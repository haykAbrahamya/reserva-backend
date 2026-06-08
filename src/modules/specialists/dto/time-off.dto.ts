import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const createTimeOffSchema = z
  .object({
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
    allDay: z.boolean().default(false),
    reason: z.string().trim().max(200).optional(),
    /** Save even if it overlaps existing bookings (default: reject with conflicts). */
    force: z.boolean().default(false),
  })
  .refine((d) => d.endAt > d.startAt, {
    message: 'End must be after start',
    path: ['endAt'],
  });
export class CreateTimeOffDto extends createZodDto(createTimeOffSchema) {}

export const updateTimeOffSchema = z
  .object({
    startAt: z.coerce.date().optional(),
    endAt: z.coerce.date().optional(),
    allDay: z.boolean().optional(),
    reason: z.string().trim().max(200).nullable().optional(),
    force: z.boolean().default(false),
  });
export class UpdateTimeOffDto extends createZodDto(updateTimeOffSchema) {}
