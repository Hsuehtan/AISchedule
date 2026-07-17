import {
  smartInboxResponseSchema,
  type SmartInboxQuery,
  type SmartInboxResponse,
  type SmartInboxScope,
} from '@ai-schedule/contracts';
import { Inject, Injectable, Optional } from '@nestjs/common';

import { ApiHttpException } from '../../platform/http/api-http.exception.js';
import {
  SMART_INBOX_READ_PORT,
  SMART_INBOX_CLOCK,
  type SmartInboxGlobalState,
  type SmartInboxReadPort,
  type SmartInboxResumeTarget,
  type SmartInboxScopeState,
} from './smart-inbox.port.js';

type ResumeKind =
  | 'AWAITING_CONFIRMATION'
  | 'AWAITING_CLARIFICATION'
  | 'PROCESSING'
  | 'EXECUTION_FAILED'
  | 'UNREAD_REPLY';

const GLOBAL_PRIORITY: ReadonlyArray<readonly [ResumeKind, keyof SmartInboxGlobalState]> = [
  ['AWAITING_CONFIRMATION', 'awaitingConfirmation'],
  ['AWAITING_CLARIFICATION', 'awaitingClarification'],
  ['PROCESSING', 'processing'],
  ['EXECUTION_FAILED', 'executionFailed'],
  ['UNREAD_REPLY', 'unreadReply'],
];

@Injectable()
export class SmartInboxService {
  constructor(
    @Inject(SMART_INBOX_READ_PORT) private readonly readPort: SmartInboxReadPort,
    @Optional()
    @Inject(SMART_INBOX_CLOCK)
    private readonly now: () => Date = () => new Date(),
  ) {}

  async get(
    input: Readonly<{ query: SmartInboxQuery; userId: string }>,
  ): Promise<SmartInboxResponse> {
    const scope = this.scopeFrom(input.query);
    const [globalState, scopeState] = await Promise.all([
      this.readPort.loadGlobalState({
        userId: input.userId,
        now: this.now(),
      }),
      this.readPort.loadScopeState({ userId: input.userId, scope }),
    ]);
    const resume = this.selectResume(globalState);
    if (resume) return smartInboxResponseSchema.parse({ item: this.resumeItem(...resume) });

    return smartInboxResponseSchema.parse({ item: this.scopeItem(scopeState) });
  }

  async assertOrganizeEligible(
    input: Readonly<{ scope: SmartInboxScope; userId: string }>,
  ): Promise<{
    eligibleTaskCount: number;
  }> {
    const scopeState = await this.readPort.loadScopeState(input);
    if (scopeState.organizeCandidateCount === 0) {
      throw new ApiHttpException(409, 'AGENT_REQUEST_CONFLICT', '暂无可整理的无项目待办');
    }
    return { eligibleTaskCount: scopeState.organizeCandidateCount };
  }

  private scopeFrom(query: SmartInboxQuery): SmartInboxScope {
    return query.projectId ? { type: 'PROJECT', projectId: query.projectId } : { type: 'ALL' };
  }

  private selectResume(
    state: SmartInboxGlobalState,
  ): readonly [ResumeKind, SmartInboxResumeTarget] | null {
    for (const [kind, key] of GLOBAL_PRIORITY) {
      const target = state[key];
      if (target) return [kind, target];
    }
    return null;
  }

  private resumeItem(kind: ResumeKind, target: SmartInboxResumeTarget) {
    return {
      kind,
      title: target.title,
      body: target.body,
      action: {
        type: 'RESUME_CONVERSATION' as const,
        conversationId: target.conversationId,
        messageId: target.messageId,
        proposalId: target.proposalId,
        requestId: target.requestId,
      },
    };
  }

  private scopeItem(state: SmartInboxScopeState) {
    if (state.organizeCandidateCount > 0) {
      return {
        kind: 'ORGANIZE_TASKS' as const,
        title: `发现 ${state.organizeCandidateCount} 个无项目待办`,
        body:
          state.organizeCandidateCount === 20
            ? '可以为它们建议项目归属，本次最多整理 20 项'
            : '可以为它们建议项目归属',
        action: { type: 'ORGANIZE_TASKS' as const, scope: state.scope },
      };
    }
    if (state.todoCount === 0) {
      return {
        kind: 'EMPTY_SCOPE' as const,
        title: '今天已经清空',
        body:
          state.scope.type === 'PROJECT'
            ? `${state.projectName ?? '当前项目'}暂时没有待处理事项`
            : '当前范围暂时没有待处理事项',
        action: { type: 'CREATE_TASK' as const },
      };
    }
    if (state.scope.type === 'PROJECT') {
      return {
        kind: 'CURRENT_SCOPE' as const,
        title: `${state.projectName ?? '当前项目'} · ${state.todoCount} 件待办`,
        body: '可以告诉 Agent 你想怎样处理当前项目',
        action: { type: 'START_AGENT' as const },
      };
    }
    return {
      kind: 'DEFAULT' as const,
      title: '告诉我下一件事',
      body: '可以用自然语言描述待办',
      action: { type: 'START_AGENT' as const },
    };
  }
}
