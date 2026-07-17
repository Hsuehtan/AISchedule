/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from 'vitest';

import type { AgentWorker } from '../../modules/agent/agent-worker.js';
import type { AgentRuntimeAvailability } from '../../modules/agent/agent-product.port.js';
import type { PgBossQueue } from './pg-boss.queue.js';
import { AgentQueueRuntime, AgentQueueWaitError } from './agent-queue.runtime.js';

function setup(available = true) {
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
  const availability: AgentRuntimeAvailability = { available };
  const runtime = new AgentQueueRuntime(queue, worker, availability);
  return { getHandler: () => handler, queue, runtime, worker };
}

describe('AgentQueueRuntime', () => {
  it('does not start a worker when the private runtime is unavailable', async () => {
    const { queue, runtime } = setup(false);
    await runtime.onApplicationBootstrap();
    expect(queue.start).not.toHaveBeenCalled();
    expect(queue.registerWorker).not.toHaveBeenCalled();
  });

  it('registers the Agent worker and leaves WAIT jobs retryable', async () => {
    const { getHandler, queue, runtime, worker } = setup();
    vi.mocked(worker.process).mockResolvedValue({
      kind: 'WAIT',
      retryAt: new Date('2026-07-17T12:02:00.000Z'),
    });

    await runtime.onApplicationBootstrap();
    expect(queue.ensureQueue).toHaveBeenCalledWith('agent-request-v1');
    await expect(
      getHandler()?.({ runId: '018f47be-1972-7d58-9d67-4ddc5eb78a64' }),
    ).rejects.toBeInstanceOf(AgentQueueWaitError);
    expect(worker.process).toHaveBeenCalledOnce();
  });
});
