import { createHash } from 'node:crypto';

import {
  agentMessageSchema,
  agentRequestResponseSchema,
  agentTurnQueuedResponseSchema,
  conversationMessagesResponseSchema,
  conversationViewedResponseSchema,
  type AgentMessage,
  type AgentRequestResponse,
  type ConversationMessagesResponse,
  type ConversationViewedResponse,
} from '@ai-schedule/contracts';
import {
  candidateContextSchema,
  executeRequestSchema,
  type ExecuteResponse,
} from '@ai-schedule/contracts/internal-agent/v1';
import { Prisma } from '@ai-schedule/db';
import { Inject, Injectable } from '@nestjs/common';

import type {
  AgentAdmissionPort,
  AgentRunSource,
  IdempotencyClaim,
} from '../../modules/agent/agent-admission.port.js';
import { createCandidateReference, selectBoundedAgentMessages } from '../../modules/agent/agent-context.js';
import type { AgentProductPort } from '../../modules/agent/agent-product.port.js';
import type {
  AgentProcessingClaim,
  AgentRunPort,
} from '../../modules/agent/agent-runtime.port.js';
import { ApiHttpException } from '../http/api-http.exception.js';
import { DatabaseService } from '../database/database.service.js';
import {
  DatabaseUnitOfWork,
  type TransactionScope,
} from '../database/unit-of-work.js';

const INTERNAL_CONTRACT_VERSION = '1.0' as const;
const HTTP_ACCEPTED = 202;
const RECOVERY_LEASE_BUFFER_MS = 60_000;

