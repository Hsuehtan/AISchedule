import { describe, expect, it, vi } from 'vitest';

import type { DatabaseService } from '../database/database.service.js';
import { PrismaAgentRecoveryAdapter } from './prisma-agent-recovery.adapter.js';

describe('PrismaAgentRecoveryAdapter', () => {
  it('gives every recoverable status an independent quota when one status exceeds the batch', async () => {
    const rows = {
      RESULT_PERSISTED: Array.from({ length: 20 }, (_, index) => ({
        id: `018f47be-1972-7d58-9d67-4ddc5eb78b${index.toString().padStart(2, '0')}`,
        status: 'RESULT_PERSISTED',
      })),
      SETTLING: [{ id: '018f47be-1972-7d58-9d67-4ddc5eb78c01', status: 'SETTLING' }],
      RUNNING: [{ id: '018f47be-1972-7d58-9d67-4ddc5eb78c02', status: 'RUNNING' }],
      FAILED: [{ id: '018f47be-1972-7d58-9d67-4ddc5eb78c03', status: 'FAILED' }],
      QUEUED: [{ id: '018f47be-1972-7d58-9d67-4ddc5eb78c04', status: 'QUEUED' }],
    } as const;
    const findMany = vi.fn(
      (query: { where: { status: string; id?: { gt?: string; lte?: string } }; take: number }) => {
        const selected = rows[query.where.status as keyof typeof rows].filter((row) => {
          if (query.where.id?.gt && row.id <= query.where.id.gt) return false;
          if (query.where.id?.lte && row.id > query.where.id.lte) return false;
          return true;
        });
        return Promise.resolve(selected.slice(0, query.take));
      },
    );
    const database = {
      client: { agentRequestRun: { findMany } },
    } as unknown as DatabaseService;
    const adapter = new PrismaAgentRecoveryAdapter(database);

    const candidates = await adapter.listEligible({
      now: new Date('2026-07-17T12:05:00.000Z'),
      limit: 10,
    });
    const repeatedScan = await adapter.listEligible({
      now: new Date('2026-07-17T12:05:15.000Z'),
      limit: 10,
    });

    expect(candidates).toHaveLength(10);
    expect(candidates.map((candidate) => candidate.status).slice(0, 6)).toEqual([
      'RESULT_PERSISTED',
      'RESULT_PERSISTED',
      'SETTLING',
      'RUNNING',
      'FAILED',
      'QUEUED',
    ]);
    expect(candidates.filter((candidate) => candidate.status === 'RESULT_PERSISTED')).toHaveLength(
      6,
    );
    expect(repeatedScan).toHaveLength(10);
    expect(repeatedScan.map((candidate) => candidate.status)).toContain('RUNNING');
    expect(repeatedScan.map((candidate) => candidate.status)).toContain('FAILED');
    expect(repeatedScan.map((candidate) => candidate.status)).toContain('QUEUED');
    expect(repeatedScan.filter((candidate) => candidate.status === 'RESULT_PERSISTED')).not.toEqual(
      candidates.filter((candidate) => candidate.status === 'RESULT_PERSISTED'),
    );
    expect(findMany.mock.calls.length).toBeGreaterThanOrEqual(10);
  });

  it('never returns more candidates than the configured batch', async () => {
    const findMany = vi.fn((query: { where: { status: string }; take: number }) =>
      Promise.resolve(
        Array.from({ length: query.take }, (_, index) => ({
          id: `018f47be-1972-7d58-9d67-${query.where.status.slice(0, 4)}${index
            .toString()
            .padStart(8, '0')}`,
          status: query.where.status,
        })),
      ),
    );
    const database = {
      client: { agentRequestRun: { findMany } },
    } as unknown as DatabaseService;

    await expect(
      new PrismaAgentRecoveryAdapter(database).listEligible({
        now: new Date('2026-07-17T12:05:00.000Z'),
        limit: 5,
      }),
    ).resolves.toHaveLength(5);
  });
});
