-- Geo coordinates for locations (from the map picker). Nullable — existing
-- locations have none until an owner sets a pin. Powers map display + future
-- "near me" / distance sort on the marketplace.
ALTER TABLE "locations" ADD COLUMN "lat" DOUBLE PRECISION;
ALTER TABLE "locations" ADD COLUMN "lng" DOUBLE PRECISION;
