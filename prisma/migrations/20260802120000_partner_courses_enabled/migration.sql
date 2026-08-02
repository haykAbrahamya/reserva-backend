-- Per-partner Courses (academy) feature flag, controlled by platform staff.
-- Additive + non-destructive: a NOT-NULL boolean with a default, so every
-- existing partner is backfilled to `false` (opt-in) atomically.
ALTER TABLE "partners" ADD COLUMN "coursesEnabled" BOOLEAN NOT NULL DEFAULT false;
