import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import type { ExecuteRequest, ExecuteResponse } from '@ai-schedule/contracts/internal-agent/v1';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AgentJobQueuePort } from '../src/modules/agent/agent-job-queue.port.js';
import type { AgentInferencePort } from '../src/modules/agent/agent-runtime.port.js';
import { AgentAdmissionService } from '../src/modules/agent/agent-admission.service.js';
import { AgentWorker } from '../src/modules/agent/agent-worker.js';
import { AiPointsService } from '../src/modules/users/points/ai-points.service.js';
import { CapabilityRegistryService } from '../src/modules/users/points/capability-registry.service.js';
import { PrismaAgentPersistence } from '../src/platform/agent/prisma-agent.persistence.js';
import { DatabaseService } from '../src/platform/database/database.service.js';
import { DatabaseUnitOfWork } from '../src/platform/database/unit-of-work.js';
import {
  PgBossAgentJobQueueAdapter,
  AGENT_REQUEST_QUEUE,
} from '../src/platform/queue/agent-job-queue.adapter.js';
import { PgBossQueue } from '../src/platform/queue/pg-boss.queue.js';
import { loadRuntimeConfiguration } from '../src/runtime-config.js';
import { createApplication } from '../src/bootstrap.js';

const execFileAsync = promisify(execFile);

