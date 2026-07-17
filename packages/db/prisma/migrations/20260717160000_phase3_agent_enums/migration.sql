-- Phase 3 Agent enum expansion. PostgreSQL requires newly added enum values
-- to commit before a later migration can use them in defaults and CHECKs.
ALTER TYPE "conversation_status" ADD VALUE IF NOT EXISTS 'CLOSED';

ALTER TYPE "action_proposal_status" ADD VALUE IF NOT EXISTS 'AWAITING_CONFIRMATION' AFTER 'DRAFT';
ALTER TYPE "action_proposal_status" ADD VALUE IF NOT EXISTS 'SUPERSEDED' AFTER 'AWAITING_CONFIRMATION';
ALTER TYPE "action_proposal_status" ADD VALUE IF NOT EXISTS 'CANCELLED' AFTER 'SUPERSEDED';
ALTER TYPE "action_proposal_status" ADD VALUE IF NOT EXISTS 'EXECUTING' AFTER 'CANCELLED';
ALTER TYPE "action_proposal_status" ADD VALUE IF NOT EXISTS 'FAILED' AFTER 'EXECUTED';
ALTER TYPE "action_proposal_status" ADD VALUE IF NOT EXISTS 'EXPIRED' AFTER 'FAILED';

ALTER TYPE "action_execution_status" ADD VALUE IF NOT EXISTS 'EXECUTING' BEFORE 'RUNNING';
ALTER TYPE "action_execution_status" ADD VALUE IF NOT EXISTS 'ROLLED_BACK' AFTER 'FAILED';
ALTER TYPE "action_execution_status" ADD VALUE IF NOT EXISTS 'UNDONE' AFTER 'ROLLED_BACK';

CREATE TYPE "message_type" AS ENUM (
  'USER_INPUT',
  'AI_REPLY',
  'QUESTION',
  'ACTION_CONFIRM'
);

CREATE TYPE "agent_input_mode" AS ENUM ('TEXT', 'VOICE', 'CHOICE', 'SYSTEM');

CREATE TYPE "agent_interaction_status" AS ENUM (
  'PENDING',
  'ANSWERED',
  'SUPERSEDED',
  'CLOSED'
);

CREATE TYPE "agent_result_type" AS ENUM (
  'REPLY',
  'CLARIFICATION',
  'CANDIDATES',
  'PLAN',
  'ACTION_PROPOSAL'
);

CREATE TYPE "agent_candidate_kind" AS ENUM ('TASK', 'PROJECT');

CREATE TYPE "action_code" AS ENUM (
  'CREATE_TASK',
  'CREATE_PROJECT_TASKS',
  'ORGANIZE_TASKS',
  'UPDATE_TASK',
  'COMPLETE_TASK',
  'RESTORE_TASK',
  'DELETE_TASK'
);

CREATE TYPE "action_mutation_operation" AS ENUM (
  'CREATE',
  'UPDATE',
  'COMPLETE',
  'RESTORE',
  'SOFT_DELETE'
);

CREATE TYPE "action_target_type" AS ENUM ('PROJECT', 'TASK');

CREATE TYPE "action_field_source" AS ENUM (
  'USER',
  'AGENT_SUGGESTION',
  'INFERRED'
);
