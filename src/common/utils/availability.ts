import { WEEKDAYS, type WeekScheduleInput } from '@/common/schemas/week-schedule.schema';

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
 * The open [start, end] minute window for a given date from a week schedule,
 * or null when that weekday is disabled / missing.
 */
export function openWindowForDate(
  schedule: WeekScheduleInput | null | undefined,
  date: Date,
): { startMin: number; endMin: number } | null {
  if (!schedule) return null;
  const day = schedule[weekdayKey(date)];
  if (!day || !day.enabled) return null;
  return { startMin: timeToMinutes(day.start), endMin: timeToMinutes(day.end) };
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
 *   open window (specialist ∩ location) − time-off − existing bookings − past.
 * Single source of truth shared by public availability + backoffice checks.
 */
export function computeSlots(p: SlotParams): string[] {
  const step = p.stepMin ?? 15;

  // Intersect specialist + location windows (whichever exist).
  const sp = openWindowForDate(p.specialistSchedule, p.day);
  const loc = openWindowForDate(p.locationHours, p.day);
  const windows = [sp, loc].filter(Boolean) as { startMin: number; endMin: number }[];
  if (windows.length === 0) return [];
  const startMin = Math.max(...windows.map((w) => w.startMin));
  const endMin = Math.min(...windows.map((w) => w.endMin));
  if (startMin >= endMin) return [];

  const dayStart = new Date(p.day);
  dayStart.setHours(0, 0, 0, 0);

  const out: string[] = [];
  for (let m = startMin; m + p.durationMin <= endMin; m += step) {
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
  const loc = openWindowForDate(p.locationHours, p.day);
  if (!loc || loc.startMin >= loc.endMin) return [];

  const dayStart = new Date(p.day);
  dayStart.setHours(0, 0, 0, 0);
  const busy = p.busy ?? [];

  const out: string[] = [];
  for (let m = loc.startMin; m + p.durationMin <= loc.endMin; m += step) {
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
  return out;
}

/** How many bookings overlap a given [start,end) window (for capacity checks). */
export function countOverlapping(start: Date, end: Date, busy: BusyWindow[]): number {
  const s = start.getTime();
  const e = end.getTime();
  return busy.filter((b) => intervalsOverlap(s, e, b.startAt.getTime(), b.endAt.getTime())).length;
}
