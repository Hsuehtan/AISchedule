import {
  agentTurnQueuedResponseSchema,
  conversationMessagesResponseSchema,
  conversationViewedResponseSchema,
  messageAnswerResponseSchema,
  type ConversationMessagesResponse,
  type ConversationViewedResponse,
  type MessageAnswerInput,
  type MessageAnswerResponse,
} from '@ai-schedule/contracts';
import type { Prisma } from '@ai-schedule/db';

import type { AgentRunSource } from '../../modules/agent/agent-admission.port.js';
import type { AgentProductPort } from '../../modules/agent/agent-product.port.js';
import { type AgentProjectsPort } from '../../modules/projects/agent-projects.port.js';
import { type AgentTasksPort } from '../../modules/tasks/agent-tasks.port.js';
import type { DatabaseService } from '../database/database.service.js';
import type { DatabaseUnitOfWork} from '../database/unit-of-work.js';
import { type TransactionScope } from '../database/unit-of-work.js';
import { ApiHttpException } from '../http/api-http.exception.js';

import type {
  AgentNextStep,
  ResolvedAnswer,
  StoredAnswerOption,
  StoredAnswerPolicy,
  Transaction} from './agent-persistence.shared.js';
import {
  AgentPersistenceSupport,
  CONSUMABLE_MESSAGE_WHERE,
  asJson,
  conflict,
  notFound,
  proposalNotExecutable,
  proposalNotFound,
  proposalVersionConflict,
  serviceUnavailable,
  sha256,
} from './agent-persistence.shared.js';
import type { PrismaAgentContextReader } from './prisma-agent-context.reader.js';
import type { PrismaAgentProposalStore } from './prisma-agent-proposal.store.js';

export class PrismaAgentConversationStore extends AgentPersistenceSupport {
  constructor(
    unitOfWork: DatabaseUnitOfWork,
    database: DatabaseService,
    tasks: AgentTasksPort,
    projects: AgentProjectsPort,
    private readonly context: PrismaAgentContextReader,
    private readonly proposal: PrismaAgentProposalStore,
  ) {
    super(unitOfWork, database, tasks, projects);
  }
  async replayAnswer(
    input: Readonly<{
      userId: string;
      conversationId: string;
      messageId: string;
      idempotencyKey: string;
      request: MessageAnswerInput;
    }>,
  ): Promise<MessageAnswerResponse | null> {
    const requestHash = sha256({
      conversationId: input.conversationId,
      messageId: input.messageId,
      ...input.request,
    });
    const records = await this.database.client.idempotencyRecord.findMany({
      where: {
        userId: input.userId,
        key: input.idempotencyKey,
        scope: 'agent.message-answer',
        expiresAt: { gt: new Date() },
      },
    });
    if (records.length === 0) return null;
    const existing = records[0];
    if (!existing || existing.requestHash !== requestHash) {
      throw conflict('该 Idempotency-Key 已用于不同请求');
    }
    if (existing.responseSnapshot === null) throw conflict('同一请求正在处理中，请稍后重试');
    const deterministic = messageAnswerResponseSchema.safeParse(existing.responseSnapshot);
    if (deterministic.success) return deterministic.data;
    const queued = agentTurnQueuedResponseSchema.safeParse(existing.responseSnapshot);
    if (queued.success) return { outcome: 'QUEUED', request: queued.data };
    throw serviceUnavailable();
  }

  async inspectAnswer(
    input: Readonly<{
      userId: string;
      conversationId: string;
      messageId: string;
      request: MessageAnswerInput;
    }>,
  ): Promise<Readonly<{ nextStep: AgentNextStep }>> {
    return this.unitOfWork.run(async (scope) => {
      const transaction = this.unitOfWork.clientFor(scope);
      const message = await transaction.message.findFirst({
        where: {
          id: input.messageId,
          userId: input.userId,
          conversationId: input.conversationId,
        },
      });
      const resolved = await this.validateQuestionAnswer(
        scope,
        transaction,
        message,
        input.request,
        new Date(),
      );
      return { nextStep: resolved.nextStep };
    });
  }

