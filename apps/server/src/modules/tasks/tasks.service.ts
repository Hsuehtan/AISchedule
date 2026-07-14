import type { CreateTaskInput, TaskListQuery, UpdateTaskInput } from '@ai-schedule/contracts';
import { TaskRepository, UndoExpiredError } from '@ai-schedule/db';
import { Inject, Injectable } from '@nestjs/common';

import { DatabaseService } from '../../platform/database/database.service.js';
import { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import { rethrowTaskRepositoryError } from '../../platform/http/repository-error.js';
import { presentTask } from './task.presenter.js';

function dateValue(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  return value === null ? null : new Date(value);
}

type DeleteUndoExecutionOutcome =
  | { kind: 'expired' }
  | {
      kind: 'executed';
      task: ReturnType<typeof presentTask>;
      undoOperation: { executedAt: string; id: string; status: 'EXECUTED' };
    };

@Injectable()
export class TasksService {
  private readonly repository: TaskRepository;

  constructor(
    @Inject(DatabaseService) database: DatabaseService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
  ) {
    this.repository = new TaskRepository(database.client);
  }

  async create(userId: string, key: string, input: CreateTaskInput) {
    return this.idempotency.execute({
      userId,
      scope: 'TASK_CREATE',
      key,
      request: input,
      responseStatus: 201,
      operation: async ({ transaction }) => {
        try {
          const task = await new TaskRepository(transaction).create(userId, {
            title: input.title,
            description: input.description,
            projectId: input.projectId,
            priority: input.priority,
            scheduledAt: dateValue(input.scheduledAt),
            deadlineAt: dateValue(input.deadlineAt),
            reminderAt: dateValue(input.reminderAt),
          });
          return { task: presentTask(task) };
        } catch (error) {
          rethrowTaskRepositoryError(error);
        }
      },
    });
  }

  async get(userId: string, taskId: string) {
    try {
      return { task: presentTask(await this.repository.get(userId, taskId)) };
    } catch (error) {
      rethrowTaskRepositoryError(error);
    }
  }

  async list(userId: string, input: TaskListQuery) {
    try {
      const page = await this.repository.list(userId, input);
      return {
        items: page.items.map(presentTask),
        pageInfo: { nextCursor: page.nextCursor },
        counts: page.counts,
      };
    } catch (error) {
      rethrowTaskRepositoryError(error);
    }
  }

  async update(userId: string, taskId: string, key: string, input: UpdateTaskInput) {
    return this.idempotency.execute({
      userId,
      scope: `TASK_UPDATE:${taskId}`,
      key,
      request: input,
      responseStatus: 200,
      operation: async ({ transaction }) => {
        try {
          const task = await new TaskRepository(transaction).update(userId, taskId, input.version, {
            ...input.changes,
            scheduledAt: dateValue(input.changes.scheduledAt),
            deadlineAt: dateValue(input.changes.deadlineAt),
            reminderAt: dateValue(input.changes.reminderAt),
          });
          return { task: presentTask(task) };
        } catch (error) {
          rethrowTaskRepositoryError(error);
        }
      },
    });
  }

  complete(userId: string, taskId: string, key: string, version: number) {
    return this.versionedMutation('TASK_COMPLETE', userId, taskId, key, version, (repository) =>
      repository.complete(userId, taskId, version),
    );
  }

  restore(userId: string, taskId: string, key: string, version: number) {
    return this.versionedMutation('TASK_RESTORE', userId, taskId, key, version, (repository) =>
      repository.restore(userId, taskId, version),
    );
  }

  async softDelete(userId: string, taskId: string, key: string, version: number) {
    const scope = `TASK_DELETE:${taskId}`;
    return this.idempotency.execute({
      userId,
      scope,
      key,
      request: { version },
      responseStatus: 200,
      operation: async ({ operationId, transaction }) => {
        try {
          const deleted = await new TaskRepository(transaction).softDelete(
            userId,
            taskId,
            version,
            operationId,
          );
          return {
            task: presentTask(deleted.task),
            undoOperation: {
              id: deleted.undoOperation.id,
              expiresAt: deleted.undoOperation.expiresAt.toISOString(),
            },
          };
        } catch (error) {
          rethrowTaskRepositoryError(error);
        }
      },
    });
  }

  async executeDeleteUndo(userId: string, undoId: string, key: string) {
    const scope = `TASK_DELETE_UNDO:${undoId}`;
    const result = await this.idempotency.execute<DeleteUndoExecutionOutcome>({
      userId,
      scope,
      key,
      request: {},
      responseStatus: (response) => (response.kind === 'expired' ? 410 : 200),
      operation: async ({ operationId, transaction }) => {
        try {
          const restored = await new TaskRepository(transaction).executeDeleteUndo(
            userId,
            undoId,
            operationId,
          );
          if (restored.kind === 'expired') {
            return { kind: 'expired' as const };
          }
          if (!restored.undoOperation.executedAt) {
            throw new Error('Executed undo operation is missing executedAt');
          }
          return {
            kind: 'executed' as const,
            task: presentTask(restored.task),
            undoOperation: {
              id: restored.undoOperation.id,
              status: 'EXECUTED' as const,
              executedAt: restored.undoOperation.executedAt.toISOString(),
            },
          };
        } catch (error) {
          rethrowTaskRepositoryError(error);
        }
      },
    });

    if (result.kind === 'expired') rethrowTaskRepositoryError(new UndoExpiredError());
    return { task: result.task, undoOperation: result.undoOperation };
  }

  private versionedMutation(
    operation: string,
    userId: string,
    taskId: string,
    key: string,
    version: number,
    mutation: (repository: TaskRepository) => ReturnType<TaskRepository['complete']>,
  ) {
    return this.idempotency.execute({
      userId,
      scope: `${operation}:${taskId}`,
      key,
      request: { version },
      responseStatus: 200,
      operation: async ({ transaction }) => {
        try {
          return { task: presentTask(await mutation(new TaskRepository(transaction))) };
        } catch (error) {
          rethrowTaskRepositoryError(error);
        }
      },
    });
  }
}
