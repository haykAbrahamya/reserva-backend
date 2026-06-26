-- Public reviews for specialists, shown on the booking page and aggregated into
-- the rating displayed across the client app. Published instantly; partners can
-- delete from the backoffice.
CREATE TABLE "specialist_reviews" (
  "id"           TEXT NOT NULL,
  "specialistId" TEXT NOT NULL,
  "partnerId"    TEXT NOT NULL,
  "author"       TEXT NOT NULL DEFAULT '',
  "rating"       INTEGER NOT NULL,
  "text"         TEXT NOT NULL DEFAULT '',
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "specialist_reviews_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "specialist_reviews_specialistId_createdAt_idx" ON "specialist_reviews"("specialistId", "createdAt");
CREATE INDEX "specialist_reviews_partnerId_createdAt_idx" ON "specialist_reviews"("partnerId", "createdAt");

ALTER TABLE "specialist_reviews"
  ADD CONSTRAINT "specialist_reviews_specialistId_fkey"
  FOREIGN KEY ("specialistId") REFERENCES "specialists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
