import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { localizedTextSchema } from '@/common/schemas/localized';

const hexColor = z.string().regex(/^#([0-9a-fA-F]{6})$/, 'Expected a #RRGGBB hex color');

// Social link: a full URL, or empty string (= not set). union keeps "" valid.
const socialUrl = z.union([z.string().url().max(300), z.literal('')]).default('');

// WhatsApp number: accept user input with spaces/+/dashes, store digits only
// (E.164 without the +). Empty = not set. 7–15 digits per the E.164 spec.
const whatsappNumber = z
  .string()
  .max(30)
  .transform((v) => v.replace(/\D/g, ''))
  .refine((v) => v === '' || (v.length >= 7 && v.length <= 15), 'Enter a valid WhatsApp number')
  .default('');

export const presentationSchema = z.object({
  tagline: z.string().max(200).default(''),
  /** Optional per-language overrides for `tagline`. */
  taglineI18n: localizedTextSchema,
  about: z.string().max(4000).default(''),
  /** Optional per-language overrides for `about`. */
  aboutI18n: localizedTextSchema,
  hours: z.string().max(120).default(''),
  instagram: socialUrl,
  facebook: socialUrl,
  whatsapp: whatsappNumber,
  rating: z.number().min(0).max(5).default(0),
  reviews: z.number().int().min(0).default(0),
  heroTints: z.array(z.string()).max(4).default([]),
  // Gallery tiles. New tiles carry an uploaded image `url`; legacy seed tiles
  // carried only a color `tone` + label. Both shapes are accepted so existing
  // data stays valid; the client renders an <img> when `url` is present and
  // falls back to the colored tile otherwise.
  gallery: z
    .array(
      z.object({
        url: z.string().max(500).optional(),
        label: z.string().max(80).optional().default(''),
        tone: z.string().max(20).optional(),
      }),
    )
    .max(12)
    .default([]),
});

/** Internal-backoffice: provision a new partner + its first admin user. */
export const createPartnerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, 'Slug may contain lowercase letters, numbers and hyphens'),
  type: z.string().trim().min(1).max(80),
  accent: hexColor,
  /** Salon (team) or single (solo pro). Solo auto-provisions one location +
   *  specialist. Defaults to salon. */
  kind: z.enum(['salon', 'single']).default('salon'),
  presentation: presentationSchema.partial().optional(),
  admin: z.object({
    name: z.string().trim().min(1).max(120),
    email: z.string().email(),
    phone: z.string().trim().min(4).max(40),
    /** Optional explicit password; otherwise a one-time password is generated. */
    password: z.string().min(8).optional(),
  }),
});
export class CreatePartnerDto extends createZodDto(createPartnerSchema) {}

export const updatePartnerSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  type: z.string().trim().min(1).max(80).optional(),
  accent: hexColor.optional(),
  active: z.boolean().optional(),
  autoConfirmBookings: z.boolean().optional(),
  bookingsEnabled: z.boolean().optional(),
  kind: z.enum(['salon', 'single']).optional(),
  /** Public booking-page layout. Presentation-only. */
  template: z.enum(['classic', 'tabbed']).optional(),
  /** Backoffice FAB behavior: support chat / new booking / hidden. */
  supportWidget: z.enum(['support', 'book', 'hidden']).optional(),
  /** Public handle for slug.reserva.am. Lowercase letters, numbers, hyphens. */
  slug: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers and hyphens')
    .optional(),
  presentation: presentationSchema.partial().optional(),
});
export class UpdatePartnerDto extends createZodDto(updatePartnerSchema) {}

/** Reorder a photo list to this exact list of image urls (drag-to-reorder). */
export const galleryReorderSchema = z.object({
  urls: z.array(z.string().max(500)).max(12),
  /** Which list to reorder: 'gallery' (Inside) or 'works'. Defaults to gallery. */
  list: z.enum(['gallery', 'works']).optional(),
});
export class GalleryReorderDto extends createZodDto(galleryReorderSchema) {}
