-- Phase 3 Agent additive expand migration.
-- T18 deliberately rejected unknown Agent runs. Repeat that fail-fast guard so
-- no deployment window can cause legacy execution history to be guessed into
-- the single-dispatch state machine below.
DO $phase_three_agent_guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "agent_request_runs"
  ) THEN
    RAISE EXCEPTION
      'Phase 3 Agent migration cannot expand a database that already contains Agent run history';
  END IF;
END
$phase_three_agent_guard$;

-- Tenant-safe polymorphic candidate targets need a composite Task key. Project
-- already exposes the equivalent (id, user_id) key.
CREATE UNIQUE INDEX "tasks_id_user_id_key"
  ON "tasks"("id", "user_id");

CREATE UNIQUE INDEX "ai_point_transactions_reservation_user_key"
  ON "ai_point_transactions"("reservation_id", "user_id");

ALTER TABLE "conversation_sessions"
  ADD COLUMN "initial_input" TEXT,
  ADD COLUMN "context_summary" TEXT,
  ADD COLUMN "last_viewed_message_id" UUID,
  ADD COLUMN "last_viewed_at" TIMESTAMPTZ(3);

ALTER TABLE "messages"
  ADD COLUMN "message_type" "message_type",
  ADD COLUMN "input_mode" "agent_input_mode",
  ADD COLUMN "reply_to_id" UUID,
  ADD COLUMN "proposal_id" UUID,
  ADD COLUMN "interaction_status" "agent_interaction_status",
  ADD COLUMN "request_run_id" UUID,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- Provider/model metadata is resolved by Python and therefore cannot be
-- required when a Run is admitted or queued.
ALTER TABLE "agent_request_runs"
  ALTER COLUMN "provider" DROP NOT NULL,
  ALTER COLUMN "model" DROP NOT NULL,
  ALTER COLUMN "prompt_version" DROP NOT NULL,
  ALTER COLUMN "schema_version" DROP NOT NULL,
  ADD COLUMN "source_message_id" UUID,
  ADD COLUMN "source_proposal_id" UUID,
  ADD COLUMN "contract_version" VARCHAR(32) NOT NULL,
  ADD COLUMN "allowed_result_types" "agent_result_type"[] NOT NULL,
  ADD COLUMN "dispatch_attempted_at" TIMESTAMPTZ(3),
  ADD COLUMN "execute_timeout_at" TIMESTAMPTZ(3),
  ADD COLUMN "run_deadline_at" TIMESTAMPTZ(3),
  ADD COLUMN "recovery_eligible_at" TIMESTAMPTZ(3),
  ADD COLUMN "result_type" "agent_result_type",
  ADD COLUMN "result_hash" CHAR(64),
  ADD COLUMN "failed_at" TIMESTAMPTZ(3),
  ADD COLUMN "released_at" TIMESTAMPTZ(3);

CREATE TABLE "agent_request_candidate_refs" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "request_run_id" UUID NOT NULL,
  "candidate_ref" VARCHAR(37) NOT NULL,
  "kind" "agent_candidate_kind" NOT NULL,
  "task_id" UUID,
  "project_id" UUID,
  "target_version" INTEGER NOT NULL,
  "label" VARCHAR(200) NOT NULL,
  "snapshot" JSONB NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "extra" JSONB NOT NULL DEFAULT '{}',

  CONSTRAINT "agent_request_candidate_refs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agent_request_candidate_refs_candidate_ref_format_check" CHECK (
    "candidate_ref" ~ '^cand_[0-9a-f]{32}$'
  ),
  CONSTRAINT "agent_request_candidate_refs_target_version_check" CHECK (
    "target_version" > 0
  ),
  CONSTRAINT "agent_request_candidate_refs_expiry_check" CHECK (
    "expires_at" > "created_at"
  ),
  CONSTRAINT "agent_request_candidate_refs_target_check" CHECK (
    ("kind" = 'TASK' AND "task_id" IS NOT NULL AND "project_id" IS NULL)
    OR
    ("kind" = 'PROJECT' AND "project_id" IS NOT NULL AND "task_id" IS NULL)
  )
);

ALTER TABLE "action_proposals"
  ADD COLUMN "supersedes_proposal_id" UUID,
  ADD COLUMN "action_code" "action_code",
  ADD COLUMN "title" VARCHAR(200),
  ADD COLUMN "model_version" VARCHAR(128),
  ADD COLUMN "prompt_version" VARCHAR(64),
  ADD COLUMN "tool_version" VARCHAR(64),
  ADD COLUMN "intent_confidence" DOUBLE PRECISION,
  ADD COLUMN "last_dismissed_at" TIMESTAMPTZ(3),
  ADD COLUMN "expires_at" TIMESTAMPTZ(3),
  ADD COLUMN "superseded_at" TIMESTAMPTZ(3),
  ADD COLUMN "cancelled_at" TIMESTAMPTZ(3),
  ADD COLUMN "expired_at" TIMESTAMPTZ(3);

