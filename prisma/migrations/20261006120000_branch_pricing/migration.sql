-- ════════════════════════════════════════════════════════════════════════════
-- Specialists at several branches + prices per branch and per specialist.
--
-- WHY: one specialist can work at more than one branch, and the same service
-- can cost a different amount at each branch and with each specialist (a real
-- partner: Hasmik does hair removal for 5 000 ֏ at Kentron and 4 000 ֏ at
-- Komitas; Anahit does it for 7 000 ֏ at Kentron). Price lived only on
-- `services`, and a specialist had exactly one `locationId`, so neither case
-- could be expressed.
--
-- Resolution, most specific first:
--   specialist_prices (specialist @ branch) → location_services (branch) → services
--
-- SAFETY: this migration is purely ADDITIVE.
--   • It creates three tables and adds one NULLABLE column. It does NOT alter,
--     rename or drop any existing column, so the running code and every open
--     app bundle keep working.
--   • `specialists.locationId` stays NOT NULL and keeps its meaning as the
--     specialist's HOME branch. `specialists.schedule` keeps being written as a
--     mirror of the home-branch schedule until every reader has moved over.
--   • `location_services` and `specialist_prices` start EMPTY. An absent row
--     means "use the service's own price and duration", which is exactly the
--     behaviour before this migration — so nothing any partner sees changes.
--   • `specialist_locations` is backfilled with one row per specialist, copied
--     from `specialists.locationId` + `specialists.schedule`, so it starts as an
--     exact mirror. A check aborts the whole migration (Prisma runs the file as
--     one implicit transaction) if any specialist was missed.
--   • Two triggers keep the home-branch row in step with `specialists` for any
--     writer that predates this table (an older app version during a rolling
--     deploy, or after a rollback), so no specialist can become unbookable.
--
-- Dry-run on a copy of a seeded database: applied in ~0.2 s, backfill 20/20
-- with identical hours, `prisma migrate diff` against the schema empty, and a
-- cross-branch double booking still rejected by `bookings_no_overlap`.
-- ════════════════════════════════════════════════════════════════════════════

-- CreateTable
CREATE TABLE "specialist_locations" (
    "specialistId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "schedule" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "specialist_locations_pkey" PRIMARY KEY ("specialistId","locationId")
);

-- CreateTable
CREATE TABLE "location_services" (
    "locationId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "offered" BOOLEAN NOT NULL DEFAULT true,
    "priceType" "ServicePriceType",
    "price" INTEGER,
    "priceMax" INTEGER,
    "duration" INTEGER,
    "capacity" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "location_services_pkey" PRIMARY KEY ("locationId","serviceId")
);

-- CreateTable
CREATE TABLE "specialist_prices" (
    "specialistId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "priceType" "ServicePriceType",
    "price" INTEGER,
    "priceMax" INTEGER,
    "duration" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "specialist_prices_pkey" PRIMARY KEY ("specialistId","locationId","serviceId")
);

-- AlterTable: bookings remember the price TYPE they were made with. Completing
-- a range-priced booking asks for the final amount; that used to be decided
-- from the service's CURRENT type, but once a branch or specialist can price a
-- range service as fixed (or the reverse) only the booking knows. Nullable with
-- NO backfill: null means "booked before this column", and the code falls back
-- to services.priceType exactly as before. A nullable column without a default
-- is a metadata-only change (no table rewrite, no long lock).
ALTER TABLE "bookings" ADD COLUMN "priceTypeAtBooking" "ServicePriceType";

-- CreateIndex
CREATE INDEX "specialist_locations_locationId_idx" ON "specialist_locations"("locationId");
CREATE INDEX "specialist_locations_partnerId_idx" ON "specialist_locations"("partnerId");
CREATE INDEX "location_services_serviceId_idx" ON "location_services"("serviceId");
CREATE INDEX "location_services_partnerId_idx" ON "location_services"("partnerId");
CREATE INDEX "specialist_prices_serviceId_locationId_idx" ON "specialist_prices"("serviceId", "locationId");
CREATE INDEX "specialist_prices_partnerId_idx" ON "specialist_prices"("partnerId");