type Transaction = Prisma.TransactionClient;
type CandidateSeed = Readonly<{
  userId: string;
  candidateRef: string;
  kind: 'PROJECT' | 'TASK';
  taskId?: string;
  projectId?: string;
  targetVersion: number;
  label: string;
  snapshot: Prisma.InputJsonValue;
  expiresAt: Date;
}>;

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
    .join(',')}}`;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(stableJson(value), 'utf8').digest('hex');
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function notFound(code = 'AGENT_REQUEST_NOT_FOUND', message = '智能请求不存在') {
  return new ApiHttpException(404, code, message);
}

function conflict(message: string) {
  return new ApiHttpException(409, 'AGENT_REQUEST_CONFLICT', message);
}

function serviceUnavailable() {
  return new ApiHttpException(503, 'AGENT_RESULT_UNAVAILABLE', '智能处理暂不可用');
}

function nextStep(value: 'AGENT_PLAN' | 'AGENT_STANDARD' | 'DETERMINISTIC') {
  switch (value) {
    case 'AGENT_PLAN':
      return 'AGENT_PLAN_GENERATION' as const;
    case 'AGENT_STANDARD':
      return 'AGENT_STANDARD_TURN' as const;
    case 'DETERMINISTIC':
      return 'DETERMINISTIC' as const;
  }
}

@Injectable()
export class PrismaAgentPersistence
  implements AgentAdmissionPort, AgentRunPort, AgentProductPort
{
  constructor(
    @Inject(DatabaseUnitOfWork) private readonly unitOfWork: DatabaseUnitOfWork,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async claimIdempotency(
    scope: TransactionScope,
    input: Readonly<{
      userId: string;
      scope: string;
      key: string;
      request: unknown;
      expiresAt: Date;
    }>,
  ): Promise<IdempotencyClaim> {
    const transaction = this.unitOfWork.clientFor(scope);
    const now = new Date();
    await transaction.idempotencyRecord.deleteMany({
      where: {
        userId: input.userId,
        scope: input.scope,
        key: input.key,
        expiresAt: { lte: now },
      },
    });

    const requestHash = sha256(input.request);
    const claimed = await transaction.idempotencyRecord.createMany({
      data: {
        userId: input.userId,
        scope: input.scope,
        key: input.key,
        requestHash,
        expiresAt: input.expiresAt,
      },
      skipDuplicates: true,
    });
    if (claimed.count === 1) return { kind: 'CLAIMED' };

    const existing = await transaction.idempotencyRecord.findUnique({
      where: { userId_scope_key: { userId: input.userId, scope: input.scope, key: input.key } },
    });
    if (!existing || existing.requestHash !== requestHash) {
      throw conflict('该 Idempotency-Key 已用于不同请求');
    }
    if (existing.responseSnapshot === null) {
      throw conflict('同一智能请求正在处理中，请稍后重试');
    }
    const parsed = agentTurnQueuedResponseSchema.safeParse(existing.responseSnapshot);
    if (!parsed.success) throw serviceUnavailable();
    return { kind: 'REPLAY', response: parsed.data };
  }

  async createRun(
    scope: TransactionScope,
    input: Parameters<AgentAdmissionPort['createRun']>[1],
  ): Promise<Readonly<{ conversationId: string }>> {
    const transaction = this.unitOfWork.clientFor(scope);
    const source = await this.materializeSource(transaction, input.userId, input.source);
    const candidates = await this.createCandidates(
      transaction,
      input.userId,
      input.source,
      input.timing.candidateExpiresAt,
    );

    await transaction.agentRequestRun.create({
      data: {
        id: input.runId,
        userId: input.userId,
        conversationId: source.conversationId,
        sourceMessageId: source.messageId,
        sourceProposalId: source.proposalId,
        capabilityCode: input.capabilityCode,
        endpointCode: input.endpointCode,
        contractVersion: INTERNAL_CONTRACT_VERSION,
        allowedResultTypes: [...input.allowedResultTypes],
        idempotencyKey: input.idempotencyKey,
        extra: {
          admissionTiming: {
            executeTimeoutAt: input.timing.executeTimeoutAt.toISOString(),
            runDeadlineAt: input.timing.runDeadlineAt.toISOString(),
            recoveryEligibleAt: input.timing.recoveryEligibleAt.toISOString(),
          },
        },
      },
    });
    if (candidates.length > 0) {
      await transaction.agentRequestCandidateRef.createMany({
        data: candidates.map((candidate) => ({ ...candidate, requestRunId: input.runId })),
      });
    }
    return { conversationId: source.conversationId };
  }

  async attachReservation(
    scope: TransactionScope,
    input: Readonly<{ runId: string; userId: string; reservationId: string }>,
  ): Promise<void> {
    const transaction = this.unitOfWork.clientFor(scope);
    const updated = await transaction.agentRequestRun.updateMany({
      where: { id: input.runId, userId: input.userId, reservationId: null },
      data: { reservationId: input.reservationId },
    });
    if (updated.count !== 1) throw conflict('智能请求无法关联积分预留');
  }

  async completeIdempotency(
    scope: TransactionScope,
    input: Parameters<AgentAdmissionPort['completeIdempotency']>[1],
  ): Promise<void> {
    const transaction = this.unitOfWork.clientFor(scope);
    const updated = await transaction.idempotencyRecord.updateMany({
      where: { userId: input.userId, scope: input.scope, key: input.key },
      data: { responseStatus: HTTP_ACCEPTED, responseSnapshot: asJson(input.response) },
    });
    if (updated.count !== 1) throw conflict('智能请求幂等记录不存在');
  }

  async claimProcessing(
    scope: TransactionScope,
    input: Readonly<{ runId: string; now: Date }>,
  ): Promise<AgentProcessingClaim> {
    const transaction = this.unitOfWork.clientFor(scope);
    if (!(await this.lockRun(transaction, input.runId))) return { kind: 'NONE' };

    const run = await transaction.agentRequestRun.findUnique({
      where: { id: input.runId },
      include: {
        user: { select: { locale: true, timezone: true } },
        reservation: { select: { status: true, reservationExpiresAt: true } },
        candidateRefs: { orderBy: [{ kind: 'asc' }, { candidateRef: 'asc' }] },
        conversation: {
          select: {
            messages: {
              where: { role: { in: ['USER', 'ASSISTANT'] } },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              take: 20,
              select: { role: true, content: true },
            },
          },
        },
        resultMessage: { select: { id: true } },
        resultProposal: { select: { id: true } },
      },
    });
    if (!run?.reservationId || !run.conversationId) return { kind: 'NONE' };

    const reservation = { userId: run.userId, reservationId: run.reservationId };
    if (run.status === 'SUCCEEDED' || run.status === 'RELEASED') return { kind: 'NONE' };
    if (run.status === 'FAILED') return { kind: 'RELEASE', ...reservation };
    if (run.status === 'RESULT_PERSISTED' || run.status === 'SETTLING') {
      const result = run.resultMessage
        ? { messageId: run.resultMessage.id }
        : run.resultProposal
          ? { proposalId: run.resultProposal.id }
          : null;
      if (!result) throw new AgentPersistenceInvariantError('Persisted Run has no product result');
      if (run.status === 'RESULT_PERSISTED') {
        const changed = await transaction.agentRequestRun.updateMany({
          where: { id: run.id, status: 'RESULT_PERSISTED' },
          data: { status: 'SETTLING' },
        });
        if (changed.count !== 1) return { kind: 'WAIT', retryAt: input.now };
      }
      return { kind: 'SETTLE', ...reservation, result };
    }

    if (run.status === 'RUNNING') {
      const retryAt = run.recoveryEligibleAt ?? run.runDeadlineAt ?? input.now;
      if (input.now < retryAt) return { kind: 'WAIT', retryAt };
      await transaction.agentRequestRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          errorCode: 'AGENT_RESULT_UNAVAILABLE',
          failedAt: input.now,
        },
      });
      return { kind: 'RELEASE', ...reservation };
    }

    const admissionTiming = this.admissionTiming(run.extra);
    const deadline = run.runDeadlineAt ?? admissionTiming.runDeadlineAt;
    const recoverAfter = run.recoveryEligibleAt ?? admissionTiming.recoveryEligibleAt;
    const executeTimeoutAt = run.executeTimeoutAt ?? admissionTiming.executeTimeoutAt;
    if (
      !deadline ||
      !recoverAfter ||
      input.now >= deadline ||
      input.now >= executeTimeoutAt ||
      run.dispatchAttemptedAt !== null
    ) {
      await transaction.agentRequestRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          errorCode: 'AGENT_REQUEST_EXPIRED',
          failedAt: input.now,
        },
      });
      return { kind: 'RELEASE', ...reservation };
    }
    if (run.reservation?.status !== 'PENDING') return { kind: 'NONE' };

    const changed = await transaction.agentRequestRun.updateMany({
      where: { id: run.id, status: 'QUEUED', dispatchAttemptedAt: null },
      data: {
        status: 'RUNNING',
        dispatchAttemptedAt: input.now,
        executeTimeoutAt,
        runDeadlineAt: deadline,
        recoveryEligibleAt: recoverAfter,
        modelStartedAt: input.now,
      },
    });
    if (changed.count !== 1) return { kind: 'WAIT', retryAt: recoverAfter };

    const messages = selectBoundedAgentMessages(
      [...(run.conversation?.messages ?? [])]
        .reverse()
        .map((message) => ({ role: message.role as 'ASSISTANT' | 'USER', content: message.content })),
    );
    const candidates = run.candidateRefs.map((candidate) =>
      candidateContextSchema.parse(candidate.snapshot),
    );
    const request = executeRequestSchema.parse({
      contractVersion: INTERNAL_CONTRACT_VERSION,
      requestId: run.id,
      capabilityCode: run.capabilityCode,
      deadlineAt: deadline.toISOString(),
      locale: run.user.locale,
      timezone: run.user.timezone,
      allowedResultTypes: run.allowedResultTypes,
      messages,
      candidates,
    });
    return {
      kind: 'DISPATCH',
      ...reservation,
      request,
      leaseExpiresAt: new Date(recoverAfter.getTime() + RECOVERY_LEASE_BUFFER_MS),
    };
  }

  async persistResult(
    scope: TransactionScope,
    input: Readonly<{ runId: string; response: ExecuteResponse; persistedAt: Date }>,
  ): Promise<void> {
    const transaction = this.unitOfWork.clientFor(scope);
    if (!(await this.lockRun(transaction, input.runId))) throw notFound();
    const run = await transaction.agentRequestRun.findUnique({ where: { id: input.runId } });
    if (!run || run.status !== 'RUNNING' || !run.conversationId) {
      throw new AgentPersistenceInvariantError('Run is not accepting a result');
    }
    if (run.runDeadlineAt && input.persistedAt >= run.runDeadlineAt) {
      throw new AgentLateResultError();
    }
    if (
      input.response.requestId !== run.id ||
      input.response.contractVersion !== run.contractVersion ||
      !run.allowedResultTypes.includes(input.response.result.type)
    ) {
      throw new AgentPersistenceInvariantError('Result does not match Run admission');
    }

    const materialized = await this.materializeResult(
      transaction,
      { id: run.id, userId: run.userId, conversationId: run.conversationId },
      input.response,
    );
    const updated = await transaction.agentRequestRun.updateMany({
      where: { id: run.id, status: 'RUNNING', resultPersistedAt: null },
      data: {
        status: 'RESULT_PERSISTED',
        provider: input.response.resolved.provider,
        model: input.response.resolved.model,
        promptVersion: input.response.resolved.promptVersion,
        schemaVersion: input.response.resolved.providerSchemaVersion,
        resultType: input.response.result.type,
        resultPayload: asJson(materialized.resultPayload),
        resultHash: sha256(input.response),
        resultPersistedAt: input.persistedAt,
      },
    });
    if (updated.count !== 1) throw new AgentPersistenceInvariantError('Result lost its state CAS');
  }

  async recordAmbiguousFailure(
    scope: TransactionScope,
    input: Readonly<{ runId: string; errorCode: string; observedAt: Date }>,
  ): Promise<void> {
    const transaction = this.unitOfWork.clientFor(scope);
    await transaction.agentRequestRun.updateMany({
      where: { id: input.runId, status: 'RUNNING', resultPersistedAt: null },
      data: {
        errorCode: input.errorCode.slice(0, 128),
        errorDetail: { classification: 'AMBIGUOUS_TRANSPORT', observedAt: input.observedAt.toISOString() },
      },
    });
  }

  async markFailed(
    scope: TransactionScope,
    input: Readonly<{ runId: string; errorCode: string; failedAt: Date }>,
  ): Promise<Readonly<{ reservationId: string; userId: string }>> {
    const transaction = this.unitOfWork.clientFor(scope);
    if (!(await this.lockRun(transaction, input.runId))) throw notFound();
    const run = await transaction.agentRequestRun.findUnique({ where: { id: input.runId } });
    if (!run?.reservationId) throw new AgentPersistenceInvariantError('Run has no reservation');
    if (run.status === 'FAILED') return { userId: run.userId, reservationId: run.reservationId };
    if (run.status !== 'RUNNING' || run.resultPersistedAt !== null) {
      throw new AgentPersistenceInvariantError('A persisted or terminal Run cannot fail');
    }
    await transaction.agentRequestRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        errorCode: input.errorCode.slice(0, 128),
        failedAt: input.failedAt,
      },
    });
    return { userId: run.userId, reservationId: run.reservationId };
  }

  async markSucceeded(
    scope: TransactionScope,
    input: Readonly<{ runId: string; settledAt: Date }>,
  ): Promise<void> {
    const transaction = this.unitOfWork.clientFor(scope);
    const updated = await transaction.agentRequestRun.updateMany({
      where: { id: input.runId, status: 'SETTLING', resultPersistedAt: { not: null } },
      data: { status: 'SUCCEEDED', settledAt: input.settledAt },
    });
    if (updated.count !== 1) {
      const current = await transaction.agentRequestRun.findUnique({ where: { id: input.runId } });
      if (current?.status !== 'SUCCEEDED') {
        throw new AgentPersistenceInvariantError('Run settlement state CAS failed');
      }
    }
  }

  async markReleased(
    scope: TransactionScope,
    input: Readonly<{ runId: string; releasedAt: Date }>,
  ): Promise<void> {
    const transaction = this.unitOfWork.clientFor(scope);
    const updated = await transaction.agentRequestRun.updateMany({
      where: { id: input.runId, status: 'FAILED', resultPersistedAt: null },
      data: { status: 'RELEASED', releasedAt: input.releasedAt },
    });
    if (updated.count !== 1) {
      const current = await transaction.agentRequestRun.findUnique({ where: { id: input.runId } });
      if (current?.status !== 'RELEASED') {
        throw new AgentPersistenceInvariantError('Run release state CAS failed');
      }
    }
  }

  async getRequest(input: Readonly<{ userId: string; requestId: string }>): Promise<AgentRequestResponse> {
    const run = await this.database.client.agentRequestRun.findFirst({
      where: { id: input.requestId, userId: input.userId },
      include: { resultMessage: true },
    });
    if (!run?.conversationId) throw notFound();

    if (['QUEUED', 'RUNNING', 'RESULT_PERSISTED', 'SETTLING'].includes(run.status)) {
      return agentRequestResponseSchema.parse({
        requestId: run.id,
        conversationId: run.conversationId,
        status: run.status,
        pollAfterMs: run.status === 'RUNNING' ? 2_000 : 1_000,
      });
    }
    if (run.status === 'FAILED' || run.status === 'RELEASED') {
      const expired = run.errorCode === 'AGENT_REQUEST_EXPIRED';
      return agentRequestResponseSchema.parse({
        requestId: run.id,
        conversationId: run.conversationId,
        status: run.status,
        failure: {
          code: expired ? 'AGENT_REQUEST_EXPIRED' : 'AGENT_SERVICE_UNAVAILABLE',
          message: expired ? '智能请求已过期' : '智能处理暂不可用',
          canRetry: true,
        },
        completedAt: (run.releasedAt ?? run.failedAt ?? run.updatedAt).toISOString(),
      });
    }
    if (!run.resultMessage || !run.settledAt || !run.resultType) throw serviceUnavailable();
    const message = this.publicMessage(run.resultMessage, run.id);
    if (!['REPLY', 'CLARIFICATION', 'CANDIDATES'].includes(run.resultType)) {
      throw serviceUnavailable();
    }
    return agentRequestResponseSchema.parse({
      requestId: run.id,
      conversationId: run.conversationId,
      status: 'SUCCEEDED',
      result: { type: run.resultType, message },
      completedAt: run.settledAt.toISOString(),
    });
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
        ...(cursor
          ? {
              OR: [
                { createdAt: { gt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { gt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: input.query.limit + 1,
      include: { sourceRuns: { orderBy: { createdAt: 'asc' }, take: 1, select: { id: true } } },
    });
    const hasMore = rows.length > input.query.limit;
    const page = rows.slice(0, input.query.limit);
    return conversationMessagesResponseSchema.parse({
      items: page.map((row) => this.publicMessage(row, row.requestRunId ?? row.sourceRuns[0]?.id ?? null)),
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

    const conversation = await transaction.conversationSession.findFirst({
      where: { id: input.conversationId, userId: input.userId },
      include: { lastViewedMessage: { select: { id: true, createdAt: true } } },
    });
    const target = await transaction.message.findFirst({
      where: {
        id: input.request.lastViewedMessageId,
        userId: input.userId,
        conversationId: input.conversationId,
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

  private async materializeSource(
    transaction: Transaction,
    userId: string,
    source: AgentRunSource,
  ): Promise<{ conversationId: string; messageId: string | null; proposalId: string | null }> {
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
          where: { id: replyTo.messageId, userId, conversationId, version: replyTo.version },
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
      return { conversationId, messageId: message.id, proposalId: null };
    }

    if (source.kind === 'PLAN') {
      if (source.input.source.type === 'MESSAGE') {
        const message = await transaction.message.findFirst({
          where: {
            id: source.input.source.messageId,
            userId,
            version: source.input.source.version,
          },
        });
        if (!message) throw notFound('AGENT_REQUEST_NOT_FOUND', '计划来源消息不存在');
        return { conversationId: message.conversationId, messageId: message.id, proposalId: null };
      }
      const proposal = await transaction.actionProposal.findFirst({
        where: {
          id: source.input.source.proposalId,
          userId,
          version: source.input.source.version,
        },
      });
      if (!proposal?.conversationId) throw notFound('ACTION_PROPOSAL_NOT_FOUND', '操作提案不存在');
      const lastMessage = await transaction.message.findFirst({
        where: { userId, conversationId: proposal.conversationId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      if (!lastMessage) throw notFound('AGENT_REQUEST_NOT_FOUND', '会话消息不存在');
      return {
        conversationId: proposal.conversationId,
        messageId: null,
        proposalId: proposal.id,
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
    return { conversationId: conversation.id, messageId: message.id, proposalId: null };
  }

  private async createCandidates(
    transaction: Transaction,
    userId: string,
    source: AgentRunSource,
    expiresAt: Date,
  ): Promise<CandidateSeed[]> {
    const tasks = await transaction.task.findMany({
      where: {
        userId,
        deletedAt: null,
        status: 'TODO',
        ...(source.kind === 'ORGANIZE' ? { projectId: null } : {}),
      },
      orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: source.kind === 'ORGANIZE' ? 20 : 50,
    });
    const projects = await transaction.project.findMany({
      where: { userId, status: 'ACTIVE' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 30,
    });
    const taskCandidates = tasks.map((task) => {
      const candidateRef = createCandidateReference();
      const snapshot = candidateContextSchema.parse({
        candidateRef,
        kind: 'TASK',
        label: task.title,
        version: task.version,
        priority: task.priority,
        scheduledAt: task.scheduledAt?.toISOString() ?? null,
        deadlineAt: task.deadlineAt?.toISOString() ?? null,
      });
      return {
        userId,
        candidateRef,
        kind: 'TASK' as const,
        taskId: task.id,
        targetVersion: task.version,
        label: task.title,
        snapshot: asJson(snapshot),
        expiresAt,
      };
    });
    const projectCandidates = projects.map((project) => {
      const candidateRef = createCandidateReference();
      const snapshot = candidateContextSchema.parse({
        candidateRef,
        kind: 'PROJECT',
        label: project.name,
        version: project.version,
      });
      return {
        userId,
        candidateRef,
        kind: 'PROJECT' as const,
        projectId: project.id,
        targetVersion: project.version,
        label: project.name,
        snapshot: asJson(snapshot),
        expiresAt,
      };
    });
    return [...taskCandidates, ...projectCandidates];
  }

  private admissionTiming(extra: Prisma.JsonValue): {
    executeTimeoutAt: Date;
    runDeadlineAt: Date;
    recoveryEligibleAt: Date;
  } {
    if (typeof extra !== 'object' || extra === null || Array.isArray(extra)) {
      throw new AgentPersistenceInvariantError('Run admission timing is missing');
    }
    const timing = extra.admissionTiming;
    if (typeof timing !== 'object' || timing === null || Array.isArray(timing)) {
      throw new AgentPersistenceInvariantError('Run admission timing is missing');
    }
    if (
      typeof timing.executeTimeoutAt !== 'string' ||
      typeof timing.runDeadlineAt !== 'string' ||
      typeof timing.recoveryEligibleAt !== 'string'
    ) {
      throw new AgentPersistenceInvariantError('Run admission timing is invalid');
    }
    const executeTimeoutAt = new Date(timing.executeTimeoutAt);
    const runDeadlineAt = new Date(timing.runDeadlineAt);
    const recoveryEligibleAt = new Date(timing.recoveryEligibleAt);
    if (
      !Number.isFinite(executeTimeoutAt.getTime()) ||
      !Number.isFinite(runDeadlineAt.getTime()) ||
      !Number.isFinite(recoveryEligibleAt.getTime()) ||
      !(executeTimeoutAt < runDeadlineAt && runDeadlineAt < recoveryEligibleAt)
    ) {
      throw new AgentPersistenceInvariantError('Run admission timing is invalid');
    }
    return { executeTimeoutAt, runDeadlineAt, recoveryEligibleAt };
  }

  private async materializeResult(
    transaction: Transaction,
    run: { id: string; userId: string; conversationId: string },
    response: ExecuteResponse,
  ): Promise<{ resultPayload: Record<string, unknown> }> {
    const result = response.result;
    if (result.type === 'REPLY') {
      const message = await transaction.message.create({
        data: {
          userId: run.userId,
          conversationId: run.conversationId,
          role: 'ASSISTANT',
          messageType: 'AI_REPLY',
          inputMode: 'SYSTEM',
          content: result.text,
          structuredData: { type: 'AI_REPLY', text: result.text, canGeneratePlan: result.offerPlan },
          requestRunId: run.id,
        },
      });
      return { resultPayload: { type: result.type, messageId: message.id } };
    }
    if (result.type === 'CLARIFICATION' || result.type === 'CANDIDATES') {
      const options = result.options.map((option) => ({
        id: option.optionId,
        label: option.label,
      }));
      const structuredData =
        result.type === 'CLARIFICATION'
          ? {
              type: 'QUESTION',
              questionKind: 'CLARIFICATION',
              prompt: result.question,
              options,
              allowFreeText: result.allowFreeText,
              nextStep: nextStep(result.options[0]?.nextStep ?? 'AGENT_STANDARD'),
            }
          : {
              type: 'QUESTION',
              questionKind: 'CANDIDATES',
              prompt: result.question,
              options,
              allowFreeText: true,
              nextStep: 'AGENT_STANDARD_TURN',
            };
      const message = await transaction.message.create({
        data: {
          userId: run.userId,
          conversationId: run.conversationId,
          role: 'ASSISTANT',
          messageType: 'QUESTION',
          inputMode: 'SYSTEM',
          content: result.question,
          structuredData,
          interactionStatus: 'PENDING',
          requestRunId: run.id,
        },
      });
      return { resultPayload: { type: result.type, messageId: message.id } };
    }
    throw new AgentResultNotImplementedError(result.type);
  }

  private publicMessage(
    message: {
      id: string;
      conversationId: string;
      role: 'ASSISTANT' | 'SYSTEM' | 'USER';
      messageType: 'ACTION_CONFIRM' | 'AI_REPLY' | 'QUESTION' | 'USER_INPUT' | null;
      inputMode: 'CHOICE' | 'SYSTEM' | 'TEXT' | 'VOICE' | null;
      structuredData: Prisma.JsonValue | null;
      replyToId: string | null;
      proposalId: string | null;
      interactionStatus: 'ANSWERED' | 'CLOSED' | 'PENDING' | 'SUPERSEDED' | null;
      version: number;
      createdAt: Date;
    },
    requestId: string | null,
  ): AgentMessage {
    return agentMessageSchema.parse({
      id: message.id,
      conversationId: message.conversationId,
      role: message.role,
      messageType: message.messageType,
      inputMode: message.inputMode,
      content: message.structuredData,
      replyToId: message.replyToId,
      proposalId: message.proposalId,
      interactionStatus: message.interactionStatus,
      aiRequestId: requestId,
      version: message.version,
      createdAt: message.createdAt.toISOString(),
    });
  }

  private async claimViewedIdempotency(
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

  private async lockRun(transaction: Transaction, runId: string): Promise<boolean> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "agent_request_runs" WHERE "id" = ${runId}::uuid FOR UPDATE
    `;
    return rows.length === 1;
  }
}

export class AgentPersistenceInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentPersistenceInvariantError';
  }
}

export class AgentLateResultError extends Error {
  constructor() {
    super('Agent result arrived after the Run deadline');
    this.name = 'AgentLateResultError';
  }
}

export class AgentResultNotImplementedError extends Error {
  constructor(resultType: string) {
    super(`Agent result type is not implemented in the current product slice: ${resultType}`);
    this.name = 'AgentResultNotImplementedError';
  }
}
