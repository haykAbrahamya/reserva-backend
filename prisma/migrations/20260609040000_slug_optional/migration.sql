-- Make Partner.slug optional (nullable). The unique index already allows
-- multiple NULLs in Postgres, so existing uniqueness is preserved.
ALTER TABLE "partners" ALTER COLUMN "slug" DROP NOT NULL;
