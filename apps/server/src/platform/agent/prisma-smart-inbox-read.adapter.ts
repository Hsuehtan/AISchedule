import { Inject, Injectable } from '@nestjs/common';

import type {
  SmartInboxGlobalState,
  SmartInboxReadPort,
  SmartInboxResumeTarget,
  SmartInboxScopeState,
} from '../../modules/agent/smart-inbox.port.js';
import {
  AGENT_PROJECTS_PORT,
  type AgentProjectsPort,
} from '../../modules/projects/agent-projects.port.js';
import { AGENT_TASKS_PORT, type AgentTasksPort } from '../../modules/tasks/agent-tasks.port.js';
import { DatabaseService } from '../database/database.service.js';
import { UNIT_OF_WORK, type UnitOfWork } from '../database/unit-of-work.js';
import { ApiHttpException } from '../http/api-http.exception.js';

const ORGANIZE_BATCH_LIMIT = 20;
const PROCESSING_STATUSES = ['QUEUED', 'RUNNING', 'RESULT_PERSISTED', 'SETTLING'] as const;

function boundedText(value: string | null | undefined, fallback: string, maximum: number): string {
  const normalized = value?.trim() || fallback;
  return Array.from(normalized).slice(0, maximum).join('');
}

function target(input: {
  body: string;
  conversationId: string;
  messageId?: string | null;
  occurredAt: Date;
  proposalId?: string | null;
  requestId?: string | null;
  title: string;
}): SmartInboxResumeTarget {
  return {
    body: boundedText(input.body, '打开查看详情', 300),
    conversationId: input.conversationId,
    messageId: input.messageId ?? null,
    occurredAt: input.occurredAt,
    proposalId: input.proposalId ?? null,
    requestId: input.requestId ?? null,
    title: boundedText(input.title, '继续处理', 120),
  };
}

@Injectable()
export class PrismaSmartInboxReadAdapter implements SmartInboxReadPort {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(AGENT_TASKS_PORT) private readonly tasks: AgentTasksPort,
    @Inject(AGENT_PROJECTS_PORT) private readonly projects: AgentProjectsPort,
  ) {}

  async loadGlobalState(
    input: Readonly<{ now: Date; userId: string }>,
  ): Promise<SmartInboxGlobalState> {
    const [proposal, question, processing, failed, unread] = await Promise.all([
      this.database.client.actionProposal.findFirst({
        where: {
          userId: input.userId,
          status: 'AWAITING_CONFIRMATION',
          conversationId: { not: null },
          requestRun: { status: 'SUCCEEDED' },
          OR: [{ expiresAt: null }, { expiresAt: { gt: input.now } }],
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          conversationId: true,
          title: true,
          summary: true,
          updatedAt: true,
        },
      }),
      this.database.client.message.findFirst({
        where: {
          userId: input.userId,
          role: 'ASSISTANT',
          messageType: 'QUESTION',
          interactionStatus: 'PENDING',
          requestRun: { is: { status: 'SUCCEEDED' } },
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        select: { id: true, conversationId: true, content: true, updatedAt: true },
      }),
      this.database.client.agentRequestRun.findFirst({
        where: {
          userId: input.userId,
          conversationId: { not: null },
          status: { in: [...PROCESSING_STATUSES] },
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        select: { id: true, conversationId: true, updatedAt: true },
      }),
      this.database.client.actionProposal.findFirst({
        where: {
          userId: input.userId,
          conversationId: { not: null },
          lastDismissedAt: null,
          requestRun: { status: 'SUCCEEDED' },
          status: 'FAILED',
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          conversationId: true,
          title: true,
          summary: true,
          updatedAt: true,
        },
      }),
      this.findLatestUnreadReply(input.userId),
    ]);

    return {
      awaitingConfirmation:
        proposal?.conversationId == null
          ? null
          : target({
              title: proposal.title ?? '有一项操作待确认',
              body: proposal.summary,
              conversationId: proposal.conversationId,
              proposalId: proposal.id,
              occurredAt: proposal.updatedAt,
            }),
      awaitingClarification:
        question == null
          ? null
          : target({
              title: '需要你补充信息',
              body: question.content,
              conversationId: question.conversationId,
              messageId: question.id,
              occurredAt: question.updatedAt,
            }),
      processing:
        processing?.conversationId == null
          ? null
          : target({
              title: 'Agent 正在处理中',
              body: '处理完成后会在这里提醒你',
              conversationId: processing.conversationId,
              requestId: processing.id,
              occurredAt: processing.updatedAt,
            }),
      executionFailed:
        failed?.conversationId == null
          ? null
          : target({
              title: failed.title ?? '上次操作未完成',
              body: failed.summary,
              conversationId: failed.conversationId,
              proposalId: failed.id,
              occurredAt: failed.updatedAt,
            }),
      unreadReply:
        unread == null
          ? null
          : target({
              title: 'Agent 已回复',
              body: unread.content,
              conversationId: unread.conversationId,
              messageId: unread.id,
              occurredAt: unread.createdAt,
            }),
    };
  }

  async loadScopeState(
    input: Parameters<SmartInboxReadPort['loadScopeState']>[0],
  ): Promise<SmartInboxScopeState> {
    return this.unitOfWork.run(async (scope) => {
      const projectName =
        input.scope.type === 'PROJECT'
          ? await this.projects.findActiveAgentProjectName(scope, {
              userId: input.userId,
              projectId: input.scope.projectId,
            })
          : null;
      if (input.scope.type === 'PROJECT' && projectName === null) {
        throw new ApiHttpException(404, 'AGENT_REQUEST_NOT_FOUND', '项目不存在或不可用');
      }
      const counts = await this.tasks.getAgentScopeCounts(scope, {
        userId: input.userId,
        ...(input.scope.type === 'PROJECT' ? { projectId: input.scope.projectId } : {}),
      });
      return {
        organizeCandidateCount: Math.min(counts.unprojectedTodoCount, ORGANIZE_BATCH_LIMIT),
        projectName,
        scope: input.scope,
        todoCount: counts.todoCount,
      };
    });
  }

  private async findLatestUnreadReply(userId: string) {
    const rows = await this.database.client.$queryRaw<
      Array<{
        id: string;
        conversationId: string;
        content: string;
        createdAt: Date;
      }>
    >`
      SELECT
        message."id",
        message."conversation_id" AS "conversationId",
        message."content",
        message."created_at" AS "createdAt"
      FROM "messages" AS message
      INNER JOIN "conversation_sessions" AS conversation
        ON conversation."id" = message."conversation_id"
      INNER JOIN "agent_request_runs" AS run
        ON run."id" = message."request_run_id"
      LEFT JOIN "messages" AS viewed
        ON viewed."id" = conversation."last_viewed_message_id"
      WHERE message."user_id" = ${userId}::uuid
        AND message."role"::text = 'ASSISTANT'
        AND message."message_type"::text = 'AI_REPLY'
        AND run."status"::text = 'SUCCEEDED'
        AND (
          viewed."id" IS NULL
          OR message."created_at" > viewed."created_at"
          OR (message."created_at" = viewed."created_at" AND message."id" > viewed."id")
        )
      ORDER BY message."created_at" DESC, message."id" DESC
      LIMIT 1
    `;
    return rows[0] ?? null;
  }
}
