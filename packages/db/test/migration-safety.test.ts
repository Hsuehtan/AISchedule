import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const phaseTwoMigration = new URL(
  '../prisma/migrations/20260714120000_phase2_manual_loop/migration.sql',
  import.meta.url,
);
const phaseThreePointsMigration = new URL(
  '../prisma/migrations/20260717153000_phase3_points/migration.sql',
  import.meta.url,
);

describe('Phase 2 migration safety', () => {
  it('refuses to reinterpret legacy generic undo rows as task-delete undo operations', async () => {
    const sql = await readFile(phaseTwoMigration, 'utf8');

    expect(sql).toMatch(/IF EXISTS\s*\(\s*SELECT 1 FROM "undo_operations"/s);
    expect(sql).toMatch(/RAISE EXCEPTION[^;]*undo_operations[^;]*empty/is);
    expect(sql).not.toMatch(/UPDATE\s+"undo_operations"/i);
    expect(sql).not.toContain('"expected_version" = 1');
  });
});

describe('Phase 3 points migration safety', () => {
  it('rejects unknown legacy reservations instead of reinterpreting accounting history', async () => {
    const sql = await readFile(phaseThreePointsMigration, 'utf8');

    expect(sql).toMatch(/IF EXISTS[\s\S]*ai_point_transactions[\s\S]*RESERVATION/i);
    expect(sql).toMatch(/RAISE EXCEPTION[^;]*point[^;]*history/is);
    expect(sql).not.toMatch(/UPDATE\s+"ai_point_transactions"\s+SET[^;]*"type"\s*=\s*'DEBIT'/i);
  });

  it('rejects databases that already contain Agent runs before expanding billing state', async () => {
    const sql = await readFile(phaseThreePointsMigration, 'utf8');

    expect(sql).toMatch(/IF EXISTS\s*\(\s*SELECT 1\s+FROM "agent_request_runs"/is);
    expect(sql).toMatch(/RAISE EXCEPTION[^;]*Agent[^;]*run/is);
  });

  it('adds immutable capability versions and hard reservation invariants', async () => {
    const sql = await readFile(phaseThreePointsMigration, 'utf8');

    expect(sql).toContain('CREATE TABLE "ai_capabilities"');
    expect(sql).toContain('ai_capabilities_rule_version_key');
    expect(sql).toMatch(
      /ai_capabilities_rule_version_key"\s+ON "ai_capabilities"\("capability_code", "cost_rule_version"\)/i,
    );
    expect(sql).toContain('ai_capabilities_one_active_key');
    expect(sql).toContain('ai_point_transactions_reservation_id_key');
    expect(sql).toContain('ai_point_transactions_effective_debit_key');
    expect(sql).toContain('ai_point_transactions_state_check');
    expect(sql).toContain('ai_point_transactions_result_check');
    expect(sql).toMatch(/num_nonnulls\("session_id",\s*"message_id",\s*"proposal_id"\)\s*=\s*1/i);
  });
});
