import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { paginationSchema } from '@/common/dto/pagination';

export const listClientsQuerySchema = paginationSchema.extend({
  /** Free-text search across name + phone. */
  search: z.string().trim().max(120).optional(),
});
export class ListClientsQueryDto extends createZodDto(listClientsQuerySchema) {}

export const updateClientSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().email().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
export class UpdateClientDto extends createZodDto(updateClientSchema) {}
