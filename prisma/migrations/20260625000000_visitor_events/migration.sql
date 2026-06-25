-- One row per page view on the public site. Enrichment fields are derived
-- server-side (IP -> geo, User-Agent -> device/browser/os), so all nullable.
CREATE TABLE "visitor_events" (
  "id"         TEXT NOT NULL,
  "ip"         TEXT,
  "userAgent"  TEXT,
  "deviceType" TEXT,
  "browser"    TEXT,
  "browserVer" TEXT,
  "os"         TEXT,
  "osVer"      TEXT,
  "path"       TEXT,
  "host"       TEXT,
  "referrer"   TEXT,
  "language"   TEXT,
  "screenW"    INTEGER,
  "screenH"    INTEGER,
  "country"    TEXT,
  "city"       TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "visitor_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "visitor_events_createdAt_idx" ON "visitor_events"("createdAt");
