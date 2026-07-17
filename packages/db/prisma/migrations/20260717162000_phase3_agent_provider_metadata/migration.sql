ALTER TABLE "agent_request_runs"
ADD COLUMN "repair_attempts" SMALLINT;

ALTER TABLE "agent_request_runs"
ADD CONSTRAINT "agent_request_runs_repair_attempts_check"
CHECK ("repair_attempts" IS NULL OR "repair_attempts" BETWEEN 0 AND 1);
