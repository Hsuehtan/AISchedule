import {
  actionProposalConfirmResponseSchema,
  publicActionProposalSchema,
  type ActionProposalConfirmResponse,
  type PublicActionProposal,
} from '@ai-schedule/contracts';
import { Prisma } from '@ai-schedule/db';
import { Inject, Injectable } from '@nestjs/common';

import type {
  ActionExecutionFailureCode,
  ActionExecutionResult,
  AgentActionExecutionPort,
  ExecutableActionProposal,
} from '../../modules/agent/agent-action-execution.port.js';
import { ApiHttpException } from '../http/api-http.exception.js';
import { DatabaseUnitOfWork, type TransactionScope } from '../database/unit-of-work.js';

type Transaction = Prisma.TransactionClient;
type ProposalWithExecution = Prisma.ActionProposalGetPayload<{
  include: {
    execution: true;
    mutations: { orderBy: { sequence: 'asc' } };
    requestRun: { select: { status: true; resultType: true } };
  };
}>;

@Injectable()
export class PrismaAgentActionExecutionAdapter implements AgentActionExecutionPort {
  constructor(@Inject(DatabaseUnitOfWork) private readonly unitOfWork: DatabaseUnitOfWork) {}

  async claim(
    scope: TransactionScope,
    input: Parameters<AgentActionExecutionPort['claim']>[1],
  ): ReturnType<AgentActionExecutionPort['claim']> {
    const transaction = this.unitOfWork.clientFor(scope);
    await lockIdempotencyKey(transaction, input.userId, input.idempotencyKey);
    if (!(await lockOwnedProposal(transaction, input.userId, input.proposalId))) {
      throw proposalNotFound();
    }
    const proposal = await readProposal(transaction, input.userId, input.proposalId);
    if (proposal.requestRun.status !== 'SUCCEEDED') {
      throw proposalNotFound();
    }
    if (proposal.execution) {
      return { kind: 'REPLAY', response: presentExecution(proposal) };
    }
    if (proposal.version !== input.proposalVersion) {
      throw new ApiHttpException(
        409,
        'ACTION_PROPOSAL_VERSION_CONFLICT',
        '操作提案已发生变化，请刷新后重试',
      );
    }
    if (proposal.expiresAt && proposal.expiresAt <= input.confirmedAt) {
      const expired = await transaction.actionProposal.updateMany({
        where: {
          id: proposal.id,
          userId: input.userId,
          version: input.proposalVersion,
          status: 'AWAITING_CONFIRMATION',
        },
        data: {
          status: 'EXPIRED',
          expiredAt: input.confirmedAt,
          version: { increment: 1 },
        },
      });
      if (expired.count !== 1) {
        throw new AgentActionExecutionInvariantError('Proposal expiry CAS failed');
      }
      return {
        kind: 'REJECTED',
        error: {
          code: 'ACTION_PROPOSAL_NOT_EXECUTABLE',
          message: '操作提案已过期',
        },
      };
    }
    if (proposal.status !== 'AWAITING_CONFIRMATION') {
      throw proposalNotExecutable('当前操作提案不可执行');
    }
    if (!proposal.actionCode || proposal.mutations.length === 0) {
      throw proposalNotExecutable('操作提案内容不完整');
    }
    const reusedKey = await transaction.actionExecution.findFirst({
      where: { userId: input.userId, idempotencyKey: input.idempotencyKey },
      select: { proposalId: true },
    });
    if (reusedKey) {
      throw proposalNotExecutable('该 Idempotency-Key 已用于其他操作提案');
    }

    const execution = await transaction.actionExecution.create({
      data: {
        userId: input.userId,
        proposalId: input.proposalId,
        confirmedById: input.userId,
        confirmedAt: input.confirmedAt,
        idempotencyKey: input.idempotencyKey,
        status: 'EXECUTING',
      },
    });
    const updated = await transaction.actionProposal.updateMany({
      where: {
        id: input.proposalId,
        userId: input.userId,
        version: input.proposalVersion,
        status: 'AWAITING_CONFIRMATION',
      },
      data: { status: 'EXECUTING', version: { increment: 1 } },
    });
    if (updated.count !== 1) {
      throw new AgentActionExecutionInvariantError('Proposal claim CAS failed');
    }
    return {
      kind: 'CLAIMED',
      executionId: execution.id,
      proposal: executableProposal(proposal),
    };
  }

