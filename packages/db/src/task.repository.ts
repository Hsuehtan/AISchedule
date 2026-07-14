import {
  ProjectStatus,
  RecordSource,
  TaskPriority,
  TaskStatus,
  UndoOperationCode,
  UndoOperationStatus,
  UndoSourceType,
} from './generated/prisma/client.js';
import type { Prisma } from './generated/prisma/client.js';
import type { DatabaseClient } from './client.js';
import {
  OptimisticWriteConflictError,
  RepositoryInvalidStateError,
  RepositoryRecordNotFoundError,
  UndoUnavailableError,
} from './repository.errors.js';

export const TASK_DELETE_UNDO_WINDOW_MS = 3_000;

export interface CreateTaskRecord {
  readonly title: string;
  readonly description?: string | undefined;
  readonly projectId?: string | null | undefined;
  readonly priority?: (typeof TaskPriority)[keyof typeof TaskPriority] | undefined;
  readonly scheduledAt?: Date | null | undefined;
  readonly deadlineAt?: Date | null | undefined;
  readonly reminderAt?: Date | null | undefined;
  readonly source?: (typeof RecordSource)[keyof typeof RecordSource] | undefined;
  readonly sourceActionId?: string | undefined;
}

export interface UpdateTaskRecord {
  readonly title?: string | undefined;
  readonly description?: string | undefined;
  readonly projectId?: string | null | undefined;
  readonly priority?: (typeof TaskPriority)[keyof typeof TaskPriority] | undefined;
  readonly scheduledAt?: Date | null | undefined;
  readonly deadlineAt?: Date | null | undefined;
  readonly reminderAt?: Date | null | undefined;
}

