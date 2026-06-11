-- Telegram customer notifications: bind a Telegram chat to a client and deliver
-- booking notifications for free over Telegram.

-- Client gains an optional Telegram chat id (set once the customer connects).
ALTER TABLE "clients" ADD COLUMN "telegramChatId" TEXT;

-- Short-lived, single-use deep-link tokens (t.me/<bot>?start=<token>) that bind
-- a Telegram chat to a client when the customer presses Start.
CREATE TABLE "telegram_links" (
    "token" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "bookingId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "telegram_links_pkey" PRIMARY KEY ("token")
);

CREATE INDEX "telegram_links_clientId_idx" ON "telegram_links" ("clientId");
CREATE INDEX "telegram_links_expiresAt_idx" ON "telegram_links" ("expiresAt");

ALTER TABLE "telegram_links"
    ADD CONSTRAINT "telegram_links_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "clients" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
