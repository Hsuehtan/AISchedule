-- Phase 3 points expand migration.
-- H2 produced only succeeded initial grants. Refuse to guess how any unreleased
-- reservation/debit history should map to the single-row debit state machine.
DO $phase_three_points_guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "agent_request_runs"
  ) THEN
    RAISE EXCEPTION
      'Phase 3 points migration cannot expand a database that already contains Agent run history';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ai_point_transactions"
    WHERE "type" IN ('RESERVATION', 'DEBIT', 'RELEASE', 'REFUND', 'ADMIN_ADJUSTMENT')
       OR "status" <> 'SUCCEEDED'
  ) THEN
    RAISE EXCEPTION
      'Phase 3 points migration cannot reinterpret existing point reservation history; reconcile or reset the unreleased database';
  END IF;
END
$phase_three_points_guard$;

CREATE TYPE "ai_capability_status" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TABLE "ai_capabilities" (
  "id" UUID NOT NULL,
  "capability_code" VARCHAR(64) NOT NULL,
  "endpoint_code" VARCHAR(128) NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "calls_model_api" BOOLEAN NOT NULL,
  "points_cost" INTEGER NOT NULL,
  "cost_rule_version" VARCHAR(64) NOT NULL,
  "status" "ai_capability_status" NOT NULL DEFAULT 'INACTIVE',
  "effective_at" TIMESTAMPTZ(3) NOT NULL,
  "config_version" INTEGER NOT NULL,
  "config_hash" CHAR(64) NOT NULL,
  "rule_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "extra" JSONB NOT NULL DEFAULT '{}',

  CONSTRAINT "ai_capabilities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_capabilities_cost_check" CHECK (
    ("calls_model_api" AND "points_cost" > 0)
    OR (NOT "calls_model_api" AND "points_cost" = 0)
  ),
  CONSTRAINT "ai_capabilities_config_version_check" CHECK ("config_version" > 0)
);

CREATE UNIQUE INDEX "ai_capabilities_rule_version_key"
  ON "ai_capabilities"("capability_code", "cost_rule_version");
CREATE UNIQUE INDEX "ai_capabilities_one_active_key"
  ON "ai_capabilities"("capability_code", "endpoint_code")
  WHERE "status" = 'ACTIVE';
CREATE INDEX "ai_capabilities_status_code_idx"
  ON "ai_capabilities"("status", "capability_code");

ALTER TABLE "ai_point_transactions"
  ADD COLUMN "idempotency_key" VARCHAR(128),
  ADD COLUMN "capability_id" UUID,
  ADD COLUMN "endpoint_code" VARCHAR(128),
  ADD COLUMN "cost_rule_version" VARCHAR(64),
  ADD COLUMN "session_id" UUID,
  ADD COLUMN "message_id" UUID,
  ADD COLUMN "proposal_id" UUID,
  ADD COLUMN "grant_rule_version" VARCHAR(64),
  ADD COLUMN "reserved_at" TIMESTAMPTZ(3),
  ADD COLUMN "settled_at" TIMESTAMPTZ(3),
  ADD COLUMN "released_at" TIMESTAMPTZ(3);

UPDATE "ai_point_transactions"
SET
  "idempotency_key" = 'legacy:' || "id"::text,
  "settled_at" = "created_at"
WHERE "idempotency_key" IS NULL;

ALTER TABLE "ai_point_transactions"
  ALTER COLUMN "idempotency_key" SET NOT NULL,
  ALTER COLUMN "balance_before" DROP NOT NULL,
  ALTER COLUMN "balance_after" DROP NOT NULL;

DROP INDEX "ai_point_transactions_daily_top_up_key";
DROP INDEX "ai_point_transactions_reservation_idx";
ALTER TABLE "ai_point_transactions"
  DROP CONSTRAINT "ai_point_transactions_balances_nonnegative_check";

CREATE UNIQUE INDEX "ai_point_transactions_idempotency_key"
  ON "ai_point_transactions"("idempotency_key");
CREATE UNIQUE INDEX "ai_point_transactions_reservation_id_key"
  ON "ai_point_transactions"("reservation_id");
CREATE UNIQUE INDEX "ai_point_transactions_refund_reversal_key"
  ON "ai_point_transactions"("reversal_of")
  WHERE "type" = 'REFUND' AND "status" = 'SUCCEEDED';
CREATE UNIQUE INDEX "ai_point_transactions_effective_debit_key"
  ON "ai_point_transactions"("user_id", "request_id", "capability_id")
  WHERE "type" = 'DEBIT' AND "status" IN ('PENDING', 'SUCCEEDED');
CREATE UNIQUE INDEX "ai_point_transactions_daily_top_up_key"
  ON "ai_point_transactions"("user_id", "type", "reason_code", "local_date")
  WHERE "type" = 'GRANT'
    AND "reason_code" = 'daily_allowance_top_up'
    AND "local_date" IS NOT NULL;
CREATE INDEX "ai_point_transactions_status_expiry_idx"
  ON "ai_point_transactions"("status", "expires_at");
