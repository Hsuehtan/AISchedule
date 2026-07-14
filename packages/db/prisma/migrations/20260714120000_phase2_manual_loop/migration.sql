-- Phase 2 manual task deletion undo audit fields.
-- This is an unreleased development migration. The previous generic payload has no
-- lossless mapping to TASK_DELETE, target refs, inverse changes, or an expected version.
-- Refuse to fabricate that history: reset an affected development database explicitly.
DO $phase_two_undo_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM "undo_operations") THEN
    RAISE EXCEPTION
      'Phase 2 migration requires undo_operations to be empty; reset the unreleased development database';
  END IF;
END
$phase_two_undo_guard$;

CREATE TYPE "undo_source_type" AS ENUM ('MANUAL', 'ACTION_EXECUTION');
CREATE TYPE "undo_operation_code" AS ENUM ('TASK_DELETE');

DROP INDEX "user_contacts_user_type_idx";
CREATE UNIQUE INDEX "user_contacts_user_type_key" ON "user_contacts"("user_id", "type");

ALTER TABLE "undo_operations"
  ADD COLUMN "source_type" "undo_source_type",
  ADD COLUMN "source_operation_id" VARCHAR(128),
  ADD COLUMN "operation_code" "undo_operation_code",
  ADD COLUMN "target_refs" JSONB,
  ADD COLUMN "inverse_change" JSONB,
  ADD COLUMN "expected_version" INTEGER,
  ADD COLUMN "idempotency_key" VARCHAR(128);

ALTER TABLE "undo_operations"
  ALTER COLUMN "source_type" SET NOT NULL,
  ALTER COLUMN "source_type" SET DEFAULT 'MANUAL',
  ALTER COLUMN "source_operation_id" SET NOT NULL,
  ALTER COLUMN "operation_code" SET NOT NULL,
  ALTER COLUMN "target_refs" SET NOT NULL,
  ALTER COLUMN "inverse_change" SET NOT NULL,
  ALTER COLUMN "expected_version" SET NOT NULL;

CREATE UNIQUE INDEX "undo_operations_user_source_operation_key"
  ON "undo_operations"("user_id", "source_operation_id");
CREATE UNIQUE INDEX "undo_operations_user_idempotency_key"
  ON "undo_operations"("user_id", "idempotency_key");

ALTER TABLE "undo_operations"
  ADD CONSTRAINT "undo_operations_expected_version_positive_check"
    CHECK ("expected_version" > 0),
  ADD CONSTRAINT "undo_operations_source_relation_check" CHECK (
    ("source_type" = 'MANUAL' AND "action_execution_id" IS NULL)
    OR ("source_type" = 'ACTION_EXECUTION' AND "action_execution_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "undo_operations_execution_state_check" CHECK (
    ("status" = 'AVAILABLE' AND "executed_at" IS NULL AND "idempotency_key" IS NULL)
    OR ("status" = 'EXECUTED' AND "executed_at" IS NOT NULL AND "idempotency_key" IS NOT NULL)
    OR ("status" = 'EXPIRED' AND "executed_at" IS NULL AND "idempotency_key" IS NULL)
  );
