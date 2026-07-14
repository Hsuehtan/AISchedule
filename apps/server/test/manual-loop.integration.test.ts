import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import {
  apiErrorEnvelopeSchema,
  authResponseSchema,
  projectListResponseSchema,
  projectMutationResponseSchema,
  taskDeleteResponseSchema,
  taskListResponseSchema,
  taskMutationResponseSchema,
  undoExecutionResponseSchema,
} from '@ai-schedule/contracts';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../src/bootstrap.js';
import { DatabaseService } from '../src/platform/database/database.service.js';
import { IdempotencyService } from '../src/platform/idempotency/idempotency.service.js';

const execFileAsync = promisify(execFile);
const origin = 'http://127.0.0.1:4173';

function parseBody<T>(
  response: { json: () => unknown },
  schema: { parse: (value: unknown) => T },
): T {
  return schema.parse(response.json());
}

function cookieFrom(response: { headers: Record<string, unknown> }): string {
  const value = response.headers['set-cookie'];
  if (typeof value !== 'string') throw new Error('missing session cookie');
  return value.split(';', 1)[0] ?? '';
}

async function register(
  app: NestFastifyApplication,
  username: string,
): Promise<{ cookie: string; userId: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/username/register',
    headers: { origin },
    payload: { username, password: 'valid-password' },
  });
  expect(response.statusCode).toBe(201);
  return {
    cookie: cookieFrom(response),
    userId: parseBody(response, authResponseSchema).user.id,
  };
}

function writeHeaders(cookie: string, key: string) {
  return { cookie, origin, 'idempotency-key': key };
}

