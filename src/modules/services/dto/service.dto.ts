import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { paginationSchema } from '@/common/dto/pagination';
import { localizedTextSchema } from '@/common/schemas/localized';

const serviceFields = z.object({
  name: z.string().trim().min(1).max(120),
  /** Optional per-language overrides for `name`. */
  nameI18n: localizedTextSchema,
  category: z.string().trim().max(60).default(''),
  /** Optional per-language overrides for `category`. */
  categoryI18n: localizedTextSchema,
  /** 'fixed' → exact `price`. 'range' → `price` (min) .. `priceMax` (max). */
  priceType: z.enum(['fixed', 'range']).default('fixed'),
  /** Fixed price, or the lower bound of a range. */
  price: z.number().int().min(0),
  /** Upper bound; required for range, must be null/absent for fixed. */
  priceMax: z.number().int().min(0).nullable().optional(),
  duration: z.number().int().min(5).max(600), // minutes
  /** Recurrence interval in TOTAL DAYS (null = no repeat). Max ~5 years. */
  repeatEveryDays: z.number().int().min(1).max(1825).nullable().optional(),
  /** When false, a facility/entry service (no specialist; uses location hours + capacity). */
  requiresSpecialist: z.boolean().default(true),
  /** Concurrent capacity per slot for no-specialist services (1–200). */
  capacity: z.number().int().min(1).max(200).default(1),
  active: z.boolean().default(true),
});

/** Cross-field price rules, applied to both create (full) and update (partial).
 *  Only enforced when the relevant fields are present so partial updates work. */
const refinePrice = (v: {
  priceType?: 'fixed' | 'range';
  price?: number;
  priceMax?: number | null;
}, ctx: z.RefinementCtx) => {
  if (v.priceType === 'range') {
    if (v.priceMax == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['priceMax'], message: 'Range services need an upper price' });
    } else if (typeof v.price === 'number' && v.priceMax <= v.price) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['priceMax'], message: 'Upper price must be greater than the lower price' });
    }
  }
  if (v.priceType === 'fixed' && v.priceMax != null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['priceMax'], message: 'Fixed services can’t have an upper price' });
  }
};

export const createServiceSchema = serviceFields.superRefine(refinePrice);
export class CreateServiceDto extends createZodDto(createServiceSchema) {}

export const updateServiceSchema = serviceFields.partial().superRefine(refinePrice);
export class UpdateServiceDto extends createZodDto(updateServiceSchema) {}

export const listServiceQuerySchema = paginationSchema.extend({
  /** Include soft-deleted + inactive. Default: only active, non-deleted. */
  includeInactive: z.coerce.boolean().default(false),
  /** Free-text search over the service NAME — matches the base name AND any of
   *  its translations (nameI18n), so a term in any language finds the service. */
  search: z.string().trim().optional(),
  /** Exact category filter (the base category value picked from the dropdown).
   *  Empty string is a valid value (services with no category). */
  category: z.string().optional(),
});
export class ListServiceQueryDto extends createZodDto(listServiceQuerySchema) {}

/** Drag-to-reorder: the partner's services in their new display order. Any id
 *  not owned by the partner is ignored; unlisted services keep their relative
 *  order after the listed ones. Mirrors the gallery-reorder contract. */
export const reorderServicesSchema = z.object({
  ids: z.array(z.string().max(64)).max(500),
});
export class ReorderServicesDto extends createZodDto(reorderServicesSchema) {}
