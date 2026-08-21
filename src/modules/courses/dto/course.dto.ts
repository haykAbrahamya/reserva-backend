import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { paginationSchema } from '@/common/dto/pagination';
import { localizedTextSchema } from '@/common/schemas/localized';

/**
 * Course = the reusable template (title, cover, price, tutor). Its actual runs
 * live in CourseCohort; its members in CourseEnrollment. Fields here never
 * change per run.
 */
const courseFields = z.object({
  title: z.string().trim().min(1).max(140),
  /** Optional per-language overrides for `title`. */
  titleI18n: localizedTextSchema,
  summary: z.string().trim().max(240).default(''),
  /** Optional per-language overrides for `summary`. */
  summaryI18n: localizedTextSchema,
  description: z.string().trim().max(6000).default(''),
  /** Optional per-language overrides for `description`. */
  descriptionI18n: localizedTextSchema,

  /** How the price is presented publicly: 'hidden' (nothing shown), 'free'
   *  (shows "Free"), or 'paid' (shows `price`). */
  priceMode: z.enum(['hidden', 'free', 'paid']).default('paid'),
  /** Price in whole AMD. Only used when priceMode = 'paid'. */
  price: z.number().int().min(0).max(100_000_000).default(0),

  /** Tutor: EITHER a linked specialist id OR free-text name/title (guest).
   *  Both may be empty (no tutor shown). */
  tutorSpecialistId: z.string().trim().min(1).nullable().optional(),
  tutorName: z.string().trim().max(120).default(''),
  tutorTitle: z.string().trim().max(120).default(''),

  /** Optional difficulty badge. */
  level: z.enum(['beginner', 'intermediate', 'advanced']).nullable().optional(),

  /** Public visibility. false = draft (hidden from the public page). */
  active: z.boolean().default(true),
});

/** Paid courses need a positive price. Only enforced when both fields are
 *  present (so partial updates that touch neither still pass). */
const requirePaidPrice = (
  v: { priceMode?: 'hidden' | 'free' | 'paid'; price?: number },
  ctx: z.RefinementCtx,
) => {
  if (v.priceMode === 'paid' && v.price !== undefined && v.price <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['price'], message: 'Paid courses need a price above 0' });
  }
};

/** Free/hidden courses carry no amount — force price to 0 so a stale value
 *  can't linger. Leaves paid prices untouched. Applied after validation. */
const normalizePrice = <T extends { priceMode?: 'hidden' | 'free' | 'paid'; price?: number }>(v: T): T =>
  (v.priceMode === 'free' || v.priceMode === 'hidden') && v.price !== undefined
    ? { ...v, price: 0 }
    : v;

export const createCourseSchema = courseFields.superRefine(requirePaidPrice).transform(normalizePrice);
export class CreateCourseDto extends createZodDto(createCourseSchema) {}

export const updateCourseSchema = courseFields.partial().superRefine(requirePaidPrice).transform(normalizePrice);
export class UpdateCourseDto extends createZodDto(updateCourseSchema) {}

export const listCourseQuerySchema = paginationSchema.extend({
  /** Include soft-deleted + inactive (draft) courses. Default: active only. */
  includeInactive: z.coerce.boolean().default(false),
  /** Free-text search over the title. */
  search: z.string().trim().optional(),
});
export class ListCourseQueryDto extends createZodDto(listCourseQuerySchema) {}
