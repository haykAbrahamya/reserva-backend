import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const hexColor = z.string().regex(/^#([0-9a-fA-F]{6})$/, 'Expected a #RRGGBB hex color');
const phone = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, 'Phone must be like +37493813296 (no spaces or symbols)');

/** Self-serve signup from the marketing site (free trial). */
export const signupSchema = z.object({
  companyName: z.string().trim().min(2).max(120),
  companyType: z.string().trim().min(1).max(80),
  accent: hexColor,
  /** Optional preferred slug. If omitted, the partner is created WITHOUT one and
   *  slug.reserva.am 404s until the owner sets it in Settings. */
  slug: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  adminName: z.string().trim().min(2).max(120),
  adminEmail: z.string().email(),
  adminPhone: phone,
  password: z.string().min(8, 'Password must be at least 8 characters'),
});
export class SignupDto extends createZodDto(signupSchema) {}

export const activateSchema = z.object({
  token: z.string().min(10),
});
export class ActivateDto extends createZodDto(activateSchema) {}
