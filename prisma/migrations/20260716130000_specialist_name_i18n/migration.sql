-- Per-language overrides for a specialist's name (transliteration). Additive +
-- non-destructive: nullable JSONB, so existing rows are untouched (NULL → falls
-- back to the base `name`). No data is written or migrated.
ALTER TABLE "specialists" ADD COLUMN "nameI18n" JSONB;
