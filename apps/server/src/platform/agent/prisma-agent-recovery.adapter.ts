import { Inject, Injectable } from '@nestjs/common';

import type {
  AgentRecoverableStatus,
  AgentRecoveryCandidate,
  AgentRecoveryPort,
} from '../../modules/agent/agent-recovery.port.js';
import { DatabaseService } from '../database/database.service.js';

const RECOVERABLE_STATUSES = [
  'RESULT_PERSISTED',
  'SETTLING',
  'RUNNING',
  'FAILED',
  'QUEUED',
] as const satisfies readonly AgentRecoverableStatus[];

@Injectable()
export class PrismaAgentRecoveryAdapter implements AgentRecoveryPort {
  private readonly cursors = new Map<AgentRecoverableStatus, string>();
  private overflowStart = 0;

  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  resetScan(): void {
    this.cursors.clear();
    this.overflowStart = 0;
  }

  async listEligible(
    input: Readonly<{ now: Date; limit: number }>,
  ): Promise<AgentRecoveryCandidate[]> {
    const perStatusLimit = Math.max(1, Math.floor(input.limit / RECOVERABLE_STATUSES.length));
    const rows: Array<{ id: string; status: string }> = [];
    const seen = new Set<string>();
    const append = (candidates: Array<{ id: string; status: string }>) => {
      for (const candidate of candidates) {
        if (rows.length >= input.limit) return;
        if (!seen.has(candidate.id)) {
          seen.add(candidate.id);
          rows.push(candidate);
        }
      }
    };

    // Reserve a quota for every state first so settlement, release, and lost QUEUED jobs
    // cannot starve one another.
    for (const status of RECOVERABLE_STATUSES) {
      append(await this.listStatus(status, input.now, perStatusLimit));
    }

    // Reuse empty quota while rotating which state receives overflow first on each scan.
    for (
      let offset = 0;
      offset < RECOVERABLE_STATUSES.length && rows.length < input.limit;
      offset++
    ) {
      const index = (this.overflowStart + offset) % RECOVERABLE_STATUSES.length;
      const status = RECOVERABLE_STATUSES[index];
      if (status) {
        append(await this.listStatus(status, input.now, input.limit - rows.length));
      }
    }
    this.overflowStart = (this.overflowStart + 1) % RECOVERABLE_STATUSES.length;

    return rows.map(toCandidate);
  }

  private async listStatus(status: AgentRecoverableStatus, now: Date, take: number) {
    const cursor = this.cursors.get(status);
    const eligibility =
      status === 'RUNNING' ? { status, recoveryEligibleAt: { lte: now } } : { status };
    const rows = await this.database.client.agentRequestRun.findMany({
      where: { ...eligibility, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: 'asc' },
      take,
      select: { id: true, status: true },
    });
    if (cursor && rows.length < take) {
      rows.push(
        ...(await this.database.client.agentRequestRun.findMany({
          where: { ...eligibility, id: { lte: cursor } },
          orderBy: { id: 'asc' },
          take: take - rows.length,
          select: { id: true, status: true },
        })),
      );
    }
    const last = rows.at(-1);
    if (last) this.cursors.set(status, last.id);
    return rows;
  }
}

function toCandidate(run: Readonly<{ id: string; status: string }>): AgentRecoveryCandidate {
  return { runId: run.id, status: run.status as AgentRecoverableStatus };
}
