import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { paginationSchema } from '@/common/dto/pagination';

const trimmed = (max: number) => z.string().trim().max(max);

/** Public "Book a demo" submission. Name + at least one contact required. */
export const createDemoRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    company: trimmed(160).optional().or(z.literal('')),
    phone: trimmed(40).optional().or(z.literal('')),
    email: z.string().trim().email().max(160).optional().or(z.literal('')),
    notes: trimmed(2000).optional().or(z.literal('')),
  })
  .refine((d) => !!(d.phone && d.phone.trim()) || !!(d.email && d.email.trim()), {
    message: 'Provide a phone or an email so we can reach you',
    path: ['phone'],
  });
export class CreateDemoRequestDto extends createZodDto(createDemoRequestSchema) {}

/** Platform-side listing (paginated, filter by status). */
export const listDemoRequestsQuerySchema = paginationSchema.extend({
  status: z.enum(['new', 'done']).optional(),
});
export class ListDemoRequestsQueryDto extends createZodDto(listDemoRequestsQuerySchema) {}

export const setDemoRequestStatusSchema = z.object({
  status: z.enum(['new', 'done']),
});
export class SetDemoRequestStatusDto extends createZodDto(setDemoRequestStatusSchema) {}
