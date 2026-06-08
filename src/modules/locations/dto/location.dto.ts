import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { weekScheduleSchema } from '@/common/schemas/week-schedule.schema';
import { paginationSchema } from '@/common/dto/pagination';

export const createLocationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().min(1).max(240),
  phone: z.string().trim().max(40).default(''),
  hours: weekScheduleSchema.optional(),
});
export class CreateLocationDto extends createZodDto(createLocationSchema) {}

export const updateLocationSchema = createLocationSchema.partial();
export class UpdateLocationDto extends createZodDto(updateLocationSchema) {}

export const listLocationQuerySchema = paginationSchema.extend({
  search: z.string().trim().optional(),
});
export class ListLocationQueryDto extends createZodDto(listLocationQuerySchema) {}
