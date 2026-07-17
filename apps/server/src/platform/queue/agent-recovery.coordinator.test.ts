/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from 'vitest';

import type { AgentRecoveryPort } from '../../modules/agent/agent-recovery.port.js';
import type { PgBossQueue } from './pg-boss.queue.js';
import { AgentRecoveryCoordinator } from './agent-recovery.coordinator.js';

describe('AgentRecoveryCoordinator', () => {
  it('re-enqueues every eligible non-terminal Run with a bounded singleton job', async () => {
    const recovery = {
      listEligible: vi.fn().mockResolvedValue([
        { runId: '018f47be-1972-7d58-9d67-4ddc5eb78a64', status: 'RESULT_PERSISTED' },
        { runId: '018f47be-1972-7d58-9d67-4ddc5eb78a65', status: 'SETTLING' },
        { runId: '018f47be-1972-7d58-9d67-4ddc5eb78a66', status: 'RUNNING' },
        { runId: '018f47be-1972-7d58-9d67-4ddc5eb78a67', status: 'FAILED' },
        { runId: '018f47be-1972-7d58-9d67-4ddc5eb78a68', status: 'QUEUED' },
      ]),
      resetScan: vi.fn(),
    } as unknown as AgentRecoveryPort;
    const queue = {
      publishSingleton: vi
        .fn()
        .mockResolvedValueOnce('job-1')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('job-3')
        .mockResolvedValueOnce('job-4')
        .mockResolvedValueOnce('job-5'),
    } as unknown as PgBossQueue;
    const coordinator = new AgentRecoveryCoordinator(recovery, queue, {
      batchSize: 25,
      intervalMs: 15_000,
    });
    const now = new Date('2026-07-17T12:05:00.000Z');

    await expect(coordinator.reconcileOnce(now)).resolves.toEqual({
      discovered: 5,
      enqueued: 4,
      deduplicated: 1,
    });
    expect(recovery.listEligible).toHaveBeenCalledWith({ now, limit: 25 });
    expect(queue.publishSingleton).toHaveBeenCalledTimes(5);
    expect(queue.publishSingleton).toHaveBeenNthCalledWith(
      1,
      'agent-request-v1',
      { runId: '018f47be-1972-7d58-9d67-4ddc5eb78a64' },
      expect.objectContaining({
        singletonKey: 'agent-recovery:018f47be-1972-7d58-9d67-4ddc5eb78a64',
        singletonSeconds: 15,
      }),
    );
  });

  it('coalesces overlapping manual and periodic scans', async () => {
    let releaseScan: (() => void) | undefined;
    const recovery = {
      listEligible: vi.fn(
        () =>
          new Promise<[]>((resolve) => {
            releaseScan = () => resolve([]);
          }),
      ),
      resetScan: vi.fn(),
    } as unknown as AgentRecoveryPort;
    const queue = { publishSingleton: vi.fn() } as unknown as PgBossQueue;
    const coordinator = new AgentRecoveryCoordinator(recovery, queue, {
      batchSize: 25,
      intervalMs: 15_000,
    });

    const first = coordinator.reconcileOnce(new Date('2026-07-17T12:05:00.000Z'));
    await expect(coordinator.reconcileOnce(new Date('2026-07-17T12:05:01.000Z'))).resolves.toEqual({
      discovered: 0,
      enqueued: 0,
      deduplicated: 0,
    });
    releaseScan?.();
    await expect(first).resolves.toEqual({ discovered: 0, enqueued: 0, deduplicated: 0 });
    expect(recovery.listEligible).toHaveBeenCalledOnce();
  });

  it('continues the batch and resets scan cursors when a publish fails', async () => {
    const recovery = {
      listEligible: vi.fn().mockResolvedValue([
        { runId: '018f47be-1972-7d58-9d67-4ddc5eb78a64', status: 'FAILED' },
        { runId: '018f47be-1972-7d58-9d67-4ddc5eb78a65', status: 'SETTLING' },
      ]),
      resetScan: vi.fn(),
    } as unknown as AgentRecoveryPort;
    const queue = {
      publishSingleton: vi
        .fn()
        .mockRejectedValueOnce(new Error('queue unavailable'))
        .mockResolvedValueOnce('job-2'),
    } as unknown as PgBossQueue;
    const coordinator = new AgentRecoveryCoordinator(recovery, queue, {
      batchSize: 25,
      intervalMs: 15_000,
    });

    await expect(coordinator.reconcileOnce()).rejects.toThrow('queue unavailable');

    expect(queue.publishSingleton).toHaveBeenCalledTimes(2);
    expect(recovery.resetScan).toHaveBeenCalledOnce();
  });

  it('resets scan cursors when discovery fails after partial progress', async () => {
    const recovery = {
      listEligible: vi.fn().mockRejectedValue(new Error('database unavailable')),
      resetScan: vi.fn(),
    } as unknown as AgentRecoveryPort;
    const queue = { publishSingleton: vi.fn() } as unknown as PgBossQueue;
    const coordinator = new AgentRecoveryCoordinator(recovery, queue, {
      batchSize: 25,
      intervalMs: 15_000,
    });

    await expect(coordinator.reconcileOnce()).rejects.toThrow('database unavailable');

    expect(recovery.resetScan).toHaveBeenCalledOnce();
    expect(queue.publishSingleton).not.toHaveBeenCalled();
  });
});
