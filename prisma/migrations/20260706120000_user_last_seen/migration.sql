-- Track last backoffice activity (app load / refresh), distinct from lastLogin.
-- Additive, nullable, no backfill — safe on production data.
ALTER TABLE "users" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
