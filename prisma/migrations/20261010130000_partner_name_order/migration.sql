-- Partner preference: specialist names are typed surname first, so display
-- them given-name first. Additive + non-destructive: NOT NULL with a false
-- default, so every existing partner keeps showing names exactly as typed.
ALTER TABLE "partners" ADD COLUMN "specialistNamesSurnameFirst" BOOLEAN NOT NULL DEFAULT false;
