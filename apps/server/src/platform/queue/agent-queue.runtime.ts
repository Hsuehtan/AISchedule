import { agentRequestIdSchema } from '@ai-schedule/contracts';
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';

import { AgentWorker } from '../../modules/agent/agent-worker.js';
import {
  AGENT_RECOVERY_OPTIONS,
  AgentRecoveryCoordinator,
  type AgentRecoveryOptions,
} from './agent-recovery.coordinator.js';
import { AGENT_REQUEST_QUEUE } from './agent-job-queue.adapter.js';
import { PgBossQueue } from './pg-boss.queue.js';

@Injectable()
export class AgentQueueRuntime implements OnApplicationBootstrap, OnApplicationShutdown {
  private started = false;
  private recoveryTimer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(PgBossQueue) private readonly queue: PgBossQueue,
    @Inject(AgentWorker) private readonly worker: AgentWorker,
    @Inject(AgentRecoveryCoordinator)
    private readonly recovery: AgentRecoveryCoordinator,
    @Inject(AGENT_RECOVERY_OPTIONS)
    private readonly recoveryOptions: AgentRecoveryOptions,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Recovery and settlement must remain available even when new inference admission is
    // disabled. Historical QUEUED/RUNNING/FAILED Runs may still hold pending reservations,
    // while RESULT_PERSISTED/SETTLING Runs must finish settlement without Python.
    await this.queue.start();
    this.started = true;
    await this.queue.ensureQueue(AGENT_REQUEST_QUEUE);
    await this.queue.registerWorker<{ runId: string }>(AGENT_REQUEST_QUEUE, async (data) => {
      const runId = agentRequestIdSchema.parse(data.runId);
      const outcome = await this.worker.process(runId);
      if (outcome.kind === 'WAIT') throw new AgentQueueWaitError();
    });
    await this.recovery.reconcileOnce();
    this.recoveryTimer = setInterval(() => {
      void this.recovery.reconcileOnce().catch(() => undefined);
    }, this.recoveryOptions.intervalMs);
    this.recoveryTimer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    if (this.started) await this.queue.stop();
  }
}

export class AgentQueueWaitError extends Error {
  constructor() {
    super('Agent Run is waiting for recovery');
    this.name = 'AgentQueueWaitError';
  }
}