  async complete(
    scope: TransactionScope,
    input: Parameters<AgentActionExecutionPort['complete']>[1],
  ): Promise<ActionProposalConfirmResponse> {
    const transaction = this.unitOfWork.clientFor(scope);
    const execution = await transaction.actionExecution.updateMany({
      where: {
        id: input.executionId,
        userId: input.userId,
        proposalId: input.proposalId,
        status: 'EXECUTING',
      },
      data: {
        status: 'SUCCEEDED',
        resultSnapshot: asJson(input.result),
        executedAt: input.executedAt,
      },
    });
    const proposal = await transaction.actionProposal.updateMany({
      where: {
        id: input.proposalId,
        userId: input.userId,
        status: 'EXECUTING',
      },
      data: { status: 'EXECUTED', version: { increment: 1 } },
    });
    if (execution.count !== 1 || proposal.count !== 1) {
      throw new AgentActionExecutionInvariantError('Execution completion CAS failed');
    }
    return presentExecution(await readProposal(transaction, input.userId, input.proposalId));
  }

  async fail(
    scope: TransactionScope,
    input: Parameters<AgentActionExecutionPort['fail']>[1],
  ): Promise<ActionProposalConfirmResponse> {
    const transaction = this.unitOfWork.clientFor(scope);
    const execution = await transaction.actionExecution.updateMany({
      where: {
        id: input.executionId,
        userId: input.userId,
        proposalId: input.proposalId,
        status: 'EXECUTING',
      },
      data: {
        status: 'FAILED',
        errorCode: input.error.code,
        errorDetail: asJson(input.error),
        failedAt: input.failedAt,
      },
    });
    const proposal = await transaction.actionProposal.updateMany({
      where: {
        id: input.proposalId,
        userId: input.userId,
        status: 'EXECUTING',
      },
      data: { status: 'FAILED', version: { increment: 1 } },
    });
    if (execution.count !== 1 || proposal.count !== 1) {
      throw new AgentActionExecutionInvariantError('Execution failure CAS failed');
    }
    return presentExecution(await readProposal(transaction, input.userId, input.proposalId));
  }
}

function executableProposal(proposal: ProposalWithExecution): ExecutableActionProposal {
  if (!proposal.actionCode) throw new AgentActionExecutionInvariantError('Action code is missing');
  return {
    id: proposal.id,
    userId: proposal.userId,
    actionCode: proposal.actionCode,
    version: proposal.version,
    mutations: proposal.mutations.map((mutation) => ({
      id: mutation.id,
      sequence: mutation.sequence,
      operation: mutation.operation,
      targetType: mutation.targetType,
      targetId: mutation.targetId,
      targetVersion: mutation.targetVersion,
      afterValue: jsonObject(mutation.afterValue),
    })),
  };
}

function presentExecution(proposal: ProposalWithExecution): ActionProposalConfirmResponse {
  const execution = proposal.execution;
  if (!execution) throw new AgentActionExecutionInvariantError('Execution is missing');
  const publicProposal = presentProposal(proposal);
  if (execution.status === 'SUCCEEDED' && execution.executedAt) {
    const result = actionResult(execution.resultSnapshot);
    return actionProposalConfirmResponseSchema.parse({
      outcome: 'EXECUTED',
      proposal: publicProposal,
      execution: {
        id: execution.id,
        status: 'SUCCEEDED',
        executedAt: execution.executedAt.toISOString(),
        result,
      },
    });
  }
  if (execution.status === 'FAILED') {
    const error = executionError(execution.errorCode, execution.errorDetail);
    return actionProposalConfirmResponseSchema.parse({
      outcome: 'FAILED',
      proposal: publicProposal,
      execution: { id: execution.id, status: 'FAILED', error },
    });
  }
  throw proposalNotExecutable('操作提案仍在执行中');
}

