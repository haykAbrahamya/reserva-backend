-- ════════════════════════════════════════════════════════════════════════════
-- Site analytics v1: sessions + events from the public site.
--
-- WHY: `visitor_events` records one row per page view and nothing else, so the
-- console cannot answer the questions the business asks of the public site —
-- where visitors come from, who clicks Book / Call / WhatsApp / Directions,
-- where the booking and sign-up flows lose people. The new tracker
-- (POST /public/pulse) sends sessions and a catalogue of events; this migration
-- creates the two tables it writes to.
--
-- Privacy: neither table has a column for a raw IP or a raw User-Agent. The
-- server derives device/browser/os and country/city and drops the inputs.
--
-- SAFETY: this migration is purely ADDITIVE.
--   • It creates two tables, their indexes and keys. It does NOT alter, rename
--     or drop anything that exists; `site_events.partnerId` is ON DELETE SET
--     NULL, so it can never block deleting a partner.
--   • `visitor_events` is only READ. `/public/visits` and the console's Visits
--     page keep working exactly as before (old cached clients still post there).
--   • The legacy copy below gives the new reports history from day one. It
--     copies a SNAPSHOT of `visitor_events` taken into a temp table: the old
--     backend keeps recording page views while this runs, and those recorded
--     after the snapshot simply stay in `visitor_events` only. The check after
--     the copy therefore counts against the snapshot, never against the live
--     table (which would race with those inserts and fail the deploy).
--   • The copy is deterministic (ids derive from the source rows), and the
--     check aborts the whole migration if a single snapshot row failed to copy.
--     Prisma runs the file as one implicit transaction, so an abort leaves
--     nothing behind.
--
-- ORDER — bulk load, so `partners` is locked for moments, not for the copy:
--   1. both tables, with their primary keys only;
--   2. the legacy copy (snapshot → sessions → events) and its check;
--   3. drop the snapshot;
--   4. the six indexes, built once over the loaded rows (cheaper than
--      maintaining them row by row during the copy);
--   5. LAST, the two foreign keys. Adding a key takes a SHARE ROW EXCLUSIVE
--      lock on the referenced table, held until COMMIT — and the whole file is
--      one transaction. Declared first, `REFERENCES partners` would block every
--      partner insert/update for the entire copy; declared last, only for the
--      keys' validation and the commit.
--
-- Dry runs: on a copy of the local database (467 page views) it applies in
-- well under a second — 467/467 copied into 380 sessions of 340 visitors,
-- `prisma migrate diff` against the schema empty. On a production-sized copy
-- (~300k page views, page views arriving concurrently) the original statement
-- order took ~50 s and exposed the two hazards that the snapshot check and
-- this order now remove.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Tables, primary keys only ────────────────────────────────────────────

-- CreateTable
CREATE TABLE "site_sessions" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "landingPath" TEXT,
    "landingHost" TEXT,
    "referrer" TEXT,
    "referrerHost" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'direct',
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "utmTerm" TEXT,
    "deviceType" TEXT,
    "browser" TEXT,
    "os" TEXT,
    "country" TEXT,
    "city" TEXT,
    "language" TEXT,
    "screenW" INTEGER,
    "screenH" INTEGER,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "site_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_events" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "partnerId" TEXT,
    "path" TEXT,
    "host" TEXT,
    "props" JSONB NOT NULL DEFAULT '{}',
    "clientAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_events_pkey" PRIMARY KEY ("id")
);

