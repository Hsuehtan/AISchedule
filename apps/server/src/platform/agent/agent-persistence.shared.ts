import { createHash } from 'node:crypto';

import {
  agentMessageSchema,
  publicActionProposalSchema,
  type AgentMessage,
  type PublicActionMutation,
  type PublicActionProposal,
} from '@ai-schedule/contracts';
import type { Prisma } from '@ai-schedule/db';

import {
  type AgentProjectSnapshot,
  type AgentProjectsPort,
} from '../../modules/projects/agent-projects.port.js';
import {
  type AgentTaskSnapshot,
  type AgentTasksPort,
} from '../../modules/tasks/agent-tasks.port.js';
import type { DatabaseService } from '../database/database.service.js';
import type { DatabaseUnitOfWork } from '../database/unit-of-work.js';
import { ApiHttpException } from '../http/api-http.exception.js';

export const HTTP_ACCEPTED = 202;
export const RECOVERY_LEASE_BUFFER_MS = 60_000;
export const PRODUCT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000;
export const PROPOSAL_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const MAX_PROJECT_NAME_LENGTH = 40;

// Model-produced messages remain private until the originating Run has settled. Messages that
// are created entirely by the product (user input and deterministic follow-ups) have neither a
// result Run nor a Proposal and are immediately consumable.
export const CONSUMABLE_MESSAGE_WHERE: Prisma.MessageWhereInput = {
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

export type AgentNextStep = 'AGENT_PLAN_GENERATION' | 'AGENT_STANDARD_TURN' | 'DETERMINISTIC';
export type StoredAnswerOption = Readonly<{
  candidateRef?: string;
  label: string;
  nextStep: AgentNextStep;
  optionId: string;
}>;
export type StoredAnswerPolicy = Readonly<{
  allowFreeText: boolean;
  freeTextNextStep: Exclude<AgentNextStep, 'DETERMINISTIC'>;
  options: readonly StoredAnswerOption[];
}>;
export type ResolvedAnswer = Readonly<{
  candidateRef?: string;
  label: string;
  nextStep: AgentNextStep;
}>;
export type ResolvedProjectSelection =
  | Readonly<{ type: 'NONE' }>
  | Readonly<{ type: 'EXISTING'; projectId: string; expectedVersion: number }>
  | Readonly<{ type: 'NEW'; name: string }>;
export type NormalizedMutation = Readonly<{
  operation: 'COMPLETE' | 'CREATE' | 'RESTORE' | 'SOFT_DELETE' | 'UPDATE';
  targetType: 'PROJECT' | 'TASK';
  targetId: string | null;
  targetVersion: number | null;
  beforeValue: Record<string, unknown> | null;
  afterValue: Record<string, unknown>;
}>;

export type Transaction = Prisma.TransactionClient;
export type ValidatedCandidate = Readonly<{
  kind: 'PROJECT' | 'TASK';
  targetVersion: number;
  task: AgentTaskSnapshot | null;
  project: AgentProjectSnapshot | null;
}>;

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
    .join(',')}}`;
}

export function sha256(value: unknown): string {
  return createHash('sha256').update(stableJson(value), 'utf8').digest('hex');
}

export function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function notFound(code = 'AGENT_REQUEST_NOT_FOUND', message = '智能请求不存在') {
  return new ApiHttpException(404, code, message);
}

export function conflict(message: string) {
  return new ApiHttpException(409, 'AGENT_REQUEST_CONFLICT', message);
}

export function serviceUnavailable() {
  return new ApiHttpException(503, 'AGENT_RESULT_UNAVAILABLE', '智能处理暂不可用');
}

export function proposalNotFound() {
  return new ApiHttpException(404, 'ACTION_PROPOSAL_NOT_FOUND', '操作提案不存在');
}

export function proposalVersionConflict(currentVersion?: number) {
  return new ApiHttpException(
    409,
    'ACTION_PROPOSAL_VERSION_CONFLICT',
    '操作提案已发生变化，请刷新后重试',
    currentVersion === undefined ? {} : { currentVersion },
  );
}

export function proposalNotExecutable(message = '操作提案当前不可编辑') {
  return new ApiHttpException(409, 'ACTION_PROPOSAL_NOT_EXECUTABLE', message);
}

export function nextStep(value: 'AGENT_PLAN' | 'AGENT_STANDARD' | 'DETERMINISTIC') {
  switch (value) {
    case 'AGENT_PLAN':
      return 'AGENT_PLAN_GENERATION' as const;
    case 'AGENT_STANDARD':
      return 'AGENT_STANDARD_TURN' as const;
    case 'DETERMINISTIC':
      return 'DETERMINISTIC' as const;
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

export function isRejectedProductResult(error: unknown): boolean {
  return (
    error instanceof ApiHttpException ||
    error instanceof AgentPersistenceInvariantError ||
    error instanceof AgentLateResultError ||
    error instanceof AgentResultNotImplementedError
  );
}

export function resultRejectionCode(error: unknown): string {
  if (error instanceof AgentLateResultError) return 'LATE_RESULT';
  if (error instanceof AgentResultNotImplementedError) return 'UNSUPPORTED_RESULT';
  if (error instanceof ApiHttpException) return error.code;
  return 'INVALID_PRODUCT_RESULT';
}

export class AgentPersistenceSupport {
  constructor(
    protected readonly unitOfWork: DatabaseUnitOfWork,
    protected readonly database: DatabaseService,
    protected readonly tasks: AgentTasksPort,
    protected readonly projects: AgentProjectsPort,
  ) {}
  jsonRecord(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new AgentPersistenceInvariantError('Action mutation value must be an object');
    }
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, Prisma.JsonValue] => entry[1] !== undefined,
      ),
    );
  }

  async lockRun(transaction: Transaction, runId: string): Promise<boolean> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "agent_request_runs" WHERE "id" = ${runId}::uuid FOR UPDATE
    `;
    return rows.length === 1;
  }

  async lockMessage(transaction: Transaction, userId: string, messageId: string): Promise<boolean> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "messages"
      WHERE "id" = ${messageId}::uuid AND "user_id" = ${userId}::uuid
      FOR UPDATE
    `;
    return rows.length === 1;
  }

  async lockProposal(
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
  async assertMessageConsumable(
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

  async claimProductIdempotency<T>(
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

  async completeProductIdempotency(
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

  publicMessage(
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

  publicProposal(
    proposal: {
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
    },
    resultType: string | null,
  ): PublicActionProposal {
    if (!proposal.conversationId || !proposal.actionCode || !proposal.title) {
      throw new AgentPersistenceInvariantError('Action proposal is incomplete');
    }
    return publicActionProposalSchema.parse({
      id: proposal.id,
      conversationId: proposal.conversationId,
      actionCode: proposal.actionCode,
      presentation: this.proposalPresentation(resultType),
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

  proposalPresentation(resultType: string | null): 'PLAN' | 'ACTION' {
    if (resultType === 'PLAN') return 'PLAN';
    if (resultType === 'ACTION_PROPOSAL') return 'ACTION';
    throw new AgentPersistenceInvariantError('Proposal source result type is invalid');
  }

  contextMessageId(extra: Prisma.JsonValue): string | null {
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

  sourceProposalVersion(extra: Prisma.JsonValue): number {
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

  admissionTiming(extra: Prisma.JsonValue): {
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
}
