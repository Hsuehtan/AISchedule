import type { TransactionScope } from '../../platform/database/unit-of-work.js';

export const AGENT_JOB_QUEUE_PORT = Symbol('AgentJobQueuePort');

export interface AgentJobQueuePort {
  enqueue(
    scope: TransactionScope,
    input: Readonly<{ runId: string }>,
  ): Promise<Readonly<{ jobId: string }>>;
}
