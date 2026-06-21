-- Persist the UI language a customer booked in, to localize reminders later.
ALTER TABLE "bookings" ADD COLUMN "locale" TEXT;