-- ── 2. Copy the legacy page views ───────────────────────────────────────────
-- Every `visitor_events` row in the snapshot (the temp table below, taken once
-- and read by every later statement) becomes one `page_view` event. Legacy
-- rows carry no session, so one synthetic session stands for each (IP,
-- User-Agent, Asia/Yerevan calendar day), and one synthetic visitor for each
-- (IP, User-Agent). Both ids are md5 digests prefixed `legacy-`: stable, never
-- colliding with a client uuid, and they let the IP and UA themselves stay
-- behind — neither is copied. Events keep their source id (`legacy-<id>`).
--
-- Derived exactly as the ingestion endpoint derives them for new sessions:
--   referrerHost  hostname of the referrer, lower-case, without "www."
--   channel       from the referrer host (legacy rows have no UTM tags)
--   isBot         the User-Agent matches the same bot pattern
--   props.pt      '/' without a partner → home, '/salons…' → marketplace,
--                 '/signup' → signup, a partner slug or '/p/…' → partner,
--                 anything else → other
--   partnerId     the partner whose slug the visit recorded (null if gone)
-- Session context (landing page, referrer, device, place, language, screen)
-- comes from the session's first page view.
CREATE TEMP TABLE "legacy_page_views" AS
SELECT
  ve."id",
  ve."createdAt",
  ve."path",
  ve."host",
  NULLIF(ve."referrer", '') AS "referrer",
  lower(regexp_replace(
    substring(ve."referrer" from '^[A-Za-z][A-Za-z0-9+.-]*://(?:[^/?#@]*@)?([^/?#:]+)'),
    '^www\.', ''
  )) AS "referrerHost",
  lower(NULLIF(ve."partnerSlug", '')) AS "partnerSlug",
  ve."deviceType",
  ve."browser",
  ve."os",
  ve."country",
  ve."city",
  ve."language",
  ve."screenW",
  ve."screenH",
  'legacy-' || md5(COALESCE(ve."ip", '') || COALESCE(ve."userAgent", '')) AS "visitorId",
  'legacy-' || md5(
    COALESCE(ve."ip", '') || COALESCE(ve."userAgent", '') || '|' ||
    to_char((ve."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Yerevan')::date, 'YYYY-MM-DD')
  ) AS "sessionId",
  COALESCE(ve."userAgent", '') ~* 'bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|headless|lighthouse|pingdom|monitor|python-requests|curl|wget' AS "isBot",
  CASE
    WHEN NULLIF(ve."partnerSlug", '') IS NULL AND ve."path" = '/' THEN 'home'
    WHEN ve."path" LIKE '/salons%' THEN 'marketplace'
    WHEN ve."path" = '/signup' THEN 'signup'
    WHEN NULLIF(ve."partnerSlug", '') IS NOT NULL OR ve."path" LIKE '/p/%' THEN 'partner'
    ELSE 'other'
  END AS "pt"
FROM "visitor_events" ve;

INSERT INTO "site_sessions" (
  "id", "visitorId", "startedAt", "lastSeenAt", "landingPath", "landingHost",
  "referrer", "referrerHost", "channel", "deviceType", "browser", "os",
  "country", "city", "language", "screenW", "screenH", "isBot", "isInternal"
)
SELECT DISTINCT ON (lv."sessionId")
  lv."sessionId",
  lv."visitorId",
  min(lv."createdAt") OVER w,
  max(lv."createdAt") OVER w,
  lv."path",
  lv."host",
  lv."referrer",
  lv."referrerHost",
  CASE
    WHEN lv."referrer" IS NULL THEN 'direct'
    WHEN lv."referrerHost" IS NULL THEN 'other'
    WHEN lv."referrerHost" ~ '(^|\.)instagram\.com$' THEN 'instagram'
    WHEN lv."referrerHost" ~ '(^|\.)(facebook\.com|fb\.me|fb\.com)$' THEN 'facebook'
    WHEN lv."referrerHost" ~ '(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$' THEN 'google'
    WHEN lv."referrerHost" ~ '(^|\.)(bing|yandex|duckduckgo|yahoo)\.[a-z]{2,3}(\.[a-z]{2})?$' THEN 'search'
    WHEN lv."referrerHost" ~ '(^|\.)tiktok\.com$' THEN 'tiktok'
    WHEN lv."referrerHost" ~ '(^|\.)(t\.me|telegram\.org)$' THEN 'telegram'
    WHEN lv."referrerHost" ~ '(^|\.)(wa\.me|whatsapp\.com)$' THEN 'whatsapp'
    WHEN lv."referrerHost" ~ '(^|\.)reserva\.am$' THEN 'reserva'
    ELSE 'other'
  END,
  lv."deviceType",
  lv."browser",
  lv."os",
  lv."country",
  lv."city",
  lv."language",
  lv."screenW",
  lv."screenH",
  lv."isBot",
  false
FROM "legacy_page_views" lv
WINDOW w AS (PARTITION BY lv."sessionId")
-- DISTINCT ON keeps the first row of each session in this order: its landing view.
ORDER BY lv."sessionId", lv."createdAt", lv."id";

INSERT INTO "site_events" (
  "id", "sessionId", "visitorId", "name", "partnerId", "path", "host", "props", "clientAt", "createdAt"
)
SELECT
  'legacy-' || lv."id",
  lv."sessionId",
  lv."visitorId",
  'page_view',
  p."id",
  lv."path",
  lv."host",
  jsonb_build_object('pt', lv."pt"),
  NULL,
  lv."createdAt"
FROM "legacy_page_views" lv
LEFT JOIN "partners" p ON p."slug" = lv."partnerSlug";

-- Abort (and roll the whole migration back) if any snapshot row was missed.
-- Counted from the snapshot, NOT from "visitor_events": under READ COMMITTED a
-- new statement would also see page views committed since the snapshot.
DO $$
DECLARE
  source_rows integer;
  copied integer;
BEGIN
  SELECT count(*) INTO source_rows FROM "legacy_page_views";
  SELECT count(*) INTO copied FROM "site_events" WHERE "id" LIKE 'legacy-%';
  IF copied <> source_rows THEN
    RAISE EXCEPTION 'legacy page-view copy incomplete: % of % row(s) copied', copied, source_rows;
  END IF;
END $$;

-- ── 3. Drop the snapshot ────────────────────────────────────────────────────
DROP TABLE "legacy_page_views";

-- ── 4. Indexes, built once over the loaded rows ─────────────────────────────

-- CreateIndex
CREATE INDEX "site_sessions_startedAt_idx" ON "site_sessions"("startedAt");
CREATE INDEX "site_sessions_visitorId_idx" ON "site_sessions"("visitorId");
CREATE INDEX "site_events_createdAt_idx" ON "site_events"("createdAt");
CREATE INDEX "site_events_name_createdAt_idx" ON "site_events"("name", "createdAt");
CREATE INDEX "site_events_partnerId_createdAt_idx" ON "site_events"("partnerId", "createdAt");
CREATE INDEX "site_events_sessionId_createdAt_idx" ON "site_events"("sessionId", "createdAt");

-- ── 5. Foreign keys, last ───────────────────────────────────────────────────

-- AddForeignKey (between the two new tables: locks nothing else)
ALTER TABLE "site_events" ADD CONSTRAINT "site_events_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "site_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The key on `partners` needs the lock it takes anyway; take it a moment
-- early, so that no partner can disappear between the next two statements.
-- A partner deleted while the copy ran (there was no key yet to stop it)
-- would otherwise fail the key's validation and the deploy; its events lose
-- their attribution instead — exactly what ON DELETE SET NULL would have
-- done. Normally this updates nothing.
LOCK TABLE "partners" IN SHARE ROW EXCLUSIVE MODE;
UPDATE "site_events" e SET "partnerId" = NULL
WHERE e."partnerId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "partners" p WHERE p."id" = e."partnerId");

-- AddForeignKey
ALTER TABLE "site_events" ADD CONSTRAINT "site_events_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;
