import { Inject, Injectable } from '@nestjs/common';

import type { AgentJobQueuePort } from '../../modules/agent/agent-job-queue.port.js';
import type { TransactionScope } from '../database/unit-of-work.js';
import { DatabaseUnitOfWork } from '../database/unit-of-work.js';
import { PgBossQueue } from './pg-boss.queue.js';

export const AGENT_REQUEST_QUEUE = 'agent-request-v1';

@Injectable()
export class PgBossAgentJobQueueAdapter implements AgentJobQueuePort {
  constructor(
    @Inject(DatabaseUnitOfWork) private readonly unitOfWork: DatabaseUnitOfWork,
    @Inject(PgBossQueue) private readonly queue: PgBossQueue,
  ) {}

  async enqueue(
    scope: TransactionScope,
    input: Readonly<{ runId: string }>,
  ): Promise<Readonly<{ jobId: string }>> {
    const jobId = await this.queue.publishInTransaction(
      AGENT_REQUEST_QUEUE,
      { runId: input.runId },
      this.unitOfWork.clientFor(scope),
      {
        id: input.runId,
        retryBackoff: true,
        retryDelay: 15,
        retryDelayMax: 60,
        retryLimit: 8,
      },
    );
    return { jobId };
  }
}
