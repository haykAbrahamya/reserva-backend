-- Service price range support + per-booking final price capture.
CREATE TYPE "ServicePriceType" AS ENUM ('fixed', 'range');

ALTER TABLE "services"
  ADD COLUMN "priceType" "ServicePriceType" NOT NULL DEFAULT 'fixed',
  ADD COLUMN "priceMax" INTEGER;

ALTER TABLE "bookings"
  ADD COLUMN "priceMaxAtBooking" INTEGER,
  ADD COLUMN "finalPrice" INTEGER;