function presentProposal(proposal: ProposalWithExecution): PublicActionProposal {
  if (!proposal.conversationId || !proposal.actionCode || !proposal.title) {
    throw new AgentActionExecutionInvariantError('Public proposal fields are missing');
  }
  if (!['PLAN', 'ACTION_PROPOSAL'].includes(proposal.requestRun.resultType ?? '')) {
    throw new AgentActionExecutionInvariantError('Proposal source result type is invalid');
  }
  return publicActionProposalSchema.parse({
    id: proposal.id,
    conversationId: proposal.conversationId,
    actionCode: proposal.actionCode,
    presentation: proposal.requestRun.resultType === 'PLAN' ? 'PLAN' : 'ACTION',
    title: proposal.title,
    status: proposal.status,
    version: proposal.version,
    mutations: proposal.mutations.map((mutation) => ({
      id: mutation.id,
      sequence: mutation.sequence,
      operation: mutation.operation,
      targetType: mutation.targetType,
      targetId: mutation.targetId,
      targetVersion: mutation.targetVersion,
      beforeValue: mutation.beforeValue === null ? null : jsonObject(mutation.beforeValue),
      afterValue: jsonObject(mutation.afterValue),
      fieldSource: mutation.fieldSource,
    })),
    lastDismissedAt: proposal.lastDismissedAt?.toISOString() ?? null,
    expiresAt: proposal.expiresAt?.toISOString() ?? null,
    createdAt: proposal.createdAt.toISOString(),
    updatedAt: proposal.updatedAt.toISOString(),
  });
}

function actionResult(value: Prisma.JsonValue | null): ActionExecutionResult {
  const result = jsonObject(value);
  if (
    !Array.isArray(result.taskIds) ||
    !result.taskIds.every((taskId) => typeof taskId === 'string') ||
    !(typeof result.projectId === 'string' || result.projectId === null) ||
    !(typeof result.undoOperationId === 'string' || result.undoOperationId === null) ||
    !(typeof result.undoExpiresAt === 'string' || result.undoExpiresAt === null)
  ) {
    throw new AgentActionExecutionInvariantError('Execution result is invalid');
  }
  return {
    projectId: result.projectId,
    taskIds: result.taskIds,
    undoOperationId: result.undoOperationId,
    undoExpiresAt: result.undoExpiresAt,
  };
}

function executionError(
  code: string | null,
  value: Prisma.JsonValue | null,
): Readonly<{ code: ActionExecutionFailureCode; message: string }> {
  const detail = jsonObject(value);
  const supportedCodes = new Set<ActionExecutionFailureCode>([
    'ACTION_EXECUTION_FAILED',
    'ACTION_PROJECT_NAME_CONFLICT',
    'ACTION_TARGET_NOT_FOUND',
    'ACTION_TARGET_VERSION_CONFLICT',
  ]);
  if (
    !code ||
    !supportedCodes.has(code as ActionExecutionFailureCode) ||
    typeof detail.message !== 'string'
  ) {
    throw new AgentActionExecutionInvariantError('Execution error is invalid');
  }
  return { code: code as ActionExecutionFailureCode, message: detail.message };
}

async function lockOwnedProposal(
  transaction: Transaction,
  userId: string,
  proposalId: string,
): Promise<boolean> {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "action_proposals"
    WHERE "id" = ${proposalId}::uuid
      AND "user_id" = ${userId}::uuid
    FOR UPDATE
  `;
  return rows.length === 1;
}

async function lockIdempotencyKey(
  transaction: Transaction,
  userId: string,
  idempotencyKey: string,
): Promise<void> {
  await transaction.$queryRaw<Array<{ lock: string }>>`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`${userId}:action-confirm:${idempotencyKey}`}::text, 0)
    )::text AS "lock"
  `;
}

function readProposal(transaction: Transaction, userId: string, proposalId: string) {
  return transaction.actionProposal.findFirstOrThrow({
    where: { id: proposalId, userId },
    include: {
      execution: true,
      mutations: { orderBy: { sequence: 'asc' } },
      requestRun: { select: { status: true, resultType: true } },
    },
  });
}

function jsonObject(value: Prisma.JsonValue | null): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new AgentActionExecutionInvariantError('Expected a JSON object');
  }
  return value as Record<string, unknown>;
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function proposalNotFound(): ApiHttpException {
  return new ApiHttpException(404, 'ACTION_PROPOSAL_NOT_FOUND', '操作提案不存在');
}

function proposalNotExecutable(message: string): ApiHttpException {
  return new ApiHttpException(409, 'ACTION_PROPOSAL_NOT_EXECUTABLE', message);
}

export class AgentActionExecutionInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentActionExecutionInvariantError';
  }
}
