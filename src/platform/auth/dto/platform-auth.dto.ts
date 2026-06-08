import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/** Platform staff log in by email + password. */
export const platformLoginSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password'),
});
export class PlatformLoginDto extends createZodDto(platformLoginSchema) {}

export const platformRefreshSchema = z.object({
  refreshToken: z.string().min(10),
});
export class PlatformRefreshDto extends createZodDto(platformRefreshSchema) {}

export const platformChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8, 'New password must be at least 8 characters'),
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: 'New password must differ from the current one',
    path: ['newPassword'],
  });
export class PlatformChangePasswordDto extends createZodDto(platformChangePasswordSchema) {}
