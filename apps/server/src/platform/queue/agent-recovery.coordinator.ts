import { Inject, Injectable } from '@nestjs/common';
import type { SendOptions } from 'pg-boss';

import {
  AGENT_RECOVERY_PORT,
  type AgentRecoveryCandidate,
  type AgentRecoveryPort,
} from '../../modules/agent/agent-recovery.port.js';
import { AGENT_REQUEST_QUEUE } from './agent-job-queue.adapter.js';
import { PgBossQueue } from './pg-boss.queue.js';

export const AGENT_RECOVERY_OPTIONS = Symbol('AgentRecoveryOptions');

export type AgentRecoveryOptions = Readonly<{
  intervalMs: number;
  batchSize: number;
}>;

export type AgentRecoveryResult = Readonly<{
  discovered: number;
  enqueued: number;
  deduplicated: number;
}>;

const RECOVERY_JOB_OPTIONS = {
  retryBackoff: true,
  retryDelay: 15,
  retryDelayMax: 60,
  retryLimit: 8,
} as const satisfies SendOptions;

@Injectable()
export class AgentRecoveryCoordinator {
  private activeScan: Promise<AgentRecoveryResult> | null = null;

  constructor(
    @Inject(AGENT_RECOVERY_PORT) private readonly recovery: AgentRecoveryPort,
    @Inject(PgBossQueue) private readonly queue: PgBossQueue,
    @Inject(AGENT_RECOVERY_OPTIONS) private readonly options: AgentRecoveryOptions,
  ) {}

  reconcileOnce(now = new Date()): Promise<AgentRecoveryResult> {
    if (this.activeScan) {
      return Promise.resolve({ discovered: 0, enqueued: 0, deduplicated: 0 });
    }
    const scan = this.reconcile(now).finally(() => {
      if (this.activeScan === scan) this.activeScan = null;
    });
    this.activeScan = scan;
    return scan;
  }

  private async reconcile(now: Date): Promise<AgentRecoveryResult> {
    let candidates: AgentRecoveryCandidate[];
    try {
      candidates = await this.recovery.listEligible({
        now,
        limit: this.options.batchSize,
      });
    } catch (error) {
      // The adapter advances per-state cursors while scanning. A partial query failure must not
      // commit that in-memory progress when no candidate batch was returned to the queue.
      this.recovery.resetScan();
      throw asRecoveryError(error);
    }
    let enqueued = 0;
    let deduplicated = 0;
    let firstPublishError: unknown;
    const singletonSeconds = Math.max(1, Math.ceil(this.options.intervalMs / 1_000));

    for (const candidate of candidates) {
      try {
        const jobId = await this.queue.publishSingleton(
          AGENT_REQUEST_QUEUE,
          { runId: candidate.runId },
          {
            ...RECOVERY_JOB_OPTIONS,
            singletonKey: `agent-recovery:${candidate.runId}`,
            singletonSeconds,
          },
        );
        if (jobId === null) deduplicated += 1;
        else enqueued += 1;
      } catch (error) {
        firstPublishError ??= error;
      }
    }

    if (firstPublishError !== undefined) {
      // Discovery advances in-memory fairness cursors. Reset after any publish failure so a
      // candidate that was not actually queued is retried on the next reconciliation interval.
      this.recovery.resetScan();
      throw asRecoveryError(firstPublishError);
    }

    return { discovered: candidates.length, enqueued, deduplicated };
  }
}

function asRecoveryError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error('Agent recovery operation failed', { cause: error });
}
