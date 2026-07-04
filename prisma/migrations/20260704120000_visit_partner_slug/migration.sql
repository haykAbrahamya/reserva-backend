-- Per-partner visit attribution: which salon's public page a view landed on.
ALTER TABLE "visitor_events" ADD COLUMN "partnerSlug" TEXT;

-- Backfill from existing rows:
--  1) tenant subdomain host "<slug>.reserva.am" → slug
--  2) otherwise path "/p/<slug>" (optionally with trailing segments) → slug
-- Reserved/apex hosts (www, app, reserva.am itself, localhost, IPs) yield no
-- subdomain and fall through to the path check.
UPDATE "visitor_events"
SET "partnerSlug" = lower(substring("host" from '^([a-z0-9-]+)\.reserva\.am$'))
WHERE "host" ~ '^[a-z0-9-]+\.reserva\.am$'
  AND lower(substring("host" from '^([a-z0-9-]+)\.reserva\.am$')) NOT IN ('www', 'app', 'api', 'admin', 'demo', 'jenkins');

UPDATE "visitor_events"
SET "partnerSlug" = lower(substring("path" from '^/p/([a-z0-9-]+)'))
WHERE "partnerSlug" IS NULL
  AND "path" ~ '^/p/[a-z0-9-]+';

CREATE INDEX "visitor_events_partnerSlug_createdAt_idx" ON "visitor_events" ("partnerSlug", "createdAt");
