import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/** Login by email OR phone, plus password. */
export const loginSchema = z.object({
  login: z.string().min(3, 'Enter your email or phone'),
  password: z.string().min(1, 'Enter your password'),
});
export class LoginDto extends createZodDto(loginSchema) {}

export const refreshSchema = z.object({
  refreshToken: z.string().min(10),
});
export class RefreshDto extends createZodDto(refreshSchema) {}

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8, 'New password must be at least 8 characters'),
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: 'New password must differ from the current one',
    path: ['newPassword'],
  });
export class ChangePasswordDto extends createZodDto(changePasswordSchema) {}
