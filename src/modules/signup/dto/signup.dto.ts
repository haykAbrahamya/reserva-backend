import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const hexColor = z.string().regex(/^#([0-9a-fA-F]{6})$/, 'Expected a #RRGGBB hex color');

/** Self-serve signup from the marketing site (free trial). */
export const signupSchema = z.object({
  companyName: z.string().trim().min(2).max(120),
  companyType: z.string().trim().min(1).max(80),
  accent: hexColor,
  /** Optional preferred slug; auto-derived from companyName if omitted. */
  slug: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  adminName: z.string().trim().min(2).max(120),
  adminEmail: z.string().email(),
  adminPhone: z.string().trim().min(4).max(40),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});
export class SignupDto extends createZodDto(signupSchema) {}

export const activateSchema = z.object({
  token: z.string().min(10),
});
export class ActivateDto extends createZodDto(activateSchema) {}
