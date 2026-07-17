/* eslint-disable @typescript-eslint/unbound-method */
import {
  agentMessageIdSchema,
  agentRequestIdSchema,
  conversationIdSchema,
} from '@ai-schedule/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { UnitOfWork } from '../../platform/database/unit-of-work.js';
import {
  AiCapabilityUnavailableError,
  InsufficientAiPointsError,
  type AiPointsPort,
} from '../users/points/ai-points.port.js';
import type { AgentAdmissionPort } from './agent-admission.port.js';
import { AgentAdmissionService } from './agent-admission.service.js';
import type { AgentJobQueuePort } from './agent-job-queue.port.js';

const now = new Date('2026-07-17T12:00:00.000Z');
const userId = '018f47be-1972-7d58-9d67-4ddc5eb78a60';
const runId = '018f47be-1972-7d58-9d67-4ddc5eb78a64';
const conversationId = '018f47be-1972-7d58-9d67-4ddc5eb78a63';
const queued = {
  requestId: agentRequestIdSchema.parse(runId),
  conversationId: conversationIdSchema.parse(conversationId),
  status: 'QUEUED' as const,
  pollAfterMs: 1_000,
};

function setup() {
  const scope = Object.freeze({}) as never;
  const unitOfWork = { run: vi.fn((work) => work(scope)) } as UnitOfWork;
  const persistence = {
    claimIdempotency: vi.fn().mockResolvedValue({ kind: 'CLAIMED' }),
    createRun: vi.fn().mockResolvedValue({ conversationId }),
    attachReservation: vi.fn().mockResolvedValue(undefined),
    completeIdempotency: vi.fn().mockResolvedValue(undefined),
  } as unknown as AgentAdmissionPort;
  const points = {
    reserve: vi.fn().mockResolvedValue({
      reservationId: '018f47be-1972-7d58-9d67-4ddc5eb78a61',
    }),
  } as unknown as AiPointsPort;
  const jobs = {
    enqueue: vi.fn().mockResolvedValue({ jobId: runId }),
  } as AgentJobQueuePort;
  const service = new AgentAdmissionService(
    unitOfWork,
    points,
    persistence,
    jobs,
    () => now,
    () => runId,
  );
  return { jobs, persistence, points, service, unitOfWork };
}

describe('AgentAdmissionService', () => {
  it('atomically creates a standard turn, reserves its server-owned cost and enqueues once', async () => {
    const { jobs, persistence, points, service, unitOfWork } = setup();

    await expect(
      service.createTurn({
        userId,
        idempotencyKey: 'turn-1',
        input: { input: { mode: 'TEXT', text: '帮我整理今天的任务' } },
      }),
    ).resolves.toEqual(queued);

    expect(unitOfWork.run).toHaveBeenCalledOnce();
    expect(persistence.createRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        runId,
        capabilityCode: 'agent.standardTurn',
        endpointCode: 'agent.turn',
        allowedResultTypes: ['REPLY', 'CLARIFICATION', 'CANDIDATES', 'ACTION_PROPOSAL'],
        timing: {
          executeTimeoutAt: new Date('2026-07-17T12:00:35.000Z'),
          runDeadlineAt: new Date('2026-07-17T12:00:40.000Z'),
          recoveryEligibleAt: new Date('2026-07-17T12:01:40.000Z'),
          candidateExpiresAt: new Date('2026-07-17T12:02:40.000Z'),
        },
      }),
    );
    expect(points.reserve).toHaveBeenCalledWith(expect.anything(), {
      userId,
      capabilityCode: 'agent.standardTurn',
      endpointCode: 'agent.turn',
      requestId: runId,
    });
    expect(jobs.enqueue).toHaveBeenCalledWith(expect.anything(), { runId });
    expect(persistence.completeIdempotency).toHaveBeenCalledOnce();
  });

  it('uses the separate two-point plan capability and never allows a direct standard PLAN', async () => {
    const { persistence, points, service } = setup();

    await service.generatePlan({
      userId,
      idempotencyKey: 'plan-1',
      input: {
        source: {
          type: 'MESSAGE',
          messageId: agentMessageIdSchema.parse('018f47be-1972-7d58-9d67-4ddc5eb78a65'),
          version: 1,
        },
      },
    });

    expect(persistence.createRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        capabilityCode: 'agent.planGeneration',
        endpointCode: 'agent.plan-generation',
        allowedResultTypes: ['CLARIFICATION', 'PLAN'],
      }),
    );
    expect(points.reserve).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ capabilityCode: 'agent.planGeneration' }),
    );
  });

  it('returns an admission replay without another reservation or queue job', async () => {
    const { jobs, persistence, points, service } = setup();
    vi.mocked(persistence.claimIdempotency).mockResolvedValue({
      kind: 'REPLAY',
      response: queued,
    });

    await expect(
      service.createTurn({
        userId,
        idempotencyKey: 'turn-1',
        input: { input: { mode: 'TEXT', text: '帮我整理今天的任务' } },
      }),
    ).resolves.toEqual(queued);
    expect(persistence.createRun).not.toHaveBeenCalled();
    expect(points.reserve).not.toHaveBeenCalled();
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it('binds a message answer to its server-selected capability inside admission', async () => {
    const { persistence, points, service } = setup();

    await service.answerMessage({
      userId,
      conversationId,
      messageId: '018f47be-1972-7d58-9d67-4ddc5eb78a65',
      idempotencyKey: 'answer-plan',
      input: { version: 1, answer: { type: 'OPTION', optionId: 'opt_1234567890abcdef' } },
      nextStep: 'AGENT_PLAN_GENERATION',
    });

    expect(persistence.createRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        capabilityCode: 'agent.planGeneration',
        endpointCode: 'agent.plan-generation',
      }),
    );
    expect(vi.mocked(persistence.createRun).mock.calls[0]?.[1].source).toMatchObject({
      kind: 'ANSWER',
    });
    expect(points.reserve).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ capabilityCode: 'agent.planGeneration' }),
    );
  });

  it.each([
    [new InsufficientAiPointsError(), 'AGENT_POINTS_INSUFFICIENT', 429],
    [new AiCapabilityUnavailableError(), 'AGENT_CAPABILITY_DISABLED', 503],
  ] as const)(
    'maps point admission failures without exposing internals',
    async (failure, code, status) => {
      const { points, service } = setup();
      vi.mocked(points.reserve).mockRejectedValue(failure);

      const error = await service
        .createTurn({
          userId,
          idempotencyKey: 'turn-failed',
          input: { input: { mode: 'TEXT', text: '帮我整理今天的任务' } },
        })
        .catch((caught: unknown) => caught);
      expect(error).toMatchObject({ code, status });
    },
  );
});
