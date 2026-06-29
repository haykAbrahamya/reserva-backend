-- "Works" photo list (separate from the "Inside" gallery). Tiles may be simple
-- photos or before/after pairs.
ALTER TABLE "partner_presentations" ADD COLUMN "works" JSONB NOT NULL DEFAULT '[]';
