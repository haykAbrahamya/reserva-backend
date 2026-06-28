-- Per-partner switch for the public booking page. When false, the page is
-- contact-only (booking CTAs hidden/replaced, public booking endpoints reject).
ALTER TABLE "partners" ADD COLUMN "bookingsEnabled" BOOLEAN NOT NULL DEFAULT true;
