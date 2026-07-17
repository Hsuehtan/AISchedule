import { createHash } from 'node:crypto';

import {
  actionProposalMutationResponseSchema,
  actionProposalResponseSchema,
  agentMessageSchema,
  agentRequestResponseSchema,
  agentTurnQueuedResponseSchema,
  conversationMessagesResponseSchema,
  conversationViewedResponseSchema,
  messageAnswerResponseSchema,
  publicActionProposalSchema,
  type ActionProposalEditInput,
  type ActionProposalMutationResponse,
  type ActionProposalResponse,
  type AgentMessage,
  type AgentRequestResponse,
  type ConversationMessagesResponse,
  type ConversationViewedResponse,
  type MessageAnswerInput,
  type MessageAnswerResponse,
  type PublicActionMutation,
  type PublicActionProposal,
} from '@ai-schedule/contracts';
import {
  candidateContextSchema,
  executeRequestSchema,
  type ActionMutation as InternalActionMutation,
  type ActionProposalResult,
  type ExecuteResponse,
  type PlanResult,
} from '@ai-schedule/contracts/internal-agent/v1';
import { Prisma } from '@ai-schedule/db';
import { Inject, Injectable } from '@nestjs/common';

import type {
  AgentAdmissionPort,
  AgentRunSource,
  IdempotencyClaim,
} from '../../modules/agent/agent-admission.port.js';
import {
  createCandidateReference,
  selectBoundedAgentMessages,
} from '../../modules/agent/agent-context.js';
import type { AgentProductPort } from '../../modules/agent/agent-product.port.js';
import {
  AgentResultRejectedError,
  type AgentProcessingClaim,
  type AgentRunPort,
} from '../../modules/agent/agent-runtime.port.js';
import {
  AGENT_PROJECTS_PORT,
  type AgentProjectSnapshot,
  type AgentProjectsPort,
} from '../../modules/projects/agent-projects.port.js';
import {
  AGENT_TASKS_PORT,
  type AgentTaskSnapshot,
  type AgentTasksPort,
} from '../../modules/tasks/agent-tasks.port.js';
import { ApiHttpException } from '../http/api-http.exception.js';
import { DatabaseService } from '../database/database.service.js';
import { DatabaseUnitOfWork, type TransactionScope } from '../database/unit-of-work.js';

const INTERNAL_CONTRACT_VERSION = '1.0' as const;
const HTTP_ACCEPTED = 202;
const RECOVERY_LEASE_BUFFER_MS = 60_000;
const PRODUCT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000;
const PROPOSAL_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_PROJECT_NAME_LENGTH = 40;

// Model-produced messages remain private until the originating Run has settled. Messages that
// are created entirely by the product (user input and deterministic follow-ups) have neither a
// result Run nor a Proposal and are immediately consumable.
const CONSUMABLE_MESSAGE_WHERE: Prisma.MessageWhereInput = {
  OR: [
    { role: 'USER', requestRunId: null, proposalId: null },
    {
      role: 'ASSISTANT',
      requestRunId: null,
      proposalId: null,
      extra: { path: ['deterministic'], equals: true },
    },
    { requestRun: { is: { status: 'SUCCEEDED' } } },
    { proposal: { is: { requestRun: { status: 'SUCCEEDED' } } } },
  ],
};

type AgentNextStep = 'AGENT_PLAN_GENERATION' | 'AGENT_STANDARD_TURN' | 'DETERMINISTIC';
type StoredAnswerOption = Readonly<{
  candidateRef?: string;
  label: string;
  nextStep: AgentNextStep;
  optionId: string;
}>;
type StoredAnswerPolicy = Readonly<{
  allowFreeText: boolean;
  freeTextNextStep: Exclude<AgentNextStep, 'DETERMINISTIC'>;
  options: readonly StoredAnswerOption[];
}>;
type ResolvedAnswer = Readonly<{
  candidateRef?: string;
  label: string;
  nextStep: AgentNextStep;
}>;
type ResolvedProjectSelection =
  | Readonly<{ type: 'NONE' }>
  | Readonly<{ type: 'EXISTING'; projectId: string; expectedVersion: number }>
  | Readonly<{ type: 'NEW'; name: string }>;
