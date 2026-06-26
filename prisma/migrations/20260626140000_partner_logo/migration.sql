-- Optional brand logo for partners, shown instead of the name initial.
ALTER TABLE "partner_presentations" ADD COLUMN "logoUrl" TEXT NOT NULL DEFAULT '';
