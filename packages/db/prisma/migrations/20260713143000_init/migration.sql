-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "identity_type" AS ENUM ('USERNAME', 'PHONE', 'WECHAT');

-- CreateEnum
CREATE TYPE "identity_status" AS ENUM ('ACTIVE', 'DEPRECATED', 'DISABLED');

-- CreateEnum
CREATE TYPE "contact_type" AS ENUM ('PHONE');

-- CreateEnum
CREATE TYPE "contact_status" AS ENUM ('UNVERIFIED', 'VERIFIED', 'DISABLED');

-- CreateEnum
CREATE TYPE "project_status" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "task_status" AS ENUM ('TODO', 'COMPLETED');

-- CreateEnum
CREATE TYPE "task_priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "record_source" AS ENUM ('MANUAL', 'AGENT');

-- CreateEnum
CREATE TYPE "conversation_status" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "message_role" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "agent_request_status" AS ENUM ('QUEUED', 'RUNNING', 'RESULT_PERSISTED', 'SETTLING', 'SUCCEEDED', 'FAILED', 'RELEASED');

-- CreateEnum
CREATE TYPE "action_proposal_status" AS ENUM ('DRAFT', 'READY', 'EXECUTED', 'DISMISSED', 'STALE');

-- CreateEnum
CREATE TYPE "action_execution_status" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "undo_operation_status" AS ENUM ('AVAILABLE', 'EXECUTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ai_point_transaction_type" AS ENUM ('NEW_USER_GRANT', 'DAILY_TOP_UP', 'RESERVATION', 'DEBIT', 'RELEASE', 'REFUND', 'ADMIN_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "transaction_status" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "nickname" VARCHAR(10) NOT NULL DEFAULT '用户',
    "status" "user_status" NOT NULL DEFAULT 'ACTIVE',
    "locale" VARCHAR(16) NOT NULL DEFAULT 'zh-CN',
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
    "ai_points" INTEGER NOT NULL DEFAULT 0,
    "credential_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "extra" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_identities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "identity_type" NOT NULL,
    "identifier" VARCHAR(255) NOT NULL,
    "identifier_normalized" VARCHAR(255) NOT NULL,
    "status" "identity_status" NOT NULL DEFAULT 'ACTIVE',
    "verified_at" TIMESTAMPTZ(3),
    "last_used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "extra" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "user_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_password_credentials" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "password_hash" TEXT NOT NULL,
    "password_changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "credential_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "extra" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "user_password_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_contacts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "contact_type" NOT NULL,
    "value" VARCHAR(255) NOT NULL,
    "value_normalized" VARCHAR(255) NOT NULL,
    "verified_at" TIMESTAMPTZ(3),
    "status" "contact_status" NOT NULL DEFAULT 'UNVERIFIED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "extra" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "user_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "credential_version" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "last_seen_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "extra" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit_events" (
    "id" UUID NOT NULL,
    "operator" VARCHAR(128) NOT NULL,
    "action_type" VARCHAR(64) NOT NULL,
    "target_user_id" UUID NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "request_payload" JSONB NOT NULL,
    "result_payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "extra" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "admin_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "name_normalized" VARCHAR(40) NOT NULL,
    "color_key" VARCHAR(24) NOT NULL,
    "status" "project_status" NOT NULL DEFAULT 'ACTIVE',
    "archived_at" TIMESTAMPTZ(3),
    "source" "record_source" NOT NULL DEFAULT 'MANUAL',
    "source_action_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "extra" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "project_id" UUID,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "task_status" NOT NULL DEFAULT 'TODO',
    "priority" "task_priority" NOT NULL DEFAULT 'MEDIUM',
    "scheduled_at" TIMESTAMPTZ(3),
    "deadline_at" TIMESTAMPTZ(3),
    "reminder_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "source" "record_source" NOT NULL DEFAULT 'MANUAL',
    "source_action_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "extra" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "conversation_status" NOT NULL DEFAULT 'ACTIVE',
    "title" VARCHAR(200),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "extra" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "conversation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "role" "message_role" NOT NULL,
    "content" TEXT NOT NULL,
    "structured_data" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "extra" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_request_runs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "conversation_id" UUID,
    "status" "agent_request_status" NOT NULL DEFAULT 'QUEUED',
    "capability_code" VARCHAR(64) NOT NULL,
    "endpoint_code" VARCHAR(128) NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "model" VARCHAR(128) NOT NULL,
    "prompt_version" VARCHAR(64) NOT NULL,
    "schema_version" VARCHAR(64) NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "reservation_id" UUID,
    "provider_request_id" VARCHAR(255),
    "result_payload" JSONB,
    "error_code" VARCHAR(128),
    "error_detail" JSONB,
    "model_started_at" TIMESTAMPTZ(3),
    "result_persisted_at" TIMESTAMPTZ(3),
    "settled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "extra" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "agent_request_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_proposals" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "conversation_id" UUID,
    "request_run_id" UUID NOT NULL,
    "status" "action_proposal_status" NOT NULL DEFAULT 'DRAFT',
    "summary" VARCHAR(500) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "extra" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "action_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_mutations" (
    "id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "extra" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "action_mutations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_executions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "status" "action_execution_status" NOT NULL DEFAULT 'RUNNING',
    "idempotency_key" VARCHAR(128) NOT NULL,
    "error_code" VARCHAR(128),
    "error_detail" JSONB,
    "executed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "extra" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "action_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "undo_operations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "action_execution_id" UUID,
    "scope" VARCHAR(64) NOT NULL,
    "target_type" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "undo_operation_status" NOT NULL DEFAULT 'AVAILABLE',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "executed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "extra" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "undo_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_evaluation_events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "request_run_id" UUID NOT NULL,
    "event_type" VARCHAR(64) NOT NULL,
    "passed" BOOLEAN,
    "score" DOUBLE PRECISION,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "extra" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "agent_evaluation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_point_transactions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "ai_point_transaction_type" NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "transaction_status" NOT NULL DEFAULT 'PENDING',
    "request_id" VARCHAR(128),
    "reservation_id" UUID,
    "reversal_of" UUID,
    "capability_code" VARCHAR(64),
    "reason_code" VARCHAR(128) NOT NULL,
    "operator" VARCHAR(128),
    "reason" VARCHAR(500),
    "config_version" INTEGER NOT NULL,
    "config_hash" CHAR(64) NOT NULL,
    "unit_cost" INTEGER NOT NULL,
    "balance_before" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "local_date" DATE,
    "expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "extra" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "ai_point_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "scope" VARCHAR(128) NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "response_status" INTEGER,
    "response_snapshot" JSONB,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "extra" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_identities_user_status_idx" ON "user_identities"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "user_identities_type_identifier_normalized_key" ON "user_identities"("type", "identifier_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "user_password_credentials_user_id_key" ON "user_password_credentials"("user_id");

-- CreateIndex
CREATE INDEX "user_contacts_user_type_idx" ON "user_contacts"("user_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "auth_sessions_user_expires_idx" ON "auth_sessions"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "admin_audit_events_target_created_idx" ON "admin_audit_events"("target_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "projects_user_status_idx" ON "projects"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "projects_id_user_id_key" ON "projects"("id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_active_name_key" ON "projects"("user_id", "name_normalized") WHERE ("status" = 'ACTIVE');

-- CreateIndex
CREATE INDEX "tasks_user_list_idx" ON "tasks"("user_id", "deleted_at", "status", "scheduled_at");

-- CreateIndex
CREATE INDEX "tasks_user_project_status_idx" ON "tasks"("user_id", "project_id", "status");

-- CreateIndex
CREATE INDEX "conversation_sessions_user_updated_idx" ON "conversation_sessions"("user_id", "updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "conversation_sessions_id_user_id_key" ON "conversation_sessions"("id", "user_id");

-- CreateIndex
CREATE INDEX "messages_conversation_created_idx" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_user_created_idx" ON "messages"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "agent_request_runs_status_updated_idx" ON "agent_request_runs"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "agent_request_runs_idempotency_key" ON "agent_request_runs"("user_id", "endpoint_code", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "agent_request_runs_id_user_id_key" ON "agent_request_runs"("id", "user_id");

-- CreateIndex
CREATE INDEX "action_proposals_user_status_idx" ON "action_proposals"("user_id", "status", "updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "action_proposals_id_user_id_key" ON "action_proposals"("id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "action_mutations_proposal_ordinal_key" ON "action_mutations"("proposal_id", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "action_executions_user_idempotency_key" ON "action_executions"("user_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "action_executions_id_user_id_key" ON "action_executions"("id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "action_executions_proposal_user_key" ON "action_executions"("proposal_id", "user_id");

-- CreateIndex
CREATE INDEX "undo_operations_user_status_expires_idx" ON "undo_operations"("user_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "agent_evaluation_events_run_created_idx" ON "agent_evaluation_events"("request_run_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_point_transactions_user_created_idx" ON "ai_point_transactions"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ai_point_transactions_reservation_idx" ON "ai_point_transactions"("reservation_id");

-- CreateIndex
CREATE INDEX "ai_point_transactions_request_idx" ON "ai_point_transactions"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_point_transactions_daily_top_up_key" ON "ai_point_transactions"("user_id", "type", "local_date") WHERE ("type" = 'DAILY_TOP_UP' AND "local_date" IS NOT NULL);

-- CreateIndex
CREATE INDEX "idempotency_records_expires_idx" ON "idempotency_records"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_user_scope_key" ON "idempotency_records"("user_id", "scope", "key");

-- AddForeignKey
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_password_credentials" ADD CONSTRAINT "user_password_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_contacts" ADD CONSTRAINT "user_contacts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_audit_events" ADD CONSTRAINT "admin_audit_events_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_user_id_fkey" FOREIGN KEY ("project_id", "user_id") REFERENCES "projects"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_sessions" ADD CONSTRAINT "conversation_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_user_id_fkey" FOREIGN KEY ("conversation_id", "user_id") REFERENCES "conversation_sessions"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_request_runs" ADD CONSTRAINT "agent_request_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_request_runs" ADD CONSTRAINT "agent_request_runs_conversation_id_user_id_fkey" FOREIGN KEY ("conversation_id", "user_id") REFERENCES "conversation_sessions"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_proposals" ADD CONSTRAINT "action_proposals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_proposals" ADD CONSTRAINT "action_proposals_conversation_id_user_id_fkey" FOREIGN KEY ("conversation_id", "user_id") REFERENCES "conversation_sessions"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_proposals" ADD CONSTRAINT "action_proposals_request_run_id_user_id_fkey" FOREIGN KEY ("request_run_id", "user_id") REFERENCES "agent_request_runs"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_mutations" ADD CONSTRAINT "action_mutations_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "action_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_executions" ADD CONSTRAINT "action_executions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_executions" ADD CONSTRAINT "action_executions_proposal_id_user_id_fkey" FOREIGN KEY ("proposal_id", "user_id") REFERENCES "action_proposals"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "undo_operations" ADD CONSTRAINT "undo_operations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "undo_operations" ADD CONSTRAINT "undo_operations_action_execution_id_user_id_fkey" FOREIGN KEY ("action_execution_id", "user_id") REFERENCES "action_executions"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_evaluation_events" ADD CONSTRAINT "agent_evaluation_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_evaluation_events" ADD CONSTRAINT "agent_evaluation_events_request_run_id_user_id_fkey" FOREIGN KEY ("request_run_id", "user_id") REFERENCES "agent_request_runs"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_point_transactions" ADD CONSTRAINT "ai_point_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Domain invariants that Prisma Schema Language cannot express.
ALTER TABLE "users"
  ADD CONSTRAINT "users_nickname_length_check" CHECK (char_length("nickname") BETWEEN 1 AND 10),
  ADD CONSTRAINT "users_ai_points_nonnegative_check" CHECK ("ai_points" >= 0),
  ADD CONSTRAINT "users_credential_version_positive_check" CHECK ("credential_version" > 0);

ALTER TABLE "user_password_credentials"
  ADD CONSTRAINT "user_password_credentials_version_positive_check" CHECK ("credential_version" > 0);

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_version_positive_check" CHECK ("version" > 0),
  ADD CONSTRAINT "projects_archive_state_check" CHECK (
    ("status" = 'ACTIVE' AND "archived_at" IS NULL)
    OR ("status" = 'ARCHIVED' AND "archived_at" IS NOT NULL)
  );

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_version_positive_check" CHECK ("version" > 0),
  ADD CONSTRAINT "tasks_completion_state_check" CHECK (
    ("status" = 'TODO' AND "completed_at" IS NULL)
    OR ("status" = 'COMPLETED' AND "completed_at" IS NOT NULL)
  );

ALTER TABLE "action_proposals"
  ADD CONSTRAINT "action_proposals_version_positive_check" CHECK ("version" > 0);

ALTER TABLE "action_mutations"
  ADD CONSTRAINT "action_mutations_ordinal_nonnegative_check" CHECK ("ordinal" >= 0);

ALTER TABLE "undo_operations"
  ADD CONSTRAINT "undo_operations_expiry_check" CHECK ("expires_at" > "created_at");

ALTER TABLE "agent_evaluation_events"
  ADD CONSTRAINT "agent_evaluation_events_score_check" CHECK ("score" IS NULL OR ("score" >= 0 AND "score" <= 1));

ALTER TABLE "ai_point_transactions"
  ADD CONSTRAINT "ai_point_transactions_config_version_positive_check" CHECK ("config_version" > 0),
  ADD CONSTRAINT "ai_point_transactions_unit_cost_nonnegative_check" CHECK ("unit_cost" >= 0),
  ADD CONSTRAINT "ai_point_transactions_balances_nonnegative_check" CHECK ("balance_before" >= 0 AND "balance_after" >= 0);

ALTER TABLE "idempotency_records"
  ADD CONSTRAINT "idempotency_records_response_status_check" CHECK (
    "response_status" IS NULL OR "response_status" BETWEEN 100 AND 599
  );
