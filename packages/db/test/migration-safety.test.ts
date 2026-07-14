import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const phaseTwoMigration = new URL(
  '../prisma/migrations/20260714120000_phase2_manual_loop/migration.sql',
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
