import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * A price override is one unit: type and amount together, or neither (inherit).
 * Mirrors the CHECK constraints on `location_services` / `specialist_prices`, so
 * a bad payload is a clean 400 here instead of a constraint error later.
 */
const priceUnit = (
  v: { priceType: 'fixed' | 'range' | null; price: number | null; priceMax: number | null },
  ctx: z.RefinementCtx,
) => {
  if ((v.priceType == null) !== (v.price == null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['price'], message: 'Set both the price type and the price, or neither' });
  }
  if (v.priceType !== 'range' && v.priceMax != null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['priceMax'], message: 'Only a range price can have an upper price' });
  }
  if (v.priceType === 'range' && v.priceMax != null && v.price != null && v.priceMax <= v.price) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['priceMax'], message: 'Upper price must be greater than the lower price' });
  }
};

const priceFields = {
  priceType: z.enum(['fixed', 'range']).nullable().default(null),
  price: z.number().int().min(0).nullable().default(null),
  priceMax: z.number().int().min(0).nullable().default(null),
  /** Minutes; null = inherit. Same bounds as Service.duration. */
  duration: z.number().int().min(5).max(600).nullable().default(null),
};

/** One branch's settings for the service. */
const branchRowSchema = z
  .object({
    locationId: z.string().uuid(),
    /** false = the branch doesn't offer this service at all. */
    offered: z.boolean().default(true),
    ...priceFields,
    /** Facility services only: concurrent guests at this branch; null = inherit. */
    capacity: z.number().int().min(1).max(200).nullable().default(null),
  })
  .superRefine(priceUnit);

/** One specialist's own price/duration for the service at one branch. */
const specialistRowSchema = z
  .object({
    specialistId: z.string().uuid(),
    locationId: z.string().uuid(),
    ...priceFields,
  })
  .superRefine(priceUnit);

/**
 * The desired price grid of ONE service, saved in one go from the backoffice.
 * Each list that is sent REPLACES that kind of row for the branches in scope
 * (absent rows go back to inherit); a list that is omitted is left untouched.
 * Scope = the branches the caller may edit (a manager: their own), narrowed to
 * `?locationId=` when given — so a branch screen can save just its own rows.
 */
export const saveServicePricingSchema = z.object({
  branches: z.array(branchRowSchema).max(200).optional(),
  specialists: z.array(specialistRowSchema).max(5000).optional(),
});
export class SaveServicePricingDto extends createZodDto(saveServicePricingSchema) {}
export type SaveServicePricingInput = z.infer<typeof saveServicePricingSchema>;

export const saveServicePricingQuerySchema = z.object({
  /** Only replace rows of this branch. */
  locationId: z.string().uuid().optional(),
});
export class SaveServicePricingQueryDto extends createZodDto(saveServicePricingQuerySchema) {}