-- action_mutations is guaranteed empty by the Run guard and its existing
-- proposal foreign key. Keep the old type/payload columns as nullable rollback
-- compatibility while switching new writes to the formal columns.
ALTER TABLE "action_mutations"
  ALTER COLUMN "type" DROP NOT NULL,
  ALTER COLUMN "payload" DROP NOT NULL,
  ADD COLUMN "user_id" UUID NOT NULL,
  ADD COLUMN "operation" "action_mutation_operation" NOT NULL,
  ADD COLUMN "target_type" "action_target_type" NOT NULL,
  ADD COLUMN "target_id" UUID,
  ADD COLUMN "target_version" INTEGER,
  ADD COLUMN "before_value" JSONB,
  ADD COLUMN "after_value" JSONB NOT NULL,
  ADD COLUMN "field_source" "action_field_source" NOT NULL;

ALTER TABLE "action_executions"
  ALTER COLUMN "status" SET DEFAULT 'EXECUTING',
  ADD COLUMN "confirmed_by" UUID NOT NULL,
  ADD COLUMN "confirmed_at" TIMESTAMPTZ(3) NOT NULL,
  ADD COLUMN "result_snapshot" JSONB,
  ADD COLUMN "failed_at" TIMESTAMPTZ(3);

CREATE INDEX "messages_conversation_cursor_idx"
  ON "messages"("conversation_id", "created_at", "id");
CREATE UNIQUE INDEX "messages_id_user_id_key"
  ON "messages"("id", "user_id");
CREATE UNIQUE INDEX "messages_id_conversation_id_user_id_key"
  ON "messages"("id", "conversation_id", "user_id");
CREATE UNIQUE INDEX "messages_request_run_id_user_id_key"
  ON "messages"("request_run_id", "user_id");
CREATE UNIQUE INDEX "messages_proposal_id_user_id_key"
  ON "messages"("proposal_id", "user_id");

CREATE INDEX "conversation_sessions_last_viewed_idx"
  ON "conversation_sessions"("last_viewed_message_id", "user_id");

CREATE UNIQUE INDEX "agent_request_runs_reservation_id_user_id_key"
  ON "agent_request_runs"("reservation_id", "user_id");
CREATE INDEX "agent_request_runs_status_recovery_idx"
  ON "agent_request_runs"("status", "recovery_eligible_at");

CREATE UNIQUE INDEX "agent_request_candidate_refs_candidate_ref_key"
  ON "agent_request_candidate_refs"("candidate_ref");
CREATE UNIQUE INDEX "agent_request_candidate_refs_run_ref_key"
  ON "agent_request_candidate_refs"("request_run_id", "candidate_ref");
CREATE INDEX "agent_request_candidate_refs_run_kind_idx"
  ON "agent_request_candidate_refs"("request_run_id", "kind");
CREATE INDEX "agent_request_candidate_refs_user_expires_idx"
  ON "agent_request_candidate_refs"("user_id", "expires_at");

CREATE UNIQUE INDEX "action_proposals_request_run_id_user_id_key"
  ON "action_proposals"("request_run_id", "user_id");
CREATE UNIQUE INDEX "action_proposals_supersedes_user_id_key"
  ON "action_proposals"("supersedes_proposal_id", "user_id");
CREATE INDEX "action_proposals_user_expires_idx"
  ON "action_proposals"("user_id", "expires_at");

CREATE UNIQUE INDEX "action_mutations_id_user_id_key"
  ON "action_mutations"("id", "user_id");

ALTER TABLE "action_mutations"
  DROP CONSTRAINT "action_mutations_proposal_id_fkey";

ALTER TABLE "conversation_sessions"
  ADD CONSTRAINT "conversation_sessions_last_viewed_message_id_id_user_id_fkey"
    FOREIGN KEY ("last_viewed_message_id", "id", "user_id")
    REFERENCES "messages"("id", "conversation_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "conversation_sessions_last_viewed_check" CHECK (
    ("last_viewed_message_id" IS NULL AND "last_viewed_at" IS NULL)
    OR ("last_viewed_message_id" IS NOT NULL AND "last_viewed_at" IS NOT NULL)
  );

