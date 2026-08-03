-- Per-language overrides for a partner's public NAME (hero title) and TYPE
-- (the category chip). Additive + non-destructive: both are nullable JSONB, so
-- existing rows are untouched (NULL → falls back to the base `name` / `type`,
-- which stay the source of truth for search/sort/emails). No data is written or
-- migrated. Shape: { hy?, en?, ru? }.
ALTER TABLE "partners" ADD COLUMN "nameI18n" JSONB;
ALTER TABLE "partners" ADD COLUMN "typeI18n" JSONB;
