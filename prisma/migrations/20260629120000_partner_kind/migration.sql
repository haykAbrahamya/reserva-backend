-- Single vs salon mode. Presentation-only flag; the booking engine is identical.
CREATE TYPE "PartnerKind" AS ENUM ('salon', 'single');

ALTER TABLE "partners" ADD COLUMN "kind" "PartnerKind" NOT NULL DEFAULT 'salon';
ALTER TABLE "pending_registrations" ADD COLUMN "kind" "PartnerKind" NOT NULL DEFAULT 'salon';
