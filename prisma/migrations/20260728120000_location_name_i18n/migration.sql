-- Per-language overrides for a branch/location's name. Additive +
-- non-destructive: nullable JSONB, so existing rows are untouched (NULL → falls
-- back to the base `name`). Only the branch NAME is translatable — address/geo
-- stay single-value. No data is written or migrated.
ALTER TABLE "locations" ADD COLUMN "nameI18n" JSONB;
