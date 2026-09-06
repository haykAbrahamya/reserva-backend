-- Professional profiles: a photo, a portfolio, and a public switch.
--
-- Additive and non-destructive. Every column carries a DEFAULT, so existing
-- rows are backfilled by Postgres in place and no application code has to cope
-- with a NULL that never existed before.
--
-- `publicProfile` defaults to FALSE deliberately: this migration must not
-- publish anybody. Accounts created so far were made mid-application and hold a
-- name and a phone number; turning them all public would be a privacy change
-- disguised as a schema change.
ALTER TABLE "professionals" ADD COLUMN "avatarUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "professionals" ADD COLUMN "photos" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "professionals" ADD COLUMN "publicProfile" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "professionals" ADD COLUMN "showContact" BOOLEAN NOT NULL DEFAULT false;

-- The directory's leading filter, for the browse page this profile is the
-- groundwork for.
CREATE INDEX "professionals_publicProfile_idx" ON "professionals"("publicProfile");
