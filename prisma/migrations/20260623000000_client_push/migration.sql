-- Web Push subscriptions for anonymous public clients, scoped per booking.
CREATE TABLE "client_push_subscriptions" (
  "id"        TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "endpoint"  TEXT NOT NULL,
  "p256dh"    TEXT NOT NULL,
  "auth"      TEXT NOT NULL,
  "userAgent" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "client_push_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "client_push_subscriptions_endpoint_key" ON "client_push_subscriptions"("endpoint");
CREATE INDEX "client_push_subscriptions_bookingId_idx" ON "client_push_subscriptions"("bookingId");

ALTER TABLE "client_push_subscriptions"
  ADD CONSTRAINT "client_push_subscriptions_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
