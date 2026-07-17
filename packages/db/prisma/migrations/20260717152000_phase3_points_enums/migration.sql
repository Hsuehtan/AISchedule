-- Enum expansion must commit before the following migration can use the new
-- values in partial indexes and CHECK constraints on PostgreSQL.
ALTER TYPE "ai_point_transaction_type" ADD VALUE IF NOT EXISTS 'GRANT' BEFORE 'NEW_USER_GRANT';
ALTER TYPE "ai_point_transaction_type" ADD VALUE IF NOT EXISTS 'ADJUSTMENT' BEFORE 'ADMIN_ADJUSTMENT';
ALTER TYPE "ai_point_transaction_type" ADD VALUE IF NOT EXISTS 'EXPIRE' BEFORE 'REFUND';
ALTER TYPE "transaction_status" ADD VALUE IF NOT EXISTS 'CANCELLED' BEFORE 'EXPIRED';
