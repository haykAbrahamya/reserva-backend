-- Manual display order for a partner's services (drag-to-reorder). Additive +
-- non-destructive: the column is NOT NULL with a DEFAULT, so every existing row
-- is backfilled atomically and no data is lost. The default 0 is then replaced
-- by a positional backfill so existing services keep a stable, sensible starting
-- order (oldest first, per partner) instead of all sharing position 0.
ALTER TABLE "services" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- Backfill: number each partner's live+deleted services from 0 upward, ordered
-- by creation time (id as a deterministic tiebreaker). Purely derived from
-- existing columns — writes only the new column.
UPDATE "services" s
SET "sortOrder" = o.rn
FROM (
  SELECT "id",
         (ROW_NUMBER() OVER (PARTITION BY "partnerId" ORDER BY "createdAt", "id") - 1) AS rn
  FROM "services"
) o
WHERE s."id" = o."id";

-- Ordered per-tenant reads (backoffice list + public page) hit this index.
CREATE INDEX "services_partnerId_sortOrder_idx" ON "services" ("partnerId", "sortOrder");
