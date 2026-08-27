import { WEEKDAYS, type WeekScheduleInput } from '@/common/schemas/week-schedule.schema';

export const MINUTES_PER_DAY = 1440;

/** [startMs, endMs) half-open interval overlap test. */
export function intervalsOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Map a JS Date to our Mon-first weekday key. */
export function weekdayKey(d: Date): (typeof WEEKDAYS)[number] {
  // getDay(): 0=Sun..6=Sat → shift so Mon=0.
  return WEEKDAYS[(d.getDay() + 6) % 7];
}

/** 'HH:MM' → minutes from midnight. */
export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * The open minute window for a given date from a week schedule, or null when
 * that weekday is disabled / missing.
 *
 * `endMin` MAY EXCEED 1440. An `end` before `start` means the shift runs past
 * midnight and closes the next morning, so it is normalised onto a single
 * continuous timeline measured from this date's own midnight:
 *
 *   10:00 → 19:00  →  { 600, 1140 }   ordinary day
 *   18:00 → 02:30  →  { 1080, 1590 }  closes 02:30 the NEXT day
 *   10:00 → 00:00  →  { 600, 1440 }   closes at midnight
 *
 * `start === end` is rejected by the schema; if a legacy row still holds one we
 * return a zero-length window, which yields no slots (the previous behaviour)
 * rather than silently meaning "open 24 hours".
 */
export function openWindowForDate(
  schedule: WeekScheduleInput | null | undefined,
  date: Date,
): { startMin: number; endMin: number } | null {
  if (!schedule) return null;
  const day = schedule[weekdayKey(date)];
  if (!day || !day.enabled) return null;
  const startMin = timeToMinutes(day.start);
  let endMin = timeToMinutes(day.end);
  if (endMin < startMin) endMin += MINUTES_PER_DAY;
  return { startMin, endMin };
}

/** The calendar day before `date` at the same clock time (handles month/DST). */
function previousDay(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - 1);
  return d;
}

/**
 * A stretch of one calendar date during which an appointment may START.
 *
 * Overnight shifts break the assumption that a day's window fits inside one
 * date, so a date is described by up to two of these: its own shift, plus the
 * tail of the previous day's overnight shift. Splitting it this way is what
 * keeps the public API contract intact — every slot we emit stays a real
 * wall-clock 'HH:MM' on the requested date, so no caller ever sees "25:00" or
 * has to know a slot belongs to the next day.
 */
export interface SlotRange {
  /** First candidate start, in minutes from the date's midnight. */
  from: number;
  /** Exclusive upper bound for a START time. Always ≤ 1440, so every slot label
   *  is a real time on this date. */
  startBefore: number;
  /** The shift's true close. May exceed 1440 — an appointment is allowed to run
   *  past midnight to the end of an overnight shift. */
  closeAt: number;
}

/** Union overlapping ranges so a slot can't be emitted twice (a day starting at
 *  00:00 can overlap the previous day's spill). */