-- AddForeignKey
ALTER TABLE "specialist_locations" ADD CONSTRAINT "specialist_locations_specialistId_fkey" FOREIGN KEY ("specialistId") REFERENCES "specialists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "specialist_locations" ADD CONSTRAINT "specialist_locations_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "location_services" ADD CONSTRAINT "location_services_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "location_services" ADD CONSTRAINT "location_services_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Composite FK: a personal price can only exist for a branch the specialist
-- actually works at, and disappears with that link.
ALTER TABLE "specialist_prices" ADD CONSTRAINT "specialist_prices_specialistId_locationId_fkey" FOREIGN KEY ("specialistId", "locationId") REFERENCES "specialist_locations"("specialistId", "locationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "specialist_prices" ADD CONSTRAINT "specialist_prices_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Integrity rules the DTOs enforce, now guaranteed by the database ─────────
-- Prisma does not model CHECK constraints; like `bookings_no_overlap`, they live
-- only in migration SQL (and `prisma migrate diff` leaves them alone). A price
-- override is all-or-nothing: type and amount together, or neither.
ALTER TABLE "location_services" ADD CONSTRAINT "location_services_price_check" CHECK (
  ("priceType" IS NULL AND "price" IS NULL AND "priceMax" IS NULL)
  OR ("priceType" = 'fixed' AND "price" >= 0 AND "priceMax" IS NULL)
  OR ("priceType" = 'range' AND "price" >= 0 AND ("priceMax" IS NULL OR "priceMax" > "price"))
);
ALTER TABLE "location_services" ADD CONSTRAINT "location_services_duration_check" CHECK ("duration" IS NULL OR "duration" BETWEEN 5 AND 600);
ALTER TABLE "location_services" ADD CONSTRAINT "location_services_capacity_check" CHECK ("capacity" IS NULL OR "capacity" BETWEEN 1 AND 200);
ALTER TABLE "specialist_prices" ADD CONSTRAINT "specialist_prices_price_check" CHECK (
  ("priceType" IS NULL AND "price" IS NULL AND "priceMax" IS NULL)
  OR ("priceType" = 'fixed' AND "price" >= 0 AND "priceMax" IS NULL)
  OR ("priceType" = 'range' AND "price" >= 0 AND ("priceMax" IS NULL OR "priceMax" > "price"))
);
ALTER TABLE "specialist_prices" ADD CONSTRAINT "specialist_prices_duration_check" CHECK ("duration" IS NULL OR "duration" BETWEEN 5 AND 600);
-- An override row must override something.
ALTER TABLE "specialist_prices" ADD CONSTRAINT "specialist_prices_not_empty" CHECK ("price" IS NOT NULL OR "duration" IS NOT NULL);

-- ── Backfill: every specialist works at their current branch, on their current hours ──
-- Soft-deleted specialists are included on purpose: restoring one must bring
-- back a specialist who still has a branch.
INSERT INTO "specialist_locations" ("specialistId", "locationId", "partnerId", "schedule", "createdAt", "updatedAt")
SELECT s."id", s."locationId", s."partnerId", s."schedule", s."createdAt", NOW()
FROM "specialists" s;

-- Abort (and roll the whole migration back) if any specialist was missed.
DO $$
DECLARE missing integer;
BEGIN
  SELECT count(*) INTO missing
  FROM "specialists" s
  WHERE NOT EXISTS (
    SELECT 1 FROM "specialist_locations" sl
    WHERE sl."specialistId" = s."id" AND sl."locationId" = s."locationId"
  );
  IF missing > 0 THEN
    RAISE EXCEPTION 'specialist_locations backfill incomplete: % specialist(s) missing', missing;
  END IF;
END $$;

-- ── Keep the home-branch row in step with `specialists`, whoever writes it ────
-- Every specialist must work at their home branch (`specialists.locationId`).
-- Code that predates this table creates and moves specialists through
-- `specialists` alone; these triggers make sure such a write still leaves a
-- matching link row, so the booking engine (which reads the links) never loses
-- a specialist. New code writes the links itself and tolerates the row already
-- existing. Safe to drop once no pre-link writer can run any more.
CREATE OR REPLACE FUNCTION reserva_specialist_home_link()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "specialist_locations" ("specialistId", "locationId", "partnerId", "schedule", "createdAt", "updatedAt")
  VALUES (NEW."id", NEW."locationId", NEW."partnerId", NEW."schedule", NOW(), NOW())
  ON CONFLICT ("specialistId", "locationId") DO NOTHING;
  RETURN NEW;
END $$;

CREATE TRIGGER "specialists_home_link"
AFTER INSERT OR UPDATE OF "locationId" ON "specialists"
FOR EACH ROW EXECUTE FUNCTION reserva_specialist_home_link();

-- A writer that only knows `specialists.schedule` (the pre-branch Hours page)
-- must still change the hours the booking engine reads: mirror it onto the
-- home-branch row. A no-op when the new code already wrote the same hours.
CREATE OR REPLACE FUNCTION reserva_specialist_home_schedule()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "specialist_locations"
     SET "schedule" = NEW."schedule", "updatedAt" = NOW()
   WHERE "specialistId" = NEW."id"
     AND "locationId" = NEW."locationId"
     AND "schedule" IS DISTINCT FROM NEW."schedule";
  RETURN NEW;
END $$;

CREATE TRIGGER "specialists_home_schedule"
AFTER UPDATE OF "schedule" ON "specialists"
FOR EACH ROW EXECUTE FUNCTION reserva_specialist_home_schedule();
