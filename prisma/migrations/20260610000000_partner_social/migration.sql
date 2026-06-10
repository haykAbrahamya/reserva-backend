-- AlterTable: public social links on the partner's marketing page
ALTER TABLE "partner_presentations" ADD COLUMN "instagram" TEXT NOT NULL DEFAULT '';
ALTER TABLE "partner_presentations" ADD COLUMN "facebook" TEXT NOT NULL DEFAULT '';