describe('Agent admission, dispatch and settlement persistence', () => {
  const container = new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('ai_schedule_agent_runtime')
    .withUsername('ai_schedule')
    .withPassword('ai_schedule');

  let startedContainer: Awaited<ReturnType<typeof container.start>>;
  let database: DatabaseService;
  let unitOfWork: DatabaseUnitOfWork;
  let points: AiPointsService;
  let persistence: PrismaAgentPersistence;
  let queue: PgBossQueue;
  let queueJobs: PgBossAgentJobQueueAdapter;

  beforeAll(async () => {
    startedContainer = await container.start();
    const databaseUrl = startedContainer.getConnectionUri();
    const dbRoot = resolve(process.cwd(), '../../packages/db');
    await execFileAsync(
      process.execPath,
      [
        resolve(dbRoot, 'node_modules/prisma/build/index.js'),
        'migrate',
        'deploy',
        '--config',
        'prisma.config.ts',
      ],
      { cwd: dbRoot, env: { ...process.env, DATABASE_URL: databaseUrl } },
    );

    database = new DatabaseService(databaseUrl);
    unitOfWork = new DatabaseUnitOfWork(database);
    const runtime = loadRuntimeConfiguration(resolve(process.cwd(), '../../config'));
    await new CapabilityRegistryService(database, runtime).synchronize();
    points = new AiPointsService(unitOfWork, runtime);
    persistence = new PrismaAgentPersistence(unitOfWork, database);
    queue = new PgBossQueue(databaseUrl);
    await queue.start();
    await queue.ensureQueue(AGENT_REQUEST_QUEUE);
    queueJobs = new PgBossAgentJobQueueAdapter(unitOfWork, queue);
  }, 120_000);

  afterAll(async () => {
    await queue?.stop();
    await database?.onApplicationShutdown();
    await startedContainer?.stop();
  });

  it('rolls back idempotency, Run and reservation when transactional enqueue fails', async () => {
    const user = await database.client.user.create({ data: { aiPoints: 20 } });
    const runId = randomUUID();
    const failingJobs: AgentJobQueuePort = {
      enqueue: () => Promise.reject(new Error('queue write failed')),
    };
    const admission = new AgentAdmissionService(
      unitOfWork,
      points,
      persistence,
      failingJobs,
      () => new Date(),
      () => runId,
    );

    await expect(
      admission.createTurn({
        userId: user.id,
        idempotencyKey: 'atomic-rollback',
        input: { input: { mode: 'TEXT', text: '这次请求必须整体回滚' } },
      }),
    ).rejects.toThrow('queue write failed');

    expect(await database.client.agentRequestRun.count({ where: { id: runId } })).toBe(0);
    expect(await database.client.aiPointTransaction.count({ where: { requestId: runId } })).toBe(0);
    expect(
      await database.client.idempotencyRecord.count({
        where: { userId: user.id, scope: 'agent.turn', key: 'atomic-rollback' },
      }),
    ).toBe(0);
  });

  it('keeps manual task APIs available and does not reserve when Agent runtime config is absent', async () => {
    const origin = 'http://127.0.0.1:4173';
    let app: NestFastifyApplication | undefined;
    try {
      app = await createApplication({
        databaseUrl: startedContainer.getConnectionUri(),
        allowedOrigins: [origin],
        configRoot: resolve(process.cwd(), '../../config'),
        isProduction: false,
      });
      const username = `runtime_${randomUUID().slice(0, 8)}`;
      const registered = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/username/register',
        headers: { origin },
        payload: { username, password: 'valid-password' },
      });
      expect(registered.statusCode).toBe(201);
      const setCookie = registered.headers['set-cookie'];
      if (typeof setCookie !== 'string') throw new Error('session cookie missing');
      const cookie = setCookie.split(';', 1)[0] ?? '';

      const manualTask = await app.inject({
        method: 'POST',
        url: '/api/v1/tasks',
        headers: { cookie, origin, 'idempotency-key': 'manual-with-agent-disabled' },
        payload: { title: '手工功能不依赖 Python' },
      });
      expect(manualTask.statusCode).toBe(201);

      const agentTurn = await app.inject({
        method: 'POST',
        url: '/api/v1/agent/turns',
        headers: { cookie, origin, 'idempotency-key': 'disabled-agent-turn' },
        payload: { input: { mode: 'TEXT', text: '不应预留积分' } },
      });
      expect(agentTurn.statusCode).toBe(503);
      expect(agentTurn.json()).toMatchObject({
        error: { code: 'AGENT_SERVICE_UNAVAILABLE', message: '智能处理暂不可用' },
      });

      const identity = await database.client.userIdentity.findUniqueOrThrow({
        where: {
          type_identifierNormalized: { type: 'USERNAME', identifierNormalized: username },
        },
      });
      expect(
        await database.client.agentRequestRun.count({ where: { userId: identity.userId } }),
      ).toBe(0);
      expect(
        await database.client.aiPointTransaction.count({
          where: { userId: identity.userId, type: 'DEBIT' },
        }),
      ).toBe(0);
    } finally {
      await app?.close();
    }
  });

  it('atomically enqueues, dispatches once, persists REPLY, settles and only then exposes it', async () => {
    const user = await database.client.user.create({ data: { aiPoints: 20 } });
    await database.client.task.create({ data: { userId: user.id, title: '只属于当前用户的任务' } });
    const runId = randomUUID();
    const admittedAt = new Date();
    const admission = new AgentAdmissionService(
      unitOfWork,
      points,
      persistence,
      queueJobs,
      () => admittedAt,
      () => runId,
    );

    const queued = await admission.createTurn({
      userId: user.id,
      idempotencyKey: 'reply-success',
      input: { input: { mode: 'TEXT', text: '我今天应该先做什么？' } },
    });
    expect(queued).toMatchObject({ requestId: runId, status: 'QUEUED' });
    expect((await persistence.getRequest({ userId: user.id, requestId: runId })).status).toBe(
      'QUEUED',
    );

    const job = await queue.fetchOne<{ runId: string }>(AGENT_REQUEST_QUEUE);
    expect(job?.data).toEqual({ runId });
    const execute = vi.fn<[ExecuteRequest], Promise<ExecuteResponse>>((request) =>
      Promise.resolve({
        contractVersion: '1.0',
        requestId: request.requestId,
        resolved: {
          provider: 'DEEPSEEK',
          model: 'deepseek-v4-flash',
          promptVersion: 'standard-v1',
          providerSchemaVersion: 'agent-output-v1',
          repairAttempts: 0,
        },
        result: { type: 'REPLY', text: '先完成最重要且临近截止的任务。', offerPlan: true },
      }),
    );
    const worker = new AgentWorker(
      unitOfWork,
      points,
      persistence,
      { execute },
      () => new Date(admittedAt.getTime() + 1_000),
    );

    await expect(worker.process(runId)).resolves.toEqual({ kind: 'DISPATCHED_AND_SETTLED' });
    expect(execute).toHaveBeenCalledOnce();
    await expect(worker.process(runId)).resolves.toEqual({ kind: 'TERMINAL' });
    expect(execute).toHaveBeenCalledOnce();

    const response = await persistence.getRequest({ userId: user.id, requestId: runId });
    expect(response).toMatchObject({
      status: 'SUCCEEDED',
      result: {
        type: 'REPLY',
        message: {
          content: {
            type: 'AI_REPLY',
            text: '先完成最重要且临近截止的任务。',
            canGeneratePlan: true,
          },
        },
      },
    });
    const run = await database.client.agentRequestRun.findUniqueOrThrow({ where: { id: runId } });
    const debit = await database.client.aiPointTransaction.findFirstOrThrow({
      where: { userId: user.id, requestId: runId, type: 'DEBIT' },
    });
    expect(run).toMatchObject({ status: 'SUCCEEDED', resultType: 'REPLY' });
    expect(run.resultHash).toMatch(/^[a-f0-9]{64}$/);
    expect(debit).toMatchObject({ status: 'SUCCEEDED', pointsDelta: -1 });
    expect(
      (await database.client.user.findUniqueOrThrow({ where: { id: user.id } })).aiPoints,
    ).toBe(19);
    const messages = await persistence.listMessages({
      userId: user.id,
      conversationId: queued.conversationId,
      query: { limit: 50 },
    });
    expect(messages.items.map(({ role }) => role)).toEqual(['USER', 'ASSISTANT']);
    expect(execute.mock.calls[0]?.[0]).not.toHaveProperty('userId');
    expect(execute.mock.calls[0]?.[0]).not.toHaveProperty('reservationId');
    expect(execute.mock.calls[0]?.[0].candidates[0]?.candidateRef).toMatch(/^cand_[a-f0-9]{32}$/);
    expect(JSON.stringify(execute.mock.calls[0]?.[0])).not.toContain(
      '只属于当前用户的任务' + user.id,
    );

    if (job) await queue.complete(AGENT_REQUEST_QUEUE, job.id);
  });

  it('releases points for a definitive invalid result without reducing the balance', async () => {
    const user = await database.client.user.create({ data: { aiPoints: 20 } });
    const runId = randomUUID();
    const admittedAt = new Date();
    const jobs: AgentJobQueuePort = { enqueue: () => Promise.resolve({ jobId: runId }) };
    const admission = new AgentAdmissionService(
      unitOfWork,
      points,
      persistence,
      jobs,
      () => admittedAt,
      () => runId,
    );
    await admission.createTurn({
      userId: user.id,
      idempotencyKey: 'invalid-result',
      input: { input: { mode: 'TEXT', text: '返回无效结果' } },
    });
    const execute = vi.fn().mockRejectedValue({ code: 'INVALID_RESPONSE' });
    const worker = new AgentWorker(
      unitOfWork,
      points,
      persistence,
      { execute } as AgentInferencePort,
      () => new Date(admittedAt.getTime() + 1_000),
    );

    await expect(worker.process(runId)).resolves.toEqual({ kind: 'RELEASED' });
    expect(
      await database.client.agentRequestRun.findUniqueOrThrow({ where: { id: runId } }),
    ).toMatchObject({ status: 'RELEASED' });
    expect(
      await database.client.aiPointTransaction.findFirstOrThrow({
        where: { userId: user.id, requestId: runId, type: 'DEBIT' },
      }),
    ).toMatchObject({ status: 'CANCELLED' });
    expect(
      (await database.client.user.findUniqueOrThrow({ where: { id: user.id } })).aiPoints,
    ).toBe(20);
  });

  it('keeps an ambiguous dispatch frozen, never redispatches, then releases during recovery', async () => {
    const user = await database.client.user.create({ data: { aiPoints: 20 } });
    const runId = randomUUID();
    const admittedAt = new Date();
    const jobs: AgentJobQueuePort = { enqueue: () => Promise.resolve({ jobId: runId }) };
    const admission = new AgentAdmissionService(
      unitOfWork,
      points,
      persistence,
      jobs,
      () => admittedAt,
      () => runId,
    );
    await admission.createTurn({
      userId: user.id,
      idempotencyKey: 'ambiguous-timeout',
      input: { input: { mode: 'TEXT', text: '模拟连接中断' } },
    });
    const execute = vi.fn().mockRejectedValue({ code: 'UNAVAILABLE' });
    const earlyWorker = new AgentWorker(
      unitOfWork,
      points,
      persistence,
      { execute } as AgentInferencePort,
      () => new Date(admittedAt.getTime() + 1_000),
    );

    await expect(earlyWorker.process(runId)).resolves.toMatchObject({ kind: 'WAIT' });
    await expect(earlyWorker.process(runId)).resolves.toMatchObject({ kind: 'WAIT' });
    expect(execute).toHaveBeenCalledOnce();
    expect(
      await database.client.aiPointTransaction.findFirstOrThrow({
        where: { userId: user.id, requestId: runId, type: 'DEBIT' },
      }),
    ).toMatchObject({ status: 'PENDING' });

    const run = await database.client.agentRequestRun.findUniqueOrThrow({ where: { id: runId } });
    const recoveryWorker = new AgentWorker(
      unitOfWork,
      points,
      persistence,
      { execute } as AgentInferencePort,
      () => new Date(run.recoveryEligibleAt!.getTime() + 1),
    );
    await expect(recoveryWorker.process(runId)).resolves.toEqual({ kind: 'RELEASED' });
    expect(execute).toHaveBeenCalledOnce();
    expect(
      await database.client.agentRequestRun.findUniqueOrThrow({ where: { id: runId } }),
    ).toMatchObject({ status: 'RELEASED' });
    expect(
      (await database.client.user.findUniqueOrThrow({ where: { id: user.id } })).aiPoints,
    ).toBe(20);
  });
});
