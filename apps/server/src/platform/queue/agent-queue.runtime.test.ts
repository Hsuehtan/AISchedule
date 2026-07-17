/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from 'vitest';

import type { AgentWorker } from '../../modules/agent/agent-worker.js';
import type { AgentRecoveryCoordinator } from './agent-recovery.coordinator.js';
import type { PgBossQueue } from './pg-boss.queue.js';
import { AgentQueueRuntime, AgentQueueWaitError } from './agent-queue.runtime.js';

function setup() {
  let handler: ((data: { runId: string }) => Promise<void>) | undefined;
  const registerWorker = vi.fn<
    [string, (data: { runId: string }) => Promise<void>],
    Promise<string>
  >((_name, work) => {
    handler = work;
    return Promise.resolve('worker-1');
  });
  const queue = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    ensureQueue: vi.fn().mockResolvedValue(undefined),
    registerWorker,
  } as unknown as PgBossQueue;
  const worker = { process: vi.fn() } as unknown as AgentWorker;
  const recovery = {
    reconcileOnce: vi.fn().mockResolvedValue(undefined),
  } as unknown as AgentRecoveryCoordinator;
  const runtime = new AgentQueueRuntime(queue, worker, recovery, {
    batchSize: 25,
    intervalMs: 15_000,
  });
  return { getHandler: () => handler, queue, recovery, runtime, worker };
}

describe('AgentQueueRuntime', () => {
  it('starts recovery independently from private inference admission availability', async () => {
    const { queue, recovery, runtime } = setup();
    await runtime.onApplicationBootstrap();
    expect(queue.start).toHaveBeenCalledOnce();
    expect(queue.registerWorker).toHaveBeenCalledOnce();
    expect(recovery.reconcileOnce).toHaveBeenCalledOnce();
    await runtime.onApplicationShutdown();
  });

  it('registers the Agent worker and leaves WAIT jobs retryable', async () => {
    const { getHandler, queue, recovery, runtime, worker } = setup();
    vi.mocked(worker.process).mockResolvedValue({
      kind: 'WAIT',
      retryAt: new Date('2026-07-17T12:02:00.000Z'),
    });

    await runtime.onApplicationBootstrap();
    expect(queue.ensureQueue).toHaveBeenCalledWith('agent-request-v1');
    expect(recovery.reconcileOnce).toHaveBeenCalledOnce();
    await expect(
      getHandler()?.({ runId: '018f47be-1972-7d58-9d67-4ddc5eb78a64' }),
    ).rejects.toBeInstanceOf(AgentQueueWaitError);
    expect(worker.process).toHaveBeenCalledOnce();
    await runtime.onApplicationShutdown();
  });
});
