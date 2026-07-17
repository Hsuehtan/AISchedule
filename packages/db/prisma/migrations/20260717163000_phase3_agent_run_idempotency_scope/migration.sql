-- Idempotency is scoped and expires after 24 hours. The durable authority is
-- idempotency_records(user_id, scope, key); a permanent Run uniqueness rule
-- would incorrectly reject the same key in another public scope or after TTL.
DROP INDEX "agent_request_runs_idempotency_key";

-- Retain the same lookup shape as a non-unique index for diagnostics and
-- reconciliation without imposing product idempotency semantics on Run history.
CREATE INDEX "agent_request_runs_idempotency_diagnostic_idx"
  ON "agent_request_runs"("user_id", "endpoint_code", "idempotency_key");
