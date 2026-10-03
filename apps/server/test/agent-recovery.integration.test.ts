import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import type { ExecuteRequest, ExecuteResponse } from '../src/modules/agent/agent-runtime.port.js';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AgentAdmissionService } from '../src/modules/agent/agent-admission.service.js';
import { AgentWorker } from '../src/modules/agent/agent-worker.js';
import { PrismaAgentProjectsAdapter } from '../src/modules/projects/prisma-agent-projects.adapter.js';
import { PrismaAgentTasksAdapter } from '../src/modules/tasks/prisma-agent-tasks.adapter.js';
import { AiPointsService } from '../src/modules/users/points/ai-points.service.js';
import { CapabilityRegistryService } from '../src/modules/users/points/capability-registry.service.js';
import { PrismaAgentPersistence } from '../src/platform/agent/prisma-agent.persistence.js';
import { PrismaAgentRecoveryAdapter } from '../src/platform/agent/prisma-agent-recovery.adapter.js';
import { DatabaseService } from '../src/platform/database/database.service.js';
import { DatabaseUnitOfWork } from '../src/platform/database/unit-of-work.js';
import {
  AGENT_REQUEST_QUEUE,
  PgBossAgentJobQueueAdapter,
} from '../src/platform/queue/agent-job-queue.adapter.js';
import { AgentRecoveryCoordinator } from '../src/platform/queue/agent-recovery.coordinator.js';
import { PgBossQueue } from '../src/platform/queue/pg-boss.queue.js';
import { loadRuntimeConfiguration } from '../src/runtime-config.js';

const execFileAsync = promisify(execFile);
const RECOVERY_OPTIONS = { batchSize: 100, intervalMs: 15_000 } as const;

