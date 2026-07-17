import { agentRequestIdSchema } from '@ai-schedule/contracts';
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';

import {
  AGENT_RUNTIME_AVAILABILITY,
  type AgentRuntimeAvailability,
} from '../../modules/agent/agent-product.port.js';
import { AgentWorker } from '../../modules/agent/agent-worker.js';
import { AGENT_REQUEST_QUEUE } from './agent-job-queue.adapter.js';
import { PgBossQueue } from './pg-boss.queue.js';

@Injectable()
export class AgentQueueRuntime implements OnApplicationBootstrap, OnApplicationShutdown {
  private started = false;

  constructor(
    @Inject(PgBossQueue) private readonly queue: PgBossQueue,
    @Inject(AgentWorker) private readonly worker: AgentWorker,
    @Inject(AGENT_RUNTIME_AVAILABILITY)
    private readonly availability: AgentRuntimeAvailability,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.availability.available) return;
    await this.queue.start();
    this.started = true;
    await this.queue.ensureQueue(AGENT_REQUEST_QUEUE);
    await this.queue.registerWorker<{ runId: string }>(AGENT_REQUEST_QUEUE, async (data) => {
      const runId = agentRequestIdSchema.parse(data.runId);
      const outcome = await this.worker.process(runId);
      if (outcome.kind === 'WAIT') throw new AgentQueueWaitError();
    });
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.started) await this.queue.stop();
  }
}

export class AgentQueueWaitError extends Error {
  constructor() {
    super('Agent Run is waiting for recovery');
    this.name = 'AgentQueueWaitError';
  }
}
