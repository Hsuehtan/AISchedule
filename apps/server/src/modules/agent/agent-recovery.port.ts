export const AGENT_RECOVERY_PORT = Symbol('AgentRecoveryPort');

export type AgentRecoverableStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'RESULT_PERSISTED'
  | 'SETTLING'
  | 'FAILED';

export type AgentRecoveryCandidate = Readonly<{
  runId: string;
  status: AgentRecoverableStatus;
}>;

/** Read-only discovery boundary. Worker CAS transitions remain the only recovery authority. */
export interface AgentRecoveryPort {
  listEligible(input: Readonly<{ now: Date; limit: number }>): Promise<AgentRecoveryCandidate[]>;
  resetScan(): void;
}
