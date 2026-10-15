-- Leads: one work list of potential partners for the internal console —
-- filled automatically from the sign-up form, demo requests and the free
-- tools, or by hand. And billing on partners: the free trial's dates and the
-- day paid through, kept by platform staff.
--
-- Additive: two enums, one new table, three nullable columns. The inserts at
-- the end only read existing rows to seed the list, and skip anything already
-- there, so the migration is safe to re-run.

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('signup', 'demo', 'tools', 'manual');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('new', 'contacted', 'interested', 'partner', 'lost');

-- AlterTable
ALTER TABLE "partners" ADD COLUMN     "paidUntil" DATE,
ADD COLUMN     "trialEndsAt" DATE,
ADD COLUMN     "trialStartedAt" DATE;

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "source" "LeadSource" NOT NULL,
    "sourceRef" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'new',
    "name" TEXT,
    "company" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "instagram" TEXT,
    "contact" TEXT,
    "context" TEXT,
    "tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sessionId" TEXT,
    "notes" TEXT,
    "partnerId" TEXT,
    "createdById" TEXT,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leads_status_lastActivityAt_idx" ON "leads"("status", "lastActivityAt");

-- CreateIndex
CREATE INDEX "leads_lastActivityAt_idx" ON "leads"("lastActivityAt");

-- CreateIndex
CREATE UNIQUE INDEX "leads_source_sourceRef_key" ON "leads"("source", "sourceRef");

-- Seed: sign-ups that were never activated.
INSERT INTO "leads" ("id", "source", "sourceRef", "status", "name", "company", "phone", "email", "context", "lastActivityAt", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'signup'::"LeadSource", p."id", 'new'::"LeadStatus",
       p."adminName", p."companyName", p."adminPhone", p."adminEmail",
       concat_ws(' · ', NULLIF(btrim(p."companyType"), ''), CASE WHEN p."slug" <> '' THEN '/' || p."slug" END),
       p."createdAt", p."createdAt", (now() AT TIME ZONE 'UTC')
FROM "pending_registrations" p
WHERE p."consumedAt" IS NULL
ON CONFLICT ("source", "sourceRef") DO NOTHING;

-- Seed: demo requests. One already marked done was answered: contacted.
INSERT INTO "leads" ("id", "source", "sourceRef", "status", "name", "company", "phone", "email", "context", "lastActivityAt", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'demo'::"LeadSource", d."id",
       (CASE WHEN d."status" = 'done' THEN 'contacted' ELSE 'new' END)::"LeadStatus",
       d."name", d."company", d."phone", d."email", d."notes",
       d."createdAt", d."createdAt", (now() AT TIME ZONE 'UTC')
FROM "demo_requests" d
ON CONFLICT ("source", "sourceRef") DO NOTHING;

-- Seed: everyone who exported from the tools with a contact line (or, before
-- the line was sent whole, an Instagram username) — one lead per contact.
-- Not staff, not bots, and not the examples' own @anna.beauty.
WITH exports AS (
  SELECT e."createdAt", e."sessionId"::text AS "sessionId", e."props"->>'tool' AS tool,
         e."props"->>'ig' AS ig,
         COALESCE(NULLIF(btrim(e."props"->>'contact'), ''), '@' || (e."props"->>'ig')) AS contact
  FROM "site_events" e
  JOIN "site_sessions" s ON s."id" = e."sessionId"
  WHERE e."name" = 'tool_export'
    AND s."isBot" IS NOT TRUE AND s."isInternal" IS NOT TRUE
    AND (NULLIF(btrim(e."props"->>'contact'), '') IS NOT NULL OR e."props"->>'ig' IS NOT NULL)
), keyed AS (
  SELECT exports.*, lower(regexp_replace(btrim(contact), '\s+', ' ', 'g')) AS key FROM exports
)
INSERT INTO "leads" ("id", "source", "sourceRef", "status", "contact", "instagram", "tools", "sessionId", "lastActivityAt", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'tools'::"LeadSource", key, 'new'::"LeadStatus",
       (array_agg(contact ORDER BY "createdAt" DESC))[1],
       (array_agg(ig ORDER BY "createdAt" DESC) FILTER (WHERE ig IS NOT NULL))[1],
       COALESCE(array_agg(DISTINCT tool) FILTER (WHERE tool IS NOT NULL), ARRAY[]::TEXT[]),
       (array_agg("sessionId" ORDER BY "createdAt" DESC))[1],
       max("createdAt"), min("createdAt"), (now() AT TIME ZONE 'UTC')
FROM keyed
WHERE key <> '@anna.beauty'
GROUP BY key
ON CONFLICT ("source", "sourceRef") DO NOTHING;
