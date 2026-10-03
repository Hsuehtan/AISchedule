import type { ContextReadResponse } from '@ai-schedule/contracts/internal-agent/v2';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import type { ExecuteRequest, ExecuteResponse } from '../src/modules/agent/agent-runtime.port.js';
import { Prisma } from '@ai-schedule/db';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AgentJobQueuePort } from '../src/modules/agent/agent-job-queue.port.js';
import type { AgentActionExecutor } from '../src/modules/agent/agent-action-executor.js';
import type { AgentInferencePort } from '../src/modules/agent/agent-runtime.port.js';
import { AgentAdmissionService } from '../src/modules/agent/agent-admission.service.js';
import { AgentApplicationService } from '../src/modules/agent/agent-application.service.js';
import { AgentWorker } from '../src/modules/agent/agent-worker.js';
import type { SmartInboxService } from '../src/modules/agent/smart-inbox.service.js';
import { PrismaAgentProjectsAdapter } from '../src/modules/projects/prisma-agent-projects.adapter.js';
import { PrismaAgentTasksAdapter } from '../src/modules/tasks/prisma-agent-tasks.adapter.js';
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
const unusedActionExecutor = { confirm: vi.fn() } as unknown as AgentActionExecutor;
const unusedSmartInbox = {
  get: vi.fn(),
  assertOrganizeEligible: vi.fn(),
} as unknown as SmartInboxService;

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

  const readContext = async (request: ExecuteRequest) => {
    const read = (resource: 'SOURCE' | 'MESSAGES' | 'TASKS' | 'PROJECTS', limit: number) =>
      unitOfWork.run((scope) =>
        persistence.context.read(
          scope,
          { requestId: request.requestId, resource, limit },
          'test-context-token',
        ),
      );
    const source = (await read('SOURCE', 1)).source;
    const messages = (await read('MESSAGES', 20)).messages.reverse();
    const candidates = [
      ...(await read('TASKS', 50)).candidates,
      ...(await read('PROJECTS', 30)).candidates,
    ];
    return { ...request, source, messages, candidates };
  };

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
    persistence = new PrismaAgentPersistence(
      unitOfWork,
      database,
      new PrismaAgentTasksAdapter(unitOfWork),
      new PrismaAgentProjectsAdapter(unitOfWork),
    );
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
        contractVersion: request.contractVersion,
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

    const processing = await unitOfWork.run(async (scope) => {
      const claim = await persistence.claimProcessing(scope, {
        runId,
        now: new Date(admittedAt.getTime() + 500),
      });
      if (claim.kind === 'DISPATCH') {
        await points.extendLease(scope, {
          userId: claim.userId,
          reservationId: claim.reservationId,
          expiresAt: claim.leaseExpiresAt,
        });
      }
      return claim;
    });
    if (processing.kind !== 'DISPATCH') throw new Error('reply run was not dispatchable');
    const dispatchedContext = await readContext(processing.request);
    const providerResponse = await execute(processing.request);
    await unitOfWork.run((scope) =>
      persistence.persistResult(scope, {
        runId,
        response: providerResponse,
        persistedAt: new Date(admittedAt.getTime() + 750),
      }),
    );

    expect(await persistence.getRequest({ userId: user.id, requestId: runId })).toMatchObject({
      status: 'RESULT_PERSISTED',
    });
    const hiddenResult = await database.client.message.findFirstOrThrow({
      where: { requestRunId: runId },
    });
    const beforeSettlement = await persistence.listMessages({
      userId: user.id,
      conversationId: queued.conversationId,
      query: { limit: 50 },
    });
    expect(beforeSettlement.items.map(({ role }) => role)).toEqual(['USER']);
    await expect(
      unitOfWork.run((scope) =>
        persistence.markConversationViewed(scope, {
          userId: user.id,
          conversationId: queued.conversationId,
          idempotencyKey: 'reply-view-before-settlement',
          request: { lastViewedMessageId: hiddenResult.id as never },
        }),
      ),
    ).rejects.toMatchObject({ code: 'AGENT_REQUEST_NOT_FOUND', status: 404 });

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
    expect(dispatchedContext.candidates[0]?.candidateRef).toMatch(/^cand_[a-f0-9]{32}$/);
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

  it('freezes model context at the Run source message when turns overlap', async () => {
    const user = await database.client.user.create({ data: { aiPoints: 20 } });
    let nextRunId = randomUUID();
    const firstRunId = nextRunId;
    const admittedAt = new Date();
    const admission = new AgentAdmissionService(
      unitOfWork,
      points,
      persistence,
      { enqueue: (_scope, input) => Promise.resolve({ jobId: input.runId }) },
      () => admittedAt,
      () => nextRunId,
    );
    const first = await admission.createTurn({
      userId: user.id,
      idempotencyKey: 'context-cutoff-first',
      input: { input: { mode: 'TEXT', text: '先提交的消息' } },
    });
    nextRunId = randomUUID();
    await admission.createTurn({
      userId: user.id,
      idempotencyKey: 'context-cutoff-second',
      input: {
        conversationId: first.conversationId,
        input: { mode: 'TEXT', text: '后提交的消息' },
      },
    });
    const sourceMessages = await database.client.agentRequestRun.findMany({
      where: { id: { in: [firstRunId, nextRunId] } },
      select: { id: true, sourceMessage: { select: { id: true, createdAt: true } } },
    });
    const firstSource = sourceMessages.find(({ id }) => id === firstRunId)?.sourceMessage;
    const secondSource = sourceMessages.find(({ id }) => id === nextRunId)?.sourceMessage;
    if (!firstSource || !secondSource) throw new Error('overlapping turns have no source messages');
    await database.client.message.update({
      where: { id: secondSource.id },
      data: { createdAt: new Date(firstSource.createdAt.getTime() + 1) },
    });

    const claim = await unitOfWork.run((scope) =>
      persistence.claimProcessing(scope, {
        runId: firstRunId,
        now: new Date(admittedAt.getTime() + 500),
      }),
    );
    if (claim.kind !== 'DISPATCH') throw new Error('first overlapping turn was not dispatched');
    expect((await readContext(claim.request)).messages.map(({ content }) => content)).toEqual([
      '先提交的消息',
    ]);
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
    await expect(
      unitOfWork.run((scope) =>
        persistence.persistResult(scope, {
          runId,
          persistedAt: new Date(run.recoveryEligibleAt!.getTime() + 2),
          response: {
            contractVersion: '1.0',
            requestId: runId,
            resolved: {
              provider: 'DEEPSEEK',
              model: 'deepseek-v4-flash',
              promptVersion: 'standard-v1',
              providerSchemaVersion: 'agent-output-v1',
              repairAttempts: 0,
            },
            result: { type: 'REPLY', text: '这是恢复释放后的迟到响应。', offerPlan: false },
          },
        }),
      ),
    ).resolves.toBe('IGNORED_TERMINAL');
    expect(
      await database.client.message.count({
        where: { conversationId: run.conversationId!, role: 'ASSISTANT' },
      }),
    ).toBe(0);
  });

  it('keeps the viewed cursor monotonic across concurrent messages with different timestamps', async () => {
    const user = await database.client.user.create({ data: { aiPoints: 20 } });
    const conversation = await database.client.conversationSession.create({
      data: { userId: user.id, initialInput: '并发查看', title: '并发查看' },
    });
    const older = await database.client.message.create({
      data: {
        userId: user.id,
        conversationId: conversation.id,
        role: 'USER',
        messageType: 'USER_INPUT',
        inputMode: 'TEXT',
        content: '较早消息',
        structuredData: { type: 'USER_INPUT', text: '较早消息' },
        createdAt: new Date('2026-07-17T10:00:00.000Z'),
      },
    });
    const newer = await database.client.message.create({
      data: {
        userId: user.id,
        conversationId: conversation.id,
        role: 'ASSISTANT',
        messageType: 'AI_REPLY',
        inputMode: 'SYSTEM',
        content: '较新消息',
        structuredData: { type: 'AI_REPLY', text: '较新消息', canGeneratePlan: false },
        extra: { deterministic: true },
        createdAt: new Date('2026-07-17T10:00:01.000Z'),
      },
    });

    await Promise.all([
      unitOfWork.run((scope) =>
        persistence.markConversationViewed(scope, {
          userId: user.id,
          conversationId: conversation.id,
          idempotencyKey: 'view-newer-concurrently',
          request: { lastViewedMessageId: newer.id as never },
        }),
      ),
      unitOfWork.run((scope) =>
        persistence.markConversationViewed(scope, {
          userId: user.id,
          conversationId: conversation.id,
          idempotencyKey: 'view-older-concurrently',
          request: { lastViewedMessageId: older.id as never },
        }),
      ),
    ]);

    expect(
      await database.client.conversationSession.findUniqueOrThrow({
        where: { id: conversation.id },
      }),
    ).toMatchObject({ lastViewedMessageId: newer.id });
  });

  it('uses message id as the monotonic viewed cursor tie-breaker under concurrency', async () => {
    const user = await database.client.user.create({ data: { aiPoints: 20 } });
    const conversation = await database.client.conversationSession.create({
      data: { userId: user.id, initialInput: '同时间消息', title: '同时间消息' },
    });
    const sameCreatedAt = new Date('2026-07-17T11:00:00.000Z');
    const lowerId = '018f47be-1972-7d58-9d67-4ddc5eb70001';
    const higherId = '018f47be-1972-7d58-9d67-4ddc5eb70002';
    await database.client.message.createMany({
      data: [
        {
          id: lowerId,
          userId: user.id,
          conversationId: conversation.id,
          role: 'USER',
          messageType: 'USER_INPUT',
          inputMode: 'TEXT',
          content: '同时间一',
          structuredData: { type: 'USER_INPUT', text: '同时间一' },
          createdAt: sameCreatedAt,
        },
        {
          id: higherId,
          userId: user.id,
          conversationId: conversation.id,
          role: 'ASSISTANT',
          messageType: 'AI_REPLY',
          inputMode: 'SYSTEM',
          content: '同时间二',
          structuredData: { type: 'AI_REPLY', text: '同时间二', canGeneratePlan: false },
          extra: { deterministic: true },
          createdAt: sameCreatedAt,
        },
      ],
    });

    await Promise.all([
      unitOfWork.run((scope) =>
        persistence.markConversationViewed(scope, {
          userId: user.id,
          conversationId: conversation.id,
          idempotencyKey: 'view-higher-id',
          request: { lastViewedMessageId: higherId as never },
        }),
      ),
      unitOfWork.run((scope) =>
        persistence.markConversationViewed(scope, {
          userId: user.id,
          conversationId: conversation.id,
          idempotencyKey: 'view-lower-id',
          request: { lastViewedMessageId: lowerId as never },
        }),
      ),
    ]);

    expect(
      await database.client.conversationSession.findUniqueOrThrow({
        where: { id: conversation.id },
      }),
    ).toMatchObject({ lastViewedMessageId: higherId });
  });

  it('answers a deterministic clarification with a persisted assistant card and no new Run or debit', async () => {
    const user = await database.client.user.create({ data: { aiPoints: 20 } });
    const runId = randomUUID();
    const admittedAt = new Date();
    const admission = new AgentAdmissionService(
      unitOfWork,
      points,
      persistence,
      { enqueue: () => Promise.resolve({ jobId: runId }) },
      () => admittedAt,
      () => runId,
    );
    const queued = await admission.createTurn({
      userId: user.id,
      idempotencyKey: 'deterministic-question',
      input: { input: { mode: 'TEXT', text: '我说的是今天还是明天？' } },
    });
    const execute = (request: ExecuteRequest): Promise<ExecuteResponse> =>
      Promise.resolve({
        contractVersion: request.contractVersion,
        requestId: request.requestId,
        resolved: {
          provider: 'DEEPSEEK',
          model: 'deepseek-v4-flash',
          promptVersion: 'standard-v1',
          providerSchemaVersion: 'agent-output-v1',
          repairAttempts: 0,
        },
        result: {
          type: 'CLARIFICATION',
          question: '你希望安排在哪一天？',
          options: [
            {
              optionId: 'opt_1111111111111111',
              label: '今天',
              nextStep: 'DETERMINISTIC',
            },
            {
              optionId: 'opt_2222222222222222',
              label: '需要继续分析',
              nextStep: 'AGENT_STANDARD',
            },
          ],
          allowFreeText: true,
        },
      });
    const worker = new AgentWorker(
      unitOfWork,
      points,
      persistence,
      { execute },
      () => new Date(admittedAt.getTime() + 1_000),
    );
    const processing = await unitOfWork.run((scope) =>
      persistence.claimProcessing(scope, {
        runId,
        now: new Date(admittedAt.getTime() + 500),
      }),
    );
    if (processing.kind !== 'DISPATCH') throw new Error('clarification was not dispatchable');
    const providerResponse = await execute(processing.request);
    await unitOfWork.run((scope) =>
      persistence.persistResult(scope, {
        runId,
        response: providerResponse,
        persistedAt: new Date(admittedAt.getTime() + 750),
      }),
    );
    const hiddenQuestion = await database.client.message.findFirstOrThrow({
      where: { requestRunId: runId },
    });
    const application = new AgentApplicationService(
      admission,
      persistence,
      unitOfWork,
      { available: true },
      unusedActionExecutor,
      unusedSmartInbox,
    );
    await expect(
      application.answerMessage({
        userId: user.id,
        conversationId: queued.conversationId,
        messageId: hiddenQuestion.id as never,
        idempotencyKey: 'answer-before-settlement',
        input: {
          version: hiddenQuestion.version,
          answer: { type: 'OPTION', optionId: 'opt_1111111111111111' },
        },
      }),
    ).rejects.toMatchObject({ code: 'AGENT_REQUEST_NOT_FOUND', status: 404 });

    await worker.process(runId);
    const settled = await persistence.getRequest({ userId: user.id, requestId: runId });
    if (settled.status !== 'SUCCEEDED' || settled.result.type !== 'CLARIFICATION') {
      throw new Error('clarification result missing');
    }
    const question = settled.result.message;
    const beforeRuns = await database.client.agentRequestRun.count({ where: { userId: user.id } });
    const beforeDebits = await database.client.aiPointTransaction.count({
      where: { userId: user.id, type: 'DEBIT' },
    });
    const command = {
      userId: user.id,
      conversationId: queued.conversationId,
      messageId: question.id,
      idempotencyKey: 'answer-deterministically',
      input: {
        version: question.version,
        answer: { type: 'OPTION' as const, optionId: 'opt_1111111111111111' },
      },
    };
    const response = await application.answerMessage(command);

    expect(response).toMatchObject({
      outcome: 'DETERMINISTIC',
      message: {
        role: 'ASSISTANT',
        messageType: 'AI_REPLY',
        content: { type: 'AI_REPLY', text: '已选择「今天」', canGeneratePlan: false },
      },
    });
    expect(await application.answerMessage(command)).toEqual(response);
    expect(await database.client.agentRequestRun.count({ where: { userId: user.id } })).toBe(
      beforeRuns,
    );
    expect(
      await database.client.aiPointTransaction.count({
        where: { userId: user.id, type: 'DEBIT' },
      }),
    ).toBe(beforeDebits);
    expect(
      await database.client.message.findUniqueOrThrow({ where: { id: question.id } }),
    ).toMatchObject({ interactionStatus: 'ANSWERED', version: question.version + 1 });
    expect(
      await database.client.idempotencyRecord.findMany({
        where: { userId: user.id, key: command.idempotencyKey },
        select: { scope: true },
      }),
    ).toEqual([{ scope: 'agent.message-answer' }]);
  });

  it('keeps candidate references private and rejects a stale selected candidate', async () => {
    const user = await database.client.user.create({ data: { aiPoints: 20 } });
    await database.client.task.createMany({
      data: [
        { userId: user.id, title: '同名候选' },
        { userId: user.id, title: '另一个候选' },
      ],
    });
    const runId = randomUUID();
    const admittedAt = new Date();
    const admission = new AgentAdmissionService(
      unitOfWork,
      points,
      persistence,
      { enqueue: () => Promise.resolve({ jobId: runId }) },
      () => admittedAt,
      () => runId,
    );
    const queued = await admission.createTurn({
      userId: user.id,
      idempotencyKey: 'candidate-question',
      input: { input: { mode: 'TEXT', text: '完成同名候选' } },
    });
    let selectedRef = '';
    const worker = new AgentWorker(
      unitOfWork,
      points,
      persistence,
      {
        execute: async (request) => {
          const candidates = (await readContext(request)).candidates.filter(
            (candidate) => candidate.kind === 'TASK',
          );
          selectedRef = candidates[0]?.candidateRef ?? '';
          return Promise.resolve({
            contractVersion: request.contractVersion,
            requestId: request.requestId,
            resolved: {
              provider: 'DEEPSEEK',
              model: 'deepseek-v4-flash',
              promptVersion: 'standard-v1',
              providerSchemaVersion: 'agent-output-v1',
              repairAttempts: 0,
            },
            result: {
              type: 'CANDIDATES',
              question: '你指的是哪一项？',
              options: candidates.slice(0, 2).map((candidate, index) => ({
                optionId: `opt_${index === 0 ? '3333333333333333' : '4444444444444444'}`,
                candidateRef: candidate.candidateRef,
                label: candidate.label,
              })),
            },
          });
        },
      },
      () => new Date(admittedAt.getTime() + 1_000),
    );
    await worker.process(runId);
    const settled = await persistence.getRequest({ userId: user.id, requestId: runId });
    if (settled.status !== 'SUCCEEDED' || settled.result.type !== 'CANDIDATES') {
      throw new Error('candidate result missing');
    }
    expect(JSON.stringify(settled.result.message)).not.toContain('cand_');
    const otherUser = await database.client.user.create({ data: { aiPoints: 20 } });
    const application = new AgentApplicationService(
      admission,
      persistence,
      unitOfWork,
      { available: true },
      unusedActionExecutor,
      unusedSmartInbox,
    );
    await expect(
      application.answerMessage({
        userId: otherUser.id,
        conversationId: queued.conversationId,
        messageId: settled.result.message.id,
        idempotencyKey: 'cross-user-answer',
        input: {
          version: settled.result.message.version,
          answer: { type: 'OPTION', optionId: 'opt_3333333333333333' },
        },
      }),
    ).rejects.toMatchObject({ status: 404 });
    const selected = await database.client.agentRequestCandidateRef.findUniqueOrThrow({
      where: { candidateRef: selectedRef },
    });
    await database.client.task.update({
      where: { id: selected.taskId! },
      data: { version: { increment: 1 } },
    });
    await expect(
      application.answerMessage({
        userId: user.id,
        conversationId: queued.conversationId,
        messageId: settled.result.message.id,
        idempotencyKey: 'answer-stale-candidate',
        input: {
          version: settled.result.message.version,
          answer: { type: 'OPTION', optionId: 'opt_3333333333333333' },
        },
      }),
    ).rejects.toMatchObject({ code: 'AGENT_REQUEST_CONFLICT', status: 409 });
  });

  it('returns the latest bounded message window when no history cursor is supplied', async () => {
    const user = await database.client.user.create({ data: { aiPoints: 20 } });
    const conversation = await database.client.conversationSession.create({
      data: { userId: user.id, initialInput: '长会话', title: '长会话' },
    });
    const createdAt = new Date('2026-07-17T00:00:00.000Z');
    await database.client.message.createMany({
      data: Array.from({ length: 101 }, (_, index) => ({
        userId: user.id,
        conversationId: conversation.id,
        role: index % 2 === 0 ? ('USER' as const) : ('ASSISTANT' as const),
        messageType: index % 2 === 0 ? ('USER_INPUT' as const) : ('AI_REPLY' as const),
        inputMode: index % 2 === 0 ? ('TEXT' as const) : ('SYSTEM' as const),
        content: `消息-${index.toString().padStart(3, '0')}`,
        structuredData:
          index % 2 === 0
            ? { type: 'USER_INPUT', text: `消息-${index.toString().padStart(3, '0')}` }
            : {
                type: 'AI_REPLY',
                text: `消息-${index.toString().padStart(3, '0')}`,
                canGeneratePlan: false,
              },
        extra: index % 2 === 0 ? {} : { deterministic: true },
        createdAt: new Date(createdAt.getTime() + index),
      })),
    });

    const page = await persistence.listMessages({
      userId: user.id,
      conversationId: conversation.id as never,
      query: { limit: 100 },
    });

    expect(page.items).toHaveLength(100);
    expect(page.items[0]?.content).toMatchObject({ text: '消息-001' });
    expect(page.items.at(-1)?.content).toMatchObject({ text: '消息-100' });
    expect(page.pageInfo.nextCursor).toBeNull();
  });

  it('atomically answers a billed question and rolls the answer back when enqueue fails', async () => {
    const user = await database.client.user.create({ data: { aiPoints: 20 } });
    const conversation = await database.client.conversationSession.create({
      data: { userId: user.id, initialInput: '生成计划', title: '生成计划' },
    });
    const question = await database.client.message.create({
      data: {
        userId: user.id,
        conversationId: conversation.id,
        role: 'ASSISTANT',
        messageType: 'QUESTION',
        inputMode: 'SYSTEM',
        content: '是否生成计划？',
        structuredData: {
          type: 'QUESTION',
          questionKind: 'CLARIFICATION',
          prompt: '是否生成计划？',
          options: [
            { id: 'opt_7777777777777777', label: '生成' },
            { id: 'opt_8888888888888888', label: '稍后' },
          ],
          allowFreeText: false,
          nextStep: 'AGENT_PLAN_GENERATION',
        },
        interactionStatus: 'PENDING',
        extra: {
          deterministic: true,
          answerPolicy: {
            allowFreeText: false,
            freeTextNextStep: 'AGENT_PLAN_GENERATION',
            options: [
              {
                optionId: 'opt_7777777777777777',
                label: '生成',
                nextStep: 'AGENT_PLAN_GENERATION',
              },
              {
                optionId: 'opt_8888888888888888',
                label: '稍后',
                nextStep: 'DETERMINISTIC',
              },
            ],
          },
        },
      },
    });
    const failedRunId = randomUUID();
    const failingAdmission = new AgentAdmissionService(
      unitOfWork,
      points,
      persistence,
      { enqueue: () => Promise.reject(new Error('answer enqueue failed')) },
      () => new Date(),
      () => failedRunId,
    );
    const failingApplication = new AgentApplicationService(
      failingAdmission,
      persistence,
      unitOfWork,
      { available: true },
      unusedActionExecutor,
      unusedSmartInbox,
    );
    const baseCommand = {
      userId: user.id,
      conversationId: conversation.id as never,
      messageId: question.id as never,
      input: {
        version: 1,
        answer: { type: 'OPTION' as const, optionId: 'opt_7777777777777777' },
      },
    };
    await expect(
      failingApplication.answerMessage({ ...baseCommand, idempotencyKey: 'answer-queue-fails' }),
    ).rejects.toThrow('answer enqueue failed');
    expect(
      await database.client.message.findUniqueOrThrow({ where: { id: question.id } }),
    ).toMatchObject({ interactionStatus: 'PENDING', version: 1 });
    expect(await database.client.agentRequestRun.count({ where: { id: failedRunId } })).toBe(0);
    expect(
      await database.client.aiPointTransaction.count({ where: { requestId: failedRunId } }),
    ).toBe(0);

    const successfulRunId = randomUUID();
    const admission = new AgentAdmissionService(
      unitOfWork,
      points,
      persistence,
      { enqueue: () => Promise.resolve({ jobId: successfulRunId }) },
      () => new Date(),
      () => successfulRunId,
    );
    const application = new AgentApplicationService(
      admission,
      persistence,
      unitOfWork,
      { available: true },
      unusedActionExecutor,
      unusedSmartInbox,
    );
    const response = await application.answerMessage({
      ...baseCommand,
      idempotencyKey: 'answer-queue-succeeds',
    });
    expect(response).toMatchObject({ outcome: 'QUEUED', request: { requestId: successfulRunId } });
    expect(
      await application.answerMessage({
        ...baseCommand,
        idempotencyKey: 'answer-queue-succeeds',
      }),
    ).toEqual(response);
    const successfulRun = await database.client.agentRequestRun.findUniqueOrThrow({
      where: { id: successfulRunId },
    });
    expect(successfulRun.capabilityCode).toBe('agent.planGeneration');
    expect(typeof successfulRun.sourceMessageId).toBe('string');
    expect(
      await database.client.aiPointTransaction.findFirstOrThrow({
        where: { requestId: successfulRunId, type: 'DEBIT' },
      }),
    ).toMatchObject({ status: 'PENDING', pointsDelta: -2 });
    expect(
      await database.client.message.findUniqueOrThrow({ where: { id: question.id } }),
    ).toMatchObject({ interactionStatus: 'ANSWERED', version: 2 });
    expect(
      await database.client.idempotencyRecord.findMany({
        where: { userId: user.id, key: 'answer-queue-succeeds' },
        select: { scope: true },
      }),
    ).toEqual([{ scope: 'agent.message-answer' }]);
  });

  it('keeps a persisted Proposal private and immutable until point settlement succeeds', async () => {
    const user = await database.client.user.create({ data: { aiPoints: 20 } });
    const conversation = await database.client.conversationSession.create({
      data: { userId: user.id, initialInput: '生成一个计划', title: '生成一个计划' },
    });
    const sourceMessage = await database.client.message.create({
      data: {
        userId: user.id,
        conversationId: conversation.id,
        role: 'USER',
        messageType: 'USER_INPUT',
        inputMode: 'TEXT',
        content: '生成一个计划',
        structuredData: { type: 'USER_INPUT', text: '生成一个计划' },
      },
    });
    const run = await database.client.agentRequestRun.create({
      data: {
        userId: user.id,
        conversationId: conversation.id,
        sourceMessageId: sourceMessage.id,
        status: 'SETTLING',
        capabilityCode: 'agent.planGeneration',
        endpointCode: 'agent.plan-generations',
        contractVersion: '1.0',
        allowedResultTypes: ['PLAN'],
        idempotencyKey: 'private-proposal-run',
        provider: 'DEEPSEEK',
        model: 'deepseek-v4-pro',
        promptVersion: 'plan-v1',
        schemaVersion: 'agent-output-v1',
        resultType: 'PLAN',
        resultPayload: { type: 'PLAN' },
        resultHash: 'a'.repeat(64),
        resultPersistedAt: new Date(),
      },
    });
    const proposal = await database.client.actionProposal.create({
      data: {
        userId: user.id,
        conversationId: conversation.id,
        requestRunId: run.id,
        actionCode: 'CREATE_TASK',
        title: '结算中的计划',
        status: 'AWAITING_CONFIRMATION',
        summary: '结算完成后才可查看',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000),
        mutations: {
          create: {
            sequence: 1,
            operation: 'CREATE',
            targetType: 'TASK',
            afterValue: {
              clientRef: 'draft_9999999999999999',
              title: '结算后创建',
              description: null,
              priority: 'MEDIUM',
              scheduledAt: null,
              deadlineAt: null,
              reminderAt: null,
              project: { type: 'NONE' },
            },
            fieldSource: 'AGENT_SUGGESTION',
          },
        },
      },
      include: { mutations: true },
    });
    await database.client.message.create({
      data: {
        userId: user.id,
        conversationId: conversation.id,
        role: 'ASSISTANT',
        messageType: 'ACTION_CONFIRM',
        inputMode: 'SYSTEM',
        content: proposal.summary,
        structuredData: {
          type: 'ACTION_CONFIRM',
          title: proposal.title,
          summary: proposal.summary,
        },
        proposalId: proposal.id,
      },
    });
    const nextRunId = randomUUID();
    const admission = new AgentAdmissionService(
      unitOfWork,
      points,
      persistence,
      { enqueue: () => Promise.resolve({ jobId: nextRunId }) },
      () => new Date(),
      () => nextRunId,
    );
    const application = new AgentApplicationService(
      admission,
      persistence,
      unitOfWork,
      { available: true },
      unusedActionExecutor,
      unusedSmartInbox,
    );
    const taskMutation = proposal.mutations[0]!;

    await expect(
      persistence.getProposal({ userId: user.id, proposalId: proposal.id }),
    ).rejects.toMatchObject({ code: 'ACTION_PROPOSAL_NOT_FOUND', status: 404 });
    expect(
      (
        await persistence.listMessages({
          userId: user.id,
          conversationId: conversation.id as never,
          query: { limit: 20 },
        })
      ).items.map(({ role }) => role),
    ).toEqual(['USER']);
    await expect(
      application.editProposal({
        userId: user.id,
        proposalId: proposal.id as never,
        idempotencyKey: 'private-proposal-edit',
        input: {
          version: proposal.version,
          command: {
            type: 'UPDATE_TASK_DRAFT',
            mutationId: taskMutation.id as never,
            changes: { title: '不能提前编辑' },
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'ACTION_PROPOSAL_NOT_FOUND', status: 404 });
    await expect(
      application.dismissProposal({
        userId: user.id,
        proposalId: proposal.id as never,
        idempotencyKey: 'private-proposal-dismiss',
        input: { version: proposal.version },
      }),
    ).rejects.toMatchObject({ code: 'ACTION_PROPOSAL_NOT_FOUND', status: 404 });
    await expect(
      application.cancelProposal({
        userId: user.id,
        proposalId: proposal.id as never,
        idempotencyKey: 'private-proposal-cancel',
        input: { version: proposal.version },
      }),
    ).rejects.toMatchObject({ code: 'ACTION_PROPOSAL_NOT_FOUND', status: 404 });
    await expect(
      application.generatePlan({
        userId: user.id,
        idempotencyKey: 'private-proposal-redo',
        input: {
          source: {
            type: 'PROPOSAL',
            proposalId: proposal.id as never,
            version: proposal.version,
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'ACTION_PROPOSAL_NOT_FOUND', status: 404 });
    expect(await database.client.agentRequestRun.count({ where: { userId: user.id } })).toBe(1);

    await database.client.agentRequestRun.update({
      where: { id: run.id },
      data: { status: 'SUCCEEDED', settledAt: new Date() },
    });
    await expect(
      persistence.getProposal({ userId: user.id, proposalId: proposal.id }),
    ).resolves.toMatchObject({ proposal: { id: proposal.id, presentation: 'PLAN' } });
    expect(
      (
        await persistence.listMessages({
          userId: user.id,
          conversationId: conversation.id as never,
          query: { limit: 20 },
        })
      ).items.map(({ role }) => role),
    ).toEqual(['USER', 'ASSISTANT']);
  });

  const redoCases = ['AWAITING_CONFIRMATION', 'FAILED'] as const;
  it.each(redoCases)('safely regenerates %s plans', async (sourceStatus) => {
    const user = await database.client.user.create({ data: { aiPoints: 20 } });
    const conversation = await database.client.conversationSession.create({
      data: { userId: user.id, initialInput: '准备面试', title: '准备面试' },
    });
    const sourceMessage = await database.client.message.create({
      data: {
        userId: user.id,
        conversationId: conversation.id,
        role: 'ASSISTANT',
        messageType: 'AI_REPLY',
        inputMode: 'SYSTEM',
        content: '可以拆成计划',
        structuredData: { type: 'AI_REPLY', text: '可以拆成计划', canGeneratePlan: true },
        extra: { deterministic: true },
      },
    });
    let nextRunId = randomUUID();
    const admittedAt = new Date();
    const admission = new AgentAdmissionService(
      unitOfWork,
      points,
      persistence,
      { enqueue: (_scope, input) => Promise.resolve({ jobId: input.runId }) },
      () => admittedAt,
      () => nextRunId,
    );
    const firstQueued = await admission.generatePlan({
      userId: user.id,
      idempotencyKey: 'plan-first',
      input: { source: { type: 'MESSAGE', messageId: sourceMessage.id as never, version: 1 } },
    });
    const planResponse = (request: ExecuteRequest, title: string): ExecuteResponse => ({
      contractVersion: request.contractVersion,
      requestId: request.requestId,
      resolved: {
        provider: 'DEEPSEEK',
        model: 'deepseek-v4-pro',
        promptVersion: 'plan-v1',
        providerSchemaVersion: 'agent-output-v1',
        repairAttempts: 1,
      },
      result: {
        type: 'PLAN',
        title,
        project: { type: 'NEW', name: '面试准备' },
        tasks: [
          {
            clientRef: 'draft_5555555555555555',
            title: '整理项目经历',
            description: null,
            priority: 'HIGH',
            scheduledAt: null,
            deadlineAt: null,
            reminderAt: null,
          },
          {
            clientRef: 'draft_6666666666666666',
            title: '模拟面试',
            description: null,
            priority: 'MEDIUM',
            scheduledAt: null,
            deadlineAt: null,
            reminderAt: null,
          },
        ],
      },
    });
    const firstWorker = new AgentWorker(
      unitOfWork,
      points,
      persistence,
      { execute: (request) => Promise.resolve(planResponse(request, '第一版计划')) },
      () => new Date(admittedAt.getTime() + 1_000),
    );
    await firstWorker.process(firstQueued.requestId);
    const firstResult = await persistence.getRequest({
      userId: user.id,
      requestId: firstQueued.requestId,
    });
    if (firstResult.status !== 'SUCCEEDED' || firstResult.result.type !== 'PLAN') {
      throw new Error('plan result missing');
    }
    const firstProposal = firstResult.result.proposal;
    expect(firstProposal).toMatchObject({
      actionCode: 'CREATE_PROJECT_TASKS',
      presentation: 'PLAN',
      status: 'AWAITING_CONFIRMATION',
    });
    expect(firstProposal.mutations.map((mutation) => mutation.targetType)).toEqual([
      'PROJECT',
      'TASK',
      'TASK',
    ]);
    expect(
      await database.client.agentRequestRun.findUniqueOrThrow({
        where: { id: firstQueued.requestId },
      }),
    ).toMatchObject({ repairAttempts: 1 });

    const application = new AgentApplicationService(
      admission,
      persistence,
      unitOfWork,
      { available: true },
      unusedActionExecutor,
      unusedSmartInbox,
    );
    const taskMutation = firstProposal.mutations.find(
      (mutation) => mutation.targetType === 'TASK',
    )!;
    const edited = await application.editProposal({
      userId: user.id,
      proposalId: firstProposal.id,
      idempotencyKey: 'plan-edit',
      input: {
        version: firstProposal.version,
        command: {
          type: 'UPDATE_TASK_DRAFT',
          mutationId: taskMutation.id,
          changes: { title: '整理三段项目经历' },
        },
      },
    });
    const legacyProposal = structuredClone(edited.proposal);
    Reflect.deleteProperty(legacyProposal, 'presentation');
    await database.client.idempotencyRecord.update({
      where: {
        userId_scope_key: {
          userId: user.id,
          scope: 'agent.proposal-edit',
          key: 'plan-edit',
        },
      },
      data: { responseSnapshot: { proposal: legacyProposal } },
    });
    const replayedEdit = await application.editProposal({
      userId: user.id,
      proposalId: firstProposal.id,
      idempotencyKey: 'plan-edit',
      input: {
        version: firstProposal.version,
        command: {
          type: 'UPDATE_TASK_DRAFT',
          mutationId: taskMutation.id,
          changes: { title: '整理三段项目经历' },
        },
      },
    });
    expect(replayedEdit.proposal.presentation).toBe('PLAN');
    const dismissed = await application.dismissProposal({
      userId: user.id,
      proposalId: edited.proposal.id,
      idempotencyKey: 'plan-dismiss',
      input: { version: edited.proposal.version },
    });
    expect(dismissed.proposal).toMatchObject({
      presentation: 'PLAN',
      status: 'AWAITING_CONFIRMATION',
    });
    expect(dismissed.proposal.lastDismissedAt).not.toBeNull();
    const foreignUser = await database.client.user.create({ data: { aiPoints: 20 } });
    const foreignProject = await database.client.project.create({
      data: {
        userId: foreignUser.id,
        name: '绝不能泄露的他人项目',
        nameNormalized: '绝不能泄露的他人项目',
        colorKey: 'cyan',
      },
    });
    const editedTask = dismissed.proposal.mutations.find(
      (mutation) => mutation.id === taskMutation.id,
    )!;
    await database.client.actionMutation.update({
      where: { id: taskMutation.id },
      data: {
        afterValue: {
          ...editedTask.afterValue,
          project: { type: 'EXISTING', projectId: foreignProject.id },
        },
      },
    });
    await database.client.actionProposal.update({
      where: { id: firstProposal.id },
      data: { status: sourceStatus },
    });
    nextRunId = randomUUID();
    const failedRedo = await application.generatePlan({
      userId: user.id,
      idempotencyKey: 'plan-redo-invalid',
      input: {
        source: {
          type: 'PROPOSAL',
          proposalId: dismissed.proposal.id,
          version: dismissed.proposal.version,
        },
        instruction: '这次模拟无效输出',
      },
    });
    const failedRedoWorker = new AgentWorker(
      unitOfWork,
      points,
      persistence,
      {
        execute: () =>
          Promise.reject(
            Object.assign(new Error('invalid response'), { code: 'INVALID_RESPONSE' }),
          ),
      },
      () => new Date(admittedAt.getTime() + 1_500),
    );
    await expect(failedRedoWorker.process(failedRedo.requestId)).resolves.toEqual({
      kind: 'RELEASED',
    });
    expect(
      await database.client.actionProposal.findUniqueOrThrow({ where: { id: firstProposal.id } }),
    ).toMatchObject({ status: sourceStatus, version: dismissed.proposal.version });

    const runCountBeforeRedo = await database.client.agentRequestRun.count({
      where: { userId: user.id },
    });
    nextRunId = randomUUID();
    const redo = await application.generatePlan({
      userId: user.id,
      idempotencyKey: 'plan-redo',
      input: {
        source: {
          type: 'PROPOSAL',
          proposalId: dismissed.proposal.id,
          version: dismissed.proposal.version,
        },
        instruction: '步骤更精简一些',
      },
    });
    let redoRequest: Awaited<ReturnType<typeof readContext>> | undefined;
    const redoWorker = new AgentWorker(
      unitOfWork,
      points,
      persistence,
      {
        execute: async (request) => {
          redoRequest = await readContext(request);
          return Promise.resolve(planResponse(request, '精简计划'));
        },
      },
      () => new Date(admittedAt.getTime() + 2_000),
    );
    await redoWorker.process(redo.requestId);
    expect(await database.client.agentRequestRun.count({ where: { userId: user.id } })).toBe(
      runCountBeforeRedo + 1,
    );
    const serializedContext = JSON.stringify(
      redoRequest ? { messages: redoRequest.messages, source: redoRequest.source } : {},
    );
    expect(serializedContext).toContain('步骤更精简一些');
    expect(serializedContext).toContain('整理三段项目经历');
    expect(serializedContext).not.toContain(user.id);
    expect(serializedContext).not.toContain(firstProposal.id);
    expect(serializedContext).not.toContain(taskMutation.id);
    expect(serializedContext).not.toContain('绝不能泄露的他人项目');
    expect(
      await database.client.actionProposal.findUniqueOrThrow({ where: { id: firstProposal.id } }),
    ).toMatchObject({ status: 'SUPERSEDED' });
    const redoResult = await persistence.getRequest({
      userId: user.id,
      requestId: redo.requestId,
    });
    expect(redoResult).toMatchObject({
      status: 'SUCCEEDED',
      result: { type: 'PLAN', proposal: { title: '精简计划' } },
    });
    if (redoResult.status !== 'SUCCEEDED' || redoResult.result.type !== 'PLAN') {
      throw new Error('redo proposal missing');
    }
    const cancelled = await application.cancelProposal({
      userId: user.id,
      proposalId: redoResult.result.proposal.id,
      idempotencyKey: 'plan-cancel',
      input: { version: redoResult.result.proposal.version },
    });
    expect(cancelled.proposal.status).toBe('CANCELLED');
    expect(
      await database.client.aiPointTransaction.count({
        where: { userId: user.id, type: 'DEBIT', status: 'SUCCEEDED' },
      }),
    ).toBe(2);
    expect(
      await database.client.aiPointTransaction.count({
        where: { userId: user.id, type: 'DEBIT', status: 'CANCELLED' },
      }),
    ).toBe(1);
  });

  it('snapshots existing project versions from Agent candidates and later user edits', async () => {
    const user = await database.client.user.create({ data: { aiPoints: 20 } });
    const generatedProject = await database.client.project.create({
      data: {
        userId: user.id,
        name: '候选项目',
        nameNormalized: '候选项目',
        colorKey: 'pink',
      },
    });
    const editedProject = await database.client.project.create({
      data: {
        userId: user.id,
        name: '用户改选项目',
        nameNormalized: '用户改选项目',
        colorKey: 'teal',
      },
    });
    const conversation = await database.client.conversationSession.create({
      data: { userId: user.id, initialInput: '生成已有项目计划', title: '生成已有项目计划' },
    });
    const sourceMessage = await database.client.message.create({
      data: {
        userId: user.id,
        conversationId: conversation.id,
        role: 'ASSISTANT',
        messageType: 'AI_REPLY',
        inputMode: 'SYSTEM',
        content: '可以生成计划',
        structuredData: { type: 'AI_REPLY', text: '可以生成计划', canGeneratePlan: true },
        extra: { deterministic: true },
      },
    });
    const runId = randomUUID();
    const admittedAt = new Date();
    const admission = new AgentAdmissionService(
      unitOfWork,
      points,
      persistence,
      { enqueue: () => Promise.resolve({ jobId: runId }) },
      () => admittedAt,
      () => runId,
    );
    const queued = await admission.generatePlan({
      userId: user.id,
      idempotencyKey: 'existing-project-plan',
      input: { source: { type: 'MESSAGE', messageId: sourceMessage.id as never, version: 1 } },
    });
    const worker = new AgentWorker(
      unitOfWork,
      points,
      persistence,
      {
        execute: async (request) => {
          const project = (await readContext(request)).candidates.find(
            (candidate) => candidate.kind === 'PROJECT' && candidate.label === '候选项目',
          );
          if (!project) throw new Error('project candidate missing');
          return Promise.resolve({
            contractVersion: request.contractVersion,
            requestId: request.requestId,
            resolved: {
              provider: 'DEEPSEEK' as const,
              model: 'deepseek-v4-pro',
              promptVersion: 'plan-v1',
              providerSchemaVersion: 'agent-output-v1',
              repairAttempts: 0,
            },
            result: {
              type: 'PLAN' as const,
              title: '已有项目计划',
              project: { type: 'EXISTING' as const, candidateRef: project.candidateRef },
              tasks: [
                {
                  clientRef: 'draft_1212121212121212',
                  title: '已有项目任务',
                  description: null,
                  priority: 'MEDIUM' as const,
                  scheduledAt: null,
                  deadlineAt: null,
                  reminderAt: null,
                },
              ],
            },
          });
        },
      },
      () => new Date(admittedAt.getTime() + 1_000),
    );
    await worker.process(queued.requestId);
    const settled = await persistence.getRequest({ userId: user.id, requestId: queued.requestId });
    if (settled.status !== 'SUCCEEDED' || settled.result.type !== 'PLAN') {
      throw new Error('existing-project plan missing');
    }
    const proposal = settled.result.proposal;
    const taskMutation = proposal.mutations.find((mutation) => mutation.targetType === 'TASK');
    expect(taskMutation?.afterValue.project).toEqual({
      type: 'EXISTING',
      projectId: generatedProject.id,
      expectedVersion: generatedProject.version,
    });

    const application = new AgentApplicationService(
      admission,
      persistence,
      unitOfWork,
      { available: true },
      unusedActionExecutor,
      unusedSmartInbox,
    );
    const edited = await application.editProposal({
      userId: user.id,
      proposalId: proposal.id,
      idempotencyKey: 'existing-project-user-edit',
      input: {
        version: proposal.version,
        command: {
          type: 'SET_PROJECT',
          project: { type: 'EXISTING', projectId: editedProject.id as never },
        },
      },
    });
    expect(
      edited.proposal.mutations.find((mutation) => mutation.targetType === 'TASK')?.afterValue
        .project,
    ).toEqual({
      type: 'EXISTING',
      projectId: editedProject.id,
      expectedVersion: editedProject.version,
    });

    const foreign = await database.client.user.create({ data: {} });
    const foreignProject = await database.client.project.create({
      data: {
        userId: foreign.id,
        name: '他人项目',
        nameNormalized: '他人项目',
        colorKey: 'cyan',
      },
    });
    await expect(
      application.editProposal({
        userId: user.id,
        proposalId: proposal.id,
        idempotencyKey: 'foreign-project-user-edit',
        input: {
          version: edited.proposal.version,
          command: {
            type: 'SET_PROJECT',
            project: { type: 'EXISTING', projectId: foreignProject.id as never },
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'ACTION_PROPOSAL_NOT_EXECUTABLE', status: 409 });
  });

  it('lazily expires a seven-day proposal and rejects edits with its stale version', async () => {
    const user = await database.client.user.create({ data: { aiPoints: 20 } });
    const conversation = await database.client.conversationSession.create({
      data: { userId: user.id, initialInput: '过期草稿', title: '过期草稿' },
    });
    const run = await database.client.agentRequestRun.create({
      data: {
        userId: user.id,
        conversationId: conversation.id,
        capabilityCode: 'agent.standardTurn',
        endpointCode: 'agent.turn',
        contractVersion: '1.0',
        allowedResultTypes: ['ACTION_PROPOSAL'],
        idempotencyKey: `expired-${randomUUID()}`,
        status: 'SUCCEEDED',
        provider: 'DEEPSEEK',
        model: 'deepseek-v4-flash',
        promptVersion: 'standard-v1',
        schemaVersion: 'agent-output-v1',
        resultType: 'ACTION_PROPOSAL',
        resultPayload: { type: 'ACTION_PROPOSAL' },
        resultHash: 'b'.repeat(64),
        resultPersistedAt: new Date(),
        settledAt: new Date(),
      },
    });
    const proposal = await database.client.actionProposal.create({
      data: {
        userId: user.id,
        conversationId: conversation.id,
        requestRunId: run.id,
        actionCode: 'CREATE_TASK',
        title: '已过期草稿',
        status: 'AWAITING_CONFIRMATION',
        summary: '已过期草稿',
        createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000),
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1_000),
      },
    });
    await database.client.actionMutation.create({
      data: {
        userId: user.id,
        proposalId: proposal.id,
        sequence: 1,
        operation: 'CREATE',
        targetType: 'TASK',
        beforeValue: Prisma.DbNull,
        afterValue: {
          clientRef: 'draft_9999999999999999',
          title: '过期任务',
          description: null,
          priority: 'MEDIUM',
          scheduledAt: null,
          deadlineAt: null,
          reminderAt: null,
          project: { type: 'NONE' },
        },
        fieldSource: 'AGENT_SUGGESTION',
      },
    });

    const expired = await persistence.getProposal({ userId: user.id, proposalId: proposal.id });
    expect(expired.proposal).toMatchObject({ status: 'EXPIRED', version: 2 });
    const application = new AgentApplicationService(
      {} as AgentAdmissionService,
      persistence,
      unitOfWork,
      { available: true },
      unusedActionExecutor,
      unusedSmartInbox,
    );
    await expect(
      application.dismissProposal({
        userId: user.id,
        proposalId: proposal.id as never,
        idempotencyKey: 'dismiss-expired-proposal',
        input: { version: 1 },
      }),
    ).rejects.toMatchObject({
      code: 'ACTION_PROPOSAL_VERSION_CONFLICT',
      details: { currentVersion: 2 },
    });
  });
  it('serves authenticated v2 pages beyond old budgets with stable references and tenant isolation', async () => {
    const user = await database.client.user.create({ data: { aiPoints: 20 } });
    const other = await database.client.user.create({ data: {} });
    await database.client.task.create({
      data: { userId: other.id, title: '另一个用户的私有待办' },
    });
    await database.client.task.createMany({
      data: Array.from({ length: 140 }, (_, i) => ({
        userId: user.id,
        title: `合成任务 ${i}`,
        description: '不导出的详细描述',
      })),
    });
    await database.client.project.createMany({
      data: Array.from({ length: 35 }, (_, i) => ({
        userId: user.id,
        name: `合成项目 ${i}`,
        nameNormalized: `合成项目 ${i}`,
        colorKey: 'cyan',
      })),
    });
    const admission = new AgentAdmissionService(unitOfWork, points, persistence, {
      enqueue: (_scope, input) => Promise.resolve({ jobId: input.runId }),
    });
    const queued = await admission.createTurn({
      userId: user.id,
      idempotencyKey: 'v2-pages',
      input: { input: { mode: 'TEXT', text: '分页上下文😀' } },
    });
    const run = await database.client.agentRequestRun.findUniqueOrThrow({
      where: { id: queued.requestId },
      include: { sourceMessage: true },
    });
    const source = run.sourceMessage!;
    await database.client.message.createMany({
      data: Array.from({ length: 25 }, (_, i) => ({
        userId: user.id,
        conversationId: queued.conversationId,
        role: 'USER' as const,
        messageType: 'USER_INPUT' as const,
        inputMode: 'TEXT' as const,
        content: '中文😀'.repeat(120) + i,
        createdAt: new Date(source.createdAt.getTime() - i - 1),
      })),
    });
    const hiddenRun = await database.client.agentRequestRun.create({
      data: {
        userId: user.id,
        conversationId: queued.conversationId,
        capabilityCode: 'agent.standardTurn',
        endpointCode: 'agent.turn',
        contractVersion: '1.0',
        allowedResultTypes: ['REPLY'],
        idempotencyKey: 'hidden-context',
        provider: 'DEEPSEEK',
        model: 'test',
        promptVersion: 'test',
        schemaVersion: 'test',
        status: 'RESULT_PERSISTED',
        resultPersistedAt: new Date(),
        resultType: 'REPLY',
        resultPayload: { type: 'REPLY' },
        resultHash: 'a'.repeat(64),
      },
    });
    await database.client.message.create({
      data: {
        userId: user.id,
        conversationId: queued.conversationId,
        role: 'ASSISTANT',
        messageType: 'AI_REPLY',
        inputMode: 'SYSTEM',
        content: '未结算不可见',
        requestRunId: hiddenRun.id,
        createdAt: new Date(source.createdAt.getTime() - 1),
      },
    });
    await unitOfWork.run((scope) =>
      persistence.claimProcessing(scope, { runId: run.id, now: new Date() }),
    );
    const token = Buffer.alloc(32, 42).toString('base64url');
    let app: NestFastifyApplication | undefined;
    try {
      app = await createApplication({
        databaseUrl: startedContainer.getConnectionUri(),
        configRoot: resolve(process.cwd(), '../../config'),
        allowedOrigins: [],
        isProduction: false,
        agentContextServiceToken: token,
      });
      const read = (
        resource: string,
        limit: number,
        cursor?: string | null,
        requestId = run.id,
        credential = token,
      ) =>
        app!.inject({
          method: 'POST',
          url: '/internal/v2/agent/context/read',
          headers: { authorization: `Bearer ${credential}` },
          payload: { requestId, resource, limit, ...(cursor ? { cursor } : {}) },
        });
      expect((await read('TASKS', 70, null, run.id, 'wrong')).statusCode).toBe(401);
      const [a, b] = await Promise.all([read('TASKS', 140), read('TASKS', 140)]);
      expect(a.statusCode).toBe(200);
      const first = a.json<{
        candidates: Array<{ candidateRef: string; label: string }>;
        nextCursor: string;
      }>();
      expect(first.candidates).toHaveLength(128);
      expect(b.json<ContextReadResponse>().candidates).toEqual(first.candidates);
      const tail = await read('TASKS', 140, first.nextCursor);
      expect(tail.json<ContextReadResponse>().candidates).toHaveLength(12);
      expect(tail.json<ContextReadResponse>().nextCursor).toBeNull();
      expect(
        await database.client.agentRequestCandidateRef.count({
          where: { requestRunId: run.id, kind: 'TASK' },
        }),
      ).toBe(140);
      expect((await read('PROJECTS', 35)).json<ContextReadResponse>().candidates).toHaveLength(35);
      const history = (await read('MESSAGES', 30)).json<{ messages: Array<{ content: string }> }>();
      expect(history.messages).toHaveLength(26);
      expect(Buffer.byteLength(JSON.stringify(history.messages))).toBeGreaterThan(12 * 1024);
      expect(JSON.stringify(history)).not.toContain('未结算不可见');
      expect(a.body).not.toContain(user.id);
      expect(a.body).not.toContain('不导出的详细描述');
      expect(a.body).not.toContain('另一个用户的私有待办');
      expect((await read('PROJECTS', 5, first.nextCursor)).statusCode).toBe(409);
      expect((await read('TASKS', 5, first.nextCursor, hiddenRun.id)).statusCode).toBe(409);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/internal/v2/agent/context/read',
            payload: {},
          })
        ).statusCode,
      ).toBe(404);
      const candidate = await database.client.agentRequestCandidateRef.findFirstOrThrow({
        where: { requestRunId: run.id, kind: 'TASK' },
      });
      await database.client.task.update({
        where: { id: candidate.taskId! },
        data: { title: '修改后的任务', version: { increment: 1 } },
      });
      const repeated = (await read('TASKS', 140)).json<ContextReadResponse>().candidates;
      expect(repeated).toEqual(first.candidates);
      await expect(
        unitOfWork.run((scope) =>
          persistence.context.requireCandidate(scope, unitOfWork.clientFor(scope), {
            runId: run.id,
            userId: user.id,
            candidateRef: candidate.candidateRef,
            now: new Date(),
          }),
        ),
      ).rejects.toThrow();
      await database.client.agentRequestRun.update({
        where: { id: run.id },
        data: {
          dispatchAttemptedAt: new Date(0),
          executeTimeoutAt: new Date(1),
          runDeadlineAt: new Date(2),
          recoveryEligibleAt: new Date(3),
        },
      });
      expect((await read('TASKS', 1)).statusCode).toBe(409);
    } finally {
      await app?.close();
    }
  });
  it('adapts queued v1 drafts without rewriting history or exposing business IDs', async () => {
    const user = await database.client.user.create({ data: { aiPoints: 20 } });
    const admission = new AgentAdmissionService(unitOfWork, points, persistence, {
      enqueue: (_scope, input) => Promise.resolve({ jobId: input.runId }),
    });
    const queued = await admission.createTurn({
      userId: user.id,
      idempotencyKey: 'legacy-context',
      input: { input: { mode: 'TEXT', text: '旧草稿' } },
    });
    const original = await database.client.agentRequestRun.findUniqueOrThrow({
      where: { id: queued.requestId },
    });
    const previousDraft = {
      actionCode: 'CREATE_PROJECT_TASKS',
      title: '旧计划',
      summary: '',
      tasks: [
        {
          title: '旧任务😀',
          description: null,
          priority: 'MEDIUM',
          scheduledAt: null,
          deadlineAt: null,
          reminderAt: null,
          project: { type: 'EXISTING', name: '安全项目名' },
        },
      ],
    };
    const content = JSON.stringify({ instruction: '精简', previousDraft });
    await database.client.message.update({
      where: { id: original.sourceMessageId! },
      data: { content, structuredData: { type: 'USER_INPUT', text: '精简' } },
    });
    const extra = original.extra as Prisma.JsonObject;
    delete extra.contextSource;
    await database.client.agentRequestRun.update({
      where: { id: original.id },
      data: {
        contractVersion: '1.0',
        sourceMessageId: null,
        extra: {
          ...extra,
          planSource: {
            type: 'PROPOSAL',
            proposalVersion: 1,
            contextMessageId: original.sourceMessageId,
          },
        },
      },
    });
    const claim = await unitOfWork.run((scope) =>
      persistence.claimProcessing(scope, { runId: original.id, now: new Date() }),
    );
    if (claim.kind !== 'DISPATCH') throw new Error('Legacy Run was not upgraded');
    expect(claim.request.contractVersion).toBe('2.0');
    expect(claim.request).not.toHaveProperty('messages');
    const upgraded = await database.client.agentRequestRun.findUniqueOrThrow({
      where: { id: original.id },
    });
    expect(upgraded.reservationId).toBe(original.reservationId);
    expect(upgraded.extra).toMatchObject({ originalContractVersion: '1.0' });
    const source = await unitOfWork.run((scope) =>
      persistence.context.read(
        scope,
        { requestId: original.id, resource: 'SOURCE', limit: 1 },
        'test-token',
      ),
    );
    expect(source.source).toEqual({ kind: 'REGENERATE', instruction: '精简', previousDraft });
    expect(JSON.stringify(source)).not.toContain(user.id);
    await expect(
      unitOfWork.run((scope) =>
        persistence.persistResult(scope, {
          runId: original.id,
          persistedAt: new Date(),
          response: {
            contractVersion: '2.0',
            requestId: original.id,
            resolved: {
              provider: 'DEEPSEEK',
              model: 'test',
              promptVersion: 'test',
              providerSchemaVersion: 'test',
              repairAttempts: 0,
            },
            result: {
              type: 'CANDIDATES',
              question: '伪造引用',
              options: [
                {
                  optionId: 'opt_0000000000000001',
                  candidateRef: 'cand_00000000000000000000000000000001',
                  label: '伪造候选',
                },
              ],
            },
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'AGENT_RESULT_INVALID' });

    expect(
      (
        await database.client.message.findUniqueOrThrow({
          where: { id: original.sourceMessageId! },
        })
      ).content,
    ).toBe(content);
    await database.client.message.update({
      where: { id: original.sourceMessageId! },
      data: {
        content: JSON.stringify({
          instruction: '精简',
          previousDraft: { ...previousDraft, userId: user.id },
        }),
      },
    });
    await expect(
      unitOfWork.run((scope) =>
        persistence.context.read(
          scope,
          { requestId: original.id, resource: 'SOURCE', limit: 1 },
          'test-token',
        ),
      ),
    ).rejects.toMatchObject({ code: 'AGENT_CONTEXT_UNAVAILABLE' });
  });
});
