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

export const setPartnerCoursesSchema = z.object({ enabled: z.boolean() });
export class SetPartnerCoursesDto extends createZodDto(setPartnerCoursesSchema) {}

/** Grant or withdraw any catalog product for a partner. */
export const setPartnerProductSchema = z.object({ enabled: z.boolean() });
export class SetPartnerProductDto extends createZodDto(setPartnerProductSchema) {}

/**
 * Write one product-specific setting. `setting` is checked server-side against
 * the SETTING_COLUMNS allowlist, so this cannot reach arbitrary columns.
 */
export const setProductSettingSchema = z.object({
  setting: z.string().trim().min(1).max(60),
  value: z.boolean(),
});
export class SetProductSettingDto extends createZodDto(setProductSettingSchema) {}

/** Paginated, minimal booking rows for the console. */
export const partnerBookingsQuerySchema = paginationSchema;
export class PartnerBookingsQueryDto extends createZodDto(partnerBookingsQuerySchema) {}

export const setPartnerKindSchema = z.object({ kind: z.enum(['salon', 'single']) });
export class SetPartnerKindDto extends createZodDto(setPartnerKindSchema) {}

// ── Partner users (platform support) ──
export const platformUpdateUserSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email().max(160).optional(),
  phone: z.string().trim().min(4).max(40).optional(),
  active: z.boolean().optional(),
});
export class PlatformUpdateUserDto extends createZodDto(platformUpdateUserSchema) {}

/** Reset a user's password. Omit `password` to auto-generate a one-time one. */
export const platformResetPasswordSchema = z.object({
  password: z.string().min(8).max(100).optional(),
});
export class PlatformResetPasswordDto extends createZodDto(platformResetPasswordSchema) {}
