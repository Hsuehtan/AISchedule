import {
  agentRequestResponseSchema,
  agentTurnQueuedResponseSchema,
  type AgentRequestResponse,
} from '@ai-schedule/contracts';
import { executeRequestSchema } from '@ai-schedule/contracts/internal-agent/v2';

import type {
  AgentAdmissionPort,
  IdempotencyClaim,
} from '../../modules/agent/agent-admission.port.js';
import { type AgentProcessingClaim } from '../../modules/agent/agent-runtime.port.js';
import { type AgentProjectsPort } from '../../modules/projects/agent-projects.port.js';
import { type AgentTasksPort } from '../../modules/tasks/agent-tasks.port.js';
import type { DatabaseService } from '../database/database.service.js';
import type { DatabaseUnitOfWork } from '../database/unit-of-work.js';
import { type TransactionScope } from '../database/unit-of-work.js';

import {
  AgentPersistenceInvariantError,
  AgentPersistenceSupport,
  HTTP_ACCEPTED,
  RECOVERY_LEASE_BUFFER_MS,
  asJson,
  conflict,
  notFound,
  serviceUnavailable,
  sha256,
} from './agent-persistence.shared.js';
import type { PrismaAgentConversationStore } from './prisma-agent-conversation.store.js';

export class PrismaAgentRunStore extends AgentPersistenceSupport {
  constructor(
    unitOfWork: DatabaseUnitOfWork,
    database: DatabaseService,
    tasks: AgentTasksPort,
    projects: AgentProjectsPort,
    private readonly conversation: PrismaAgentConversationStore,
  ) {
    super(unitOfWork, database, tasks, projects);
  }
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
    const source = await this.conversation.materializeSource(
      scope,
      transaction,
      input.userId,
      input.source,
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
        contractVersion: '2.0',
        allowedResultTypes: [...input.allowedResultTypes],
        idempotencyKey: input.idempotencyKey,
        extra: {
          candidateExpiresAt: input.timing.candidateExpiresAt.toISOString(),
          admissionTiming: {
            executeTimeoutAt: input.timing.executeTimeoutAt.toISOString(),
            runDeadlineAt: input.timing.runDeadlineAt.toISOString(),
            recoveryEligibleAt: input.timing.recoveryEligibleAt.toISOString(),
          },
          ...source.runExtra,
        },
      },
    });
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
        contractVersion: '2.0',
        extra: asJson({
          ...this.jsonRecord(run.extra ?? {}),
          ...(run.contractVersion !== '2.0'
            ? { originalContractVersion: run.contractVersion }
            : {}),
        }),
        dispatchAttemptedAt: input.now,
        executeTimeoutAt,
        runDeadlineAt: deadline,
        recoveryEligibleAt: recoverAfter,
        modelStartedAt: input.now,
      },
    });
    if (changed.count !== 1) return { kind: 'WAIT', retryAt: recoverAfter };

    const request = executeRequestSchema.parse({
      contractVersion: '2.0',
      requestId: run.id,
      capabilityCode: run.capabilityCode,
      deadlineAt: executeTimeoutAt.toISOString(),
      locale: run.user.locale,
      timezone: run.user.timezone,
      allowedResultTypes: run.allowedResultTypes,
    });
    return {
      kind: 'DISPATCH',
      ...reservation,
      request,
      leaseExpiresAt: new Date(recoverAfter.getTime() + RECOVERY_LEASE_BUFFER_MS),
    };
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
        errorDetail: {
          classification: 'AMBIGUOUS_TRANSPORT',
          observedAt: input.observedAt.toISOString(),
        },
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

  async getRequest(
    input: Readonly<{ userId: string; requestId: string }>,
  ): Promise<AgentRequestResponse> {
    const run = await this.database.client.agentRequestRun.findFirst({
      where: { id: input.requestId, userId: input.userId },
      include: {
        resultMessage: true,
        resultProposal: { include: { mutations: { orderBy: { sequence: 'asc' } } } },
      },
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
    if (!run.settledAt || !run.resultType) throw serviceUnavailable();
    if (run.resultType === 'PLAN' || run.resultType === 'ACTION_PROPOSAL') {
      if (!run.resultProposal) throw serviceUnavailable();
      return agentRequestResponseSchema.parse({
        requestId: run.id,
        conversationId: run.conversationId,
        status: 'SUCCEEDED',
        result: {
          type: run.resultType,
          proposal: this.publicProposal(run.resultProposal, run.resultType),
        },
        completedAt: run.settledAt.toISOString(),
      });
    }
    if (!run.resultMessage) throw serviceUnavailable();
    const message = this.publicMessage(run.resultMessage, run.id);
    return agentRequestResponseSchema.parse({
      requestId: run.id,
      conversationId: run.conversationId,
      status: 'SUCCEEDED',
      result: { type: run.resultType, message },
      completedAt: run.settledAt.toISOString(),
    });
  }
}
