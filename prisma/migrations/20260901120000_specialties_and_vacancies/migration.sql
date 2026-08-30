-- Specialty taxonomy + vacancies.
--
-- Fully additive: three new tables and seven new enums. No existing table is
-- altered and no existing row is touched, so this is safe to apply to
-- production while the app is serving traffic.
--
-- The catalog rows themselves (specialty groups, specialties, the `vacancies`
-- product) are seeded by the migration that follows this one, so the structure
-- and the vocabulary can evolve independently.

-- CreateEnum
CREATE TYPE "VacancyPayType" AS ENUM ('percentage', 'rent', 'salary', 'negotiable');

-- CreateEnum
CREATE TYPE "VacancyPayPeriod" AS ENUM ('day', 'week', 'month');

-- CreateEnum
CREATE TYPE "VacancyScheduleType" AS ENUM ('full_time', 'part_time', 'shift', 'flexible');

-- CreateEnum
CREATE TYPE "VacancyExperience" AS ENUM ('any', 'junior', 'experienced');

-- CreateEnum
CREATE TYPE "VacancyApplyMode" AS ENUM ('in_app', 'phone', 'both');

-- CreateEnum
CREATE TYPE "VacancyStatus" AS ENUM ('draft', 'published', 'paused', 'closed', 'expired');

-- CreateEnum
CREATE TYPE "VacancyReviewStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "specialty_groups" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameI18n" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "specialty_groups_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "specialties" (
    "key" TEXT NOT NULL,
    "groupKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameI18n" JSONB NOT NULL,
    "roleName" TEXT NOT NULL,
    "roleNameI18n" JSONB NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "specialties_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "vacancies" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "specialtyKey" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "titleI18n" JSONB,
    "description" TEXT NOT NULL DEFAULT '',
    "descriptionI18n" JSONB,
    "coverUrl" TEXT NOT NULL DEFAULT '',
    "seats" INTEGER NOT NULL DEFAULT 1,
    "payType" "VacancyPayType" NOT NULL DEFAULT 'negotiable',
    "salonPercent" INTEGER,
    "salonPercentMax" INTEGER,
    "amount" INTEGER,
    "amountMax" INTEGER,
    "payPeriod" "VacancyPayPeriod" NOT NULL DEFAULT 'month',
    "currency" TEXT NOT NULL DEFAULT 'AMD',
    "scheduleType" "VacancyScheduleType",
    "scheduleNote" TEXT NOT NULL DEFAULT '',
    "experience" "VacancyExperience" NOT NULL DEFAULT 'any',
    "perks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "applyMode" "VacancyApplyMode" NOT NULL DEFAULT 'both',
    "contactPhone" TEXT NOT NULL DEFAULT '',
    "status" "VacancyStatus" NOT NULL DEFAULT 'draft',
    "reviewStatus" "VacancyReviewStatus" NOT NULL DEFAULT 'approved',
    "publishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "vacancies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "specialty_groups_active_sortOrder_idx" ON "specialty_groups"("active", "sortOrder");

-- CreateIndex
CREATE INDEX "specialties_groupKey_sortOrder_idx" ON "specialties"("groupKey", "sortOrder");

-- CreateIndex
CREATE INDEX "specialties_active_sortOrder_idx" ON "specialties"("active", "sortOrder");

-- CreateIndex
CREATE INDEX "vacancies_partnerId_deletedAt_status_idx" ON "vacancies"("partnerId", "deletedAt", "status");

-- CreateIndex
CREATE INDEX "vacancies_status_deletedAt_publishedAt_idx" ON "vacancies"("status", "deletedAt", "publishedAt");

-- CreateIndex
CREATE INDEX "vacancies_specialtyKey_status_idx" ON "vacancies"("specialtyKey", "status");

-- CreateIndex
CREATE INDEX "vacancies_locationId_idx" ON "vacancies"("locationId");

-- AddForeignKey
ALTER TABLE "specialties" ADD CONSTRAINT "specialties_groupKey_fkey" FOREIGN KEY ("groupKey") REFERENCES "specialty_groups"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_specialtyKey_fkey" FOREIGN KEY ("specialtyKey") REFERENCES "specialties"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

