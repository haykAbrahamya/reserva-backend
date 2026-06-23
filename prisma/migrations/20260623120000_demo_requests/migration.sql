-- Leads from the public "Book a demo" form, triaged in the internal console.
CREATE TYPE "DemoRequestStatus" AS ENUM ('new', 'done');

CREATE TABLE "demo_requests" (
  "id"        TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "company"   TEXT,
  "phone"     TEXT,
  "email"     TEXT,
  "notes"     TEXT,
  "status"    "DemoRequestStatus" NOT NULL DEFAULT 'new',
  "handledBy" TEXT,
  "handledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "demo_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "demo_requests_status_createdAt_idx" ON "demo_requests"("status", "createdAt");
