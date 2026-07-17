/* eslint-disable @typescript-eslint/unbound-method */
import type { ExecuteRequest, ExecuteResponse } from '@ai-schedule/contracts/internal-agent/v1';
import { describe, expect, it, vi } from 'vitest';

import type { UnitOfWork } from '../../platform/database/unit-of-work.js';
import type { AiPointsPort } from '../users/points/ai-points.port.js';
import {
  AgentResultRejectedError,
  type AgentInferencePort,
  type AgentRunPort,
} from './agent-runtime.port.js';
import { AgentWorker } from './agent-worker.js';

const now = new Date('2026-07-17T12:00:00.000Z');
const runId = '018f47be-1972-7d58-9d67-4ddc5eb78a64';
const userId = '018f47be-1972-7d58-9d67-4ddc5eb78a60';
const reservationId = '018f47be-1972-7d58-9d67-4ddc5eb78a61';
const messageId = '018f47be-1972-7d58-9d67-4ddc5eb78a65';

const request: ExecuteRequest = {
  contractVersion: '1.0',
  requestId: runId,
  capabilityCode: 'agent.standardTurn',
  deadlineAt: '2026-07-17T12:00:40.000Z',
  locale: 'zh-CN',
  timezone: 'Asia/Shanghai',
  allowedResultTypes: ['REPLY'],
  messages: [{ role: 'USER', content: '帮我整理今天的任务' }],
  candidates: [],
};

const response: ExecuteResponse = {
  contractVersion: '1.0',
  requestId: runId,
  resolved: {
    provider: 'DEEPSEEK',
    model: 'deepseek-v4-flash',
    promptVersion: 'p0-v1',
    providerSchemaVersion: 'p0-v1',
    repairAttempts: 0,
  },
  result: { type: 'REPLY', text: '先完成周报。', offerPlan: false },
};

function setup() {
  const scope = Object.freeze({}) as never;
  const unitOfWork: UnitOfWork = {
    run: vi.fn((work) => work(scope)),
  };
  const points = {
    extendLease: vi.fn().mockResolvedValue({}),
    settle: vi.fn().mockResolvedValue({}),
    release: vi.fn().mockResolvedValue({}),
  } as unknown as AiPointsPort;
  const runs = {
    claimProcessing: vi.fn(),
    persistResult: vi.fn().mockResolvedValue('PERSISTED'),
    recordAmbiguousFailure: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue({ userId, reservationId }),
    markSucceeded: vi.fn().mockResolvedValue(undefined),
    markReleased: vi.fn().mockResolvedValue(undefined),
  } as unknown as AgentRunPort;
  const inference = { execute: vi.fn().mockResolvedValue(response) } as AgentInferencePort;
  const worker = new AgentWorker(unitOfWork, points, runs, inference, () => now);
  return { inference, points, runs, worker };
}

describe('AgentWorker', () => {
  it('dispatches once, persists a valid result, then settles without a second model call', async () => {
    const { inference, points, runs, worker } = setup();
    vi.mocked(runs.claimProcessing)
      .mockResolvedValueOnce({
        kind: 'DISPATCH',
        request,
        userId,
        reservationId,
        leaseExpiresAt: new Date('2026-07-17T12:01:40.000Z'),
      })
      .mockResolvedValueOnce({
        kind: 'SETTLE',
        userId,
        reservationId,
        result: { messageId },
      });

    await expect(worker.process(runId)).resolves.toEqual({ kind: 'DISPATCHED_AND_SETTLED' });
    expect(inference.execute).toHaveBeenCalledOnce();
    expect(runs.persistResult).toHaveBeenCalledOnce();
    expect(points.settle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ runId }),
    );
    expect(runs.markSucceeded).toHaveBeenCalledOnce();
  });

  it('only retries settlement when a persisted result is replayed', async () => {
    const { inference, points, runs, worker } = setup();
    vi.mocked(runs.claimProcessing).mockResolvedValue({
      kind: 'SETTLE',
      userId,
      reservationId,
      result: { messageId },
    });

    await worker.process(runId);
    expect(inference.execute).not.toHaveBeenCalled();
    expect(points.settle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ runId }),
    );
  });

  it('retains the reservation after an ambiguous disconnect', async () => {
    const { inference, points, runs, worker } = setup();
    const retryAt = new Date('2026-07-17T12:02:40.000Z');
    vi.mocked(runs.claimProcessing)
      .mockResolvedValueOnce({
        kind: 'DISPATCH',
        request,
        userId,
        reservationId,
        leaseExpiresAt: retryAt,
      })
      .mockResolvedValueOnce({ kind: 'WAIT', retryAt });
    vi.mocked(inference.execute).mockRejectedValue({ code: 'UNAVAILABLE' });

    await expect(worker.process(runId)).resolves.toEqual({ kind: 'WAIT', retryAt });
    expect(runs.recordAmbiguousFailure).toHaveBeenCalledOnce();
    expect(points.release).not.toHaveBeenCalled();
  });

  it('releases a reservation after a definitive invalid response', async () => {
    const { inference, points, runs, worker } = setup();
    vi.mocked(runs.claimProcessing).mockResolvedValueOnce({
      kind: 'DISPATCH',
      request,
      userId,
      reservationId,
      leaseExpiresAt: new Date('2026-07-17T12:01:40.000Z'),
    });
    vi.mocked(inference.execute).mockRejectedValue({ code: 'INVALID_RESPONSE' });

    await expect(worker.process(runId)).resolves.toEqual({ kind: 'RELEASED' });
    expect(runs.markFailed).toHaveBeenCalledOnce();
    expect(points.release).toHaveBeenCalledOnce();
    expect(runs.markReleased).toHaveBeenCalledOnce();
  });

  it('releases a reservation when a valid transport response cannot become a product result', async () => {
    const { points, runs, worker } = setup();
    vi.mocked(runs.claimProcessing).mockResolvedValueOnce({
      kind: 'DISPATCH',
      request,
      userId,
      reservationId,
      leaseExpiresAt: new Date('2026-07-17T12:01:40.000Z'),
    });
    vi.mocked(runs.persistResult).mockRejectedValue(
      new AgentResultRejectedError('ACTION_TARGET_VERSION_CONFLICT'),
    );

    await expect(worker.process(runId)).resolves.toEqual({ kind: 'RELEASED' });
    expect(runs.markFailed).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        runId,
        errorCode: 'AGENT_ACTION_TARGET_VERSION_CONFLICT',
      }),
    );
    expect(points.release).toHaveBeenCalledOnce();
    expect(runs.markReleased).toHaveBeenCalledOnce();
    expect(points.settle).not.toHaveBeenCalled();
  });

  it('silently discards a response after recovery already released the Run', async () => {
    const { points, runs, worker } = setup();
    vi.mocked(runs.claimProcessing).mockResolvedValueOnce({
      kind: 'DISPATCH',
      request,
      userId,
      reservationId,
      leaseExpiresAt: new Date('2026-07-17T12:01:40.000Z'),
    });
    vi.mocked(runs.persistResult).mockResolvedValue('IGNORED_TERMINAL');

    await expect(worker.process(runId)).resolves.toEqual({ kind: 'TERMINAL' });
    expect(runs.markFailed).not.toHaveBeenCalled();
    expect(points.release).not.toHaveBeenCalled();
    expect(points.settle).not.toHaveBeenCalled();
  });
});
