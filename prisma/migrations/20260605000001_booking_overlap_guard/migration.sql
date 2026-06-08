-- Hard, race-proof double-booking prevention.
--
-- A specialist can never have two ACTIVE (pending/confirmed/completed) bookings
-- whose [startAt, endAt) time ranges overlap. Enforced by a Postgres EXCLUDE
-- constraint over a GiST index on (specialistId, time-range). Cancelled and
-- no-show bookings are excluded from the rule via the partial predicate, so a
-- freed slot can be re-booked.

-- GiST support for equality on a scalar column (specialistId) alongside a range.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Any tstzrange / "AT TIME ZONE" expression is only STABLE (timezone-dependent),
-- which Postgres refuses inside an index expression. Use a plpgsql IMMUTABLE
-- wrapper returning a tsrange over plain `timestamp`; the index casts the
-- timestamptz columns with the IMMUTABLE `::timestamp` cast. Bookings are stored
-- and compared in a single server timezone, so overlap detection is exact.
CREATE OR REPLACE FUNCTION reserva_booking_range(_start timestamp, _end timestamp)
RETURNS tsrange
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$ BEGIN RETURN tsrange(_start, _end, '[)'); END $$;

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_no_overlap"
  EXCLUDE USING gist (
    "specialistId" WITH =,
    reserva_booking_range("startAt"::timestamp, "endAt"::timestamp) WITH &&
  )
  WHERE ("status" IN ('pending', 'confirmed', 'completed'));
