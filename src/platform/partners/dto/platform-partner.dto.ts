import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { paginationSchema } from '@/common/dto/pagination';

export const listPlatformPartnersQuerySchema = paginationSchema.extend({
  search: z.string().trim().optional(),
  /** Filter by active state. Omit for all. */
  active: z.coerce.boolean().optional(),
});
export class ListPlatformPartnersQueryDto extends createZodDto(listPlatformPartnersQuerySchema) {}

export const setPartnerActiveSchema = z.object({ active: z.boolean() });
export class SetPartnerActiveDto extends createZodDto(setPartnerActiveSchema) {}

export const setPartnerMarketplaceSchema = z.object({ listed: z.boolean() });
export class SetPartnerMarketplaceDto extends createZodDto(setPartnerMarketplaceSchema) {}

export const setPartnerBookingsSchema = z.object({ enabled: z.boolean() });
export class SetPartnerBookingsDto extends createZodDto(setPartnerBookingsSchema) {}

// ── Partner users (platform support) ──
export const platformUpdateUserSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().min(4).max(40).optional(),
  active: z.boolean().optional(),
});
export class PlatformUpdateUserDto extends createZodDto(platformUpdateUserSchema) {}

/** Reset a user's password. Omit `password` to auto-generate a one-time one. */
export const platformResetPasswordSchema = z.object({
  password: z.string().min(8).max(100).optional(),
});
export class PlatformResetPasswordDto extends createZodDto(platformResetPasswordSchema) {}
