-- Per-language overrides for tenant-authored public text. Additive +
-- non-destructive: every column is nullable JSONB, so existing rows are
-- untouched (NULL → falls back to the base string, exactly today's behavior).
-- No data is written or migrated.
ALTER TABLE "services" ADD COLUMN "nameI18n" JSONB;
ALTER TABLE "services" ADD COLUMN "categoryI18n" JSONB;
ALTER TABLE "partner_presentations" ADD COLUMN "taglineI18n" JSONB;
ALTER TABLE "partner_presentations" ADD COLUMN "aboutI18n" JSONB;
ALTER TABLE "specialists" ADD COLUMN "titleI18n" JSONB;