type NormalizedMutation = Readonly<{
  operation: 'COMPLETE' | 'CREATE' | 'RESTORE' | 'SOFT_DELETE' | 'UPDATE';
  targetType: 'PROJECT' | 'TASK';
  targetId: string | null;
  targetVersion: number | null;
  beforeValue: Record<string, unknown> | null;
  afterValue: Record<string, unknown>;
}>;

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
type ValidatedCandidate = Readonly<{
  kind: 'PROJECT' | 'TASK';
  targetVersion: number;
  task: AgentTaskSnapshot | null;
  project: AgentProjectSnapshot | null;
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

function proposalNotFound() {
  return new ApiHttpException(404, 'ACTION_PROPOSAL_NOT_FOUND', '操作提案不存在');
}

function proposalVersionConflict(currentVersion?: number) {
  return new ApiHttpException(
    409,
    'ACTION_PROPOSAL_VERSION_CONFLICT',
    '操作提案已发生变化，请刷新后重试',
    currentVersion === undefined ? {} : { currentVersion },
  );
}

function proposalNotExecutable(message = '操作提案当前不可编辑') {
  return new ApiHttpException(409, 'ACTION_PROPOSAL_NOT_EXECUTABLE', message);
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
export class PrismaAgentPersistence implements AgentAdmissionPort, AgentRunPort, AgentProductPort {
  constructor(
    @Inject(DatabaseUnitOfWork) private readonly unitOfWork: DatabaseUnitOfWork,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AGENT_TASKS_PORT) private readonly tasks: AgentTasksPort,
    @Inject(AGENT_PROJECTS_PORT) private readonly projects: AgentProjectsPort,
  ) {}

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
    const source = await this.materializeSource(scope, transaction, input.userId, input.source);
    const candidates = await this.createCandidates(
      scope,
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
          ...source.runExtra,
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
        sourceMessage: { select: { id: true, createdAt: true } },
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

    const fallbackContextMessageId = this.contextMessageId(run.extra);
    const contextMessage =
      run.sourceMessage ??
      (fallbackContextMessageId
        ? await transaction.message.findFirst({
            where: {
              id: fallbackContextMessageId,
              userId: run.userId,
              conversationId: run.conversationId,
              role: 'USER',
            },
            select: { id: true, createdAt: true },
          })
        : null);
    if (!contextMessage) {
      throw new AgentPersistenceInvariantError('Run context cutoff message is missing');
    }
    const contextRows = await transaction.message.findMany({
      where: {
        conversationId: run.conversationId,
        userId: run.userId,
        role: { in: ['USER', 'ASSISTANT'] },
        AND: [
          CONSUMABLE_MESSAGE_WHERE,
          {
            OR: [
              { createdAt: { lt: contextMessage.createdAt } },
              { createdAt: contextMessage.createdAt, id: { lte: contextMessage.id } },
            ],
          },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 20,
      select: { role: true, content: true },
    });
    const messages = selectBoundedAgentMessages(
      contextRows.reverse().map((message) => ({
        role: message.role as 'ASSISTANT' | 'USER',
        content: message.content,
      })),
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
  ): Promise<'IGNORED_TERMINAL' | 'PERSISTED'> {
    const transaction = this.unitOfWork.clientFor(scope);
    try {
      if (!(await this.lockRun(transaction, input.runId))) return 'IGNORED_TERMINAL';
      const run = await transaction.agentRequestRun.findUnique({ where: { id: input.runId } });
      if (!run) return 'IGNORED_TERMINAL';
      if (
        ['FAILED', 'RELEASED', 'RESULT_PERSISTED', 'SETTLING', 'SUCCEEDED'].includes(run.status)
      ) {
        return 'IGNORED_TERMINAL';
      }
      if (run.status !== 'RUNNING' || !run.conversationId) {
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
        scope,
        transaction,
        {
          id: run.id,
          userId: run.userId,
          conversationId: run.conversationId,
          sourceProposalId: run.sourceProposalId,
          extra: run.extra,
        },
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
          repairAttempts: input.response.resolved.repairAttempts,
          resultType: input.response.result.type,
          resultPayload: asJson(materialized.resultPayload),
          resultHash: sha256(input.response),
          resultPersistedAt: input.persistedAt,
        },
      });
      if (updated.count !== 1) {
        throw new AgentPersistenceInvariantError('Result lost its state CAS');
      }
      return 'PERSISTED';
    } catch (error) {
      if (isRejectedProductResult(error)) {
        throw new AgentResultRejectedError(resultRejectionCode(error));
      }
      throw error;
    }
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
          proposal: this.publicProposal(run.resultProposal),
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

  async getProposal(
    input: Readonly<{
      userId: string;
      proposalId: string;
    }>,
  ): Promise<ActionProposalResponse> {
    return this.unitOfWork.run(async (scope) => {
      const transaction = this.unitOfWork.clientFor(scope);
      const proposal = await transaction.actionProposal.findFirst({
        where: {
          id: input.proposalId,
          userId: input.userId,
          requestRun: { status: 'SUCCEEDED' },
        },
        include: { mutations: { orderBy: { sequence: 'asc' } } },
      });
      if (!proposal) throw proposalNotFound();
      const current = await this.expireProposalIfNeeded(transaction, proposal, new Date());
      return actionProposalResponseSchema.parse({ proposal: this.publicProposal(current) });
    });
  }

  async editProposal(
    scope: TransactionScope,
    input: Readonly<{
      userId: string;
      proposalId: string;
      idempotencyKey: string;
      request: ActionProposalEditInput;
    }>,
  ): Promise<ActionProposalMutationResponse> {
    const transaction = this.unitOfWork.clientFor(scope);
    const replay = await this.claimProposalMutationIdempotency(transaction, 'edit', input);
    if (replay) return replay;
    const proposal = await this.lockEditableProposal(transaction, input);
    const command = input.request.command;

    if (command.type === 'SET_PROJECT') {
      const projectSelection = await this.resolvePublicProjectSelection(
        scope,
        input.userId,
        command.project,
        proposal.actionCode === 'CREATE_PROJECT_TASKS',
      );
      const taskMutations = proposal.mutations.filter(
        (mutation) => mutation.targetType === 'TASK' && mutation.operation === 'CREATE',
      );
      if (taskMutations.length === 0) throw proposalNotExecutable('提案不包含可编辑的任务草稿');
      for (const mutation of taskMutations) {
        const afterValue = this.jsonRecord(mutation.afterValue);
        await transaction.actionMutation.update({
          where: { id: mutation.id },
          data: {
            afterValue: asJson({ ...afterValue, project: projectSelection }),
            fieldSource: 'USER',
          },
        });
      }
    } else if (command.type === 'UPDATE_TASK_DRAFT') {
      const mutation = proposal.mutations.find((candidate) => candidate.id === command.mutationId);
      if (!mutation || mutation.targetType !== 'TASK' || mutation.operation !== 'CREATE') {
        throw proposalNotExecutable('任务草稿不存在或不可编辑');
      }
      const projectSelection = command.changes.project
        ? await this.resolvePublicProjectSelection(
            scope,
            input.userId,
            command.changes.project,
            proposal.actionCode === 'CREATE_PROJECT_TASKS',
          )
        : undefined;
      if (projectSelection) {
        for (const taskMutation of proposal.mutations.filter(
          (candidate) => candidate.targetType === 'TASK' && candidate.operation === 'CREATE',
        )) {
          await transaction.actionMutation.update({
            where: { id: taskMutation.id },
            data: {
              afterValue: asJson({
                ...this.jsonRecord(taskMutation.afterValue),
                project: projectSelection,
              }),
              fieldSource: 'USER',
            },
          });
        }
      }
      const taskChanges = { ...command.changes };
      delete taskChanges.project;
      await transaction.actionMutation.update({
        where: { id: mutation.id },
        data: {
          afterValue: asJson({
            ...this.jsonRecord(mutation.afterValue),
            ...taskChanges,
            ...(projectSelection ? { project: projectSelection } : {}),
          }),
          fieldSource: 'USER',
        },
      });
    } else if (command.type === 'REMOVE_MUTATION') {
      const mutation = proposal.mutations.find((candidate) => candidate.id === command.mutationId);
      if (!mutation || mutation.targetType !== 'TASK' || mutation.operation !== 'CREATE') {
        throw proposalNotExecutable('只能删除计划中的任务草稿');
      }
      const taskCount = proposal.mutations.filter(
        (candidate) => candidate.targetType === 'TASK' && candidate.operation === 'CREATE',
      ).length;
      if (taskCount <= 1) throw proposalNotExecutable('计划至少需要保留一项任务');
      await transaction.actionMutation.delete({ where: { id: mutation.id } });
    } else {
      const mutation = proposal.mutations.find((candidate) => candidate.id === command.mutationId);
      if (!mutation || mutation.targetType !== 'TASK' || mutation.operation !== 'CREATE') {
        throw proposalNotExecutable('任务草稿不存在或不可编辑');
      }
      const afterValue = this.jsonRecord(mutation.afterValue);
      if (command.field === 'PROJECT') {
        if (proposal.actionCode === 'CREATE_PROJECT_TASKS') {
          throw proposalNotExecutable('计划任务必须保留项目归属');
        }
        afterValue.project = { type: 'NONE' };
      } else {
        const field = {
          SCHEDULED_AT: 'scheduledAt',
          DEADLINE_AT: 'deadlineAt',
          REMINDER_AT: 'reminderAt',
        }[command.field];
        afterValue[field] = null;
      }
      await transaction.actionMutation.update({
        where: { id: mutation.id },
        data: { afterValue: asJson(afterValue), fieldSource: 'USER' },
      });
    }

    await this.reconcileProjectCreateMutations(transaction, proposal.id, input.userId);
    await transaction.actionProposal.update({
      where: { id: proposal.id },
      data: { version: { increment: 1 } },
    });
    const response = await this.loadProposalResponse(transaction, input.userId, proposal.id);
    await this.completeProposalMutationIdempotency(transaction, 'edit', input, response);
    return response;
  }

  async dismissProposal(
    scope: TransactionScope,
    input: Readonly<{
      userId: string;
      proposalId: string;
      idempotencyKey: string;
      request: { version: number };
    }>,
  ): Promise<ActionProposalMutationResponse> {
    const transaction = this.unitOfWork.clientFor(scope);
    const replay = await this.claimProposalMutationIdempotency(transaction, 'dismiss', input);
    if (replay) return replay;
    const proposal = await this.lockDismissibleProposal(transaction, input);
    await transaction.actionProposal.update({
      where: { id: proposal.id },
      data: { lastDismissedAt: new Date(), version: { increment: 1 } },
    });
    const response = await this.loadProposalResponse(transaction, input.userId, proposal.id);
    await this.completeProposalMutationIdempotency(transaction, 'dismiss', input, response);
    return response;
  }

  async cancelProposal(
    scope: TransactionScope,
    input: Readonly<{
      userId: string;
      proposalId: string;
      idempotencyKey: string;
      request: { version: number };
    }>,
  ): Promise<ActionProposalMutationResponse> {
    const transaction = this.unitOfWork.clientFor(scope);
    const replay = await this.claimProposalMutationIdempotency(transaction, 'cancel', input);
    if (replay) return replay;
    const proposal = await this.lockEditableProposal(transaction, input);
    await transaction.actionProposal.update({
      where: { id: proposal.id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), version: { increment: 1 } },
    });
    const response = await this.loadProposalResponse(transaction, input.userId, proposal.id);
    await this.completeProposalMutationIdempotency(transaction, 'cancel', input, response);
    return response;
  }

  private async validateQuestionAnswer(
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
      await this.requireCandidate(scope, transaction, {
        runId: message.requestRunId,
        userId: message.userId,
        candidateRef: resolved.candidateRef,
        now,
      });
    }
    return resolved;
  }

  private async assertMessageConsumable(
    transaction: Transaction,
    message: Readonly<{
      id: string;
      userId: string;
      requestRunId: string | null;
      proposalId: string | null;
    }>,
    notFoundMessage: string,
  ): Promise<void> {
    const visible = await transaction.message.findFirst({
      where: {
        id: message.id,
        userId: message.userId,
        ...CONSUMABLE_MESSAGE_WHERE,
      },
      select: { id: true },
    });
    if (!visible) throw notFound('AGENT_REQUEST_NOT_FOUND', notFoundMessage);
  }

  private answerPolicy(extra: Prisma.JsonValue): StoredAnswerPolicy {
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

  private async createAnswerMessage(
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

  private async requireCandidate(
    scope: TransactionScope,
    transaction: Transaction,
    input: Readonly<{
      runId: string;
      userId: string;
      candidateRef: string;
      now: Date;
    }>,
  ): Promise<ValidatedCandidate> {
    const candidate = await transaction.agentRequestCandidateRef.findFirst({
      where: {
        requestRunId: input.runId,
        userId: input.userId,
        candidateRef: input.candidateRef,
      },
      select: {
        kind: true,
        taskId: true,
        projectId: true,
        targetVersion: true,
        expiresAt: true,
      },
    });
    if (!candidate || candidate.expiresAt <= input.now) {
      throw conflict('候选项已过期，请重新发起智能请求');
    }
    if (candidate.kind === 'TASK') {
      const task = candidate.taskId
        ? await this.tasks.findAgentTask(scope, { userId: input.userId, taskId: candidate.taskId })
        : null;
      if (!task || task.version !== candidate.targetVersion) {
        throw conflict('候选待办已发生变化，请刷新后重试');
      }
      return { kind: 'TASK', targetVersion: candidate.targetVersion, task, project: null };
    }
    const project = candidate.projectId
      ? await this.projects.findActiveAgentProject(scope, {
          userId: input.userId,
          projectId: candidate.projectId,
        })
      : null;
    if (!project || project.version !== candidate.targetVersion) {
      throw conflict('候选项目已发生变化，请刷新后重试');
    }
    return { kind: 'PROJECT', targetVersion: candidate.targetVersion, task: null, project };
  }

  private async lockEditableProposal(
    transaction: Transaction,
    input: Readonly<{ userId: string; proposalId: string; request: { version: number } }>,
  ) {
    if (!(await this.lockProposal(transaction, input.userId, input.proposalId))) {
      throw proposalNotFound();
    }
    const found = await transaction.actionProposal.findFirst({
      where: {
        id: input.proposalId,
        userId: input.userId,
        requestRun: { status: 'SUCCEEDED' },
      },
      include: { mutations: { orderBy: { sequence: 'asc' } } },
    });
    if (!found) throw proposalNotFound();
    const proposal = await this.expireProposalIfNeeded(transaction, found, new Date());
    if (proposal.version !== input.request.version) throw proposalVersionConflict(proposal.version);
    if (!['DRAFT', 'AWAITING_CONFIRMATION'].includes(proposal.status)) {
      throw proposalNotExecutable();
    }
    return proposal;
  }

  private async lockDismissibleProposal(
    transaction: Transaction,
    input: Readonly<{ userId: string; proposalId: string; request: { version: number } }>,
  ) {
    if (!(await this.lockProposal(transaction, input.userId, input.proposalId))) {
      throw proposalNotFound();
    }
    const found = await transaction.actionProposal.findFirst({
      where: {
        id: input.proposalId,
        userId: input.userId,
        requestRun: { status: 'SUCCEEDED' },
      },
      include: { mutations: { orderBy: { sequence: 'asc' } } },
    });
    if (!found) throw proposalNotFound();
    const proposal = await this.expireProposalIfNeeded(transaction, found, new Date());
    if (proposal.version !== input.request.version) throw proposalVersionConflict(proposal.version);
    if (!['DRAFT', 'AWAITING_CONFIRMATION', 'FAILED'].includes(proposal.status)) {
      throw proposalNotExecutable('该提案当前不可关闭');
    }
    return proposal;
  }

  private async expireProposalIfNeeded<
    T extends {
      id: string;
      status: string;
      expiresAt: Date | null;
      version: number;
    },
  >(transaction: Transaction, proposal: T, now: Date): Promise<T> {
    if (
      proposal.expiresAt &&
      proposal.expiresAt <= now &&
      ['DRAFT', 'AWAITING_CONFIRMATION'].includes(proposal.status)
    ) {
      await transaction.actionProposal.updateMany({
        where: { id: proposal.id, version: proposal.version, status: proposal.status as never },
        data: { status: 'EXPIRED', expiredAt: now, version: { increment: 1 } },
      });
      return { ...proposal, status: 'EXPIRED', version: proposal.version + 1 };
    }
    return proposal;
  }

  private async claimProposalMutationIdempotency(
    transaction: Transaction,
    operation: 'cancel' | 'dismiss' | 'edit',
    input: Readonly<{
      userId: string;
      proposalId: string;
      idempotencyKey: string;
      request: unknown;
    }>,
  ): Promise<ActionProposalMutationResponse | null> {
    return this.claimProductIdempotency(
      transaction,
      {
        userId: input.userId,
        scope: `agent.proposal-${operation}`,
        key: input.idempotencyKey,
        request: { proposalId: input.proposalId, request: input.request },
      },
      (snapshot) => {
        const parsed = actionProposalMutationResponseSchema.safeParse(snapshot);
        return parsed.success ? parsed.data : null;
      },
    );
  }

  private completeProposalMutationIdempotency(
    transaction: Transaction,
    operation: 'cancel' | 'dismiss' | 'edit',
    input: Readonly<{ userId: string; idempotencyKey: string }>,
    response: ActionProposalMutationResponse,
  ): Promise<void> {
    return this.completeProductIdempotency(transaction, {
      userId: input.userId,
      scope: `agent.proposal-${operation}`,
      key: input.idempotencyKey,
      response,
      responseStatus: 200,
    });
  }

  private async claimProductIdempotency<T>(
    transaction: Transaction,
    input: Readonly<{ userId: string; scope: string; key: string; request: unknown }>,
    parse: (snapshot: Prisma.JsonValue) => T | null,
  ): Promise<T | null> {
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
        expiresAt: new Date(now.getTime() + PRODUCT_IDEMPOTENCY_TTL_MS),
      },
      skipDuplicates: true,
    });
    if (claimed.count === 1) return null;
    const existing = await transaction.idempotencyRecord.findUnique({
      where: { userId_scope_key: { userId: input.userId, scope: input.scope, key: input.key } },
    });
    if (!existing || existing.requestHash !== requestHash) {
      throw conflict('该 Idempotency-Key 已用于不同请求');
    }
    if (existing.responseSnapshot === null) throw conflict('同一请求正在处理中，请稍后重试');
    const parsed = parse(existing.responseSnapshot);
    if (parsed === null) throw serviceUnavailable();
    return parsed;
  }

  private async completeProductIdempotency(
    transaction: Transaction,
    input: Readonly<{
      userId: string;
      scope: string;
      key: string;
      responseStatus: number;
      response: unknown;
    }>,
  ): Promise<void> {
    const changed = await transaction.idempotencyRecord.updateMany({
      where: { userId: input.userId, scope: input.scope, key: input.key },
      data: { responseStatus: input.responseStatus, responseSnapshot: asJson(input.response) },
    });
    if (changed.count !== 1) throw conflict('请求幂等记录不存在');
  }

  private async resolvePublicProjectSelection(
    scope: TransactionScope,
    userId: string,
    selection:
      | Readonly<{ type: 'EXISTING'; projectId: string }>
      | Readonly<{ type: 'NEW'; name: string }>
      | Readonly<{ type: 'NONE' }>,
    projectRequired: boolean,
  ): Promise<ResolvedProjectSelection> {
    if (selection.type === 'NONE') {
      if (projectRequired) throw proposalNotExecutable('计划任务必须选择已有或新项目');
      return selection;
    }
    if (selection.type === 'NEW') {
      if (Array.from(selection.name.trim()).length > MAX_PROJECT_NAME_LENGTH) {
        throw proposalNotExecutable('项目名称不能超过 40 个字符');
      }
      return { type: 'NEW', name: selection.name.trim() };
    }
    const project = await this.projects.findActiveAgentProject(scope, {
      userId,
      projectId: selection.projectId,
    });
    if (!project) throw proposalNotExecutable('所选项目不存在或已归档');
    return {
      type: 'EXISTING',
      projectId: project.id,
      expectedVersion: project.version,
    };
  }

  private jsonRecord(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new AgentPersistenceInvariantError('Action mutation value must be an object');
    }
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, Prisma.JsonValue] => entry[1] !== undefined,
      ),
    );
  }

  private async reconcileProjectCreateMutations(
    transaction: Transaction,
    proposalId: string,
    userId: string,
  ): Promise<void> {
    const mutations = await transaction.actionMutation.findMany({
      where: { proposalId, userId },
      orderBy: { sequence: 'asc' },
    });
    const taskMutations = mutations.filter(
      (mutation) => mutation.targetType === 'TASK' && mutation.operation === 'CREATE',
    );
    const newProjectNames = [
      ...new Set(
        taskMutations.flatMap((mutation) => {
          const project = this.jsonRecord(mutation.afterValue).project;
          if (
            typeof project === 'object' &&
            project !== null &&
            !Array.isArray(project) &&
            project.type === 'NEW' &&
            typeof project.name === 'string'
          ) {
            return [project.name];
          }
          return [];
        }),
      ),
    ];
    const projectMutations = mutations.filter(
      (mutation) => mutation.targetType === 'PROJECT' && mutation.operation === 'CREATE',
    );
    for (const mutation of projectMutations) {
      const name = this.jsonRecord(mutation.afterValue).name;
      if (typeof name !== 'string' || !newProjectNames.includes(name)) {
        await transaction.actionMutation.delete({ where: { id: mutation.id } });
      }
    }
    const retainedNames = new Set(
      projectMutations.flatMap((mutation) => {
        const name = this.jsonRecord(mutation.afterValue).name;
        return typeof name === 'string' && newProjectNames.includes(name) ? [name] : [];
      }),
    );
    let temporarySequence = Math.max(0, ...mutations.map((mutation) => mutation.sequence)) + 1;
    for (const name of newProjectNames) {
      if (retainedNames.has(name)) continue;
      await transaction.actionMutation.create({
        data: {
          userId,
          proposalId,
          sequence: temporarySequence,
          operation: 'CREATE',
          targetType: 'PROJECT',
          targetId: null,
          targetVersion: null,
          beforeValue: Prisma.DbNull,
          afterValue: { name },
          fieldSource: 'USER',
        },
      });
      temporarySequence += 1;
    }
    const current = await transaction.actionMutation.findMany({
      where: { proposalId, userId },
      orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
    });
    const ordered = [
      ...current
        .filter((mutation) => mutation.targetType === 'PROJECT')
        .sort((left, right) => {
          const leftName = this.jsonRecord(left.afterValue).name;
          const rightName = this.jsonRecord(right.afterValue).name;
          return (typeof leftName === 'string' ? leftName : '').localeCompare(
            typeof rightName === 'string' ? rightName : '',
          );
        }),
      ...current.filter((mutation) => mutation.targetType === 'TASK'),
    ];
    for (const mutation of ordered) {
      await transaction.actionMutation.update({
        where: { id: mutation.id },
        data: { sequence: mutation.sequence + 1_000 },
      });
    }
    for (const [index, mutation] of ordered.entries()) {
      await transaction.actionMutation.update({
        where: { id: mutation.id },
        data: { sequence: index + 1 },
      });
    }
  }

  private async loadProposalResponse(
    transaction: Transaction,
    userId: string,
    proposalId: string,
  ): Promise<ActionProposalMutationResponse> {
    const proposal = await transaction.actionProposal.findFirst({
      where: { id: proposalId, userId },
      include: { mutations: { orderBy: { sequence: 'asc' } } },
    });
    if (!proposal) throw proposalNotFound();
    return actionProposalMutationResponseSchema.parse({ proposal: this.publicProposal(proposal) });
  }

  private publicProposal(proposal: {
    id: string;
    conversationId: string | null;
    actionCode: string | null;
    title: string | null;
    status: string;
    version: number;
    lastDismissedAt: Date | null;
    expiresAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    mutations: Array<{
      id: string;
      sequence: number;
      operation: string;
      targetType: string;
      targetId: string | null;
      targetVersion: number | null;
      beforeValue: Prisma.JsonValue | null;
      afterValue: Prisma.JsonValue;
      fieldSource: string;
    }>;
  }): PublicActionProposal {
    if (!proposal.conversationId || !proposal.actionCode || !proposal.title) {
      throw new AgentPersistenceInvariantError('Action proposal is incomplete');
    }
    return publicActionProposalSchema.parse({
      id: proposal.id,
      conversationId: proposal.conversationId,
      actionCode: proposal.actionCode,
      title: proposal.title,
      status: proposal.status,
      version: proposal.version,
      mutations: proposal.mutations.map((mutation) => ({
        id: mutation.id as PublicActionMutation['id'],
        sequence: mutation.sequence,
        operation: mutation.operation as PublicActionMutation['operation'],
        targetType: mutation.targetType as PublicActionMutation['targetType'],
        targetId: mutation.targetId,
        targetVersion: mutation.targetVersion,
        beforeValue: mutation.beforeValue === null ? null : this.jsonRecord(mutation.beforeValue),
        afterValue: this.jsonRecord(mutation.afterValue),
        fieldSource: mutation.fieldSource as PublicActionMutation['fieldSource'],
      })),
      lastDismissedAt: proposal.lastDismissedAt?.toISOString() ?? null,
      expiresAt: proposal.expiresAt?.toISOString() ?? null,
      createdAt: proposal.createdAt.toISOString(),
      updatedAt: proposal.updatedAt.toISOString(),
    });
  }

  private async sanitizeProposalForAgent(
    scope: TransactionScope,
    proposal: {
      userId: string;
      actionCode: string | null;
      title: string | null;
      summary: string;
      mutations: Array<{ targetType: string; operation: string; afterValue: Prisma.JsonValue }>;
    },
  ): Promise<Record<string, unknown>> {
    const projectIds = new Set<string>();
    for (const mutation of proposal.mutations) {
      const project = this.jsonRecord(mutation.afterValue).project;
      if (
        typeof project === 'object' &&
        project !== null &&
        !Array.isArray(project) &&
        project.type === 'EXISTING' &&
        typeof project.projectId === 'string'
      ) {
        projectIds.add(project.projectId);
      }
    }
    const projects =
      projectIds.size === 0
        ? []
        : await this.projects.listAgentCandidates(scope, {
            userId: proposal.userId,
            limit: Math.min(projectIds.size, 30),
            projectIds: [...projectIds],
          });
    const names = new Map(projects.map((project) => [project.id, project.name]));
    const tasks = proposal.mutations
      .filter((mutation) => mutation.targetType === 'TASK' && mutation.operation === 'CREATE')
      .map((mutation) => {
        const value = this.jsonRecord(mutation.afterValue);
        const project = value.project;
        let safeProject: Record<string, unknown> | undefined;
        if (typeof project === 'object' && project !== null && !Array.isArray(project)) {
          if (project.type === 'NEW' && typeof project.name === 'string') {
            safeProject = { type: 'NEW', name: project.name };
          } else if (project.type === 'EXISTING' && typeof project.projectId === 'string') {
            safeProject = { type: 'EXISTING', name: names.get(project.projectId) ?? '已有项目' };
          }
        }
        return {
          title: typeof value.title === 'string' ? value.title : '未命名任务',
          description: typeof value.description === 'string' ? value.description : null,
          priority: typeof value.priority === 'string' ? value.priority : 'MEDIUM',
          scheduledAt: typeof value.scheduledAt === 'string' ? value.scheduledAt : null,
          deadlineAt: typeof value.deadlineAt === 'string' ? value.deadlineAt : null,
          reminderAt: typeof value.reminderAt === 'string' ? value.reminderAt : null,
          ...(safeProject ? { project: safeProject } : {}),
        };
      });
    return {
      actionCode: proposal.actionCode ?? 'CREATE_PROJECT_TASKS',
      title: proposal.title ?? '计划草稿',
      summary: proposal.summary,
      tasks,
    };
  }

  private async materializeProposal(
    scope: TransactionScope,
    transaction: Transaction,
    run: {
      id: string;
      userId: string;
      conversationId: string;
      sourceProposalId: string | null;
      extra: Prisma.JsonValue;
    },
    response: ExecuteResponse,
  ) {
    const result = response.result;
    if (result.type !== 'PLAN' && result.type !== 'ACTION_PROPOSAL') {
      throw new AgentPersistenceInvariantError('Result is not a proposal');
    }
    const normalized =
      result.type === 'PLAN'
        ? await this.normalizePlanResult(scope, transaction, run, result)
        : await this.normalizeActionProposalResult(scope, transaction, run, result);
    const expiresAt = new Date(Date.now() + PROPOSAL_TTL_MS);
    const proposal = await transaction.actionProposal.create({
      data: {
        userId: run.userId,
        conversationId: run.conversationId,
        requestRunId: run.id,
        supersedesProposalId: run.sourceProposalId,
        actionCode: normalized.actionCode,
        title: normalized.title,
        status: 'AWAITING_CONFIRMATION',
        summary: normalized.summary,
        modelVersion: response.resolved.model,
        promptVersion: response.resolved.promptVersion,
        toolVersion: response.resolved.providerSchemaVersion,
        expiresAt,
      },
    });
    await transaction.actionMutation.createMany({
      data: normalized.mutations.map((mutation, index) => ({
        userId: run.userId,
        proposalId: proposal.id,
        sequence: index + 1,
        operation: mutation.operation,
        targetType: mutation.targetType,
        targetId: mutation.targetId,
        targetVersion: mutation.targetVersion,
        beforeValue: mutation.beforeValue === null ? Prisma.DbNull : asJson(mutation.beforeValue),
        afterValue: asJson(mutation.afterValue),
        fieldSource: 'AGENT_SUGGESTION' as const,
      })),
    });
    const confirmMessage = await transaction.message.create({
      data: {
        userId: run.userId,
        conversationId: run.conversationId,
        role: 'ASSISTANT',
        messageType: 'ACTION_CONFIRM',
        inputMode: 'SYSTEM',
        content: normalized.summary,
        structuredData: {
          type: 'ACTION_CONFIRM',
          title: normalized.title,
          summary: normalized.summary,
        },
        proposalId: proposal.id,
      },
    });
    void confirmMessage;

    if (run.sourceProposalId) {
      const sourceVersion = this.sourceProposalVersion(run.extra);
      const superseded = await transaction.actionProposal.updateMany({
        where: {
          id: run.sourceProposalId,
          userId: run.userId,
          version: sourceVersion,
          status: { in: ['DRAFT', 'AWAITING_CONFIRMATION'] },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        data: {
          status: 'SUPERSEDED',
          supersededAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (superseded.count !== 1) {
        throw new AgentPersistenceInvariantError('Source proposal changed before redo completed');
      }
    }
    return transaction.actionProposal.findUniqueOrThrow({
      where: { id: proposal.id },
      include: { mutations: { orderBy: { sequence: 'asc' } } },
    });
  }

  private sourceProposalVersion(extra: Prisma.JsonValue): number {
    if (typeof extra !== 'object' || extra === null || Array.isArray(extra)) {
      throw new AgentPersistenceInvariantError('Run source proposal version is missing');
    }
    const source = extra.planSource;
    if (
      typeof source !== 'object' ||
      source === null ||
      Array.isArray(source) ||
      source.type !== 'PROPOSAL' ||
      typeof source.proposalVersion !== 'number'
    ) {
      throw new AgentPersistenceInvariantError('Run source proposal version is missing');
    }
    return source.proposalVersion;
  }

  private contextMessageId(extra: Prisma.JsonValue): string | null {
    if (typeof extra !== 'object' || extra === null || Array.isArray(extra)) return null;
    const source = extra.planSource;
    if (
      typeof source !== 'object' ||
      source === null ||
      Array.isArray(source) ||
      source.type !== 'PROPOSAL' ||
      typeof source.contextMessageId !== 'string'
    ) {
      return null;
    }
    return source.contextMessageId;
  }

  private async normalizePlanResult(
    scope: TransactionScope,
    transaction: Transaction,
    run: { id: string; userId: string },
    result: PlanResult,
  ) {
    const project = await this.resolvePlanProject(scope, transaction, run, result.project);
    const mutations: NormalizedMutation[] = [];
    if (project.type === 'NEW') {
      mutations.push({
        operation: 'CREATE',
        targetType: 'PROJECT',
        targetId: null,
        targetVersion: null,
        beforeValue: null,
        afterValue: { name: project.name },
      });
    }
    for (const task of result.tasks) {
      mutations.push({
        operation: 'CREATE',
        targetType: 'TASK',
        targetId: null,
        targetVersion: null,
        beforeValue: null,
        afterValue: this.taskDraftAfterValue(task, project),
      });
    }
    return {
      actionCode: 'CREATE_PROJECT_TASKS' as const,
      title: result.title,
      summary: result.title,
      mutations,
    };
  }

  private async normalizeActionProposalResult(
    scope: TransactionScope,
    transaction: Transaction,
    run: { id: string; userId: string },
    result: ActionProposalResult,
  ) {
    const mutations: NormalizedMutation[] = [];
    for (const mutation of result.mutations) {
      mutations.push(
        ...(await this.normalizeInternalMutation(
          scope,
          transaction,
          run,
          result.actionCode,
          mutation,
        )),
      );
    }
    return {
      actionCode: result.actionCode,
      title: Array.from(result.summary).slice(0, 200).join(''),
      summary: result.summary,
      mutations,
    };
  }

  private async normalizeInternalMutation(
    scope: TransactionScope,
    transaction: Transaction,
    run: { id: string; userId: string },
    actionCode: ActionProposalResult['actionCode'],
    mutation: InternalActionMutation,
  ): Promise<NormalizedMutation[]> {
    const expectedAction = {
      CREATE_TASK: 'CREATE_TASK',
      CREATE_PROJECT_TASKS: 'CREATE_PROJECT_TASKS',
      ORGANIZE_TASK: 'ORGANIZE_TASKS',
      UPDATE_TASK: 'UPDATE_TASK',
      COMPLETE_TASK: 'COMPLETE_TASK',
      RESTORE_TASK: 'RESTORE_TASK',
      DELETE_TASK: 'DELETE_TASK',
    }[mutation.operation];
    if (actionCode !== expectedAction) {
      throw new AgentPersistenceInvariantError('Action code does not match mutation operation');
    }
    if (mutation.operation === 'CREATE_TASK') {
      const project = await this.resolveTaskProject(scope, transaction, run, mutation.project);
      return [
        {
          operation: 'CREATE',
          targetType: 'TASK',
          targetId: null,
          targetVersion: null,
          beforeValue: null,
          afterValue: this.taskDraftAfterValue(mutation.task, project),
        },
      ];
    }
    if (mutation.operation === 'CREATE_PROJECT_TASKS') {
      const project = await this.resolvePlanProject(scope, transaction, run, mutation.project);
      return [
        ...(project.type === 'NEW'
          ? ([
              {
                operation: 'CREATE',
                targetType: 'PROJECT',
                targetId: null,
                targetVersion: null,
                beforeValue: null,
                afterValue: { name: project.name },
              },
            ] satisfies NormalizedMutation[])
          : []),
        ...mutation.tasks.map(
          (task): NormalizedMutation => ({
            operation: 'CREATE',
            targetType: 'TASK',
            targetId: null,
            targetVersion: null,
            beforeValue: null,
            afterValue: this.taskDraftAfterValue(task, project),
          }),
        ),
      ];
    }
    if (mutation.operation === 'ORGANIZE_TASK') {
      const task = await this.requireTaskCandidate(
        scope,
        transaction,
        run,
        mutation.targetRef,
        mutation.expectedVersion,
      );
      const project = await this.requireProjectCandidate(
        scope,
        transaction,
        run,
        mutation.projectRef,
      );
      return [
        {
          operation: 'UPDATE',
          targetType: 'TASK',
          targetId: task.id,
          targetVersion: task.version,
          beforeValue: this.taskBeforeValue(task),
          afterValue: {
            project: {
              type: 'EXISTING',
              projectId: project.id,
              expectedVersion: project.version,
            },
          },
        },
      ];
    }
    const task = await this.requireTaskCandidate(
      scope,
      transaction,
      run,
      mutation.targetRef,
      mutation.expectedVersion,
    );
    if (mutation.operation === 'UPDATE_TASK') {
      return [
        {
          operation: 'UPDATE',
          targetType: 'TASK',
          targetId: task.id,
          targetVersion: task.version,
          beforeValue: this.taskBeforeValue(task),
          afterValue: JSON.parse(JSON.stringify(mutation.changes)) as Record<string, unknown>,
        },
      ];
    }
    const transition: Pick<NormalizedMutation, 'operation' | 'afterValue'> =
      mutation.operation === 'COMPLETE_TASK'
        ? { operation: 'COMPLETE', afterValue: { status: 'COMPLETED' } }
        : mutation.operation === 'RESTORE_TASK'
          ? { operation: 'RESTORE', afterValue: { status: 'TODO' } }
          : { operation: 'SOFT_DELETE', afterValue: { deleted: true } };
    return [
      {
        operation: transition.operation,
        targetType: 'TASK',
        targetId: task.id,
        targetVersion: task.version,
        beforeValue: this.taskBeforeValue(task),
        afterValue: transition.afterValue,
      },
    ];
  }

  private async resolveTaskProject(
    scope: TransactionScope,
    transaction: Transaction,
    run: { id: string; userId: string },
    selection: { type: 'NONE' } | { type: 'EXISTING'; candidateRef: string },
  ): Promise<ResolvedProjectSelection> {
    if (selection.type === 'NONE') return selection;
    const project = await this.requireProjectCandidate(
      scope,
      transaction,
      run,
      selection.candidateRef,
    );
    return { type: 'EXISTING', projectId: project.id, expectedVersion: project.version };
  }

  private async resolvePlanProject(
    scope: TransactionScope,
    transaction: Transaction,
    run: { id: string; userId: string },
    selection: { type: 'EXISTING'; candidateRef: string } | { type: 'NEW'; name: string },
  ): Promise<Exclude<ResolvedProjectSelection, { type: 'NONE' }>> {
    if (selection.type === 'EXISTING') {
      const project = await this.requireProjectCandidate(
        scope,
        transaction,
        run,
        selection.candidateRef,
      );
      return { type: 'EXISTING', projectId: project.id, expectedVersion: project.version };
    }
    const name = selection.name.trim();
    if (name.length === 0 || Array.from(name).length > MAX_PROJECT_NAME_LENGTH) {
      throw new AgentPersistenceInvariantError('Generated project name violates product limits');
    }
    return { type: 'NEW', name };
  }

  private async requireTaskCandidate(
    scope: TransactionScope,
    transaction: Transaction,
    run: { id: string; userId: string },
    candidateRef: string,
    expectedVersion: number,
  ) {
    const candidate = await this.requireCandidate(scope, transaction, {
      runId: run.id,
      userId: run.userId,
      candidateRef,
      now: new Date(),
    });
    if (
      !candidate.task ||
      candidate.kind !== 'TASK' ||
      candidate.targetVersion !== expectedVersion
    ) {
      throw new AgentPersistenceInvariantError('Task candidate does not match mutation');
    }
    return candidate.task;
  }

  private async requireProjectCandidate(
    scope: TransactionScope,
    transaction: Transaction,
    run: { id: string; userId: string },
    candidateRef: string,
  ) {
    const candidate = await this.requireCandidate(scope, transaction, {
      runId: run.id,
      userId: run.userId,
      candidateRef,
      now: new Date(),
    });
    if (!candidate.project || candidate.kind !== 'PROJECT') {
      throw new AgentPersistenceInvariantError('Project candidate does not match mutation');
    }
    return candidate.project;
  }

  private taskDraftAfterValue(
    task: {
      clientRef: string;
      title: string;
      description: string | null;
      priority: string;
      scheduledAt: string | null;
      deadlineAt: string | null;
      reminderAt: string | null;
    },
    project: ResolvedProjectSelection,
  ): Record<string, unknown> {
    return {
      clientRef: task.clientRef,
      title: task.title,
      description: task.description,
      priority: task.priority,
      scheduledAt: task.scheduledAt,
      deadlineAt: task.deadlineAt,
      reminderAt: task.reminderAt,
      project,
    };
  }

  private taskBeforeValue(task: {
    title: string;
    description: string;
    status: string;
    priority: string;
    projectId: string | null;
    scheduledAt: Date | null;
    deadlineAt: Date | null;
    reminderAt: Date | null;
  }): Record<string, unknown> {
    return {
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      projectId: task.projectId,
      scheduledAt: task.scheduledAt?.toISOString() ?? null,
      deadlineAt: task.deadlineAt?.toISOString() ?? null,
      reminderAt: task.reminderAt?.toISOString() ?? null,
    };
  }

  private async materializeSource(
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
      const active = await this.expireProposalIfNeeded(transaction, proposal, new Date());
      const conversationId = active.conversationId;
      if (!conversationId) throw proposalNotFound();
      if (active.version !== source.input.source.version) {
        throw proposalVersionConflict(active.version);
      }
      if (!['DRAFT', 'AWAITING_CONFIRMATION'].includes(active.status)) {
        throw proposalNotExecutable('只有待确认草稿可以重新生成');
      }
      const instruction = source.input.instruction ?? '请基于旧草稿重新生成计划';
      const previousDraft = await this.sanitizeProposalForAgent(scope, active);
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

  private async createCandidates(
    scope: TransactionScope,
    userId: string,
    source: AgentRunSource,
    expiresAt: Date,
  ): Promise<CandidateSeed[]> {
    const tasks = await this.tasks.listAgentCandidates(scope, {
      userId,
      limit: source.kind === 'ORGANIZE' ? 20 : 50,
      onlyUnassigned: source.kind === 'ORGANIZE',
      statuses: source.kind === 'ORGANIZE' ? ['TODO'] : ['TODO', 'COMPLETED'],
    });
    if (source.kind === 'ORGANIZE' && tasks.length === 0) {
      throw conflict('当前没有可整理的无项目待办');
    }
    const scopedProjectId =
      source.kind === 'ORGANIZE' && source.input.scope.type === 'PROJECT'
        ? source.input.scope.projectId
        : undefined;
    const projects = await this.projects.listAgentCandidates(scope, {
      userId,
      limit: scopedProjectId ? 1 : 30,
      ...(scopedProjectId ? { projectIds: [scopedProjectId] } : {}),
    });
    if (scopedProjectId && projects.length !== 1) {
      throw conflict('整理目标项目不存在或已归档');
    }
    const taskCandidates = tasks.map((task) => {
      const candidateRef = createCandidateReference();
      const label = task.status === 'COMPLETED' ? `【已完成】${task.title}` : task.title;
      const snapshot = candidateContextSchema.parse({
        candidateRef,
        kind: 'TASK',
        label,
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
        label,
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
    scope: TransactionScope,
    transaction: Transaction,
    run: {
      id: string;
      userId: string;
      conversationId: string;
      sourceProposalId: string | null;
      extra: Prisma.JsonValue;
    },
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
          structuredData: {
            type: 'AI_REPLY',
            text: result.text,
            canGeneratePlan: result.offerPlan,
          },
          requestRunId: run.id,
        },
      });
      return { resultPayload: { type: result.type, messageId: message.id } };
    }
    if (result.type === 'CLARIFICATION' || result.type === 'CANDIDATES') {
      const policyOptions: StoredAnswerOption[] = [];
      if (result.type === 'CANDIDATES') {
        for (const option of result.options) {
          await this.requireCandidate(scope, transaction, {
            runId: run.id,
            userId: run.userId,
            candidateRef: option.candidateRef,
            now: new Date(),
          });
          policyOptions.push({
            optionId: option.optionId,
            label: option.label,
            candidateRef: option.candidateRef,
            nextStep: 'AGENT_STANDARD_TURN',
          });
        }
      } else {
        for (const option of result.options) {
          policyOptions.push({
            optionId: option.optionId,
            label: option.label,
            nextStep: nextStep(option.nextStep),
          });
        }
      }
      const freeTextNextStep = policyOptions.every(
        (option) => option.nextStep === 'AGENT_PLAN_GENERATION',
      )
        ? 'AGENT_PLAN_GENERATION'
        : 'AGENT_STANDARD_TURN';
      const publicNextStep = policyOptions.every(
        (option) => option.nextStep === policyOptions[0]?.nextStep,
      )
        ? (policyOptions[0]?.nextStep ?? 'AGENT_STANDARD_TURN')
        : 'AGENT_STANDARD_TURN';
      const options = policyOptions.map((option) => ({
        id: option.optionId,
        label: Array.from(option.label).slice(0, 120).join(''),
      }));
      const structuredData =
        result.type === 'CLARIFICATION'
          ? {
              type: 'QUESTION',
              questionKind: 'CLARIFICATION',
              prompt: result.question,
              options,
              allowFreeText: result.allowFreeText,
              nextStep: publicNextStep,
            }
          : {
              type: 'QUESTION',
              questionKind: 'CANDIDATES',
              prompt: result.question,
              options,
              allowFreeText: true,
              nextStep: publicNextStep,
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
          extra: {
            answerPolicy: {
              allowFreeText: result.type === 'CANDIDATES' ? true : result.allowFreeText,
              freeTextNextStep,
              options: policyOptions,
            },
          },
        },
      });
      return { resultPayload: { type: result.type, messageId: message.id } };
    }
    if (result.type === 'PLAN' || result.type === 'ACTION_PROPOSAL') {
      const proposal = await this.materializeProposal(scope, transaction, run, response);
      return { resultPayload: { type: result.type, proposalId: proposal.id } };
    }
    throw new AgentResultNotImplementedError(String((result as { type?: unknown }).type));
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

  private async lockMessage(
    transaction: Transaction,
    userId: string,
    messageId: string,
  ): Promise<boolean> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "messages"
      WHERE "id" = ${messageId}::uuid AND "user_id" = ${userId}::uuid
      FOR UPDATE
    `;
    return rows.length === 1;
  }

  private async lockProposal(
    transaction: Transaction,
    userId: string,
    proposalId: string,
  ): Promise<boolean> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "action_proposals"
      WHERE "id" = ${proposalId}::uuid AND "user_id" = ${userId}::uuid
      FOR UPDATE
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

function isRejectedProductResult(error: unknown): boolean {
  return (
    error instanceof ApiHttpException ||
    error instanceof AgentPersistenceInvariantError ||
    error instanceof AgentLateResultError ||
    error instanceof AgentResultNotImplementedError
  );
}

function resultRejectionCode(error: unknown): string {
  if (error instanceof AgentLateResultError) return 'LATE_RESULT';
  if (error instanceof AgentResultNotImplementedError) return 'UNSUPPORTED_RESULT';
  if (error instanceof ApiHttpException) return error.code;
  return 'INVALID_PRODUCT_RESULT';
}
