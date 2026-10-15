import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/** A super admin signs in with their internal-console email and password. */
export const superLoginSchema = z.object({
  email: z.string().trim().email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password'),
});
export class SuperLoginDto extends createZodDto(superLoginSchema) {}

/**
 * Rotate the super admin session. With `partnerId`, the access token that
 * comes back is for that partner — how the backoffice keeps working in one.
 */
export const superRefreshSchema = z.object({
  refreshToken: z.string().min(10),
  partnerId: z.string().trim().min(1).max(64).optional(),
});
export class SuperRefreshDto extends createZodDto(superRefreshSchema) {}

export const superLogoutSchema = z.object({ refreshToken: z.string().min(10) });
export class SuperLogoutDto extends createZodDto(superLogoutSchema) {}

/** Enter (or switch to) a partner's backoffice. */
export const superEnterSchema = z.object({ partnerId: z.string().trim().min(1).max(64) });
export class SuperEnterDto extends createZodDto(superEnterSchema) {}

export const superPartnersQuerySchema = z.object({ search: z.string().trim().max(100).optional() });
export class SuperPartnersQueryDto extends createZodDto(superPartnersQuerySchema) {}
