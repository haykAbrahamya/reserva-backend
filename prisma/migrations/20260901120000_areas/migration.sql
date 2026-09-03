-- Area taxonomy: a structured place for every branch.
--
-- Additive and safe on a live table: one new enum, one new table, and a single
-- NULLABLE column on `locations` (ADD COLUMN with no default = no table
-- rewrite). No existing row is modified.
--
-- `locations.areaKey` stays nullable so the branches that predate this keep
-- working; the requirement is enforced at the product boundary instead — a
-- vacancy cannot be published from a branch with no area.

-- CreateEnum
CREATE TYPE "AreaKind" AS ENUM ('region', 'city', 'district');

-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "areaKey" TEXT;

-- CreateTable
CREATE TABLE "areas" (
    "key" TEXT NOT NULL,
    "parentKey" TEXT,
    "kind" "AreaKind" NOT NULL,
    "name" TEXT NOT NULL,
    "nameI18n" JSONB NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "areas_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "areas_parentKey_sortOrder_idx" ON "areas"("parentKey", "sortOrder");

-- CreateIndex
CREATE INDEX "areas_active_kind_sortOrder_idx" ON "areas"("active", "kind", "sortOrder");

-- CreateIndex
CREATE INDEX "locations_areaKey_idx" ON "locations"("areaKey");

-- AddForeignKey
ALTER TABLE "areas" ADD CONSTRAINT "areas_parentKey_fkey" FOREIGN KEY ("parentKey") REFERENCES "areas"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_areaKey_fkey" FOREIGN KEY ("areaKey") REFERENCES "areas"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

