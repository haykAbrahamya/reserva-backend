-- CreateEnum
CREATE TYPE "VacancyApplicationSource" AS ENUM ('board', 'account');

-- CreateEnum
CREATE TYPE "VacancyApplicationStatus" AS ENUM ('new', 'contacted', 'shortlisted', 'rejected');

-- CreateTable
CREATE TABLE "vacancy_applications" (
    "id" TEXT NOT NULL,
    "vacancyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "locale" TEXT NOT NULL DEFAULT 'hy',
    "source" "VacancyApplicationSource" NOT NULL DEFAULT 'board',
    "status" "VacancyApplicationStatus" NOT NULL DEFAULT 'new',
    "seenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vacancy_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vacancy_applications_vacancyId_createdAt_idx" ON "vacancy_applications"("vacancyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "vacancy_applications_vacancyId_phone_key" ON "vacancy_applications"("vacancyId", "phone");

-- AddForeignKey
ALTER TABLE "vacancy_applications" ADD CONSTRAINT "vacancy_applications_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "vacancies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

