-- Default language for a partner's PUBLIC client page (first-time visitors).
-- Additive + non-destructive: a NOT-NULL column with a default, so every
-- existing row is backfilled to 'hy' (Armenian, our primary market) atomically.
-- A visitor's own saved language choice always wins over this at runtime.
ALTER TABLE "partners" ADD COLUMN "defaultLocale" TEXT NOT NULL DEFAULT 'hy';