export interface ListTaskRecordsInput {
  readonly projectId?: string | undefined;
  readonly status?: (typeof TaskStatus)[keyof typeof TaskStatus] | undefined;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

type RepositoryClient = DatabaseClient | Prisma.TransactionClient;

function isDatabaseClient(client: RepositoryClient): client is DatabaseClient {
  return '$transaction' in client;
}

function withTransaction<T>(
  client: RepositoryClient,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return isDatabaseClient(client) ? client.$transaction(operation) : operation(client);
}

const taskProjectSelect = {
  id: true,
  name: true,
  colorKey: true,
  status: true,
} satisfies Prisma.ProjectSelect;

const taskInclude = {
  project: { select: taskProjectSelect },
} satisfies Prisma.TaskInclude;

function assertOperationKey(value: string): void {
  if (value.length < 1 || value.length > 128) {
    throw new TypeError('Operation keys must contain between 1 and 128 characters');
  }
}

async function assertActiveProject(
  client: RepositoryClient,
  userId: string,
  projectId: string,
): Promise<void> {
  // Lock the project row through the subsequent task write. A concurrent archive either
  // linearizes after this assignment or commits first and is observed as ARCHIVED here.
  const projects = await client.$queryRaw<Array<{ id: string; status: string }>>`
    SELECT "id", "status"::text AS "status"
    FROM "projects"
    WHERE "id" = ${projectId}::uuid
      AND "user_id" = ${userId}::uuid
    FOR UPDATE
  `;
  if (projects[0]?.status !== ProjectStatus.ACTIVE) {
    throw new RepositoryRecordNotFoundError('Project');
  }
}

type LockedTaskRow = {
  deletedAt: Date | null;
  id: string;
  version: number;
};

async function lockOwnedTask(
  client: RepositoryClient,
  userId: string,
  taskId: string,
): Promise<LockedTaskRow> {
  const rows = await client.$queryRaw<LockedTaskRow[]>`
    SELECT "id", "version", "deleted_at" AS "deletedAt"
    FROM "tasks"
    WHERE "id" = ${taskId}::uuid
      AND "user_id" = ${userId}::uuid
    FOR UPDATE
  `;
  const task = rows[0];
  if (!task) throw new RepositoryRecordNotFoundError('Task');
  return task;
}

async function lockDeleteUndo(client: RepositoryClient, userId: string, undoOperationId: string) {
  const rows = await client.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "undo_operations"
    WHERE "id" = ${undoOperationId}::uuid
      AND "user_id" = ${userId}::uuid
      AND "operation_code"::text = 'TASK_DELETE'
      AND "source_type"::text = 'MANUAL'
    FOR UPDATE
  `;
  if (!rows[0]) throw new RepositoryRecordNotFoundError('UndoOperation');

  return client.undoOperation.findUniqueOrThrow({ where: { id: undoOperationId } });
}

async function findTask(
  client: RepositoryClient,
  userId: string,
  taskId: string,
  includeDeleted: boolean,
) {
  const task = await client.task.findFirst({
    where: { id: taskId, userId, ...(includeDeleted ? {} : { deletedAt: null }) },
    include: taskInclude,
  });
  if (!task) {
    throw new RepositoryRecordNotFoundError('Task');
  }
  return task;
}

async function classifyTaskWriteFailure(
  client: RepositoryClient,
  userId: string,
  taskId: string,
  version: number,
  expectedStatus?: (typeof TaskStatus)[keyof typeof TaskStatus],
): Promise<never> {
  const task = await client.task.findFirst({ where: { id: taskId, userId } });
  if (!task) {
    throw new RepositoryRecordNotFoundError('Task');
  }
  if (task.version !== version) {
    throw new OptimisticWriteConflictError();
  }
  if (task.deletedAt !== null) {
    throw new RepositoryInvalidStateError('DELETED');
  }
  if (expectedStatus !== undefined && task.status !== expectedStatus) {
    throw new RepositoryInvalidStateError(task.status);
  }
  throw new OptimisticWriteConflictError();
}

function readTargetTaskId(targetRefs: Prisma.JsonValue): string {
  if (
    targetRefs !== null &&
    !Array.isArray(targetRefs) &&
    typeof targetRefs === 'object' &&
    typeof targetRefs.taskId === 'string'
  ) {
    return targetRefs.taskId;
  }
  throw new RepositoryInvalidStateError('INVALID_UNDO_TARGET');
}

function taskUpdateData(changes: UpdateTaskRecord): Prisma.TaskUpdateManyMutationInput {
  return {
    version: { increment: 1 },
    ...(changes.title === undefined ? {} : { title: changes.title.trim() }),
    ...(changes.description === undefined ? {} : { description: changes.description }),
    ...(changes.projectId === undefined ? {} : { projectId: changes.projectId }),
    ...(changes.priority === undefined ? {} : { priority: changes.priority }),
    ...(changes.scheduledAt === undefined ? {} : { scheduledAt: changes.scheduledAt }),
    ...(changes.deadlineAt === undefined ? {} : { deadlineAt: changes.deadlineAt }),
    ...(changes.reminderAt === undefined ? {} : { reminderAt: changes.reminderAt }),
  };
}

export class TaskRepository {
  constructor(
    private readonly db: RepositoryClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(userId: string, input: CreateTaskRecord) {
    return withTransaction(this.db, async (transaction) => {
      if (input.projectId) {
        await assertActiveProject(transaction, userId, input.projectId);
      }

      return transaction.task.create({
        data: {
          userId,
          title: input.title.trim(),
          description: input.description ?? '',
          priority: input.priority ?? TaskPriority.MEDIUM,
          source: input.source ?? RecordSource.MANUAL,
          ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
          ...(input.scheduledAt === undefined ? {} : { scheduledAt: input.scheduledAt }),
          ...(input.deadlineAt === undefined ? {} : { deadlineAt: input.deadlineAt }),
          ...(input.reminderAt === undefined ? {} : { reminderAt: input.reminderAt }),
          ...(input.sourceActionId === undefined ? {} : { sourceActionId: input.sourceActionId }),
        },
        include: taskInclude,
      });
    });
  }

  get(userId: string, taskId: string) {
    return findTask(this.db, userId, taskId, false);
  }

  async list(userId: string, input: ListTaskRecordsInput = {}) {
    const status = input.status ?? TaskStatus.TODO;
    const limit = input.limit ?? 50;
    const scope = {
      userId,
      deletedAt: null,
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    } satisfies Prisma.TaskWhereInput;
    const orderBy: Prisma.TaskOrderByWithRelationInput[] =
      status === TaskStatus.COMPLETED
        ? [{ completedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }, { id: 'desc' }]
        : [
            { scheduledAt: { sort: 'asc', nulls: 'last' } },
            { priority: 'desc' },
            { createdAt: 'asc' },
            { id: 'asc' },
          ];

    const [items, todo, completed] = await withTransaction(this.db, (transaction) =>
      Promise.all([
        transaction.task.findMany({
          where: { ...scope, status },
          include: taskInclude,
          orderBy,
          take: limit + 1,
          ...(input.cursor === undefined ? {} : { cursor: { id: input.cursor }, skip: 1 }),
        }),
        transaction.task.count({ where: { ...scope, status: TaskStatus.TODO } }),
        transaction.task.count({ where: { ...scope, status: TaskStatus.COMPLETED } }),
      ]),
    );

    const hasNextPage = items.length > limit;
    const page = hasNextPage ? items.slice(0, limit) : items;
    return {
      items: page,
      nextCursor: hasNextPage ? (page.at(-1)?.id ?? null) : null,
      counts: { todo, completed },
    };
  }

  async update(userId: string, taskId: string, version: number, changes: UpdateTaskRecord) {
    return withTransaction(this.db, async (transaction) => {
      if (changes.projectId) {
        await assertActiveProject(transaction, userId, changes.projectId);
      }
      const result = await transaction.task.updateMany({
        where: { id: taskId, userId, version, deletedAt: null },
        data: taskUpdateData(changes),
      });
      if (result.count !== 1) {
        await classifyTaskWriteFailure(transaction, userId, taskId, version);
      }
      return findTask(transaction, userId, taskId, false);
    });
  }

  async complete(userId: string, taskId: string, version: number) {
    const completedAt = this.now();
    return withTransaction(this.db, async (transaction) => {
      const result = await transaction.task.updateMany({
        where: {
          id: taskId,
          userId,
          version,
          deletedAt: null,
          status: TaskStatus.TODO,
        },
        data: {
          status: TaskStatus.COMPLETED,
          completedAt,
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) {
        await classifyTaskWriteFailure(transaction, userId, taskId, version, TaskStatus.TODO);
      }
      return findTask(transaction, userId, taskId, false);
    });
  }

  async restore(userId: string, taskId: string, version: number) {
    return withTransaction(this.db, async (transaction) => {
      const result = await transaction.task.updateMany({
        where: {
          id: taskId,
          userId,
          version,
          deletedAt: null,
          status: TaskStatus.COMPLETED,
        },
        data: {
          status: TaskStatus.TODO,
          completedAt: null,
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) {
        await classifyTaskWriteFailure(transaction, userId, taskId, version, TaskStatus.COMPLETED);
      }
      return findTask(transaction, userId, taskId, false);
    });
  }

  async softDelete(userId: string, taskId: string, version: number, sourceOperationId: string) {
    assertOperationKey(sourceOperationId);

    return withTransaction(this.db, async (transaction) => {
      const lockedTask = await lockOwnedTask(transaction, userId, taskId);
      if (lockedTask.version !== version) throw new OptimisticWriteConflictError();
      if (lockedTask.deletedAt !== null) throw new RepositoryInvalidStateError('DELETED');

      const deletedAt = this.now();
      const expiresAt = new Date(deletedAt.getTime() + TASK_DELETE_UNDO_WINDOW_MS);
      const result = await transaction.task.updateMany({
        where: { id: taskId, userId, version, deletedAt: null },
        data: { deletedAt, version: { increment: 1 } },
      });
      if (result.count !== 1) {
        await classifyTaskWriteFailure(transaction, userId, taskId, version);
      }
      const task = await findTask(transaction, userId, taskId, true);
      const undoOperation = await transaction.undoOperation.create({
        data: {
          userId,
          sourceType: UndoSourceType.MANUAL,
          sourceOperationId,
          operationCode: UndoOperationCode.TASK_DELETE,
          targetRefs: { taskId },
          inverseChange: { deletedAt: null },
          expectedVersion: task.version,
          scope: 'TASKS',
          targetType: 'TASK',
          payload: { taskId, deletedAt: deletedAt.toISOString() },
          expiresAt,
          createdAt: deletedAt,
        },
      });
      return { task, undoOperation };
    });
  }

  async executeDeleteUndo(userId: string, undoOperationId: string, idempotencyKey: string) {
    assertOperationKey(idempotencyKey);
    return withTransaction(this.db, async (transaction) => {
      const undoOperation = await lockDeleteUndo(transaction, userId, undoOperationId);
      if (undoOperation.status === UndoOperationStatus.EXPIRED) {
        return { kind: 'expired' as const, undoOperation };
      }
      if (undoOperation.status !== UndoOperationStatus.AVAILABLE) {
        throw new UndoUnavailableError();
      }

      const taskId = readTargetTaskId(undoOperation.targetRefs);
      const lockedTask = await lockOwnedTask(transaction, userId, taskId);
      if (lockedTask.version !== undoOperation.expectedVersion || lockedTask.deletedAt === null) {
        throw new OptimisticWriteConflictError();
      }

      const executedAt = this.now();
      if (undoOperation.expiresAt.getTime() <= executedAt.getTime()) {
        const expired = await transaction.undoOperation.update({
          where: { id: undoOperation.id },
          data: { status: UndoOperationStatus.EXPIRED },
        });
        return { kind: 'expired' as const, undoOperation: expired };
      }

      const restored = await transaction.task.updateMany({
        where: {
          id: taskId,
          userId,
          version: undoOperation.expectedVersion,
          deletedAt: { not: null },
        },
        data: { deletedAt: null, version: { increment: 1 } },
      });
      if (restored.count !== 1) {
        const task = await transaction.task.findFirst({ where: { id: taskId, userId } });
        if (!task) {
          throw new RepositoryRecordNotFoundError('Task');
        }
        throw new OptimisticWriteConflictError();
      }

      const used = await transaction.undoOperation.updateMany({
        where: {
          id: undoOperation.id,
          userId,
          status: UndoOperationStatus.AVAILABLE,
        },
        data: {
          status: UndoOperationStatus.EXECUTED,
          executedAt,
          idempotencyKey,
        },
      });
      if (used.count !== 1) {
        throw new UndoUnavailableError();
      }

      return {
        kind: 'executed' as const,
        task: await findTask(transaction, userId, taskId, false),
        undoOperation: await transaction.undoOperation.findUniqueOrThrow({
          where: { id: undoOperation.id },
        }),
      };
    });
  }
}
