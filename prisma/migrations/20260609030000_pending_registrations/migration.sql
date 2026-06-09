-- CreateTable
CREATE TABLE "pending_registrations" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "companyType" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "accent" TEXT NOT NULL,
    "adminName" TEXT NOT NULL,
    "adminEmail" TEXT NOT NULL,
    "adminPhone" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pending_registrations_tokenHash_key" ON "pending_registrations"("tokenHash");

-- CreateIndex
CREATE INDEX "pending_registrations_adminEmail_idx" ON "pending_registrations"("adminEmail");

-- CreateIndex
CREATE INDEX "pending_registrations_slug_idx" ON "pending_registrations"("slug");
