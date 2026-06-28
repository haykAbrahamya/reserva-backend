import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { paginationSchema } from '@/common/dto/pagination';

export const listPendingRegistrationsQuerySchema = paginationSchema.extend({
  search: z.string().trim().optional(),
  /** 'pending' (default) = actionable; 'expired' = lapsed links. */
  status: z.enum(['pending', 'expired']).optional(),
});
export class ListPendingRegistrationsQueryDto extends createZodDto(
  listPendingRegistrationsQuerySchema,
) {}