function mergeRanges(ranges: SlotRange[]): SlotRange[] {
  if (ranges.length < 2) return ranges;
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  const out: SlotRange[] = [{ ...sorted[0] }];
  for (const r of sorted.slice(1)) {
    const last = out[out.length - 1];
    if (r.from <= last.startBefore) {
      last.startBefore = Math.max(last.startBefore, r.startBefore);
      last.closeAt = Math.max(last.closeAt, r.closeAt);
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

/**
 * The stretches of `date` this schedule makes bookable: its own shift, plus any
 * tail spilling over from the previous day's overnight shift. Empty when the
 * schedule leaves the date closed.
 */
export function openRangesForDate(
  schedule: WeekScheduleInput | null | undefined,
  date: Date,
): SlotRange[] {
  const out: SlotRange[] = [];

  const own = openWindowForDate(schedule, date);
  if (own && own.startMin < own.endMin && own.startMin < MINUTES_PER_DAY) {
    out.push({
      from: own.startMin,
      startBefore: Math.min(own.endMin, MINUTES_PER_DAY),
      closeAt: own.endMin,
    });
  }

  // Yesterday's shift running past midnight lands on this date as [0, tail).
  const before = openWindowForDate(schedule, previousDay(date));
  if (before && before.endMin > MINUTES_PER_DAY) {
    const tail = before.endMin - MINUTES_PER_DAY;
    out.push({ from: 0, startBefore: tail, closeAt: tail });
  }

  return mergeRanges(out);
}

/** Intersect two sets of ranges (specialist ∩ location). */
function intersectRanges(a: SlotRange[], b: SlotRange[]): SlotRange[] {
  const out: SlotRange[] = [];
  for (const x of a) {
    for (const y of b) {
      const from = Math.max(x.from, y.from);
      const startBefore = Math.min(x.startBefore, y.startBefore);
      const closeAt = Math.min(x.closeAt, y.closeAt);
      if (from < startBefore) out.push({ from, startBefore, closeAt });
    }
  }
  return out;
}

/**
 * When may an appointment START on `date`, given the specialist's schedule and
 * the location's hours?
 *
 * A schedule that says nothing about the date (absent, or that weekday
 * disabled) does not constrain — preserving the long-standing behaviour where
 * such a schedule is ignored rather than treated as closed.
 */
export function bookableRangesForDate(
  specialistSchedule: WeekScheduleInput | null | undefined,
  locationHours: WeekScheduleInput | null | undefined,
  date: Date,
): SlotRange[] {
  const parts = [
    openRangesForDate(specialistSchedule, date),
    openRangesForDate(locationHours, date),
  ].filter((r) => r.length > 0);

  if (parts.length === 0) return [];
  if (parts.length === 1) return parts[0];
  return intersectRanges(parts[0], parts[1]);
}

/**
 * The windows COVERING `date` on its own midnight-relative timeline, used to ask
 * "is this booking inside working hours?" rather than to generate slots.
 *
 * Unlike {@link openRangesForDate} these are not clipped at midnight, and the
 * previous day's shift appears shifted into negative minutes — so a booking that
 * itself straddles midnight (23:30 + 1h inside an 18:00→02:30 shift) is still
 * recognised as fully within the shift.
 */
function coveringWindowsForDate(
  schedule: WeekScheduleInput | null | undefined,
  date: Date,
): { startMin: number; endMin: number }[] {
  const out: { startMin: number; endMin: number }[] = [];
  const own = openWindowForDate(schedule, date);
  if (own && own.startMin < own.endMin) out.push(own);
  const before = openWindowForDate(schedule, previousDay(date));
  if (before && before.endMin > MINUTES_PER_DAY) {
    out.push({
      startMin: before.startMin - MINUTES_PER_DAY,
      endMin: before.endMin - MINUTES_PER_DAY,
    });
  }
  return out;
}

/**
 * True when [startMin, endMin) — minutes from `date`'s midnight, possibly
 * running past 1440 — sits entirely inside a working window of BOTH the
 * specialist and the location. A schedule that doesn't cover the date doesn't
 * constrain, and when neither does the answer is true, matching the previous
 * soft-validation behaviour.
 */
export function isWithinWorkingHours(
  specialistSchedule: WeekScheduleInput | null | undefined,
  locationHours: WeekScheduleInput | null | undefined,
  date: Date,
  startMin: number,
  endMin: number,
): boolean {
  const parts = [
    coveringWindowsForDate(specialistSchedule, date),
    coveringWindowsForDate(locationHours, date),
  ].filter((w) => w.length > 0);
  if (parts.length === 0) return true;

  return parts.every((ws) =>
    ws.some((w) => startMin >= w.startMin && endMin <= w.endMin),
  );
}

export interface TimeOffWindow {
  startAt: Date;
  endAt: Date;
}

export interface BusyWindow {
  startAt: Date;
  endAt: Date;
}

export interface SlotParams {
  /** Local calendar day (midnight) to generate slots for. */
  day: Date;
  durationMin: number;
  /** Granularity between candidate start times. */
  stepMin?: number;
  /** Specialist's recurring schedule (null → fall back to location hours). */
  specialistSchedule?: WeekScheduleInput | null;
  /** Location opening hours (acts as the outer bound). */
  locationHours?: WeekScheduleInput | null;
  timeOff?: TimeOffWindow[];
  busy?: BusyWindow[];
  /** Treat slots before this instant as unavailable (e.g. now, for today). */
  notBefore?: Date;
}

/**
 * Compute bookable 'HH:MM' start times for a day by layering:
 *   open ranges (specialist ∩ location) − time-off − existing bookings − past.
 * Single source of truth shared by public availability + backoffice checks.
 */
export function computeSlots(p: SlotParams): string[] {
  const step = p.stepMin ?? 15;

  const ranges = bookableRangesForDate(p.specialistSchedule, p.locationHours, p.day);
  if (ranges.length === 0) return [];

  const dayStart = new Date(p.day);
  dayStart.setHours(0, 0, 0, 0);

  const out: string[] = [];
  for (const r of ranges) {
    // A slot must START on this date (m < startBefore) but MAY finish after
    // midnight, bounded by the shift's true close (m + duration <= closeAt).
    for (let m = r.from; m < r.startBefore && m + p.durationMin <= r.closeAt; m += step) {
      const slotStart = new Date(dayStart.getTime() + m * 60_000);
      const slotEnd = new Date(slotStart.getTime() + p.durationMin * 60_000);

      if (p.notBefore && slotStart < p.notBefore) continue;

      const sMs = slotStart.getTime();
      const eMs = slotEnd.getTime();

      const blockedByOff = (p.timeOff ?? []).some((o) =>
        intervalsOverlap(sMs, eMs, o.startAt.getTime(), o.endAt.getTime()),
      );
      if (blockedByOff) continue;

      const blockedByBooking = (p.busy ?? []).some((b) =>
        intervalsOverlap(sMs, eMs, b.startAt.getTime(), b.endAt.getTime()),
      );
      if (blockedByBooking) continue;

      out.push(minutesToTime(m));
    }
  }
  return out;
}

export function minutesToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export interface CapacitySlotParams {
  day: Date;
  durationMin: number;
  stepMin?: number;
  /** The venue's opening hours — the outer bound (no specialist involved). */
  locationHours?: WeekScheduleInput | null;
  /** Existing bookings for THIS facility service at the location. */
  busy?: BusyWindow[];
  /** Max concurrent bookings allowed per overlapping window. */
  capacity: number;
  notBefore?: Date;
}

/**
 * Slots for a facility/entry service (spa sauna, pool, day pass): availability
 * comes from location hours, and a slot is open while the number of OVERLAPPING
 * existing bookings is below `capacity`. No specialist involved.
 */
export function computeCapacitySlots(p: CapacitySlotParams): string[] {
  const step = p.stepMin ?? 15;
  const ranges = openRangesForDate(p.locationHours, p.day);
  if (ranges.length === 0) return [];

  const dayStart = new Date(p.day);
  dayStart.setHours(0, 0, 0, 0);
  const busy = p.busy ?? [];

  const out: string[] = [];
  for (const r of ranges) {
    for (let m = r.from; m < r.startBefore && m + p.durationMin <= r.closeAt; m += step) {
      const slotStart = new Date(dayStart.getTime() + m * 60_000);
      const slotEnd = new Date(slotStart.getTime() + p.durationMin * 60_000);
      if (p.notBefore && slotStart < p.notBefore) continue;

      const sMs = slotStart.getTime();
      const eMs = slotEnd.getTime();
      const concurrent = busy.filter((b) =>
        intervalsOverlap(sMs, eMs, b.startAt.getTime(), b.endAt.getTime()),
      ).length;

      if (concurrent < p.capacity) out.push(minutesToTime(m));
    }
  }
  return out;
}

/**
 * Map a day's open-slot count to a 0–3 "density" bucket for the booking page's
 * day-strip dots. Kept here so the client contract (dots) stays stable and the
 * bucketing lives with the slot logic rather than in a controller.
 *   0 → none, 1 → 1–2, 2 → 3–5, 3 → 6+
 */
export function slotCountToDots(count: number): 0 | 1 | 2 | 3 {
  if (count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  return 3;
}

/** How many bookings overlap a given [start,end) window (for capacity checks). */
export function countOverlapping(start: Date, end: Date, busy: BusyWindow[]): number {
  const s = start.getTime();
  const e = end.getTime();
  return busy.filter((b) => intervalsOverlap(s, e, b.startAt.getTime(), b.endAt.getTime())).length;
}
