import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const phone = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, 'Phone must be like +37493813296 (no spaces or symbols)');

/** Catalog keys, same shape as the specialty and area keys everywhere else. */
const catalogKey = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9-]+$/, 'Invalid catalog key');

/**
 * How many specialties and areas one account may claim.
 *
 * A cap rather than a rule about the person: someone genuinely does several
 * things, but an account tagged with thirty specialties is either a mistake or
 * an attempt to appear in every search, and both make the board worse for
 * everyone honest.
 */
const MAX_KEYS = 12;

const specialtyKeys = z.array(catalogKey).max(MAX_KEYS).optional();
const areaKeys = z.array(catalogKey).max(MAX_KEYS).optional();
/**
 * Years in the trade.
 *
 * Capped at 60 because a career is not longer than that and an unbounded number
 * on a public form is an invitation. `null` is allowed and distinct from 0:
 * "prefer not to say" and "this is my first year" are different answers.
 */
const experienceYears = z.number().int().min(0).max(60).nullable().optional();
const locale = z.enum(['hy', 'en', 'ru']).optional();

export const registerProfessionalSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone,
  /** Optional: many professionals here have a phone and no email. */
  email: z.string().email().optional(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  specialtyKeys,
  areaKeys,
  experienceYears,
  about: z.string().trim().max(1200).optional(),
  locale,
});
export class RegisterProfessionalDto extends createZodDto(registerProfessionalSchema) {}

export const professionalLoginSchema = z.object({
  /** An email OR a phone number — see ProfessionalsService.findByLogin. */
  identifier: z.string().trim().min(3).max(160),
  password: z.string().min(1),
});
export class ProfessionalLoginDto extends createZodDto(professionalLoginSchema) {}

export const professionalRefreshSchema = z.object({
  refreshToken: z.string().min(10),
});
export class ProfessionalRefreshDto extends createZodDto(professionalRefreshSchema) {}

/**
 * Every field optional: this is a PATCH.
 *
 * `password` is deliberately absent — changing it revokes sessions and needs
 * the current one, which is a different endpoint with different rules, not a
 * field someone can slip into a profile save.
 */
export const updateProfessionalSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: phone.optional(),
  /** Empty string clears it; the column is nullable. */
  email: z.union([z.string().email(), z.literal('')]).optional(),
  specialtyKeys,
  areaKeys,
  experienceYears,
  about: z.string().trim().max(1200).optional(),
  locale,
});
export class UpdateProfessionalDto extends createZodDto(updateProfessionalSchema) {}
