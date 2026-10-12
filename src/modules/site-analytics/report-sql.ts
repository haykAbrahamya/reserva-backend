import { Prisma } from '@prisma/client';
import { addDays } from './calendar-day';
import type { Site } from './pulse-batch';

/*
 * SQL building blocks shared by the console's reports.
 *
 * Time. Report days are Asia/Yerevan calendar days, inclusive at both ends.
 * The columns are timestamp(3) holding UTC, so a range becomes the half-open
 * UTC interval [Yerevan midnight of `from`, Yerevan midnight after `to`) —
 * computed by Postgres from the 'YYYY-MM-DD' strings, which keeps the result
 * independent of the process and session time zones, and keeps the predicate
 * a plain range on the indexed column. Days are bucketed with the contract's
 * expression: ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Yerevan')::date.
 *
 * Audience. A report covers one site (reserva.am, or tools.reserva.am). Bot
 * sessions never count. Internal (staff) sessions count only with
 * includeInternal. "In range" for a visitor or a session means it has at
 * least one event in range.
 *
 * Every query is a tagged template: values travel as bind parameters, and
 * these fragments are fixed SQL text.
 */

/** Inclusive calendar-day window. */
export interface Window {
  from: string;
  to: string;
}

/** The UTC instant (as stored) at which a Yerevan calendar day begins. */
export const yerevanMidnight = (day: string) =>
  Prisma.sql`(((${day}::date)::timestamp AT TIME ZONE 'Asia/Yerevan') AT TIME ZONE 'UTC')`;

/** Events (alias `e`) created inside the window. */
export const eventsIn = (w: Window) =>
  Prisma.sql`e."createdAt" >= ${yerevanMidnight(w.from)} AND e."createdAt" < ${yerevanMidnight(addDays(w.to, 1))}`;

/** Bookings (alias `b`) created inside the window. */
export const bookingsIn = (w: Window) =>
  Prisma.sql`b."createdAt" >= ${yerevanMidnight(w.from)} AND b."createdAt" < ${yerevanMidnight(addDays(w.to, 1))}`;

/** Who a report counts: one site's sessions, with or without staff. */
export interface Audience {
  includeInternal: boolean;
  site: Site;
}

/**
 * Which sessions (alias `s`) a report sees: one site's, never bots, staff only
 * on request. Sites are never mixed — tools.reserva.am traffic must not move
 * the booking site's numbers, nor the other way round.
 */
export const audience = (a: Audience) =>
  a.includeInternal
    ? Prisma.sql`s."site" = ${a.site} AND NOT s."isBot"`
    : Prisma.sql`s."site" = ${a.site} AND NOT s."isBot" AND NOT s."isInternal"`;
