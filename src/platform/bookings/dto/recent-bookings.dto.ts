import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { decodeBookingCursor } from '../booking-cursor';

/**
 * GET /platform/bookings/recent. `cursor` is the `nextCursor` of the previous
 * page; omitted (or empty) means the newest bookings. Anything this API did
 * not issue is a 400, not a silent first page.
 */
export const recentBookingsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(5),
  cursor: z
    .string()
    .optional()
    .transform((c) => (c?.trim() ? c.trim() : undefined))
    .refine((c) => c === undefined || decodeBookingCursor(c) !== null, 'Invalid cursor'),
});
export class RecentBookingsQueryDto extends createZodDto(recentBookingsQuerySchema) {}
export type RecentBookingsQuery = z.infer<typeof recentBookingsQuerySchema>;