describe('Phase 2 manual task and project loop', () => {
  const container = new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('ai_schedule')
    .withUsername('ai_schedule')
    .withPassword('ai_schedule');

  let startedContainer: Awaited<ReturnType<typeof container.start>>;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    startedContainer = await container.start();
    const databaseUrl = startedContainer.getConnectionUri();
    await execFileAsync(
      'pnpm',
      ['exec', 'prisma', 'migrate', 'deploy', '--config', 'prisma.config.ts'],
      {
        cwd: resolve(process.cwd(), '../../packages/db'),
        env: { ...process.env, DATABASE_URL: databaseUrl },
      },
    );
    app = await createApplication({
      databaseUrl,
      allowedOrigins: [origin],
      configRoot: resolve(process.cwd(), '../../config'),
      isProduction: false,
    });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await startedContainer?.stop();
  });

  it('creates, filters, updates, completes and restores tenant-safe tasks', async () => {
    const owner = await register(app, 'task-owner');
    const other = await register(app, 'task-other');

    const projectResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: writeHeaders(owner.cookie, 'project-work'),
      payload: { name: '工作' },
    });
    expect(projectResponse.statusCode).toBe(201);
    const project = parseBody(projectResponse, projectMutationResponseSchema).project;
    expect(project).toMatchObject({ name: '工作', colorKey: 'pink', version: 1 });

    const highResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: writeHeaders(owner.cookie, 'task-high'),
      payload: {
        title: '写周报',
        projectId: project.id,
        priority: 'HIGH',
        scheduledAt: '2026-07-16T01:30:00.000Z',
        deadlineAt: '2026-07-16T12:00:00.000Z',
        reminderAt: '2026-07-16T01:25:00.000Z',
      },
    });
    expect(highResponse.statusCode).toBe(201);
    const high = parseBody(highResponse, taskMutationResponseSchema).task;
    expect(high).toMatchObject({
      priority: 'HIGH',
      project: { id: project.id, name: '工作', colorKey: 'pink', status: 'ACTIVE' },
    });

    const mediumResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: writeHeaders(owner.cookie, 'task-medium'),
      payload: { title: '买牛奶' },
    });
    expect(mediumResponse.statusCode).toBe(201);
    const medium = parseBody(mediumResponse, taskMutationResponseSchema).task;
    expect(medium).toMatchObject({ priority: 'MEDIUM', project: null });

    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: writeHeaders(owner.cookie, 'task-medium'),
      payload: { title: '买牛奶' },
    });
    expect(replay.statusCode).toBe(201);
    expect(parseBody(replay, taskMutationResponseSchema).task.id).toBe(medium.id);

    const changedReplay = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: writeHeaders(owner.cookie, 'task-medium'),
      payload: { title: '不同请求' },
    });
    expect(changedReplay.statusCode).toBe(409);
    expect(parseBody(changedReplay, apiErrorEnvelopeSchema)).toMatchObject({
      error: { code: 'IDEMPOTENCY_KEY_REUSED' },
    });

    const all = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks?status=TODO',
      headers: { cookie: owner.cookie },
    });
    expect(all.statusCode).toBe(200);
    const allBody = parseBody(all, taskListResponseSchema);
    expect(allBody.counts).toEqual({ todo: 2, completed: 0 });
    expect(allBody.items.map((task) => task.id)).toEqual([high.id, medium.id]);

    const filtered = await app.inject({
      method: 'GET',
      url: `/api/v1/tasks?status=TODO&projectId=${project.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(filtered.statusCode).toBe(200);
    const filteredBody = parseBody(filtered, taskListResponseSchema);
    expect(filteredBody.items).toHaveLength(1);
    expect(filteredBody.counts).toEqual({ todo: 1, completed: 0 });

    const foreign = await app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${high.id}`,
      headers: { cookie: other.cookie },
    });
    expect(foreign.statusCode).toBe(404);

    const updatedResponse = await app.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${medium.id}`,
      headers: writeHeaders(owner.cookie, 'task-medium-update'),
      payload: {
        version: medium.version,
        changes: {
          projectId: project.id,
          priority: 'LOW',
          scheduledAt: null,
          deadlineAt: '2026-07-18T12:00:00.000Z',
          reminderAt: null,
        },
      },
    });
    expect(updatedResponse.statusCode).toBe(200);
    const updated = parseBody(updatedResponse, taskMutationResponseSchema).task;
    expect(updated).toMatchObject({
      priority: 'LOW',
      scheduledAt: null,
      reminderAt: null,
      project: { id: project.id, name: '工作' },
    });

    const stale = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${updated.id}/complete`,
      headers: writeHeaders(owner.cookie, 'task-stale-complete'),
      payload: { version: medium.version },
    });
    expect(stale.statusCode).toBe(409);
    expect(parseBody(stale, apiErrorEnvelopeSchema)).toMatchObject({
      error: { code: 'TASK_VERSION_CONFLICT' },
    });

    const completedResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${updated.id}/complete`,
      headers: writeHeaders(owner.cookie, 'task-complete'),
      payload: { version: updated.version },
    });
    expect(completedResponse.statusCode).toBe(200);
    const completed = parseBody(completedResponse, taskMutationResponseSchema).task;
    expect(completed).toMatchObject({ status: 'COMPLETED' });

    const restoredResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${updated.id}/restore`,
      headers: writeHeaders(owner.cookie, 'task-restore'),
      payload: { version: completed.version },
    });
    expect(restoredResponse.statusCode).toBe(200);
    expect(parseBody(restoredResponse, taskMutationResponseSchema).task).toMatchObject({
      status: 'TODO',
      completedAt: null,
    });
  });

  it('soft-deletes with a server-owned three-second single-use undo window', async () => {
    const owner = await register(app, 'undo-owner');
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: writeHeaders(owner.cookie, 'undo-task-create'),
      payload: { title: '临时任务' },
    });
    const task = parseBody(created, taskMutationResponseSchema).task;

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/tasks/${task.id}?version=${task.version}`,
      headers: writeHeaders(owner.cookie, 'undo-task-delete'),
    });
    expect(deleted.statusCode).toBe(200);
    const deletedBody = parseBody(deleted, taskDeleteResponseSchema);
    expect(Date.parse(deletedBody.undoOperation.expiresAt)).toBeGreaterThan(Date.now());

    const undoId = deletedBody.undoOperation.id;
    const restored = await app.inject({
      method: 'POST',
      url: `/api/v1/undo-operations/${undoId}/execute`,
      headers: writeHeaders(owner.cookie, 'undo-task-execute'),
    });
    expect(restored.statusCode).toBe(200);
    expect(parseBody(restored, undoExecutionResponseSchema)).toMatchObject({
      task: { id: task.id, deletedAt: null },
      undoOperation: { id: undoId, status: 'EXECUTED' },
    });

    const repeated = await app.inject({
      method: 'POST',
      url: `/api/v1/undo-operations/${undoId}/execute`,
      headers: writeHeaders(owner.cookie, 'undo-task-execute-again'),
    });
    expect(repeated.statusCode).toBe(409);
    expect(parseBody(repeated, apiErrorEnvelopeSchema)).toMatchObject({
      error: { code: 'UNDO_NOT_AVAILABLE' },
    });

    const expires = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: writeHeaders(owner.cookie, 'expired-task-create'),
      payload: { title: '过期任务' },
    });
    const expiringTask = parseBody(expires, taskMutationResponseSchema).task;
    const expiringDelete = await app.inject({
      method: 'DELETE',
      url: `/api/v1/tasks/${expiringTask.id}?version=${expiringTask.version}`,
      headers: writeHeaders(owner.cookie, 'expired-task-delete'),
    });
    const expiringUndoId = parseBody(expiringDelete, taskDeleteResponseSchema).undoOperation.id;
    const database = app.get(DatabaseService).client;
    const forcedExpiryClock = Date.now();
    await database.undoOperation.update({
      where: { id: expiringUndoId },
      data: {
        createdAt: new Date(forcedExpiryClock - 5_000),
        expiresAt: new Date(forcedExpiryClock - 1_000),
      },
    });

    const expired = await app.inject({
      method: 'POST',
      url: `/api/v1/undo-operations/${expiringUndoId}/execute`,
      headers: writeHeaders(owner.cookie, 'expired-task-execute'),
    });
    expect(expired.statusCode).toBe(410);
    expect(parseBody(expired, apiErrorEnvelopeSchema)).toMatchObject({
      error: { code: 'UNDO_EXPIRED' },
    });
    expect(
      await database.undoOperation.findUniqueOrThrow({ where: { id: expiringUndoId } }),
    ).toMatchObject({ status: 'EXPIRED' });
    expect(
      await database.idempotencyRecord.findUniqueOrThrow({
        where: {
          userId_scope_key: {
            userId: owner.userId,
            scope: `TASK_DELETE_UNDO:${expiringUndoId}`,
            key: 'expired-task-execute',
          },
        },
      }),
    ).toMatchObject({ responseStatus: 410, responseSnapshot: { kind: 'expired' } });

    const expiredReplay = await app.inject({
      method: 'POST',
      url: `/api/v1/undo-operations/${expiringUndoId}/execute`,
      headers: writeHeaders(owner.cookie, 'expired-task-execute'),
    });
    expect(expiredReplay.statusCode).toBe(410);
    expect(parseBody(expiredReplay, apiErrorEnvelopeSchema)).toMatchObject({
      error: { code: 'UNDO_EXPIRED' },
    });

    const expiredWithNewKey = await app.inject({
      method: 'POST',
      url: `/api/v1/undo-operations/${expiringUndoId}/execute`,
      headers: writeHeaders(owner.cookie, 'expired-task-execute-again'),
    });
    expect(expiredWithNewKey.statusCode).toBe(410);
    expect(parseBody(expiredWithNewKey, apiErrorEnvelopeSchema)).toMatchObject({
      error: { code: 'UNDO_EXPIRED' },
    });
  });

  it('serializes concurrent project color allocation through idempotent API writes', async () => {
    const owner = await register(app, 'concurrent-project-owner');
    const responses = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        app.inject({
          method: 'POST',
          url: '/api/v1/projects',
          headers: writeHeaders(owner.cookie, `concurrent-project-${index}`),
          payload: { name: `并发项目${index + 1}` },
        }),
      ),
    );

    expect(responses.map((response) => response.statusCode)).toEqual([
      201, 201, 201, 201, 201, 201,
    ]);
    expect(
      responses
        .map((response) => parseBody(response, projectMutationResponseSchema).project.colorKey)
        .sort(),
    ).toEqual(['amber', 'cyan', 'pink', 'purple', 'slate', 'teal']);
  });

  it('manages projects, keeps archived task summaries, and permits active-name reuse', async () => {
    const owner = await register(app, 'project-owner');

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: writeHeaders(owner.cookie, 'project-create'),
      payload: { name: '工作' },
    });
    const project = parseBody(create, projectMutationResponseSchema).project;

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: writeHeaders(owner.cookie, 'project-duplicate'),
      payload: { name: ' 工作 ' },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(parseBody(duplicate, apiErrorEnvelopeSchema)).toMatchObject({
      error: { code: 'PROJECT_NAME_CONFLICT' },
    });

    const taskResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: writeHeaders(owner.cookie, 'project-task'),
      payload: { title: '归档后仍可见', projectId: project.id },
    });
    const projectTask = parseBody(taskResponse, taskMutationResponseSchema).task;

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${project.id}`,
      headers: writeHeaders(owner.cookie, 'project-rename'),
      payload: { version: project.version, changes: { name: '事业' } },
    });
    const renamedProject = parseBody(renamed, projectMutationResponseSchema).project;
    expect(renamed.statusCode).toBe(200);
    expect(renamedProject.name).toBe('事业');

    const archived = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/archive`,
      headers: writeHeaders(owner.cookie, 'project-archive'),
      payload: { version: renamedProject.version },
    });
    expect(archived.statusCode).toBe(200);
    expect(parseBody(archived, projectMutationResponseSchema).project.status).toBe('ARCHIVED');

    const active = await app.inject({
      method: 'GET',
      url: '/api/v1/projects?status=ACTIVE',
      headers: { cookie: owner.cookie },
    });
    expect(parseBody(active, projectListResponseSchema).items).toEqual([]);

    const archivedTask = await app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${projectTask.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(parseBody(archivedTask, taskMutationResponseSchema).task.project).toMatchObject({
      id: project.id,
      name: '事业',
      status: 'ARCHIVED',
    });

    const editedArchivedTask = await app.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${projectTask.id}`,
      headers: writeHeaders(owner.cookie, 'archived-project-task-edit'),
      payload: {
        version: projectTask.version,
        changes: { description: '归档后仍允许编辑任务自身字段' },
      },
    });
    expect(editedArchivedTask.statusCode).toBe(200);
    expect(parseBody(editedArchivedTask, taskMutationResponseSchema).task).toMatchObject({
      description: '归档后仍允许编辑任务自身字段',
      project: { id: project.id, name: '事业', status: 'ARCHIVED' },
    });

    const reused = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: writeHeaders(owner.cookie, 'project-name-reuse'),
      payload: { name: '事业' },
    });
    expect(reused.statusCode).toBe(201);
    expect(parseBody(reused, projectMutationResponseSchema).project.id).not.toBe(project.id);
  });

  it('requires an idempotency key on every task, project and undo write', async () => {
    const owner = await register(app, 'idempotency-owner');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { cookie: owner.cookie, origin },
      payload: { title: '缺少幂等键' },
    });
    expect(response.statusCode).toBe(428);
    expect(parseBody(response, apiErrorEnvelopeSchema)).toMatchObject({
      error: { code: 'IDEMPOTENCY_KEY_REQUIRED' },
    });
  });

  it('commits the business write and response snapshot atomically and reclaims expired keys', async () => {
    const owner = await register(app, 'idempotency-atomic-owner');
    const database = app.get(DatabaseService).client;
    const idempotency = app.get(IdempotencyService);
    const options = {
      userId: owner.userId,
      scope: 'TEST_ATOMIC_WRITE',
      key: 'same-user-intent',
      request: { title: '原子任务' },
      responseStatus: 201,
    } as const;

    await expect(
      idempotency.execute({
        ...options,
        operation: async ({ transaction }) => {
          await transaction.task.create({
            data: { userId: owner.userId, title: '不应提交' },
          });
          throw new Error('simulate response serialization failure');
        },
      }),
    ).rejects.toThrow('simulate response serialization failure');

    expect(await database.task.count({ where: { userId: owner.userId, title: '不应提交' } })).toBe(
      0,
    );
    expect(
      await database.idempotencyRecord.count({
        where: { userId: owner.userId, scope: options.scope, key: options.key },
      }),
    ).toBe(0);

    const committed = await idempotency.execute({
      ...options,
      operation: async ({ transaction }) => {
        const task = await transaction.task.create({
          data: { userId: owner.userId, title: '原子任务' },
        });
        return { taskId: task.id };
      },
    });
    const replayed = await idempotency.execute({
      ...options,
      operation: () => Promise.reject(new Error('replay must not execute the operation')),
    });
    expect(replayed).toEqual(committed);

    await database.idempotencyRecord.update({
      where: {
        userId_scope_key: {
          userId: owner.userId,
          scope: options.scope,
          key: options.key,
        },
      },
      data: { expiresAt: new Date(Date.now() - 1) },
    });

    const afterExpiry = await idempotency.execute({
      ...options,
      request: { title: '过期后新意图' },
      operation: async ({ transaction }) => {
        const task = await transaction.task.create({
          data: { userId: owner.userId, title: '过期后新意图' },
        });
        return { taskId: task.id };
      },
    });
    expect(afterExpiry.taskId).not.toBe(committed.taskId);
    expect(await database.task.count({ where: { userId: owner.userId } })).toBe(2);
  });
});
