import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createPrismaClient,
  OptimisticWriteConflictError,
  PROJECT_COLOR_KEYS,
  ProjectRepository,
  RepositoryRecordNotFoundError,
  TaskRepository,
  UndoUnavailableError,
  type DatabaseClient,
} from '../src/index';

const execFileAsync = promisify(execFile);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function holdProjectArchive(db: DatabaseClient, userId: string, projectId: string) {
  const archived = deferred();
  const release = deferred();
  const transaction = db.$transaction(async (client) => {
    const result = await client.project.updateMany({
      where: { id: projectId, userId, status: 'ACTIVE' },
      data: {
        status: 'ARCHIVED',
        archivedAt: new Date('2026-07-14T12:00:00.000Z'),
        version: { increment: 1 },
      },
    });
    expect(result.count).toBe(1);
    archived.resolve();
    await release.promise;
  });

  await archived.promise;
  return {
    commit: async () => {
      release.resolve();
      await transaction;
    },
  };
}

async function holdTaskRow(db: DatabaseClient, userId: string, taskId: string) {
  const locked = deferred();
  const release = deferred();
  const transaction = db.$transaction(async (client) => {
    await client.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "tasks"
      WHERE "id" = ${taskId}::uuid
        AND "user_id" = ${userId}::uuid
      FOR UPDATE
    `;
    locked.resolve();
    await release.promise;
  });

  await locked.promise;
  return {
    commit: async () => {
      release.resolve();
      await transaction;
    },
  };
}

describe('PostgreSQL repository baseline', () => {
  const container = new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('ai_schedule')
    .withUsername('ai_schedule')
    .withPassword('ai_schedule');

  let startedContainer: Awaited<ReturnType<typeof container.start>>;
  let db: DatabaseClient;

  beforeAll(async () => {
    startedContainer = await container.start();
    const databaseUrl = startedContainer.getConnectionUri();

    await execFileAsync(
      'pnpm',
      ['exec', 'prisma', 'migrate', 'deploy', '--config', 'prisma.config.ts'],
      {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: databaseUrl },
      },
    );

    db = createPrismaClient(databaseUrl);
  }, 120_000);

  afterAll(async () => {
    await db?.$disconnect();
    await startedContainer?.stop();
  });

  it('enforces tenant-safe project relations and active-name reuse rules', async () => {
    const owner = await db.user.create({ data: {} });
    const otherUser = await db.user.create({ data: {} });
    const projects = new ProjectRepository(db);
    const tasks = new TaskRepository(db);

    const work = await projects.create(owner.id, {
      name: ' 工作 ',
    });

    await expect(projects.create(owner.id, { name: '工作' })).rejects.toMatchObject({
      code: 'P2002',
    });

    await expect(
      tasks.create(otherUser.id, { title: '越权任务', projectId: work.id }),
    ).rejects.toBeInstanceOf(RepositoryRecordNotFoundError);

    const task = await tasks.create(owner.id, {
      title: '准备周报',
      projectId: work.id,
    });
    expect(task.userId).toBe(owner.id);

    await projects.archive(owner.id, work.id, work.version);
    const replacement = await projects.create(owner.id, {
      name: '工作',
    });
    expect(replacement.id).not.toBe(work.id);
  });

  it('assigns project colors server-side and returns tenant-scoped task counts', async () => {
    const owner = await db.user.create({ data: {} });
    const otherUser = await db.user.create({ data: {} });
    const projects = new ProjectRepository(db);
    const tasks = new TaskRepository(db);

    const work = await projects.create(owner.id, { name: '工作' });
    const life = await projects.create(owner.id, { name: '生活' });
    expect([work.colorKey, life.colorKey]).toEqual(['pink', 'teal']);

    await tasks.create(owner.id, { title: '周报', projectId: work.id });
    const done = await tasks.create(owner.id, { title: '旧周报', projectId: work.id });
    await tasks.complete(owner.id, done.id, done.version);
    await tasks.create(otherUser.id, { title: '他人任务' });

    const page = await projects.list(owner.id, { status: 'ACTIVE', limit: 20 });
    expect(page.items.map(({ name, taskCount }) => ({ name, taskCount }))).toEqual([
      { name: '工作', taskCount: 1 },
      { name: '生活', taskCount: 0 },
    ]);
    expect(page.nextCursor).toBeNull();

    const renamed = await projects.updateName(owner.id, life.id, life.version, '家庭');
    expect(renamed.name).toBe('家庭');
    await expect(
      projects.updateName(owner.id, life.id, life.version, '过期'),
    ).rejects.toBeInstanceOf(OptimisticWriteConflictError);
    await expect(
      projects.updateName(otherUser.id, work.id, work.version, '越权'),
    ).rejects.toBeInstanceOf(RepositoryRecordNotFoundError);
  });

  it('serializes concurrent project color allocation per user', async () => {
    const owner = await db.user.create({ data: {} });
    const projects = new ProjectRepository(db);

    const firstPair = await Promise.all([
      projects.create(owner.id, { name: '并发项目一' }),
      projects.create(owner.id, { name: '并发项目二' }),
    ]);
    expect(firstPair.map(({ colorKey }) => colorKey).sort()).toEqual(['pink', 'teal'].sort());

    const remaining = [];
    for (const name of ['项目三', '项目四', '项目五', '项目六']) {
      remaining.push(await projects.create(owner.id, { name }));
    }
    expect(remaining.map(({ colorKey }) => colorKey)).toEqual(['purple', 'amber', 'cyan', 'slate']);

    const leastUsed = await projects.create(owner.id, { name: '项目七' });
    expect(leastUsed.colorKey).toBe(PROJECT_COLOR_KEYS[0]);
  });

  it('rejects task creation when a concurrent archive commits first', async () => {
    const owner = await db.user.create({ data: {} });
    const projects = new ProjectRepository(db);
    const tasks = new TaskRepository(db);
    const project = await projects.create(owner.id, { name: '即将归档' });
    const archive = await holdProjectArchive(db, owner.id, project.id);

    const rejectedCreate = expect(
      tasks.create(owner.id, { title: '不能写入归档项目', projectId: project.id }),
    ).rejects.toBeInstanceOf(RepositoryRecordNotFoundError);

    await new Promise((resolve) => setTimeout(resolve, 25));
    await archive.commit();
    await rejectedCreate;
    expect(await db.task.count({ where: { projectId: project.id } })).toBe(0);
  });

  it('rejects task reassignment when a concurrent archive commits first', async () => {
    const owner = await db.user.create({ data: {} });
    const projects = new ProjectRepository(db);
    const tasks = new TaskRepository(db);
    const project = await projects.create(owner.id, { name: '目标项目' });
    const task = await tasks.create(owner.id, { title: '待移动任务' });
    const archive = await holdProjectArchive(db, owner.id, project.id);

    const rejectedUpdate = expect(
      tasks.update(owner.id, task.id, task.version, { projectId: project.id }),
    ).rejects.toBeInstanceOf(RepositoryRecordNotFoundError);

    await new Promise((resolve) => setTimeout(resolve, 25));
    await archive.commit();
    await rejectedUpdate;
    expect(await db.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({
      projectId: null,
      version: task.version,
    });
  });

  it('lists, updates, completes and restores tasks with deterministic ordering', async () => {
    const owner = await db.user.create({ data: {} });
    const otherUser = await db.user.create({ data: {} });
    const projects = new ProjectRepository(db);
    const tasks = new TaskRepository(db);
    const work = await projects.create(owner.id, { name: '工作' });
    const scheduledAt = new Date('2026-07-14T09:00:00.000Z');

    const low = await tasks.create(owner.id, {
      title: '低优先级',
      projectId: work.id,
      priority: 'LOW',
      scheduledAt,
      reminderAt: new Date('2026-07-14T08:55:00.000Z'),
    });
    const high = await tasks.create(owner.id, {
      title: '高优先级',
      projectId: work.id,
      priority: 'HIGH',
      scheduledAt,
    });
    const unscheduled = await tasks.create(owner.id, { title: '未排期' });

    expect(low.project).toMatchObject({ id: work.id, name: '工作', colorKey: 'pink' });
    expect(unscheduled.priority).toBe('MEDIUM');

    const page = await tasks.list(owner.id, {
      status: 'TODO',
      projectId: work.id,
      limit: 20,
    });
    expect(page.items.map((task) => task.id)).toEqual([high.id, low.id]);
    expect(page.counts).toEqual({ todo: 2, completed: 0 });

    const updated = await tasks.update(owner.id, low.id, low.version, {
      title: '修改后',
      projectId: null,
      deadlineAt: new Date('2026-07-15T12:00:00.000Z'),
      reminderAt: null,
    });
    expect(updated).toMatchObject({ title: '修改后', projectId: null, version: 2 });
    expect(updated.project).toBeNull();
    expect(updated.reminderAt).toBeNull();

    await expect(tasks.complete(owner.id, updated.id, 1)).rejects.toBeInstanceOf(
      OptimisticWriteConflictError,
    );
    await expect(
      tasks.update(otherUser.id, high.id, high.version, { title: '越权' }),
    ).rejects.toBeInstanceOf(RepositoryRecordNotFoundError);

    const completed = await tasks.complete(owner.id, updated.id, updated.version);
    expect(completed.status).toBe('COMPLETED');
    expect(completed.completedAt).not.toBeNull();
    const restored = await tasks.restore(owner.id, completed.id, completed.version);
    expect(restored).toMatchObject({ status: 'TODO', completedAt: null, version: 4 });
  });

  it('soft-deletes atomically and allows exactly one tenant-safe undo before three seconds', async () => {
    let now = new Date('2026-07-14T10:00:00.000Z');
    const owner = await db.user.create({ data: {} });
    const otherUser = await db.user.create({ data: {} });
    const tasks = new TaskRepository(db, () => now);
    const task = await tasks.create(owner.id, { title: '可撤销删除' });

    const deleted = await tasks.softDelete(owner.id, task.id, task.version, 'delete-op-1');
    expect(deleted.task).toMatchObject({ id: task.id, version: 2 });
    expect(deleted.task.deletedAt).toEqual(now);
    expect(deleted.undoOperation).toMatchObject({
      sourceOperationId: 'delete-op-1',
      operationCode: 'TASK_DELETE',
      expectedVersion: 2,
      status: 'AVAILABLE',
    });
    expect(deleted.undoOperation.expiresAt).toEqual(new Date('2026-07-14T10:00:03.000Z'));

    await expect(
      tasks.executeDeleteUndo(otherUser.id, deleted.undoOperation.id, 'undo-op-other'),
    ).rejects.toBeInstanceOf(RepositoryRecordNotFoundError);

    now = new Date('2026-07-14T10:00:02.999Z');
    const restored = await tasks.executeDeleteUndo(owner.id, deleted.undoOperation.id, 'undo-op-1');
    expect(restored.kind).toBe('executed');
    if (restored.kind !== 'executed') throw new Error('expected the undo to execute');
    expect(restored.task).toMatchObject({ id: task.id, deletedAt: null, version: 3 });
    expect(restored.undoOperation).toMatchObject({ status: 'EXECUTED', executedAt: now });

    await expect(
      tasks.executeDeleteUndo(owner.id, deleted.undoOperation.id, 'undo-op-retry'),
    ).rejects.toBeInstanceOf(UndoUnavailableError);
  });

  it('expires delete undo at the exact three-second boundary without restoring the task', async () => {
    let now = new Date('2026-07-14T11:00:00.000Z');
    const owner = await db.user.create({ data: {} });
    const tasks = new TaskRepository(db, () => now);
    const task = await tasks.create(owner.id, { title: '过期撤销' });
    const deleted = await tasks.softDelete(owner.id, task.id, task.version, 'delete-op-expired');

    now = new Date('2026-07-14T11:00:03.000Z');
    const expired = await tasks.executeDeleteUndo(
      owner.id,
      deleted.undoOperation.id,
      'undo-op-expired',
    );
    expect(expired).toMatchObject({
      kind: 'expired',
      undoOperation: { status: 'EXPIRED' },
    });

    const repeated = await tasks.executeDeleteUndo(
      owner.id,
      deleted.undoOperation.id,
      'undo-op-expired-again',
    );
    expect(repeated.kind).toBe('expired');

    expect(
      await db.task.findFirst({
        where: { id: task.id, userId: owner.id, deletedAt: { not: null } },
      }),
    ).not.toBeNull();
    expect(
      await db.undoOperation.findUniqueOrThrow({ where: { id: deleted.undoOperation.id } }),
    ).toMatchObject({ status: 'EXPIRED', executedAt: null });
  });

  it('starts the delete undo window only after the task write lock is acquired', async () => {
    let now = new Date('2026-07-14T12:00:00.000Z');
    const owner = await db.user.create({ data: {} });
    const tasks = new TaskRepository(db, () => now);
    const task = await tasks.create(owner.id, { title: '等待删除锁' });
    const held = await holdTaskRow(db, owner.id, task.id);

    const deletion = tasks.softDelete(owner.id, task.id, task.version, 'delete-after-lock');
    await new Promise((resolve) => setTimeout(resolve, 25));
    now = new Date('2026-07-14T12:00:03.200Z');
    await held.commit();

    const deleted = await deletion;
    expect(deleted.task.deletedAt).toEqual(now);
    expect(deleted.undoOperation.expiresAt).toEqual(new Date('2026-07-14T12:00:06.200Z'));
  });

  it('evaluates undo expiry only after its task lock is acquired', async () => {
    let now = new Date('2026-07-14T13:00:00.000Z');
    const owner = await db.user.create({ data: {} });
    const tasks = new TaskRepository(db, () => now);
    const task = await tasks.create(owner.id, { title: '等待撤销锁' });
    const deleted = await tasks.softDelete(owner.id, task.id, task.version, 'delete-for-undo-lock');
    const held = await holdTaskRow(db, owner.id, task.id);

    now = new Date('2026-07-14T13:00:02.999Z');
    const undo = tasks.executeDeleteUndo(owner.id, deleted.undoOperation.id, 'undo-after-lock');
    await new Promise((resolve) => setTimeout(resolve, 25));
    now = new Date('2026-07-14T13:00:03.000Z');
    await held.commit();

    await expect(undo).resolves.toMatchObject({
      kind: 'expired',
      undoOperation: { status: 'EXPIRED' },
    });
    expect(await db.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({
      deletedAt: new Date('2026-07-14T13:00:00.000Z'),
      version: 2,
    });
  });

  it('rejects a negative points balance at the database boundary', async () => {
    await expect(db.user.create({ data: { aiPoints: -1 } })).rejects.toThrow();
  });
});
