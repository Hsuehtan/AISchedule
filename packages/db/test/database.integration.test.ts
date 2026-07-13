import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createPrismaClient,
  ProjectRepository,
  TaskRepository,
  type DatabaseClient,
} from '../src/index';

const execFileAsync = promisify(execFile);

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
      colorKey: 'pink',
    });

    await expect(
      projects.create(owner.id, { name: '工作', colorKey: 'teal' }),
    ).rejects.toMatchObject({ code: 'P2002' });

    await expect(
      tasks.create(otherUser.id, { title: '越权任务', projectId: work.id }),
    ).rejects.toMatchObject({ code: 'P2003' });

    const task = await tasks.create(owner.id, {
      title: '准备周报',
      projectId: work.id,
    });
    expect(task.userId).toBe(owner.id);

    await projects.archive(owner.id, work.id, work.version);
    const replacement = await projects.create(owner.id, {
      name: '工作',
      colorKey: 'teal',
    });
    expect(replacement.id).not.toBe(work.id);
  });

  it('rejects a negative points balance at the database boundary', async () => {
    await expect(db.user.create({ data: { aiPoints: -1 } })).rejects.toThrow();
  });
});
