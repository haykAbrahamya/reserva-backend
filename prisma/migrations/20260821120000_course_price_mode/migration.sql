-- Course price presentation mode (hidden | free | paid). Additive +
-- non-destructive. The column is NOT NULL with a DEFAULT so every existing row
-- is backfilled atomically. We then map the old "0 = free" convention onto the
-- new discriminator: rows priced 0 become `free`, priced rows stay `paid`.
-- Nothing distinguishes the new `hidden` mode in old data, so no row is set to
-- it here (partners opt into it explicitly from the editor).

-- Enum type.
CREATE TYPE "CoursePriceMode" AS ENUM ('hidden', 'free', 'paid');

-- Column defaults to 'paid'; existing priced rows keep showing their amount.
ALTER TABLE "courses" ADD COLUMN "priceMode" "CoursePriceMode" NOT NULL DEFAULT 'paid';

-- Backfill: rows that were free under the old convention (price = 0) → 'free'.
UPDATE "courses" SET "priceMode" = 'free' WHERE "price" = 0;
