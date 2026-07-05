-- Backoffice FAB behavior per partner: support chat (default) / new booking /
-- hidden. Additive only — new enum + new column with a safe default; existing
-- rows get 'support'. No data altered.

-- CreateEnum
CREATE TYPE "SupportWidgetMode" AS ENUM ('support', 'book', 'hidden');

-- AlterTable
ALTER TABLE "partners" ADD COLUMN     "supportWidget" "SupportWidgetMode" NOT NULL DEFAULT 'support';
