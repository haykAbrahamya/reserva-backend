import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { weekScheduleSchema } from '@/common/schemas/week-schedule.schema';
import { localizedTextSchema } from '@/common/schemas/localized';
import { paginationSchema } from '@/common/dto/pagination';

export const createLocationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  /** Optional per-language overrides for `name` ({ hy?, en?, ru? }). Only the
   *  branch name is translatable — address/geo stay single-value. */
  nameI18n: localizedTextSchema,
  address: z.string().trim().min(1).max(240),
  /**
   * Structured place from the platform catalog. Optional here so the branches
   * that predate the column keep validating; the requirement lives at the
   * product boundary instead (a vacancy cannot publish without it). Null clears
   * it.
   */
  areaKey: z.string().trim().min(1).nullable().optional(),
  phone: z.string().trim().max(40).default(''),
  hours: weekScheduleSchema.optional(),
  /** Geo coordinates from the map picker. Nullable to allow clearing the pin. */
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
});
export class CreateLocationDto extends createZodDto(createLocationSchema) {}

export const updateLocationSchema = createLocationSchema.partial();
export class UpdateLocationDto extends createZodDto(updateLocationSchema) {}

export const listLocationQuerySchema = paginationSchema.extend({
  search: z.string().trim().optional(),
});
export class ListLocationQueryDto extends createZodDto(listLocationQuerySchema) {}
