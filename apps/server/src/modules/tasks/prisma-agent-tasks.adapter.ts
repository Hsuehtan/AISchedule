import {
  OptimisticWriteConflictError,
  RepositoryInvalidStateError,
  RepositoryRecordNotFoundError,
  TaskRepository,
} from '@ai-schedule/db';
import { Inject, Injectable } from '@nestjs/common';

import { DatabaseUnitOfWork, type TransactionScope } from '../../platform/database/unit-of-work.js';
import {
  ActionTargetNotFoundError,
  ActionTargetVersionConflictError,
} from '../agent/agent-action-execution.port.js';
import type { AgentTasksPort } from './agent-tasks.port.js';

@Injectable()
export class PrismaAgentTasksAdapter implements AgentTasksPort {
  constructor(@Inject(DatabaseUnitOfWork) private readonly unitOfWork: DatabaseUnitOfWork) {}

  getAgentScopeCounts(
    scope: TransactionScope,
    input: Parameters<AgentTasksPort['getAgentScopeCounts']>[1],
  ): ReturnType<AgentTasksPort['getAgentScopeCounts']> {
    return this.repository(scope).getAgentScopeCounts(input.userId, input.projectId);
  }

  listAgentCandidates(
    scope: TransactionScope,
    input: Parameters<AgentTasksPort['listAgentCandidates']>[1],
  ): ReturnType<AgentTasksPort['listAgentCandidates']> {
    return this.repository(scope).listAgentCandidates(input.userId, {
      limit: input.limit,
      ...(input.offset === undefined ? {} : { offset: input.offset }),
      onlyUnassigned: input.onlyUnassigned,
      statuses: input.statuses,
    });
  }

  findAgentTask(
    scope: TransactionScope,
    input: Parameters<AgentTasksPort['findAgentTask']>[1],
  ): ReturnType<AgentTasksPort['findAgentTask']> {
    return this.repository(scope).findAgentTask(input.userId, input.taskId);
  }

  async prepare(
    scope: TransactionScope,
    input: Parameters<AgentTasksPort['prepare']>[1],
  ): Promise<void> {
    try {
      await this.repository(scope).prepareWrites(
        input.userId,
        input.targets.map((target) => ({
          taskId: target.taskId,
          version: target.version,
          ...(target.expectedStatus === undefined ? {} : { expectedStatus: target.expectedStatus }),
        })),
      );
    } catch (error) {
      rethrowTaskActionError(error);
    }
  }

  async create(
    scope: TransactionScope,
    input: Parameters<AgentTasksPort['create']>[1],
  ): Promise<Readonly<{ id: string }>> {
    try {
      const task = await this.repository(scope).create(input.userId, {
        ...input.draft,
        source: 'AGENT',
        sourceActionId: input.sourceActionId,
      });
      return { id: task.id };
    } catch (error) {
      rethrowTaskActionError(error);
    }
  }

  async update(
    scope: TransactionScope,
    input: Parameters<AgentTasksPort['update']>[1],
  ): Promise<Readonly<{ id: string }>> {
    try {
      const task = await this.repository(scope).update(
        input.userId,
        input.taskId,
        input.version,
        input.changes,
      );
      return { id: task.id };
    } catch (error) {
      rethrowTaskActionError(error);
    }
  }

  async complete(
    scope: TransactionScope,
    input: Parameters<AgentTasksPort['complete']>[1],
  ): Promise<Readonly<{ id: string }>> {
    try {
      const task = await this.repository(scope).complete(input.userId, input.taskId, input.version);
      return { id: task.id };
    } catch (error) {
      rethrowTaskActionError(error);
    }
  }

  async restore(
    scope: TransactionScope,
    input: Parameters<AgentTasksPort['restore']>[1],
  ): Promise<Readonly<{ id: string }>> {
    try {
      const task = await this.repository(scope).restore(input.userId, input.taskId, input.version);
      return { id: task.id };
    } catch (error) {
      rethrowTaskActionError(error);
    }
  }

  async softDeleteMany(
    scope: TransactionScope,
    input: Parameters<AgentTasksPort['softDeleteMany']>[1],
  ): Promise<
    Readonly<{
      taskIds: readonly string[];
      undoOperation: Readonly<{ id: string; expiresAt: Date }>;
    }>
  > {
    try {
      const result = await this.repository(scope).softDeleteBatch(
        input.userId,
        input.targets,
        input.sourceOperationId,
        input.executionId,
      );
      return {
        taskIds: result.tasks.map(({ id }) => id),
        undoOperation: {
          id: result.undoOperation.id,
          expiresAt: result.undoOperation.expiresAt,
        },
      };
    } catch (error) {
      rethrowTaskActionError(error);
    }
  }

  private repository(scope: TransactionScope): TaskRepository {
    return new TaskRepository(this.unitOfWork.clientFor(scope));
  }
}

function rethrowTaskActionError(error: unknown): never {
  if (error instanceof RepositoryRecordNotFoundError) throw new ActionTargetNotFoundError();
  if (
    error instanceof OptimisticWriteConflictError ||
    error instanceof RepositoryInvalidStateError
  ) {
    throw new ActionTargetVersionConflictError();
  }
  if (prismaCode(error) === 'P2003') throw new ActionTargetNotFoundError();
  throw error;
}

function prismaCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}
