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
 * Whether a specialist's weekly hours have been set at all. Every way of
 * creating a specialist writes a full week; only a row that predates that still
 * holds the column default `{}`, which says nothing about any day.
 */
export function scheduleIsSet(schedule: WeekScheduleInput | null | undefined): boolean {
  return !!schedule && WEEKDAYS.some((d) => schedule[d] != null);
}

/**
 * When may an appointment START on `date`, given the specialist's schedule and
 * the location's hours?
 *
 * The specialist's hours, once set, are the truth: a day they switched off is
 * closed. (Until 2026-10 a switched-off day fell back to the branch's hours, so
 * a specialist could be booked — by staff, or by "any specialist" — on their
 * day off.) A schedule that was never set (`{}`) still follows the branch.
 *
 * The branch's hours keep their old leniency: a day the BRANCH has switched off
 * does not close a specialist whose own hours open it.
 */
export function bookableRangesForDate(
  specialistSchedule: WeekScheduleInput | null | undefined,
  locationHours: WeekScheduleInput | null | undefined,
  date: Date,
  /**
   * A specialist who works at SEVERAL branches has hours per branch, and a day
   * their hours here leave closed is a day they are at another branch — so it
   * must not fall back to this branch's opening hours. Single-branch
   * specialists keep the long-standing fallback below, unchanged.
   */
  strictSchedule = false,
): SlotRange[] {
  const own = openRangesForDate(specialistSchedule, date);
  if ((strictSchedule || scheduleIsSet(specialistSchedule)) && own.length === 0) return [];
  const parts = [own, openRangesForDate(locationHours, date)].filter((r) => r.length > 0);

  if (parts.length === 0) return [];
  if (parts.length === 1) return parts[0];
  return intersectRanges(parts[0], parts[1]);
}

/** One weekday's working window at a branch, in shift form (see below). */
export interface WeekdayWindow {
  day: (typeof WEEKDAYS)[number];
  startMin: number;
  /** May pass 1440: the shift closes after midnight. */
  endMin: number;
}

/**
 * A specialist's working window on each weekday at one branch, as bookings see
 * it: their hours there ∩ the branch's, with the same fallbacks as slot
 * generation — a side that says nothing about the day doesn't constrain, and a
 * multi-branch specialist's closed day stays closed (`strictSchedule`). This is
 * what the public page shows as their working hours, so it can never claim a
 * day off on a day the booking flow would offer, or the other way round.
 */
export function weeklyWorkingWindows(
  specialistSchedule: WeekScheduleInput | null | undefined,
  locationHours: WeekScheduleInput | null | undefined,
  strictSchedule = false,
): WeekdayWindow[] {
  const out: WeekdayWindow[] = [];
  // Same rule as bookableRangesForDate: set hours make a switched-off day closed.
  const strict = strictSchedule || scheduleIsSet(specialistSchedule);
  /** The small hours a shift running past midnight takes from the next date. */
  const spill = (w: { startMin: number; endMin: number } | null) =>
    w && w.endMin > MINUTES_PER_DAY ? { startMin: 0, endMin: w.endMin - MINUTES_PER_DAY } : null;
  // Schedules are keyed by weekday, so any Monday→Sunday run of dates will do.
  for (let i = 0; i < 7; i++) {
    const date = new Date(2026, 0, 5 + i); // Mon 5 Jan 2026 … Sun 11 Jan 2026
    const prev = new Date(2026, 0, 4 + i);
    const own = openWindowForDate(specialistSchedule, date);
    const loc = openWindowForDate(locationHours, date);
    // Only the day's OWN shift is shown here; last night's tail is part of
    // yesterday's window ("16:00 – 02:30").
    if (!own && !loc) continue;
    if (strict && !own) continue;
    // A side constrains the date when it opens that day or yesterday's shift
    // runs into it — exactly when bookableRangesForDate stops falling back.
    const ownSide = own ?? spill(openWindowForDate(specialistSchedule, prev));
    const locSide = loc ?? spill(openWindowForDate(locationHours, prev));
    const startMin = Math.max(ownSide?.startMin ?? -Infinity, locSide?.startMin ?? -Infinity);
    const endMin = Math.min(ownSide?.endMin ?? Infinity, locSide?.endMin ?? Infinity);
    if (Number.isFinite(startMin) && Number.isFinite(endMin) && endMin > startMin) {
      out.push({ day: weekdayKey(date), startMin, endMin });
    }
  }
  return out;
}

/**
 * Does [startAt, endAt) take time away from the hours a specialist can be
 * booked at a branch (their hours there ∩ the branch's, by the same rule as
 * slot generation)? A booking at another branch on a day they are not
 * scheduled here — or outside their hours here — does not, so a branch
 * calendar only shows the clashes that matter to it.
 */
export function overlapsBookableHours(
  specialistSchedule: WeekScheduleInput | null | undefined,
  locationHours: WeekScheduleInput | null | undefined,
  startAt: Date,
  endAt: Date,
  strictSchedule = false,
): boolean {
  const day = new Date(startAt.getFullYear(), startAt.getMonth(), startAt.getDate());
  const next = new Date(startAt.getFullYear(), startAt.getMonth(), startAt.getDate() + 1);
  const startMin = startAt.getHours() * 60 + startAt.getMinutes();
  const endMin = startMin + (endAt.getTime() - startAt.getTime()) / 60000;
  const windows = [
    ...bookableRangesForDate(specialistSchedule, locationHours, day, strictSchedule).map((r) => [r.from, r.closeAt]),
    // A booking running past midnight can reach into the next day's hours.
    ...bookableRangesForDate(specialistSchedule, locationHours, next, strictSchedule).map((r) => [
      r.from + MINUTES_PER_DAY,
      r.closeAt + MINUTES_PER_DAY,
    ]),
  ];
  return windows.some(([from, to]) => startMin < to && endMin > from);
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
 * specialist and the location. Same rules as bookableRangesForDate: a day the
 * specialist switched off is closed; a never-set schedule or a branch day off
 * doesn't constrain, and when neither side does the answer is true.
 */
export function isWithinWorkingHours(
  specialistSchedule: WeekScheduleInput | null | undefined,
  locationHours: WeekScheduleInput | null | undefined,
  date: Date,
  startMin: number,
  endMin: number,
  /** Multi-branch specialist: a day their hours here don't open is closed. */
  strictSchedule = false,
): boolean {
  const own = coveringWindowsForDate(specialistSchedule, date);
  if ((strictSchedule || scheduleIsSet(specialistSchedule)) && own.length === 0) return false;
  const parts = [own, coveringWindowsForDate(locationHours, date)].filter((w) => w.length > 0);
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
  /** Multi-branch specialist: only days their hours AT THIS BRANCH open. */
  strictSchedule?: boolean;
}

/**
 * Compute bookable 'HH:MM' start times for a day by layering:
 *   open ranges (specialist ∩ location) − time-off − existing bookings − past.
 * Single source of truth shared by public availability + backoffice checks.
 */
export function computeSlots(p: SlotParams): string[] {
  const step = p.stepMin ?? 15;

  const ranges = bookableRangesForDate(p.specialistSchedule, p.locationHours, p.day, p.strictSchedule);
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
