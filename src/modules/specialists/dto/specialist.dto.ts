import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { weekScheduleSchema } from '@/common/schemas/week-schedule.schema';
import { localizedTextSchema } from '@/common/schemas/localized';
import { paginationSchema } from '@/common/dto/pagination';

export const createSpecialistSchema = z.object({
  name: z.string().trim().min(1).max(120),
  title: z.string().trim().max(120).default(''),
  /** Optional per-language overrides for `title` (role). */
  titleI18n: localizedTextSchema,
  phone: z.string().trim().max(40).default(''),
  locationId: z.string().uuid(),
  active: z.boolean().default(true),
  /** Service ids this specialist can perform. */
  serviceIds: z.array(z.string().uuid()).default([]),
  schedule: weekScheduleSchema.optional(),
});
export class CreateSpecialistDto extends createZodDto(createSpecialistSchema) {}

export const updateSpecialistSchema = createSpecialistSchema.partial();
export class UpdateSpecialistDto extends createZodDto(updateSpecialistSchema) {}

export const listSpecialistQuerySchema = paginationSchema.extend({
  locationId: z.string().uuid().optional(),
  includeInactive: z.coerce.boolean().default(false),
  search: z.string().trim().optional(),
});
export class ListSpecialistQueryDto extends createZodDto(listSpecialistQuerySchema) {}