  async answerDeterministically(
    scope: TransactionScope,
    input: Readonly<{
      userId: string;
      conversationId: string;
      messageId: string;
      idempotencyKey: string;
      request: MessageAnswerInput;
    }>,
  ): Promise<MessageAnswerResponse> {
    const transaction = this.unitOfWork.clientFor(scope);
    const replay = await this.claimProductIdempotency(
      transaction,
      {
        userId: input.userId,
        scope: 'agent.message-answer',
        key: input.idempotencyKey,
        request: {
          conversationId: input.conversationId,
          messageId: input.messageId,
          ...input.request,
        },
      },
      (snapshot) => {
        const parsed = messageAnswerResponseSchema.safeParse(snapshot);
        return parsed.success ? parsed.data : null;
      },
    );
    if (replay) return replay;

    if (!(await this.lockMessage(transaction, input.userId, input.messageId))) {
      throw notFound('AGENT_REQUEST_NOT_FOUND', '问题消息不存在');
    }
    const question = await transaction.message.findFirst({
      where: {
        id: input.messageId,
        userId: input.userId,
        conversationId: input.conversationId,
      },
    });
    const resolved = await this.validateQuestionAnswer(
      scope,
      transaction,
      question,
      input.request,
      new Date(),
    );
    if (resolved.nextStep !== 'DETERMINISTIC') {
      throw conflict('该回答需要进入智能处理');
    }
    const answer = await this.createAnswerMessage(transaction, {
      userId: input.userId,
      conversationId: input.conversationId,
      questionId: input.messageId,
      request: input.request,
      resolved,
    });
    const nextCard = await transaction.message.create({
      data: {
        userId: input.userId,
        conversationId: input.conversationId,
        role: 'ASSISTANT',
        messageType: 'AI_REPLY',
        inputMode: 'SYSTEM',
        content: `已选择「${resolved.label}」`,
        structuredData: {
          type: 'AI_REPLY',
          text: `已选择「${resolved.label}」`,
          canGeneratePlan: false,
        },
        replyToId: answer.id,
        extra: { deterministic: true },
      },
    });
    const response = messageAnswerResponseSchema.parse({
      outcome: 'DETERMINISTIC',
      message: this.publicMessage(nextCard, null),
      proposal: null,
    });
    await this.completeProductIdempotency(transaction, {
      userId: input.userId,
      scope: 'agent.message-answer',
      key: input.idempotencyKey,
      response,
      responseStatus: 200,
    });
    return response;
  }