ALTER TABLE "messages"
  ADD CONSTRAINT "messages_reply_to_id_user_id_fkey"
    FOREIGN KEY ("reply_to_id", "user_id")
    REFERENCES "messages"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "messages_proposal_id_user_id_fkey"
    FOREIGN KEY ("proposal_id", "user_id")
    REFERENCES "action_proposals"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "messages_request_run_id_user_id_fkey"
    FOREIGN KEY ("request_run_id", "user_id")
    REFERENCES "agent_request_runs"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "messages_version_positive_check" CHECK ("version" > 0),
  ADD CONSTRAINT "messages_reply_not_self_check" CHECK (
    "reply_to_id" IS NULL OR "reply_to_id" <> "id"
  ),
  ADD CONSTRAINT "messages_formal_shape_check" CHECK (
    "message_type" IS NULL
    OR (
      "message_type" = 'USER_INPUT'
      AND "role" = 'USER'
      AND "input_mode" IN ('TEXT', 'VOICE', 'CHOICE')
      AND "proposal_id" IS NULL
      AND "interaction_status" IS NULL
    )
    OR (
      "message_type" = 'AI_REPLY'
      AND "role" = 'ASSISTANT'
      AND "input_mode" = 'SYSTEM'
      AND "proposal_id" IS NULL
      AND "interaction_status" IS NULL
    )
    OR (
      "message_type" = 'QUESTION'
      AND "role" = 'ASSISTANT'
      AND "input_mode" = 'SYSTEM'
      AND "proposal_id" IS NULL
      AND "interaction_status" IS NOT NULL
    )
    OR (
      "message_type" = 'ACTION_CONFIRM'
      AND "role" = 'ASSISTANT'
      AND "input_mode" = 'SYSTEM'
      AND "proposal_id" IS NOT NULL
      AND "interaction_status" IS NULL
    )
  );

ALTER TABLE "agent_request_runs"
  ADD CONSTRAINT "agent_request_runs_source_message_id_user_id_fkey"
    FOREIGN KEY ("source_message_id", "user_id")
    REFERENCES "messages"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "agent_request_runs_source_proposal_id_user_id_fkey"
    FOREIGN KEY ("source_proposal_id", "user_id")
    REFERENCES "action_proposals"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "agent_request_runs_reservation_id_user_id_fkey"
    FOREIGN KEY ("reservation_id", "user_id")
    REFERENCES "ai_point_transactions"("reservation_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "agent_request_runs_allowed_results_check" CHECK (
    cardinality("allowed_result_types") BETWEEN 1 AND 5
    AND (
      "result_type" IS NULL
      OR "result_type" = ANY("allowed_result_types")
    )
  ),
  ADD CONSTRAINT "agent_request_runs_source_check" CHECK (
    num_nonnulls("source_message_id", "source_proposal_id") <= 1
  ),
  ADD CONSTRAINT "agent_request_runs_resolved_metadata_check" CHECK (
    num_nonnulls("provider", "model", "prompt_version", "schema_version") IN (0, 4)
  ),
  ADD CONSTRAINT "agent_request_runs_result_consistency_check" CHECK (
    (
      num_nonnulls("result_type", "result_payload", "result_hash", "result_persisted_at") = 0
      AND "settled_at" IS NULL
    )
    OR (
      num_nonnulls("result_type", "result_payload", "result_hash", "result_persisted_at") = 4
      AND "provider" IS NOT NULL
      AND "result_hash" ~ '^[0-9a-f]{64}$'
    )
  ),
  ADD CONSTRAINT "agent_request_runs_dispatch_window_check" CHECK (
    (
      "dispatch_attempted_at" IS NULL
      AND "execute_timeout_at" IS NULL
      AND "run_deadline_at" IS NULL
      AND "recovery_eligible_at" IS NULL
    )
    OR (
      "dispatch_attempted_at" IS NOT NULL
      AND "execute_timeout_at" IS NOT NULL
      AND "run_deadline_at" IS NOT NULL
      AND "recovery_eligible_at" IS NOT NULL
      AND "dispatch_attempted_at" < "execute_timeout_at"
      AND "execute_timeout_at" < "run_deadline_at"
      AND "run_deadline_at" < "recovery_eligible_at"
    )
  ),
  ADD CONSTRAINT "agent_request_runs_state_check" CHECK (
    (
      "status" IN ('QUEUED', 'RUNNING')
      AND "result_persisted_at" IS NULL
      AND "settled_at" IS NULL
      AND "failed_at" IS NULL
      AND "released_at" IS NULL
      AND ("status" <> 'RUNNING' OR "dispatch_attempted_at" IS NOT NULL)
    )
    OR (
      "status" IN ('RESULT_PERSISTED', 'SETTLING')
      AND "result_persisted_at" IS NOT NULL
      AND "settled_at" IS NULL
      AND "failed_at" IS NULL
      AND "released_at" IS NULL
    )
    OR (
      "status" = 'SUCCEEDED'
      AND "result_persisted_at" IS NOT NULL
      AND "settled_at" IS NOT NULL
      AND "failed_at" IS NULL
      AND "released_at" IS NULL
    )
    OR (
      "status" = 'FAILED'
      AND "result_persisted_at" IS NULL
      AND "settled_at" IS NULL
      AND "failed_at" IS NOT NULL
      AND "released_at" IS NULL
    )
    OR (
      "status" = 'RELEASED'
      AND "result_persisted_at" IS NULL
      AND "settled_at" IS NULL
      AND "failed_at" IS NOT NULL
      AND "released_at" IS NOT NULL
    )
  );

