import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const hexColor = z.string().regex(/^#([0-9a-fA-F]{6})$/, 'Expected a #RRGGBB hex color');

// Social link: a full URL, or empty string (= not set). union keeps "" valid.
const socialUrl = z.union([z.string().url().max(300), z.literal('')]).default('');

export const presentationSchema = z.object({
  tagline: z.string().max(200).default(''),
  about: z.string().max(4000).default(''),
  hours: z.string().max(120).default(''),
  instagram: socialUrl,
  facebook: socialUrl,
  rating: z.number().min(0).max(5).default(0),
  reviews: z.number().int().min(0).default(0),
  heroTints: z.array(z.string()).max(4).default([]),
  gallery: z
    .array(z.object({ label: z.string().max(80), tone: z.string().max(20) }))
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
