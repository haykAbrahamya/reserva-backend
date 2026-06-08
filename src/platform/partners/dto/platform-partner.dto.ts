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
