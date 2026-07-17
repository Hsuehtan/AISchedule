import { Inject, Injectable, Optional } from '@nestjs/common';

import { UNIT_OF_WORK, type UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AI_POINTS_PORT, type AiPointsPort } from '../users/points/ai-points.port.js';
import {
  AGENT_INFERENCE_PORT,
  AGENT_RUN_PORT,
  AgentResultRejectedError,
  type AgentInferencePort,
  type AgentProcessingClaim,
  type AgentRunPort,
} from './agent-runtime.port.js';

export type AgentWorkerOutcome =
  | Readonly<{ kind: 'DISPATCHED_AND_SETTLED' }>
  | Readonly<{ kind: 'RELEASED' }>
  | Readonly<{ kind: 'TERMINAL' }>
  | Readonly<{ kind: 'WAIT'; retryAt: Date }>;

type SafeInferenceFailure = Readonly<{
  code: string;
  definitive: boolean;
}>;

export const AGENT_WORKER_CLOCK = Symbol('AgentWorkerClock');

function classifyInferenceFailure(error: unknown): SafeInferenceFailure {
  if (typeof error !== 'object' || error === null) {
    return { code: 'AGENT_SERVICE_UNAVAILABLE', definitive: false };
  }
  const candidate = error as { code?: unknown; status?: unknown };
  const code = typeof candidate.code === 'string' ? candidate.code : 'UNAVAILABLE';
  const status = typeof candidate.status === 'number' ? candidate.status : undefined;

  // A received HTTP error is definitive: Python did not return a product result.
  // A timeout/disconnect without a status is ambiguous and must wait for recovery.
  const definitive =
    status !== undefined ||
    code === 'AUTHENTICATION_FAILED' ||
    code === 'BUSY' ||
    code === 'CONTRACT_REJECTED' ||
    code === 'DEADLINE_EXPIRED' ||
    code === 'INVALID_RESPONSE';
  return { code: `AGENT_${code}`, definitive };
}

@Injectable()
export class AgentWorker {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(AI_POINTS_PORT) private readonly points: AiPointsPort,
    @Inject(AGENT_RUN_PORT) private readonly runs: AgentRunPort,
    @Inject(AGENT_INFERENCE_PORT) private readonly inference: AgentInferencePort,
    @Optional()
    @Inject(AGENT_WORKER_CLOCK)
    private readonly now: () => Date = () => new Date(),
  ) {}

  async process(runId: string): Promise<AgentWorkerOutcome> {
    const claim = await this.claim(runId);
    switch (claim.kind) {
      case 'NONE':
        return { kind: 'TERMINAL' };
      case 'WAIT':
        return claim;
      case 'RELEASE':
        await this.release(runId, claim);
        return { kind: 'RELEASED' };
      case 'SETTLE':
        await this.settle(runId, claim);
        return { kind: 'DISPATCHED_AND_SETTLED' };
      case 'DISPATCH':
        return this.dispatch(runId, claim);
    }
  }

  private claim(runId: string): Promise<AgentProcessingClaim> {
    const observedAt = this.now();
    return this.unitOfWork.run(async (scope) => {
      const claim = await this.runs.claimProcessing(scope, { runId, now: observedAt });
      if (claim.kind === 'DISPATCH') {
        await this.points.extendLease(scope, {
          userId: claim.userId,
          reservationId: claim.reservationId,
          expiresAt: claim.leaseExpiresAt,
        });
      }
      return claim;
    });
  }

  private async dispatch(
    runId: string,
    claim: Extract<AgentProcessingClaim, { kind: 'DISPATCH' }>,
  ): Promise<AgentWorkerOutcome> {
    let response;
    try {
      response = await this.inference.execute(claim.request);
    } catch (error) {
      const failure = classifyInferenceFailure(error);
      if (!failure.definitive) {
        await this.unitOfWork.run((scope) =>
          this.runs.recordAmbiguousFailure(scope, {
            runId,
            errorCode: failure.code,
            observedAt: this.now(),
          }),
        );
        return { kind: 'WAIT', retryAt: claim.leaseExpiresAt };
      }

      await this.unitOfWork.run(async (scope) => {
        const reservation = await this.runs.markFailed(scope, {
          runId,
          errorCode: failure.code,
          failedAt: this.now(),
        });
        await this.points.release(scope, reservation);
        await this.runs.markReleased(scope, { runId, releasedAt: this.now() });
      });
      return { kind: 'RELEASED' };
    }

    try {
      const outcome = await this.unitOfWork.run((scope) =>
        this.runs.persistResult(scope, { runId, response, persistedAt: this.now() }),
      );
      if (outcome === 'IGNORED_TERMINAL') return { kind: 'TERMINAL' };
    } catch (error) {
      if (!(error instanceof AgentResultRejectedError)) throw error;
      await this.failAndRelease(runId, `AGENT_${error.code}`);
      return { kind: 'RELEASED' };
    }
    const persistedClaim = await this.claim(runId);
    if (persistedClaim.kind !== 'SETTLE') {
      throw new AgentWorkerInvariantError('Persisted result was not available for settlement');
    }
    await this.settle(runId, persistedClaim);
    return { kind: 'DISPATCHED_AND_SETTLED' };
  }

  private settle(
    runId: string,
    claim: Extract<AgentProcessingClaim, { kind: 'SETTLE' }>,
  ): Promise<void> {
    return this.unitOfWork.run(async (scope) => {
      await this.points.settle(scope, {
        userId: claim.userId,
        reservationId: claim.reservationId,
        runId,
        result: claim.result,
      });
      await this.runs.markSucceeded(scope, { runId, settledAt: this.now() });
    });
  }

  private release(
    runId: string,
    claim: Extract<AgentProcessingClaim, { kind: 'RELEASE' }>,
  ): Promise<void> {
    return this.unitOfWork.run(async (scope) => {
      await this.points.release(scope, {
        userId: claim.userId,
        reservationId: claim.reservationId,
      });
      await this.runs.markReleased(scope, { runId, releasedAt: this.now() });
    });
  }

  private failAndRelease(runId: string, errorCode: string): Promise<void> {
    return this.unitOfWork.run(async (scope) => {
      const reservation = await this.runs.markFailed(scope, {
        runId,
        errorCode,
        failedAt: this.now(),
      });
      await this.points.release(scope, reservation);
      await this.runs.markReleased(scope, { runId, releasedAt: this.now() });
    });
  }
}

export class AgentWorkerInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentWorkerInvariantError';
  }
}
