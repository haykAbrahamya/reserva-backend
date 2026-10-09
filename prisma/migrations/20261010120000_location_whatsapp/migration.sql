-- A branch's own WhatsApp number, so a salon with several branches can let
-- visitors pick which one to message. Additive + non-destructive: NOT NULL with
-- an empty default, so existing rows read as "not set" and the public page keeps
-- using the partner-wide WhatsApp. No data is written or migrated.
ALTER TABLE "locations" ADD COLUMN "whatsapp" TEXT NOT NULL DEFAULT '';
