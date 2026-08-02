-- Courses feature (Phase 1): reusable Course template, per-run CourseCohort,
-- and self-contained CourseEnrollment (members are NOT booking Clients).
-- Purely additive: new enums + new tables only. No change to existing tables,
-- so no existing data is touched or lost.

-- CreateEnum
CREATE TYPE "CourseLevel" AS ENUM ('beginner', 'intermediate', 'advanced');

-- CreateEnum
CREATE TYPE "CohortStatus" AS ENUM ('draft', 'open', 'running', 'completed', 'archived');

-- CreateEnum
CREATE TYPE "EnrollmentSource" AS ENUM ('public', 'backoffice');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('pending', 'confirmed', 'cancelled', 'completed', 'noshow');

-- CreateTable
CREATE TABLE "courses" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titleI18n" JSONB,
    "summary" TEXT NOT NULL DEFAULT '',
    "summaryI18n" JSONB,
    "description" TEXT NOT NULL DEFAULT '',
    "descriptionI18n" JSONB,
    "coverUrl" TEXT NOT NULL DEFAULT '',
    "price" INTEGER NOT NULL DEFAULT 0,
    "tutorSpecialistId" TEXT,
    "tutorName" TEXT NOT NULL DEFAULT '',
    "tutorTitle" TEXT NOT NULL DEFAULT '',
    "level" "CourseLevel",
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_cohorts" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "locationId" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "scheduleText" TEXT NOT NULL DEFAULT '',
    "capacity" INTEGER NOT NULL DEFAULT 0,
    "status" "CohortStatus" NOT NULL DEFAULT 'open',
    "registrationOpen" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "course_cohorts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_enrollments" (
    "id" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "memberName" TEXT NOT NULL,
    "memberPhone" TEXT NOT NULL,
    "memberEmail" TEXT NOT NULL DEFAULT '',
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'pending',
    "source" "EnrollmentSource" NOT NULL DEFAULT 'backoffice',
    "notes" TEXT,
    "priceAtEnroll" INTEGER NOT NULL DEFAULT 0,
    "locale" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "courses_partnerId_deletedAt_idx" ON "courses"("partnerId", "deletedAt");

-- CreateIndex
CREATE INDEX "courses_partnerId_active_idx" ON "courses"("partnerId", "active");

-- CreateIndex
CREATE INDEX "course_cohorts_courseId_deletedAt_idx" ON "course_cohorts"("courseId", "deletedAt");

-- CreateIndex
CREATE INDEX "course_cohorts_partnerId_status_idx" ON "course_cohorts"("partnerId", "status");

-- CreateIndex
CREATE INDEX "course_enrollments_partnerId_status_idx" ON "course_enrollments"("partnerId", "status");

-- CreateIndex
CREATE INDEX "course_enrollments_cohortId_status_idx" ON "course_enrollments"("cohortId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "course_enrollments_cohortId_memberPhone_key" ON "course_enrollments"("cohortId", "memberPhone");

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_tutorSpecialistId_fkey" FOREIGN KEY ("tutorSpecialistId") REFERENCES "specialists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_cohorts" ADD CONSTRAINT "course_cohorts_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_cohorts" ADD CONSTRAINT "course_cohorts_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_cohorts" ADD CONSTRAINT "course_cohorts_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "course_cohorts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

