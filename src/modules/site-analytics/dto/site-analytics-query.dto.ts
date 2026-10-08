import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { daysInclusive, isCalendarDay } from '../calendar-day';
import { CHANNELS } from '../traffic-source';

/**
 * Longest window one report may cover: 3 years, so the console's "All time"
 * fits while a single request stays bounded (contract §8, amendment 1).
 */
export const MAX_RANGE_DAYS = 1096;

/** An Asia/Yerevan calendar day, inclusive at both ends of a range. */
const calendarDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine(isCalendarDay, 'Not a calendar date');

/**
 * 'true' includes staff/internal sessions (default: excluded). Parsed
 * explicitly rather than with z.coerce.boolean(), which reads the STRING
 * 'false' as true.
 */
const includeInternal = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const rangeFields = z.object({ from: calendarDay, to: calendarDay, includeInternal });

function checkRange(q: { from: string; to: string }, ctx: z.RefinementCtx) {
  // Skip when a day itself is invalid; that issue is already reported.
  if (!isCalendarDay(q.from) || !isCalendarDay(q.to)) return;
  const days = daysInclusive(q.from, q.to);
  if (days < 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['to'],
      message: '`to` must be on or after `from`',
    });
  } else if (days > MAX_RANGE_DAYS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['to'],
      message: `A range spans at most ${MAX_RANGE_DAYS} days`,
    });
  }
}

/** overview, partners. */
export const analyticsRangeQuerySchema = rangeFields.superRefine(checkRange);
export class AnalyticsRangeQueryDto extends createZodDto(analyticsRangeQuerySchema) {}
export type AnalyticsRangeQuery = z.infer<typeof analyticsRangeQuerySchema>;

/** sources: optionally only sessions with an event on one partner. */
export const analyticsSourcesQuerySchema = rangeFields
  .extend({ partnerId: z.string().uuid().optional() })
  .superRefine(checkRange);
export class AnalyticsSourcesQueryDto extends createZodDto(analyticsSourcesQuerySchema) {}
export type AnalyticsSourcesQuery = z.infer<typeof analyticsSourcesQuerySchema>;

/**
 * DELETE data: `before` keeps that Yerevan day and everything after it; no
 * `before` deletes everything. An empty or malformed value is a 400 — it must
 * never fall through to "everything".
 */
export const analyticsClearQuerySchema = z.object({ before: calendarDay.optional() });
export class AnalyticsClearQueryDto extends createZodDto(analyticsClearQuerySchema) {}

/** events: the raw event log, newest first, paginated. */
export const analyticsEventsQuerySchema = rangeFields
  .extend({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
    name: z
      .string()
      .regex(/^[a-z_]{1,40}$/, 'Expected an event name')
      .optional(),
    partnerId: z.string().uuid().optional(),
  })
  .superRefine(checkRange);
export class AnalyticsEventsQueryDto extends createZodDto(analyticsEventsQuerySchema) {}
export type AnalyticsEventsQuery = z.infer<typeof analyticsEventsQuerySchema>;

/**
 * What a session achieved (contract §11). `bounced` = exactly one event, and
 * that one a page_view; `reviewed` = left a review (contract §12).
 */
export const SESSION_OUTCOMES = [
  'booked',
  'contacted',
  'signup',
  'reviewed',
  'bookclick',
  'bounced',
] as const;
export type SessionOutcome = (typeof SESSION_OUTCOMES)[number];

/** sessions: visits, newest first, paginated; optionally one partner / source / outcome. */
export const analyticsSessionsQuerySchema = rangeFields
  .extend({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(25),
    partnerId: z.string().uuid().optional(),
    channel: z.enum(CHANNELS).optional(),
    outcome: z.enum(SESSION_OUTCOMES).optional(),
  })
  .superRefine(checkRange);
export class AnalyticsSessionsQueryDto extends createZodDto(analyticsSessionsQuerySchema) {}
export type AnalyticsSessionsQuery = z.infer<typeof analyticsSessionsQuerySchema>;
