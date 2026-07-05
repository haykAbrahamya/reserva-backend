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

/**
 * Query for the day-strip availability summary: how open each of `days` days is,
 * starting at `from`. Same service/specialist/branch context as {@link slotsQuerySchema}.
 * `days` is clamped server-side; the strip shows 7.
 */
export const availabilitySummaryQuerySchema = z.object({
  serviceId: z.string().uuid(),
  specialistId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
  days: z.coerce.number().int().min(1).max(31).optional(),
});
export class AvailabilitySummaryQueryDto extends createZodDto(availabilitySummaryQuerySchema) {}

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
  /** UI language the booking was made in, for localized reminders later. */
  locale: z.enum(['en', 'hy', 'ru']).optional(),
});
export class PublicCreateBookingDto extends createZodDto(publicCreateBookingSchema) {}
