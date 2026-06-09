-- AlterTable: per-service recurrence interval in total days (nullable = no repeat)
ALTER TABLE "services" ADD COLUMN "repeatEveryDays" INTEGER;
