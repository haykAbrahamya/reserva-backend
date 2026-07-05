-- Public booking-page layout. Presentation-only; the booking API + flow are
-- identical across templates. Defaults to the original `classic` page.
CREATE TYPE "PartnerTemplate" AS ENUM ('classic', 'tabbed');

ALTER TABLE "partners" ADD COLUMN "template" "PartnerTemplate" NOT NULL DEFAULT 'classic';