ALTER TABLE "agent_request_candidate_refs"
  ADD CONSTRAINT "agent_request_candidate_refs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "agent_request_candidate_refs_request_run_id_user_id_fkey"
    FOREIGN KEY ("request_run_id", "user_id")
    REFERENCES "agent_request_runs"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "agent_request_candidate_refs_task_id_user_id_fkey"
    FOREIGN KEY ("task_id", "user_id")
    REFERENCES "tasks"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "agent_request_candidate_refs_project_id_user_id_fkey"
    FOREIGN KEY ("project_id", "user_id")
    REFERENCES "projects"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "action_proposals"
  ADD CONSTRAINT "action_proposals_supersedes_proposal_id_user_id_fkey"
    FOREIGN KEY ("supersedes_proposal_id", "user_id")
    REFERENCES "action_proposals"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "action_proposals_title_code_check" CHECK (
    ("action_code" IS NULL AND "title" IS NULL)
    OR ("action_code" IS NOT NULL AND "title" IS NOT NULL)
  ),
  ADD CONSTRAINT "action_proposals_generation_metadata_check" CHECK (
    num_nonnulls("model_version", "prompt_version", "tool_version") IN (0, 3)
  ),
  ADD CONSTRAINT "action_proposals_intent_confidence_check" CHECK (
    "intent_confidence" IS NULL
    OR ("intent_confidence" >= 0 AND "intent_confidence" <= 1)
  ),
  ADD CONSTRAINT "action_proposals_expiry_check" CHECK (
    "expires_at" IS NULL OR "expires_at" > "created_at"
  ),
  ADD CONSTRAINT "action_proposals_not_self_superseding_check" CHECK (
    "supersedes_proposal_id" IS NULL OR "supersedes_proposal_id" <> "id"
  ),
  ADD CONSTRAINT "action_proposals_lifecycle_timestamps_check" CHECK (
    ("status" = 'SUPERSEDED') = ("superseded_at" IS NOT NULL)
    AND ("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL)
    AND ("status" = 'EXPIRED') = ("expired_at" IS NOT NULL)
  );

ALTER TABLE "action_mutations"
  ADD CONSTRAINT "action_mutations_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "action_mutations_proposal_id_user_id_fkey"
    FOREIGN KEY ("proposal_id", "user_id")
    REFERENCES "action_proposals"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "action_mutations_target_version_check" CHECK (
    "target_version" IS NULL OR "target_version" > 0
  ),
  ADD CONSTRAINT "action_mutations_formal_shape_check" CHECK (
    (
      "operation" = 'CREATE'
      AND "target_id" IS NULL
      AND "target_version" IS NULL
      AND "before_value" IS NULL
    )
    OR (
      "operation" <> 'CREATE'
      AND "target_id" IS NOT NULL
      AND "target_version" IS NOT NULL
      AND "before_value" IS NOT NULL
    )
  );

ALTER TABLE "action_executions"
  ADD CONSTRAINT "action_executions_confirmer_check" CHECK (
    "confirmed_by" = "user_id"
  ),
  ADD CONSTRAINT "action_executions_state_check" CHECK (
    (
      "status" IN ('EXECUTING', 'RUNNING')
      AND "executed_at" IS NULL
      AND "failed_at" IS NULL
      AND "result_snapshot" IS NULL
    )
    OR (
      "status" = 'SUCCEEDED'
      AND "executed_at" IS NOT NULL
      AND "failed_at" IS NULL
      AND "error_code" IS NULL
      AND "result_snapshot" IS NOT NULL
    )
    OR (
      "status" = 'FAILED'
      AND "executed_at" IS NULL
      AND "failed_at" IS NOT NULL
      AND "error_code" IS NOT NULL
      AND "result_snapshot" IS NULL
    )
    OR (
      "status" IN ('ROLLED_BACK', 'UNDONE')
      AND "executed_at" IS NOT NULL
      AND "result_snapshot" IS NOT NULL
    )
  );

ALTER TABLE "ai_point_transactions"
  ADD CONSTRAINT "ai_point_transactions_session_id_user_id_fkey"
    FOREIGN KEY ("session_id", "user_id")
    REFERENCES "conversation_sessions"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_point_transactions_message_id_user_id_fkey"
    FOREIGN KEY ("message_id", "user_id")
    REFERENCES "messages"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_point_transactions_proposal_id_user_id_fkey"
    FOREIGN KEY ("proposal_id", "user_id")
    REFERENCES "action_proposals"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
