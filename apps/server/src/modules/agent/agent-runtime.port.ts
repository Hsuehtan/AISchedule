import type { ExecuteRequest, ExecuteResponse } from '@ai-schedule/contracts/internal-agent/v1';

import type { AiResultReference } from '../users/points/ai-points.port.js';
import type { TransactionScope } from '../../platform/database/unit-of-work.js';

export const AGENT_INFERENCE_PORT = Symbol('AgentInferencePort');
export const AGENT_RUN_PORT = Symbol('AgentRunPort');

export class AgentResultRejectedError extends Error {
  constructor(readonly code: string) {
    super('The Agent result cannot be materialized as a product result');
    this.name = 'AgentResultRejectedError';
  }
}

export interface AgentInferencePort {
  execute(request: ExecuteRequest): Promise<ExecuteResponse>;
}

type ReservationClaim = Readonly<{
  reservationId: string;
  userId: string;
}>;

export type AgentProcessingClaim =
  | (ReservationClaim &
      Readonly<{
        kind: 'DISPATCH';
        leaseExpiresAt: Date;
        request: ExecuteRequest;
      }>)
  | (ReservationClaim & Readonly<{ kind: 'SETTLE'; result: AiResultReference }>)
  | (ReservationClaim & Readonly<{ kind: 'RELEASE' }>)
  | Readonly<{ kind: 'WAIT'; retryAt: Date }>
  | Readonly<{ kind: 'NONE' }>;

/**
 * Persistence-side state transitions. Implementations own row locking, status
 * compare-and-set checks, result materialization and tenant isolation.
 */
export interface AgentRunPort {
  claimProcessing(
    scope: TransactionScope,
    input: Readonly<{ runId: string; now: Date }>,
  ): Promise<AgentProcessingClaim>;
  persistResult(
    scope: TransactionScope,
    input: Readonly<{ runId: string; response: ExecuteResponse; persistedAt: Date }>,
  ): Promise<'IGNORED_TERMINAL' | 'PERSISTED'>;
  recordAmbiguousFailure(
    scope: TransactionScope,
    input: Readonly<{ runId: string; errorCode: string; observedAt: Date }>,
  ): Promise<void>;
  markFailed(
    scope: TransactionScope,
    input: Readonly<{ runId: string; errorCode: string; failedAt: Date }>,
  ): Promise<ReservationClaim>;
  markSucceeded(
    scope: TransactionScope,
    input: Readonly<{ runId: string; settledAt: Date }>,
  ): Promise<void>;
  markReleased(
    scope: TransactionScope,
    input: Readonly<{ runId: string; releasedAt: Date }>,
  ): Promise<void>;
}
