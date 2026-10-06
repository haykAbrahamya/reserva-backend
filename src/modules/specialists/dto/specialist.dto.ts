import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { weekScheduleSchema } from '@/common/schemas/week-schedule.schema';
import { localizedTextSchema } from '@/common/schemas/localized';
import { paginationSchema } from '@/common/dto/pagination';

/** One branch a specialist works at, with their weekly hours there. */
export const specialistBranchSchema = z.object({
  locationId: z.string().uuid(),
  /** Hours at this branch. Omitted on create = a sensible default week; omitted
   *  on update = keep the hours already stored for this branch. */
  schedule: weekScheduleSchema.optional(),
});
export type SpecialistBranchInput = z.infer<typeof specialistBranchSchema>;

const specialistFields = z.object({
  name: z.string().trim().min(1).max(120),
  /** Optional per-language overrides for `name`. */
  nameI18n: localizedTextSchema,
  title: z.string().trim().max(120).default(''),
  /** Optional per-language overrides for `title` (role). */
  titleI18n: localizedTextSchema,
  phone: z.string().trim().max(40).default(''),
  /** HOME branch. Also the only branch for clients that predate `locations`. */
  locationId: z.string().uuid(),
  /**
   * Every branch the specialist works at, home included, each with its own
   * hours. Omitted = just the home branch (the original single-branch shape).
   */
  locations: z
    .array(specialistBranchSchema)
    .min(1)
    .max(50)
    .refine((ls) => new Set(ls.map((l) => l.locationId)).size === ls.length, {
      message: 'Each branch can only be listed once',
    })
    .optional(),
  active: z.boolean().default(true),
  /** Service ids this specialist can perform. */
  serviceIds: z.array(z.string().uuid()).default([]),
  /** Hours at the HOME branch (the original single-branch field). */
  schedule: weekScheduleSchema.optional(),
});

/** When both are sent, the home branch must be one of the listed branches. */
const homeIsListed = (
  v: { locationId?: string; locations?: SpecialistBranchInput[] },
  ctx: z.RefinementCtx,
) => {
  if (v.locationId && v.locations && !v.locations.some((l) => l.locationId === v.locationId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['locationId'],
      message: 'The home branch must be one of the branches the specialist works at',
    });
  }
};

export const createSpecialistSchema = specialistFields.superRefine(homeIsListed);
export class CreateSpecialistDto extends createZodDto(createSpecialistSchema) {}

export const updateSpecialistSchema = specialistFields.partial().superRefine(homeIsListed);
export class UpdateSpecialistDto extends createZodDto(updateSpecialistSchema) {}

export const listSpecialistQuerySchema = paginationSchema.extend({
  /** Specialists who work at this branch (home or not). */
  locationId: z.string().uuid().optional(),
  includeInactive: z.coerce.boolean().default(false),
  search: z.string().trim().optional(),
});
export class ListSpecialistQueryDto extends createZodDto(listSpecialistQuerySchema) {}