describe('Agent Run reconciliation', () => {
  const container = new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('ai_schedule_agent_recovery')
    .withUsername('ai_schedule')
    .withPassword('ai_schedule');

  let startedContainer: Awaited<ReturnType<typeof container.start>>;
  let database: DatabaseService;
  let unitOfWork: DatabaseUnitOfWork;
  let points: AiPointsService;
  let persistence: PrismaAgentPersistence;
  let queue: PgBossQueue;
  let queueJobs: PgBossAgentJobQueueAdapter;
  let recovery: AgentRecoveryCoordinator;

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
    recovery = new AgentRecoveryCoordinator(
      new PrismaAgentRecoveryAdapter(database),
      queue,
      RECOVERY_OPTIONS,
    );
  }, 120_000);

  afterAll(async () => {
    await queue?.stop();
    await database?.onApplicationShutdown();
    await startedContainer?.stop();
  });

  it('re-enqueues a lost QUEUED job without allowing a duplicate dispatch', async () => {
    const user = await database.client.user.create({ data: { aiPoints: 20 } });
    const admittedAt = new Date();
    const runId = randomUUID();
    await admit(user.id, runId, 'recover-queued', admittedAt);
    await discardNextJob(runId);

    await expect(recovery.reconcileOnce(new Date(admittedAt.getTime() + 100))).resolves.toEqual({
      discovered: 1,
      enqueued: 1,
      deduplicated: 0,
    });
    await expect(recovery.reconcileOnce(new Date(admittedAt.getTime() + 200))).resolves.toEqual({
      discovered: 1,
      enqueued: 0,
      deduplicated: 1,
    });

    await database.client.agentRequestRun.update({
      where: { id: runId },
      data: { contractVersion: '1.0' },
    });
    const execute = vi.fn<[ExecuteRequest], Promise<ExecuteResponse>>((request) =>
      Promise.resolve(reply(request, '恢复后只派发一次')),
    );
    const dispatchAt = new Date(admittedAt.getTime() + 1_000);
    const worker = new AgentWorker(unitOfWork, points, persistence, { execute }, () => dispatchAt);
    const recoveryJob = await fetchExpectedJob(runId);
    await expect(worker.process(runId)).resolves.toEqual({ kind: 'DISPATCHED_AND_SETTLED' });
    await queue.complete(AGENT_REQUEST_QUEUE, recoveryJob.id);

    expect(execute).toHaveBeenCalledOnce();
    const run = await database.client.agentRequestRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run).toMatchObject({
      status: 'SUCCEEDED',
      dispatchAttemptedAt: dispatchAt,
      contractVersion: '2.0',
    });
    expect(run.extra).toMatchObject({ originalContractVersion: '1.0' });
  });

  it('re-enqueues an exhausted RUNNING job for release without a second inference call', async () => {
    const user = await database.client.user.create({ data: { aiPoints: 20 } });
    const admittedAt = new Date();
    const runId = randomUUID();
    await admit(user.id, runId, 'recover-running', admittedAt);
    await discardNextJob(runId);

    const execute = vi.fn<[ExecuteRequest], Promise<ExecuteResponse>>().mockRejectedValue({
      code: 'CONNECTION_RESET',
    });
    const dispatchAt = new Date(admittedAt.getTime() + 1_000);
    const firstWorker = new AgentWorker(
      unitOfWork,
      points,
      persistence,
      { execute },
      () => dispatchAt,
    );
    await expect(firstWorker.process(runId)).resolves.toMatchObject({ kind: 'WAIT' });

    const running = await database.client.agentRequestRun.findUniqueOrThrow({
      where: { id: runId },
    });
    expect(running.status).toBe('RUNNING');
    await database.client.agentRequestRun.update({
      where: { id: runId },
      data: { contractVersion: '1.0' },
    });
    expect(running.recoveryEligibleAt).not.toBeNull();
    const recoveryAt = new Date(running.recoveryEligibleAt!.getTime() + 1);
    await recovery.reconcileOnce(recoveryAt);

    const recoveryJob = await fetchExpectedJob(runId);
    const recoveryWorker = new AgentWorker(
      unitOfWork,
      points,
      persistence,
      { execute },
      () => recoveryAt,
    );
    await expect(recoveryWorker.process(runId)).resolves.toEqual({ kind: 'RELEASED' });
    await queue.complete(AGENT_REQUEST_QUEUE, recoveryJob.id);

    expect(execute).toHaveBeenCalledOnce();
    const released = await database.client.agentRequestRun.findUniqueOrThrow({
      where: { id: runId },
    });
    expect(released).toMatchObject({ status: 'RELEASED', dispatchAttemptedAt: dispatchAt });
    expect(
      await database.client.aiPointTransaction.findFirstOrThrow({
        where: { requestId: runId, type: 'DEBIT' },
      }),
    ).toMatchObject({ status: 'CANCELLED' });
  });

  it('recovers FAILED when the process crashes after claim and before releasing points', async () => {
    const user = await database.client.user.create({ data: { aiPoints: 20 } });
    const admittedAt = new Date();
    const runId = randomUUID();
    await admit(user.id, runId, 'recover-failed-release-gap', admittedAt);
    await discardNextJob(runId);

    const execute = vi.fn<[ExecuteRequest], Promise<ExecuteResponse>>().mockRejectedValue({
      code: 'CONNECTION_RESET',
    });
    const dispatchAt = new Date(admittedAt.getTime() + 1_000);
    const firstWorker = new AgentWorker(
      unitOfWork,
      points,
      persistence,
      { execute },
      () => dispatchAt,
    );
    await expect(firstWorker.process(runId)).resolves.toMatchObject({ kind: 'WAIT' });

    const running = await database.client.agentRequestRun.findUniqueOrThrow({
      where: { id: runId },
    });
    const recoveryAt = new Date(running.recoveryEligibleAt!.getTime() + 1);
    await expect(
      unitOfWork.run((scope) => persistence.claimProcessing(scope, { runId, now: recoveryAt })),
    ).resolves.toMatchObject({ kind: 'RELEASE' });

    const failed = await database.client.agentRequestRun.findUniqueOrThrow({
      where: { id: runId },
    });
    expect(failed).toMatchObject({ status: 'FAILED', dispatchAttemptedAt: dispatchAt });
    expect(
      await database.client.aiPointTransaction.findFirstOrThrow({
        where: { requestId: runId, type: 'DEBIT' },
      }),
    ).toMatchObject({ status: 'PENDING' });

    await recovery.reconcileOnce(new Date(recoveryAt.getTime() + 1));
    const recoveryJob = await fetchExpectedJob(runId);
    const recoveryWorker = new AgentWorker(
      unitOfWork,
      points,
      persistence,
      { execute },
      () => new Date(recoveryAt.getTime() + 2),
    );
    await expect(recoveryWorker.process(runId)).resolves.toEqual({ kind: 'RELEASED' });
    await queue.complete(AGENT_REQUEST_QUEUE, recoveryJob.id);

    expect(execute).toHaveBeenCalledOnce();
    expect(
      await database.client.agentRequestRun.findUniqueOrThrow({ where: { id: runId } }),
    ).toMatchObject({ status: 'RELEASED', dispatchAttemptedAt: dispatchAt });
    expect(
      await database.client.aiPointTransaction.findFirstOrThrow({
        where: { requestId: runId, type: 'DEBIT' },
      }),
    ).toMatchObject({ status: 'CANCELLED' });
  });

  for (const persistedStatus of ['RESULT_PERSISTED', 'SETTLING'] as const) {
    it(`re-enqueues ${persistedStatus} after job exhaustion and settles without inference`, async () => {
      const user = await database.client.user.create({ data: { aiPoints: 20 } });
      const admittedAt = new Date();
      const runId = randomUUID();
      await admit(user.id, runId, `recover-${persistedStatus.toLowerCase()}`, admittedAt);
      await discardNextJob(runId);

      const dispatchAt = new Date(admittedAt.getTime() + 1_000);
      const dispatchClaim = await unitOfWork.run((scope) =>
        persistence.claimProcessing(scope, { runId, now: dispatchAt }),
      );
      expect(dispatchClaim.kind).toBe('DISPATCH');
      if (dispatchClaim.kind !== 'DISPATCH') throw new Error('Expected a dispatch claim');
      await unitOfWork.run((scope) =>
        persistence.persistResult(scope, {
          runId,
          response: reply(dispatchClaim.request, '已持久化结果'),
          persistedAt: new Date(dispatchAt.getTime() + 1),
        }),
      );
      await database.client.agentRequestRun.update({
        where: { id: runId },
        data: { contractVersion: '1.0' },
      });
      if (persistedStatus === 'SETTLING') {
        await expect(
          unitOfWork.run((scope) =>
            persistence.claimProcessing(scope, {
              runId,
              now: new Date(dispatchAt.getTime() + 2),
            }),
          ),
        ).resolves.toMatchObject({ kind: 'SETTLE' });
      }
      expect(
        (await database.client.agentRequestRun.findUniqueOrThrow({ where: { id: runId } })).status,
      ).toBe(persistedStatus);

      await recovery.reconcileOnce(new Date(dispatchAt.getTime() + 3));
      const recoveryJob = await fetchExpectedJob(runId);
      const execute = vi.fn<[ExecuteRequest], Promise<ExecuteResponse>>();
      const worker = new AgentWorker(
        unitOfWork,
        points,
        persistence,
        { execute },
        () => new Date(dispatchAt.getTime() + 4),
      );
      await expect(worker.process(runId)).resolves.toEqual({ kind: 'DISPATCHED_AND_SETTLED' });
      await queue.complete(AGENT_REQUEST_QUEUE, recoveryJob.id);

      expect(execute).not.toHaveBeenCalled();
      const settled = await database.client.agentRequestRun.findUniqueOrThrow({
        where: { id: runId },
      });
      expect(settled).toMatchObject({ status: 'SUCCEEDED', dispatchAttemptedAt: dispatchAt });
      expect(
        await database.client.aiPointTransaction.findFirstOrThrow({
          where: { requestId: runId, type: 'DEBIT' },
        }),
      ).toMatchObject({ status: 'SUCCEEDED' });
    });
  }

  async function admit(userId: string, runId: string, key: string, now: Date) {
    const admission = new AgentAdmissionService(
      unitOfWork,
      points,
      persistence,
      queueJobs,
      () => now,
      () => runId,
    );
    return admission.createTurn({
      userId,
      idempotencyKey: key,
      input: { input: { mode: 'TEXT', text: '使用合成测试数据验证恢复' } },
    });
  }

  async function discardNextJob(runId: string) {
    const job = await fetchExpectedJob(runId);
    await queue.complete(AGENT_REQUEST_QUEUE, job.id);
  }

  async function fetchExpectedJob(runId: string) {
    const job = await queue.fetchOne<{ runId: string }>(AGENT_REQUEST_QUEUE);
    expect(job?.data).toEqual({ runId });
    if (!job) throw new Error(`Expected queued recovery job for Run ${runId}`);
    return job;
  }
});

function reply(request: ExecuteRequest, text: string): ExecuteResponse {
  return {
    contractVersion: request.contractVersion,
    requestId: request.requestId,
    resolved: {
      provider: 'DEEPSEEK',
      model: 'deepseek-v4-flash',
      promptVersion: 'standard-v1',
      providerSchemaVersion: 'agent-output-v1',
      repairAttempts: 0,
    },
    result: { type: 'REPLY', text, offerPlan: false },
  };
}
