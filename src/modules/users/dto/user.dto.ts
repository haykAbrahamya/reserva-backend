import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/** Admin creates a branch manager; an OTP is generated as their first password. */
export const createManagerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().email(),
  phone: z.string().trim().min(4).max(40),
  locationId: z.string().uuid(),
  /** Which channel the operator will deliver the OTP through (record only). */
  otpChannel: z.enum(['phone', 'email']).default('phone'),
});
export class CreateManagerDto extends createZodDto(createManagerSchema) {}

export const updateManagerSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  email: z.string().email().optional(),
  phone: z.string().trim().min(4).max(40).optional(),
  locationId: z.string().uuid().optional(),
  active: z.boolean().optional(),
});
export class UpdateManagerDto extends createZodDto(updateManagerSchema) {}
