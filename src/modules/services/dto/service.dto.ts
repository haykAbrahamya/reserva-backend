import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { paginationSchema } from '@/common/dto/pagination';

export const createServiceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().max(60).default(''),
  price: z.number().int().min(0),
  duration: z.number().int().min(5).max(600), // minutes
  /** Recurrence interval in TOTAL DAYS (null = no repeat). Max ~5 years. */
  repeatEveryDays: z.number().int().min(1).max(1825).nullable().optional(),
  active: z.boolean().default(true),
});
export class CreateServiceDto extends createZodDto(createServiceSchema) {}

export const updateServiceSchema = createServiceSchema.partial();
export class UpdateServiceDto extends createZodDto(updateServiceSchema) {}

export const listServiceQuerySchema = paginationSchema.extend({
  /** Include soft-deleted + inactive. Default: only active, non-deleted. */
  includeInactive: z.coerce.boolean().default(false),
  /** Free-text search over name/category. */
  search: z.string().trim().optional(),
});
export class ListServiceQueryDto extends createZodDto(listServiceQuerySchema) {}
