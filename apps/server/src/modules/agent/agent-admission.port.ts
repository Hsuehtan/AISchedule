import type {
  AgentTurnInput,
  AgentTurnQueuedResponse,
  PlanGenerationInput,
  SmartInboxOrganizeInput,
} from '@ai-schedule/contracts';
import type { ResultType } from '@ai-schedule/contracts/internal-agent/v1';

import type { TransactionScope } from '../../platform/database/unit-of-work.js';

export const AGENT_ADMISSION_PORT = Symbol('AgentAdmissionPort');

export type AgentRunSource =
  | Readonly<{ kind: 'TURN'; input: AgentTurnInput }>
  | Readonly<{ kind: 'PLAN'; input: PlanGenerationInput }>
  | Readonly<{ kind: 'ORGANIZE'; input: SmartInboxOrganizeInput }>;

export type AgentRunTiming = Readonly<{
  candidateExpiresAt: Date;
  executeTimeoutAt: Date;
  recoveryEligibleAt: Date;
  runDeadlineAt: Date;
}>;

export type IdempotencyClaim =
  | Readonly<{ kind: 'CLAIMED' }>
  | Readonly<{ kind: 'REPLAY'; response: AgentTurnQueuedResponse }>;

export interface AgentAdmissionPort {
  claimIdempotency(
    scope: TransactionScope,
    input: Readonly<{
      userId: string;
      scope: string;
      key: string;
      request: unknown;
      expiresAt: Date;
    }>,
  ): Promise<IdempotencyClaim>;
  createRun(
    scope: TransactionScope,
    input: Readonly<{
      runId: string;
      userId: string;
      idempotencyKey: string;
      capabilityCode: 'agent.planGeneration' | 'agent.standardTurn';
      endpointCode: 'agent.plan-generation' | 'agent.turn';
      allowedResultTypes: readonly ResultType[];
      source: AgentRunSource;
      timing: AgentRunTiming;
    }>,
  ): Promise<Readonly<{ conversationId: string }>>;
  attachReservation(
    scope: TransactionScope,
    input: Readonly<{ runId: string; userId: string; reservationId: string }>,
  ): Promise<void>;
  completeIdempotency(
    scope: TransactionScope,
    input: Readonly<{
      userId: string;
      scope: string;
      key: string;
      response: AgentTurnQueuedResponse;
    }>,
  ): Promise<void>;
}
