-- Public WhatsApp number for the partner's booking page (click-to-chat wa.me).
ALTER TABLE "partner_presentations" ADD COLUMN "whatsapp" TEXT NOT NULL DEFAULT '';