CREATE INDEX "ai_point_transactions_capability_idx"
  ON "ai_point_transactions"("capability_id");

ALTER TABLE "ai_point_transactions"
  ADD CONSTRAINT "ai_point_transactions_capability_id_fkey"
    FOREIGN KEY ("capability_id") REFERENCES "ai_capabilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_point_transactions_reversal_of_fkey"
    FOREIGN KEY ("reversal_of") REFERENCES "ai_point_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_point_transactions_state_check" CHECK (
    (
      "status" = 'SUCCEEDED'
      AND "balance_before" IS NOT NULL
      AND "balance_after" IS NOT NULL
      AND "balance_before" >= 0
      AND "balance_after" >= 0
      AND "balance_after" = "balance_before" + "amount"
      AND "settled_at" IS NOT NULL
    )
    OR (
      "status" <> 'SUCCEEDED'
      AND "balance_before" IS NULL
      AND "balance_after" IS NULL
      AND "settled_at" IS NULL
    )
  ),
  ADD CONSTRAINT "ai_point_transactions_amount_check" CHECK (
    ("type" IN ('GRANT', 'NEW_USER_GRANT', 'DAILY_TOP_UP', 'REFUND') AND "amount" >= 0)
    OR ("type" IN ('DEBIT', 'EXPIRE') AND "amount" < 0)
    OR ("type" IN ('ADJUSTMENT', 'ADMIN_ADJUSTMENT'))
    OR ("type" IN ('RESERVATION', 'RELEASE'))
  ),
  ADD CONSTRAINT "ai_point_transactions_reservation_check" CHECK (
    (
      "type" = 'DEBIT'
      AND "request_id" IS NOT NULL
      AND "reservation_id" IS NOT NULL
      AND "capability_id" IS NOT NULL
      AND "capability_code" IS NOT NULL
      AND "endpoint_code" IS NOT NULL
      AND "cost_rule_version" IS NOT NULL
      AND "reserved_at" IS NOT NULL
      AND "expires_at" IS NOT NULL
      AND "expires_at" > "reserved_at"
    )
    OR "type" <> 'DEBIT'
  ),
  ADD CONSTRAINT "ai_point_transactions_debit_status_check" CHECK (
    "status" NOT IN ('PENDING', 'CANCELLED') OR "type" = 'DEBIT'
  ),
  ADD CONSTRAINT "ai_point_transactions_release_check" CHECK (
    ("status" = 'CANCELLED' AND "released_at" IS NOT NULL)
    OR ("status" <> 'CANCELLED' AND "released_at" IS NULL)
  ),
  ADD CONSTRAINT "ai_point_transactions_result_check" CHECK (
    "type" <> 'DEBIT'
    OR "status" <> 'SUCCEEDED'
    OR num_nonnulls("session_id", "message_id", "proposal_id") = 1
  ),
  ADD CONSTRAINT "ai_point_transactions_daily_grant_check" CHECK (
    ("reason_code" = 'daily_allowance_top_up' AND "type" = 'GRANT' AND "local_date" IS NOT NULL AND "grant_rule_version" IS NOT NULL)
    OR "reason_code" <> 'daily_allowance_top_up'
  ),
  ADD CONSTRAINT "ai_point_transactions_new_user_grant_check" CHECK (
    ("reason_code" = 'new_user_initial_grant' AND "type" = 'GRANT' AND "grant_rule_version" IS NOT NULL)
    OR "reason_code" <> 'new_user_initial_grant'
  ),
  ADD CONSTRAINT "ai_point_transactions_admin_adjustment_check" CHECK (
    ("reason_code" = 'admin_adjustment' AND "type" = 'ADJUSTMENT' AND "operator" IS NOT NULL AND "reason" IS NOT NULL)
    OR "reason_code" <> 'admin_adjustment'
  );

-- Capability rule content is immutable. Only current activation and bookkeeping
-- timestamps may change when a previously deployed version is reactivated.
CREATE FUNCTION reject_ai_capability_rule_mutation() RETURNS trigger AS $immutable_capability$
BEGIN
  IF (OLD."capability_code", OLD."endpoint_code", OLD."name", OLD."calls_model_api", OLD."points_cost", OLD."cost_rule_version", OLD."effective_at", OLD."config_version", OLD."config_hash", OLD."rule_hash", OLD."extra")
     IS DISTINCT FROM
     (NEW."capability_code", NEW."endpoint_code", NEW."name", NEW."calls_model_api", NEW."points_cost", NEW."cost_rule_version", NEW."effective_at", NEW."config_version", NEW."config_hash", NEW."rule_hash", NEW."extra") THEN
    RAISE EXCEPTION 'AiCapability rule versions are immutable';
  END IF;
  RETURN NEW;
END
$immutable_capability$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_capabilities_rule_immutable"
BEFORE UPDATE ON "ai_capabilities"
FOR EACH ROW EXECUTE FUNCTION reject_ai_capability_rule_mutation();
