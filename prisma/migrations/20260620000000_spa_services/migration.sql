-- Spa / facility ("entry-price") services: not tied to a specialist, availability
-- driven by location hours + a per-slot capacity.

-- Service: whether a person is required, and concurrent capacity when not.
ALTER TABLE "services" ADD COLUMN "requiresSpecialist" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "services" ADD COLUMN "capacity" INTEGER NOT NULL DEFAULT 1;

-- Booking: specialist becomes optional (null for facility/entry bookings).
ALTER TABLE "bookings" ALTER COLUMN "specialistId" DROP NOT NULL;
