-- Professionals: the other side of the vacancies market.
--
-- A third kind of principal, alongside `users` (staff at a partner) and
-- `platform_users` (Reserva staff). Deliberately NOT a row in `users`: that
-- table is scoped to a partnerId and carries admin/manager roles, so putting a
-- job seeker there would mean inventing an organization per individual and then
-- special-casing every tenant-scoped query and guard in the system.
--
-- Strictly ADDITIVE. Two new tables and one new NULLABLE column; nothing is
-- dropped, renamed, or backfilled, and every existing row keeps the values it
-- has. `vacancy_applications` in particular is untouched apart from gaining a
-- column that is NULL for every row that already exists — applying has never
-- required an account and still does not.

-- CreateTable
CREATE TABLE "professionals" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT NOT NULL,
    "specialtyKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "areaKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "experience" "VacancyExperience" NOT NULL DEFAULT 'any',
    "about" TEXT NOT NULL DEFAULT '',
    "cvUrl" TEXT NOT NULL DEFAULT '',
    "locale" TEXT NOT NULL DEFAULT 'hy',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLogin" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "professionals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "professional_refresh_tokens" (
    "id" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "professional_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Phone is THE identifier in this market, and it is normalized to E.164 before
-- it is stored — the same rule the anonymous application path already applies,
-- which is what will let an account claim applications made before it existed.
CREATE UNIQUE INDEX "professionals_phone_key" ON "professionals"("phone");

-- CreateIndex
-- Email is optional: plenty of professionals here have a phone and no address.
-- Postgres allows many NULLs in a unique index, so this constrains only the
-- rows that actually have one.
CREATE UNIQUE INDEX "professionals_email_key" ON "professionals"("email");

-- CreateIndex
-- "Colourists available in Yerevan" — the search the salon-facing side will run.
-- GIN, because both columns are arrays drawn from the shared catalogs.
CREATE INDEX "professionals_specialtyKeys_idx" ON "professionals" USING GIN ("specialtyKeys");

-- CreateIndex
CREATE INDEX "professionals_areaKeys_idx" ON "professionals" USING GIN ("areaKeys");

-- CreateIndex
CREATE INDEX "professionals_active_idx" ON "professionals"("active");

-- CreateIndex
CREATE UNIQUE INDEX "professional_refresh_tokens_tokenHash_key" ON "professional_refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "professional_refresh_tokens_professionalId_revokedAt_idx" ON "professional_refresh_tokens"("professionalId", "revokedAt");

-- AddForeignKey
ALTER TABLE "professional_refresh_tokens" ADD CONSTRAINT "professional_refresh_tokens_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "professionals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
-- Nullable, and permanently so. Most applications have no account behind them
-- and that is the intended steady state, not a migration gap.
ALTER TABLE "vacancy_applications" ADD COLUMN "professionalId" TEXT;

-- CreateIndex
-- "My applications" — one professional's own history, newest first.
CREATE INDEX "vacancy_applications_professionalId_createdAt_idx" ON "vacancy_applications"("professionalId", "createdAt");

-- AddForeignKey
-- SET NULL, never CASCADE: deleting an account must not delete the salon's
-- record of who applied to its listing.
ALTER TABLE "vacancy_applications" ADD CONSTRAINT "vacancy_applications_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "professionals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
