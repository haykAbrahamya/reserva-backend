import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { paginationSchema } from '@/common/dto/pagination';

const bookingStatus = z.enum(['pending', 'confirmed', 'cancelled', 'completed', 'noshow']);

export const listBookingsQuerySchema = paginationSchema.extend({
  status: bookingStatus.optional(),
  specialistId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  /** Inclusive date range on the booking start (YYYY-MM-DD). */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  search: z.string().trim().max(120).optional(),
});
export class ListBookingsQueryDto extends createZodDto(listBookingsQuerySchema) {}

/**
 * Calendar window query. `from`/`to` are validated as real dates so a malformed
 * value returns a clean 400 instead of crashing Prisma with an Invalid Date.
 */
export const calendarQuerySchema = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
  })
  .refine((q) => q.from <= q.to, { message: '`from` must be on or before `to`', path: ['from'] });
export class CalendarQueryDto extends createZodDto(calendarQuerySchema) {}

export const createBookingSchema = z.object({
  locationId: z.string().uuid(),
  /** Null/omitted for facility/entry services (spa) that aren't tied to a person. */
  specialistId: z.string().uuid().nullable().optional(),
  serviceId: z.string().uuid(),
  clientName: z.string().trim().min(1).max(120),
  clientPhone: z.string().trim().min(4).max(40),
  /** Booking start; end is derived from the service duration. */
  startAt: z.coerce.date(),
  notes: z.string().trim().max(2000).optional(),
  status: bookingStatus.default('confirmed'),
  /** UI language the booking was made in, for localized reminders later. */
  locale: z.enum(['en', 'hy', 'ru']).optional(),
});
export class CreateBookingDto extends createZodDto(createBookingSchema) {}

/** Reschedule / reassign. End recomputed from the (possibly new) service. */
export const updateBookingSchema = z.object({
  specialistId: z.string().uuid().optional(),
  serviceId: z.string().uuid().optional(),
  startAt: z.coerce.date().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
export class UpdateBookingDto extends createZodDto(updateBookingSchema) {}

export const updateStatusSchema = z.object({ status: bookingStatus });
export class UpdateStatusDto extends createZodDto(updateStatusSchema) {}
