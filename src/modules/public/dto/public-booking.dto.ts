import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const slotsQuerySchema = z.object({
  serviceId: z.string().uuid(),
  /** Specific specialist, or omit for "any available". */
  specialistId: z.string().uuid().optional(),
  /** Branch; required for multi-location partners. */
  locationId: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
});
export class SlotsQueryDto extends createZodDto(slotsQuerySchema) {}

export const publicCreateBookingSchema = z.object({
  serviceId: z.string().uuid(),
  /** Null/omitted → auto-assign any available specialist at the branch. */
  specialistId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  clientName: z.string().trim().min(1).max(120),
  clientPhone: z.string().trim().min(4).max(40),
  notes: z.string().trim().max(1000).optional(),
});
export class PublicCreateBookingDto extends createZodDto(publicCreateBookingSchema) {}
