-- Super admin: platform staff an owner allows to sign in to the partner
-- backoffice and act as any partner's admin. Off for everyone by default —
-- no existing account gains access. Plus an append-only audit trail of every
-- entry into a partner's backoffice.
--
-- Additive: one NOT NULL column with a constant default (no table rewrite on
-- PostgreSQL 11+) and one new table. No data is written or migrated.

-- AlterTable
ALTER TABLE "platform_users" ADD COLUMN     "superAdmin" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "super_admin_visits" (
    "id" TEXT NOT NULL,
    "platformUserId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "actingUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "super_admin_visits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "super_admin_visits_partnerId_createdAt_idx" ON "super_admin_visits"("partnerId", "createdAt");

-- CreateIndex
CREATE INDEX "super_admin_visits_platformUserId_createdAt_idx" ON "super_admin_visits"("platformUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "super_admin_visits" ADD CONSTRAINT "super_admin_visits_platformUserId_fkey" FOREIGN KEY ("platformUserId") REFERENCES "platform_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
