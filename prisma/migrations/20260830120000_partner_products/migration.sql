-- ════════════════════════════════════════════════════════════════════════════
-- Product catalog + per-partner entitlements.
--
-- WHY: Reserva is becoming several products on one Partner (bookings, courses,
-- and later vacancies / seminars). "Which products may this organization use"
-- becomes a row per partner × product instead of a boolean column per product,
-- so each grant carries its own lifecycle and a new product never adds a column.
--
-- SAFETY: this migration is purely ADDITIVE.
--   • It creates two new tables and one new enum.
--   • It does NOT read, alter, rename or drop any existing column.
--   • `partners.bookingsEnabled` and `partners.coursesEnabled` are left exactly
--     as they are and remain the source of truth for application behaviour;
--     nothing in the running code reads the new tables yet.
--   • Therefore it is safe to deploy ahead of the code that uses it, and safe
--     to roll the application back without touching the database.
--
-- BACKFILL SEMANTICS (deliberate, see below):
--   • EVERY partner receives the `bookings` grant — including those with
--     bookingsEnabled = false. That column is a SETTING inside the booking
--     product ("contact-only mode", toggled by partners themselves in Settings);
--     those salons still have services, staff, hours and a public page, so they
--     are booking customers and must not lose the product.
--   • `coursesEnabled = true` additionally receives the `courses` grant. That
--     flag IS an entitlement: it defaults to false and only platform staff can
--     turn it on.
-- ════════════════════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "PartnerProductStatus" AS ENUM ('active', 'trialing', 'suspended');
-- CreateTable
CREATE TABLE "products" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "selfServe" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "products_pkey" PRIMARY KEY ("key")
);
-- CreateTable
CREATE TABLE "partner_products" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "productKey" TEXT NOT NULL,
    "status" "PartnerProductStatus" NOT NULL DEFAULT 'active',
    "plan" TEXT,
    "trialEndsAt" TIMESTAMP(3),
    "settings" JSONB NOT NULL DEFAULT '{}',
    "enabledById" TEXT,
    "enabledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "partner_products_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "partner_products_productKey_status_idx" ON "partner_products"("productKey", "status");
-- CreateIndex
CREATE UNIQUE INDEX "partner_products_partnerId_productKey_key" ON "partner_products"("partnerId", "productKey");
-- AddForeignKey
ALTER TABLE "partner_products" ADD CONSTRAINT "partner_products_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "partner_products" ADD CONSTRAINT "partner_products_productKey_fkey" FOREIGN KEY ("productKey") REFERENCES "products"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Seed the catalog ────────────────────────────────────────────────────────
-- Keys are lowercase plural domain nouns, matching the existing *Enabled
-- columns and route names, so one word identifies a product everywhere.
-- `selfServe` marks products a partner may take on without staff involvement;
-- courses stays curated exactly as `coursesEnabled` is today.
INSERT INTO "products" ("key", "name", "description", "selfServe", "sortOrder", "active", "createdAt", "updatedAt")
VALUES
  ('bookings', 'Booking',  'Online appointment booking, calendar, clients and services.', true,  10, true, NOW(), NOW()),
  ('courses',  'Courses',  'Academy offerings: course runs, enrollment and seats.',       false, 20, true, NOW(), NOW());

-- ── Backfill: every partner is a booking customer ───────────────────────────
-- Soft-deleted partners are included on purpose: restoring one must not
-- silently come back without its products.
INSERT INTO "partner_products"
  ("id", "partnerId", "productKey", "status", "settings", "enabledById", "enabledAt", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  p."id",
  'bookings',
  'active',
  '{}'::jsonb,
  NULL,           -- automated grant, no acting user
  p."createdAt",  -- they have had booking since the day they signed up
  NOW(),
  NOW()
FROM "partners" p;

-- ── Backfill: curated courses grant ─────────────────────────────────────────
-- The original grant time was never recorded, so these are stamped with the
-- migration time rather than inventing one.
INSERT INTO "partner_products"
  ("id", "partnerId", "productKey", "status", "settings", "enabledById", "enabledAt", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  p."id",
  'courses',
  'active',
  '{}'::jsonb,
  NULL,
  NOW(),
  NOW(),
  NOW()
FROM "partners" p
WHERE p."coursesEnabled" = true;
