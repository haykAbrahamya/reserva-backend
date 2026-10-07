/**
 * Arithmetic on 'YYYY-MM-DD' calendar days. Pure dates: the strings are read
 * as UTC midnights only to count and step days, so neither the process time
 * zone nor DST can shift a result. Turning a day into the instants it covers
 * (Asia/Yerevan) is left to Postgres — see site-analytics.service.ts.
 */

const DAY_MS = 86_400_000;
const at = (day: string) => Date.parse(`${day}T00:00:00Z`);

/** True for a real calendar day in YYYY-MM-DD form ('2026-02-30' is not one). */
export function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = at(value);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

/** `day` moved by `n` days (negative goes back). */
export function addDays(day: string, n: number): string {
  return new Date(at(day) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Days in the inclusive range from..to (1 when equal, ≤ 0 when to < from). */
export function daysInclusive(from: string, to: string): number {
  return Math.round((at(to) - at(from)) / DAY_MS) + 1;
}

/** Every day from..to inclusive, ascending. */
export function eachDay(from: string, to: string): string[] {
  const n = daysInclusive(from, to);
  return Array.from({ length: Math.max(0, n) }, (_, i) => addDays(from, i));
}