  async listMessages(
    input: Parameters<AgentProductPort['listMessages']>[0],
  ): Promise<ConversationMessagesResponse> {
    const conversation = await this.database.client.conversationSession.findFirst({
      where: { id: input.conversationId, userId: input.userId },
      select: { id: true },
    });
    if (!conversation) throw notFound('AGENT_REQUEST_NOT_FOUND', '会话不存在');

    let cursor: { createdAt: Date; id: string } | undefined;
    if (input.query.cursor) {
      const found = await this.database.client.message.findFirst({
        where: {
          id: input.query.cursor,
          userId: input.userId,
          conversationId: input.conversationId,
          ...CONSUMABLE_MESSAGE_WHERE,
        },
        select: { id: true, createdAt: true },
      });
      if (!found) throw notFound('AGENT_REQUEST_NOT_FOUND', '消息游标不存在');
      cursor = found;
    }

    const rows = await this.database.client.message.findMany({
      where: {
        userId: input.userId,
        conversationId: input.conversationId,
        AND: [
          CONSUMABLE_MESSAGE_WHERE,
          ...(cursor
            ? [
                {
                  OR: [
                    { createdAt: { gt: cursor.createdAt } },
                    { createdAt: cursor.createdAt, id: { gt: cursor.id } },
                  ],
                },
              ]
            : []),
        ],
      },
      orderBy: cursor
        ? [{ createdAt: 'asc' as const }, { id: 'asc' as const }]
        : [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
      take: input.query.limit + 1,
      include: { sourceRuns: { orderBy: { createdAt: 'asc' }, take: 1, select: { id: true } } },
    });
    const hasMore = cursor !== undefined && rows.length > input.query.limit;
    const bounded = rows.slice(0, input.query.limit);
    const page = cursor ? bounded : bounded.reverse();
    return conversationMessagesResponseSchema.parse({
      items: page.map((row) =>
        this.publicMessage(row, row.requestRunId ?? row.sourceRuns[0]?.id ?? null),
      ),
      pageInfo: { nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null },
    });
  }

  async markConversationViewed(
    scope: TransactionScope,
    input: Parameters<AgentProductPort['markConversationViewed']>[1],
  ): Promise<ConversationViewedResponse> {
    const transaction = this.unitOfWork.clientFor(scope);
    const replay = await this.claimViewedIdempotency(transaction, input);
    if (replay) return replay;

    const locked = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "conversation_sessions"
      WHERE "id" = ${input.conversationId}::uuid
        AND "user_id" = ${input.userId}::uuid
      FOR UPDATE
    `;
    if (locked.length !== 1) throw notFound('AGENT_REQUEST_NOT_FOUND', '会话不存在');

    const conversation = await transaction.conversationSession.findFirst({
      where: { id: input.conversationId, userId: input.userId },
      include: { lastViewedMessage: { select: { id: true, createdAt: true } } },
    });
    const target = await transaction.message.findFirst({
      where: {
        id: input.request.lastViewedMessageId,
        userId: input.userId,
        conversationId: input.conversationId,
        ...CONSUMABLE_MESSAGE_WHERE,
      },
      select: { id: true, createdAt: true },
    });
    if (!conversation || !target) throw notFound('AGENT_REQUEST_NOT_FOUND', '会话消息不存在');

    const current = conversation.lastViewedMessage;
    const shouldAdvance =
      !current ||
      target.createdAt > current.createdAt ||
      (target.createdAt.getTime() === current.createdAt.getTime() && target.id > current.id);
    const viewedAt = new Date();
    const lastViewedMessageId = shouldAdvance ? target.id : current.id;
    if (shouldAdvance) {
      await transaction.conversationSession.update({
        where: { id: conversation.id },
        data: { lastViewedMessageId, lastViewedAt: viewedAt },
      });
    }
    const response = conversationViewedResponseSchema.parse({
      lastViewedMessageId,
      viewedAt: (shouldAdvance ? viewedAt : (conversation.lastViewedAt ?? viewedAt)).toISOString(),
    });
    await transaction.idempotencyRecord.update({
      where: {
        userId_scope_key: {
          userId: input.userId,
          scope: 'agent.conversation-viewed',
          key: input.idempotencyKey,
        },
      },
      data: { responseStatus: 200, responseSnapshot: asJson(response) },
    });
    return response;
  }

  async validateQuestionAnswer(
    scope: TransactionScope,
    transaction: Transaction,
    message: Awaited<ReturnType<Transaction['message']['findFirst']>>,
    request: MessageAnswerInput,
    now: Date,
  ): Promise<ResolvedAnswer> {
    if (!message) throw notFound('AGENT_REQUEST_NOT_FOUND', '问题消息不存在');
    await this.assertMessageConsumable(transaction, message, '问题消息不存在');
    if (
      message.messageType !== 'QUESTION' ||
      message.interactionStatus !== 'PENDING' ||
      message.version !== request.version
    ) {
      throw new ApiHttpException(
        409,
        'AGENT_MESSAGE_VERSION_CONFLICT',
        '问题已发生变化，请刷新后重试',
        { currentVersion: message.version },
      );
    }
    const policy = this.answerPolicy(message.extra);
    let resolved: ResolvedAnswer;
    if (request.answer.type === 'TEXT') {
      if (!policy.allowFreeText) throw conflict('该问题不接受补充文本');
      resolved = {
        label: request.answer.text,
        nextStep: policy.freeTextNextStep,
      };
    } else {
      const optionId = request.answer.optionId;
      const option = policy.options.find((candidate) => candidate.optionId === optionId);
      if (!option) throw conflict('问题选项不存在，请刷新后重试');
      resolved = option;
    }
    if (resolved.candidateRef) {
      if (!message.requestRunId) throw serviceUnavailable();
      await this.context.requireCandidate(scope, transaction, {
        runId: message.requestRunId,
        userId: message.userId,
        candidateRef: resolved.candidateRef,
        now,
      });
    }
    return resolved;
  }

  answerPolicy(extra: Prisma.JsonValue): StoredAnswerPolicy {
    if (typeof extra !== 'object' || extra === null || Array.isArray(extra)) {
      throw serviceUnavailable();
    }
    const raw = extra.answerPolicy;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw serviceUnavailable();
    }
    if (
      typeof raw.allowFreeText !== 'boolean' ||
      typeof raw.freeTextNextStep !== 'string' ||
      !['AGENT_PLAN_GENERATION', 'AGENT_STANDARD_TURN'].includes(raw.freeTextNextStep) ||
      !Array.isArray(raw.options)
    ) {
      throw serviceUnavailable();
    }
    const options = raw.options.map((value): StoredAnswerOption => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw serviceUnavailable();
      }
      if (
        typeof value.optionId !== 'string' ||
        typeof value.label !== 'string' ||
        typeof value.nextStep !== 'string' ||
        !['AGENT_PLAN_GENERATION', 'AGENT_STANDARD_TURN', 'DETERMINISTIC'].includes(
          value.nextStep,
        ) ||
        (value.candidateRef !== undefined && typeof value.candidateRef !== 'string')
      ) {
        throw serviceUnavailable();
      }
      return {
        optionId: value.optionId,
        label: value.label,
        nextStep: value.nextStep as AgentNextStep,
        ...(typeof value.candidateRef === 'string' ? { candidateRef: value.candidateRef } : {}),
      };
    });
    return {
      allowFreeText: raw.allowFreeText,
      freeTextNextStep: raw.freeTextNextStep as Exclude<AgentNextStep, 'DETERMINISTIC'>,
      options,
    };
  }

  async createAnswerMessage(
    transaction: Transaction,
    input: Readonly<{
      userId: string;
      conversationId: string;
      questionId: string;
      request: MessageAnswerInput;
      resolved: ResolvedAnswer;
    }>,
  ) {
    const changed = await transaction.message.updateMany({
      where: {
        id: input.questionId,
        userId: input.userId,
        conversationId: input.conversationId,
        version: input.request.version,
        interactionStatus: 'PENDING',
      },
      data: { interactionStatus: 'ANSWERED', version: { increment: 1 } },
    });
    if (changed.count !== 1) {
      throw new ApiHttpException(
        409,
        'AGENT_MESSAGE_VERSION_CONFLICT',
        '问题已发生变化，请刷新后重试',
      );
    }
    return transaction.message.create({
      data: {
        userId: input.userId,
        conversationId: input.conversationId,
        role: 'USER',
        messageType: 'USER_INPUT',
        inputMode: input.request.answer.type === 'OPTION' ? 'CHOICE' : 'TEXT',
        content: input.resolved.label,
        structuredData: { type: 'USER_INPUT', text: input.resolved.label },
        replyToId: input.questionId,
        extra: {
          answerSource: {
            type: input.request.answer.type,
            ...(input.request.answer.type === 'OPTION'
              ? { optionId: input.request.answer.optionId }
              : {}),
            ...(input.resolved.candidateRef ? { candidateRef: input.resolved.candidateRef } : {}),
            nextStep: input.resolved.nextStep,
          },
        },
      },
    });
  }

  async materializeSource(
    scope: TransactionScope,
    transaction: Transaction,
    userId: string,
    source: AgentRunSource,
  ): Promise<{
    conversationId: string;
    messageId: string | null;
    proposalId: string | null;
    runExtra: Record<string, Prisma.InputJsonValue>;
  }> {
    if (source.kind === 'TURN') {
      const text = source.input.input.text;
      const requestedConversationId = source.input.conversationId;
      let conversationId: string;
      if (requestedConversationId) {
        const conversation = await transaction.conversationSession.findFirst({
          where: { id: requestedConversationId, userId, status: 'ACTIVE' },
        });
        if (!conversation) throw notFound('AGENT_REQUEST_NOT_FOUND', '会话不存在');
        conversationId = conversation.id;
      } else {
        const conversation = await transaction.conversationSession.create({
          data: { userId, initialInput: text, title: text.slice(0, 80) },
        });
        conversationId = conversation.id;
      }
      const replyTo = source.input.input.replyTo;
      if (replyTo) {
        const parent = await transaction.message.findFirst({
          where: {
            id: replyTo.messageId,
            userId,
            conversationId,
            version: replyTo.version,
            ...CONSUMABLE_MESSAGE_WHERE,
          },
        });
        if (!parent) {
          throw new ApiHttpException(
            409,
            'AGENT_MESSAGE_VERSION_CONFLICT',
            '消息已发生变化，请刷新后重试',
          );
        }
      }
      const message = await transaction.message.create({
        data: {
          userId,
          conversationId,
          role: 'USER',
          messageType: 'USER_INPUT',
          inputMode: 'TEXT',
          content: text,
          structuredData: { type: 'USER_INPUT', text },
          ...(replyTo ? { replyToId: replyTo.messageId } : {}),
        },
      });
      return { conversationId, messageId: message.id, proposalId: null, runExtra: {} };
    }

    if (source.kind === 'ANSWER') {
      if (!(await this.lockMessage(transaction, userId, source.input.messageId))) {
        throw notFound('AGENT_REQUEST_NOT_FOUND', '问题消息不存在');
      }
      const question = await transaction.message.findFirst({
        where: {
          id: source.input.messageId,
          userId,
          conversationId: source.input.conversationId,
        },
      });
      const resolved = await this.validateQuestionAnswer(
        scope,
        transaction,
        question,
        source.input.answer,
        new Date(),
      );
      if (resolved.nextStep !== source.input.expectedNextStep) {
        throw conflict('问题选项已发生变化，请刷新后重试');
      }
      const answer = await this.createAnswerMessage(transaction, {
        userId,
        conversationId: source.input.conversationId,
        questionId: source.input.messageId,
        request: source.input.answer,
        resolved,
      });
      return {
        conversationId: source.input.conversationId,
        messageId: answer.id,
        proposalId: null,
        runExtra: {
          answerSource: {
            questionId: source.input.messageId,
            nextStep: resolved.nextStep,
          },
        },
      };
    }

    if (source.kind === 'PLAN') {
      if (source.input.source.type === 'MESSAGE') {
        const message = await transaction.message.findFirst({
          where: {
            id: source.input.source.messageId,
            userId,
            ...CONSUMABLE_MESSAGE_WHERE,
          },
        });
        if (!message) throw notFound('AGENT_REQUEST_NOT_FOUND', '计划来源消息不存在');
        if (message.version !== source.input.source.version) {
          throw new ApiHttpException(
            409,
            'AGENT_MESSAGE_VERSION_CONFLICT',
            '消息已发生变化，请刷新后重试',
          );
        }
        const instruction = source.input.instruction ?? '请基于上文生成可执行计划';
        const promptMessage = await transaction.message.create({
          data: {
            userId,
            conversationId: message.conversationId,
            role: 'USER',
            messageType: 'USER_INPUT',
            inputMode: 'TEXT',
            content: instruction,
            structuredData: { type: 'USER_INPUT', text: instruction },
            replyToId: message.id,
          },
        });
        return {
          conversationId: message.conversationId,
          messageId: promptMessage.id,
          proposalId: null,
          runExtra: { planSource: { type: 'MESSAGE', messageVersion: message.version } },
        };
      }
      const proposal = await transaction.actionProposal.findFirst({
        where: {
          id: source.input.source.proposalId,
          userId,
          requestRun: { status: 'SUCCEEDED' },
        },
        include: { mutations: { orderBy: { sequence: 'asc' } } },
      });
      if (!proposal?.conversationId) throw proposalNotFound();
      const active = await this.proposal.expireProposalIfNeeded(transaction, proposal, new Date());
      const conversationId = active.conversationId;
      if (!conversationId) throw proposalNotFound();
      if (active.version !== source.input.source.version) {
        throw proposalVersionConflict(active.version);
      }
      if (!['DRAFT', 'AWAITING_CONFIRMATION'].includes(active.status)) {
        throw proposalNotExecutable('只有待确认草稿可以重新生成');
      }
      const instruction = source.input.instruction ?? '请基于旧草稿重新生成计划';
      const previousDraft = await this.context.sanitizeProposalForAgent(scope, active);
      const internalContent = JSON.stringify({ instruction, previousDraft });
      if (
        Array.from(internalContent).length > 4_000 ||
        new TextEncoder().encode(internalContent).byteLength > 12 * 1_024
      ) {
        throw conflict('旧计划草稿超过智能上下文限制');
      }
      const promptMessage = await transaction.message.create({
        data: {
          userId,
          conversationId,
          role: 'USER',
          messageType: 'USER_INPUT',
          inputMode: 'TEXT',
          content: internalContent,
          structuredData: { type: 'USER_INPUT', text: instruction },
        },
      });
      return {
        conversationId,
        messageId: null,
        proposalId: active.id,
        runExtra: {
          planSource: {
            type: 'PROPOSAL',
            proposalVersion: active.version,
            contextMessageId: promptMessage.id,
          },
        },
      };
    }

    const text = '整理未归属项目的待办';
    const conversation = await transaction.conversationSession.create({
      data: { userId, initialInput: text, title: text },
    });
    const message = await transaction.message.create({
      data: {
        userId,
        conversationId: conversation.id,
        role: 'USER',
        messageType: 'USER_INPUT',
        inputMode: 'TEXT',
        content: text,
        structuredData: { type: 'USER_INPUT', text },
      },
    });
    return {
      conversationId: conversation.id,
      messageId: message.id,
      proposalId: null,
      runExtra: {},
    };
  }

  async claimViewedIdempotency(
    transaction: Transaction,
    input: Parameters<AgentProductPort['markConversationViewed']>[1],
  ): Promise<ConversationViewedResponse | null> {
    const scope = 'agent.conversation-viewed';
    const requestHash = sha256({ conversationId: input.conversationId, ...input.request });
    const now = new Date();
    await transaction.idempotencyRecord.deleteMany({
      where: {
        userId: input.userId,
        scope,
        key: input.idempotencyKey,
        expiresAt: { lte: now },
      },
    });
    const claimed = await transaction.idempotencyRecord.createMany({
      data: {
        userId: input.userId,
        scope,
        key: input.idempotencyKey,
        requestHash,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1_000),
      },
      skipDuplicates: true,
    });
    if (claimed.count === 1) return null;
    const existing = await transaction.idempotencyRecord.findUnique({
      where: { userId_scope_key: { userId: input.userId, scope, key: input.idempotencyKey } },
    });
    if (!existing || existing.requestHash !== requestHash) {
      throw conflict('该 Idempotency-Key 已用于不同请求');
    }
    if (existing.responseSnapshot === null) throw conflict('同一请求正在处理中，请稍后重试');
    const parsed = conversationViewedResponseSchema.safeParse(existing.responseSnapshot);
    if (!parsed.success) throw serviceUnavailable();
    return parsed.data;
  }
}
