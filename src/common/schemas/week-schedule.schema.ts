import { z } from 'zod';

/** 'HH:MM' 24-hour time. */
export const timeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM (24h)');

export const workingDaySchema = z.object({
  enabled: z.boolean(),
  start: timeOfDay,
  end: timeOfDay,
});

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/**
 * A full week of opening hours, used by both Location and Specialist.
 *
 * `end` BEFORE `start` is legal and means the shift runs past midnight and
 * closes the next morning — 18:00→02:30 is a late-night salon, 10:00→00:00
 * closes at midnight. Only `start === end` is rejected, because it can't be
 * told apart from a zero-length day.
 *
 * Everything that interprets these windows goes through
 * `@/common/utils/availability`, which resolves the wrap; see
 * `openWindowForDate` there for the exact minute arithmetic.
 */
export const weekScheduleSchema = z
  .object(
    Object.fromEntries(WEEKDAYS.map((d) => [d, workingDaySchema])) as Record<
      (typeof WEEKDAYS)[number],
      typeof workingDaySchema
    >,
  )
  .partial()
  .refine(
    (sched) =>
      Object.values(sched).every((d) => !d || !d.enabled || d.start !== d.end),
    {
      message:
        'Each enabled day must have a start and end that differ (an end before the start means the day closes after midnight)',
    },
  );

export type WeekScheduleInput = z.infer<typeof weekScheduleSchema>;
