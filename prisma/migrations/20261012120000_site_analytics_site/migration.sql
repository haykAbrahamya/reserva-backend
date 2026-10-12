-- Which Reserva site a visit was on, so tools.reserva.am traffic can be read on
-- its own instead of inflating the booking site's numbers. Additive +
-- non-destructive: NOT NULL with a constant default, which PostgreSQL 11+ adds
-- without rewriting the table; every existing session reads as 'web'
-- (reserva.am and its partner pages). No data is written or migrated.
ALTER TABLE "site_sessions" ADD COLUMN "site" TEXT NOT NULL DEFAULT 'web';
