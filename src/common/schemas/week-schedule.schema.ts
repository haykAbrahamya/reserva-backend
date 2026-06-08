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

/** A full week of opening hours, used by both Location and Specialist. */
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
      Object.values(sched).every((d) => !d || !d.enabled || d.start < d.end),
    { message: 'Each enabled day must have start before end' },
  );

export type WeekScheduleInput = z.infer<typeof weekScheduleSchema>;
