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
const phaseThreeAgentEnumsMigration = new URL(
  '../prisma/migrations/20260717160000_phase3_agent_enums/migration.sql',
  import.meta.url,
);
const phaseThreeAgentExpandMigration = new URL(
  '../prisma/migrations/20260717161000_phase3_agent_expand/migration.sql',
  import.meta.url,
);
const phaseThreeRunIdempotencyMigration = new URL(
  '../prisma/migrations/20260717163000_phase3_agent_run_idempotency_scope/migration.sql',
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

describe('Phase 3 Agent migration safety', () => {
  it('expands legacy enums before the Agent table migration consumes the new states', async () => {
    const sql = await readFile(phaseThreeAgentEnumsMigration, 'utf8');

    for (const state of [
      'AWAITING_CONFIRMATION',
      'SUPERSEDED',
      'CANCELLED',
      'EXECUTING',
      'FAILED',
      'EXPIRED',
    ]) {
      expect(sql).toContain(`'${state}'`);
    }
    expect(sql).toContain('CREATE TYPE "agent_result_type"');
    expect(sql).toContain('CREATE TYPE "agent_candidate_kind"');
    expect(sql).toContain('CREATE TYPE "action_code"');
  });

  it('refuses unknown Agent run history and never rewrites or contracts it silently', async () => {
    const sql = await readFile(phaseThreeAgentExpandMigration, 'utf8');

    expect(sql).toMatch(/IF EXISTS\s*\(\s*SELECT 1\s+FROM "agent_request_runs"/is);
    expect(sql).toMatch(/RAISE EXCEPTION[^;]*Agent[^;]*run/is);
    expect(sql).not.toMatch(/UPDATE\s+"agent_request_runs"/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+"agent_request_runs"/i);
    expect(sql).not.toMatch(/DROP\s+(?:COLUMN|TYPE|TABLE)/i);
    expect(sql).not.toMatch(/DROP\s+INDEX/i);
    expect(sql).not.toMatch(/RENAME\s+(?:COLUMN|TABLE)/i);
  });

  it('adds the single-dispatch Run fields and tenant-safe reservation relation', async () => {
    const sql = await readFile(phaseThreeAgentExpandMigration, 'utf8');

    for (const field of [
      'contract_version',
      'allowed_result_types',
      'dispatch_attempted_at',
      'execute_timeout_at',
      'run_deadline_at',
      'recovery_eligible_at',
      'result_type',
      'result_hash',
    ]) {
      expect(sql).toContain(`"${field}"`);
    }
    expect(sql).toMatch(/ALTER COLUMN "provider" DROP NOT NULL/i);
    expect(sql).toContain('agent_request_runs_reservation_id_user_id_fkey');
    expect(sql).toMatch(
      /FOREIGN KEY \("reservation_id", "user_id"\)[\s\S]*ai_point_transactions"\("reservation_id", "user_id"\)/i,
    );
    expect(sql).toContain('agent_request_runs_result_consistency_check');
    expect(sql).toContain('agent_request_runs_dispatch_window_check');
  });

  it('adds bounded candidate references with tenant-safe Task and Project targets', async () => {
    const sql = await readFile(phaseThreeAgentExpandMigration, 'utf8');

    expect(sql).toContain('CREATE TABLE "agent_request_candidate_refs"');
    expect(sql).toContain('agent_request_candidate_refs_candidate_ref_key');
    expect(sql).toContain('agent_request_candidate_refs_target_check');
    expect(sql).toContain('agent_request_candidate_refs_task_id_user_id_fkey');
    expect(sql).toContain('agent_request_candidate_refs_project_id_user_id_fkey');
    expect(sql).toMatch(/candidate_ref" ~ '\^cand_\[0-9a-f\]\{32\}\$'/i);
  });

  it('expands message and proposal audit fields without replacing legacy payload columns', async () => {
    const sql = await readFile(phaseThreeAgentExpandMigration, 'utf8');

    for (const field of [
      'initial_input',
      'context_summary',
      'last_viewed_message_id',
      'messages_conversation_cursor_idx',
      'message_type',
      'input_mode',
      'reply_to_id',
      'interaction_status',
      'action_code',
      'last_dismissed_at',
      'before_value',
      'after_value',
      'confirmed_by',
      'confirmed_at',
      'result_snapshot',
    ]) {
      expect(sql).toContain(`"${field}"`);
    }
    expect(sql).toContain('action_mutations_proposal_id_user_id_fkey');
    expect(sql).toContain('messages_request_run_id_user_id_key');
    expect(sql).not.toMatch(/DROP\s+COLUMN\s+"(?:structured_data|type|payload)"/i);
  });

  it('relaxes only the redundant permanent Run idempotency index', async () => {
    const sql = await readFile(phaseThreeRunIdempotencyMigration, 'utf8');

    expect(sql).toMatch(/DROP\s+INDEX\s+"agent_request_runs_idempotency_key"/i);
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+"agent_request_runs_idempotency_diagnostic_idx"[\s\S]*"user_id",\s*"endpoint_code",\s*"idempotency_key"/i,
    );
    expect(sql).not.toMatch(/DELETE\s+FROM|UPDATE\s+"agent_request_runs"/i);
    expect(sql).not.toMatch(/DROP\s+(?:COLUMN|TYPE|TABLE)/i);
    expect(sql).not.toMatch(/DROP\s+INDEX\s+(?!"agent_request_runs_idempotency_key")/i);
  });
});
