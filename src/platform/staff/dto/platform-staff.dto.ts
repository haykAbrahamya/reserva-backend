import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { paginationSchema } from '@/common/dto/pagination';

export const listStaffQuerySchema = paginationSchema.extend({
  search: z.string().trim().optional(),
});
export class ListStaffQueryDto extends createZodDto(listStaffQuerySchema) {}

export const createStaffSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().email(),
  role: z.enum(['owner', 'operator']).default('operator'),
  /** Optional explicit password; otherwise a one-time password is generated. */
  password: z.string().min(8).optional(),
  /** May sign in to the partner backoffice as any partner (see auth/super-admin). Off unless chosen. */
  superAdmin: z.boolean().default(false),
});
export class CreateStaffDto extends createZodDto(createStaffSchema) {}

export const updateStaffSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  role: z.enum(['owner', 'operator']).optional(),
  active: z.boolean().optional(),
  superAdmin: z.boolean().optional(),
});
export class UpdateStaffDto extends createZodDto(updateStaffSchema) {}
