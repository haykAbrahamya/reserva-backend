-- Optional specialist profile photo. Additive + non-destructive: existing rows
-- get the empty-string default (→ letter-initial avatar, unchanged behavior).
ALTER TABLE "specialists" ADD COLUMN "avatarUrl" TEXT NOT NULL DEFAULT '';
