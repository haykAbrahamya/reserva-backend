-- Marketplace listing flag for the public /salons directory. Curated from the
-- internal-backoffice; partners see it read-only.
ALTER TABLE "partners" ADD COLUMN "marketplaceListed" BOOLEAN NOT NULL DEFAULT false;

-- Index for the marketplace listing query (active, listed salons).
CREATE INDEX "partners_marketplaceListed_active_idx" ON "partners" ("marketplaceListed", "active");
