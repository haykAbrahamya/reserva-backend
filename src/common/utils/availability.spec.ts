import {
  weekdayKey,
  openWindowForDate,
  openRangesForDate,
  bookableRangesForDate,
  isWithinWorkingHours,
  computeSlots,
  computeCapacitySlots,
  MINUTES_PER_DAY,
} from './availability';
import type { WeekScheduleInput } from '@/common/schemas/week-schedule.schema';

// Fixed local dates so weekday-keyed schedules are unambiguous.
const SUNDAY = new Date(2026, 7, 30); // 2026-08-30
const MONDAY = new Date(2026, 7, 31); // 2026-08-31
const TUESDAY = new Date(2026, 8, 1); // 2026-09-01

/** A schedule with a single enabled weekday. */
const on = (
  weekday: 'sun' | 'mon' | 'tue',
  start: string,
  end: string,
): WeekScheduleInput => ({ [weekday]: { enabled: true, start, end } }) as WeekScheduleInput;

describe('date fixtures', () => {
  it('are the weekdays the tests assume', () => {
    expect(weekdayKey(SUNDAY)).toBe('sun');
    expect(weekdayKey(MONDAY)).toBe('mon');
    expect(weekdayKey(TUESDAY)).toBe('tue');
  });
});

describe('openWindowForDate', () => {
  it('reads an ordinary day as-is', () => {
    expect(openWindowForDate(on('mon', '10:00', '19:00'), MONDAY)).toEqual({
      startMin: 600,
      endMin: 1140,
    });
  });

  it('normalises an overnight shift past 1440', () => {
    expect(openWindowForDate(on('mon', '18:00', '02:30'), MONDAY)).toEqual({
      startMin: 1080,
      endMin: 1590,
    });
  });

  it('treats a midnight close as the end of the day, not a wrap to zero', () => {
    expect(openWindowForDate(on('mon', '10:00', '00:00'), MONDAY)).toEqual({
      startMin: 600,
      endMin: MINUTES_PER_DAY,
    });
  });

  it('returns null for a disabled or missing day', () => {
    expect(openWindowForDate({ mon: { enabled: false, start: '10:00', end: '19:00' } }, MONDAY)).toBeNull();
    expect(openWindowForDate(on('mon', '10:00', '19:00'), TUESDAY)).toBeNull();
    expect(openWindowForDate(null, MONDAY)).toBeNull();
  });

  it('leaves a legacy start===end row zero-length rather than 24h', () => {
    expect(openWindowForDate(on('mon', '10:00', '10:00'), MONDAY)).toEqual({
      startMin: 600,
      endMin: 600,
    });
  });
});

describe('openRangesForDate', () => {
  it('gives an ordinary day one range and leaves the next day closed', () => {
    const sched = on('mon', '10:00', '19:00');
    expect(openRangesForDate(sched, MONDAY)).toEqual([
      { from: 600, startBefore: 1140, closeAt: 1140 },
    ]);
    expect(openRangesForDate(sched, TUESDAY)).toEqual([]);
  });

  it('caps an overnight start window at midnight but keeps the true close', () => {
    expect(openRangesForDate(on('mon', '18:00', '02:30'), MONDAY)).toEqual([
      { from: 1080, startBefore: MINUTES_PER_DAY, closeAt: 1590 },
    ]);
  });

  it('spills the tail of an overnight shift onto the following day', () => {
    expect(openRangesForDate(on('mon', '18:00', '02:30'), TUESDAY)).toEqual([
      { from: 0, startBefore: 150, closeAt: 150 },
    ]);
  });

  it('does not spill when the day closes exactly at midnight', () => {
    expect(openRangesForDate(on('mon', '10:00', '00:00'), TUESDAY)).toEqual([]);
  });

  it('merges an own window that overlaps the previous day’s spill', () => {
    // Sun 22:00→01:00 spills [0,60) onto Monday, whose own shift is 00:00→06:00.
    const sched: WeekScheduleInput = {
      sun: { enabled: true, start: '22:00', end: '01:00' },
      mon: { enabled: true, start: '00:00', end: '06:00' },
    };
    expect(openRangesForDate(sched, MONDAY)).toEqual([
      { from: 0, startBefore: 360, closeAt: 360 },
    ]);
  });
});

describe('bookableRangesForDate', () => {
  it('intersects specialist and location windows', () => {
    const loc = on('mon', '09:00', '21:00');
    const sp = on('mon', '12:00', '18:00');
    expect(bookableRangesForDate(sp, loc, MONDAY)).toEqual([
      { from: 720, startBefore: 1080, closeAt: 1080 },
    ]);
  });

  it('clips a specialist to an overnight location window', () => {
    const loc = on('mon', '18:00', '02:30');
    const sp = on('mon', '20:00', '23:00');
    expect(bookableRangesForDate(sp, loc, MONDAY)).toEqual([
      { from: 1200, startBefore: 1380, closeAt: 1380 },
    ]);
  });

  it('lets a schedule that says nothing about the day not constrain', () => {
    const loc = on('mon', '10:00', '19:00');
    expect(bookableRangesForDate(null, loc, MONDAY)).toEqual([
      { from: 600, startBefore: 1140, closeAt: 1140 },
    ]);
    expect(bookableRangesForDate(loc, null, MONDAY)).toEqual([
      { from: 600, startBefore: 1140, closeAt: 1140 },
    ]);
  });

  it('is empty when neither schedule opens the day', () => {
    expect(bookableRangesForDate(null, null, MONDAY)).toEqual([]);
    expect(bookableRangesForDate(on('tue', '10:00', '19:00'), null, MONDAY)).toEqual([]);
  });
});

describe('computeSlots — ordinary days (regression)', () => {
  it('generates the same slots as before for a normal shift', () => {
    expect(
      computeSlots({
        day: MONDAY,
        durationMin: 60,
        stepMin: 60,
        specialistSchedule: on('mon', '18:00', '22:00'),
      }),
    ).toEqual(['18:00', '19:00', '20:00', '21:00']);
  });

  it('returns nothing on a closed day', () => {
    expect(
      computeSlots({ day: TUESDAY, durationMin: 60, specialistSchedule: on('mon', '10:00', '19:00') }),
    ).toEqual([]);
  });

  it('honours notBefore', () => {
    expect(
      computeSlots({
        day: MONDAY,
        durationMin: 60,
        stepMin: 60,
        specialistSchedule: on('mon', '18:00', '22:00'),
        notBefore: new Date(2026, 7, 31, 20, 0),
      }),
    ).toEqual(['20:00', '21:00']);
  });
});

describe('computeSlots — overnight shifts', () => {
  const overnight = on('mon', '18:00', '02:30');

  it('offers evening slots on the shift’s own day', () => {
    expect(
      computeSlots({ day: MONDAY, durationMin: 60, stepMin: 60, specialistSchedule: overnight }),
    ).toEqual(['18:00', '19:00', '20:00', '21:00', '22:00', '23:00']);
  });

  it('lets the last slot of the day run past midnight', () => {
    // 23:45 + 60min ends 00:45, inside the 02:30 close — so it must be offered,
    // and every label stays a real time on Monday (never "24:15").
    const slots = computeSlots({
      day: MONDAY,
      durationMin: 60,
      stepMin: 15,
      specialistSchedule: overnight,
    });
    expect(slots[slots.length - 1]).toBe('23:45');
    expect(slots.every((s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s))).toBe(true);
  });

  it('offers the post-midnight tail on the FOLLOWING day', () => {
    expect(
      computeSlots({ day: TUESDAY, durationMin: 60, stepMin: 30, specialistSchedule: overnight }),
    ).toEqual(['00:00', '00:30', '01:00', '01:30']);
  });

  it('does not offer a tail slot that would overrun the close', () => {
    // 02:00 + 60min would end 03:00, past the 02:30 close.
    expect(
      computeSlots({ day: TUESDAY, durationMin: 60, stepMin: 30, specialistSchedule: overnight }),
    ).not.toContain('02:00');
  });

  it('offers nothing two days later', () => {
    expect(
      computeSlots({ day: new Date(2026, 8, 2), durationMin: 60, specialistSchedule: overnight }),
    ).toEqual([]);
  });

  it('blocks a post-midnight slot already booked', () => {
    const slots = computeSlots({
      day: TUESDAY,
      durationMin: 60,
      stepMin: 60,
      specialistSchedule: overnight,
      busy: [{ startAt: new Date(2026, 8, 1, 1, 0), endAt: new Date(2026, 8, 1, 2, 0) }],
    });
    // Proves the slot's absolute instant really lands on Tuesday.
    expect(slots).toEqual(['00:00']);
  });

  it('blocks a post-midnight slot covered by time-off', () => {
    const slots = computeSlots({
      day: TUESDAY,
      durationMin: 60,
      stepMin: 60,
      specialistSchedule: overnight,
      timeOff: [{ startAt: new Date(2026, 8, 1, 0, 0), endAt: new Date(2026, 8, 1, 1, 0) }],
    });
    expect(slots).toEqual(['01:00']);
  });

  it('intersects an overnight location with a normal specialist shift', () => {
    // The specialist closes at 23:00, so 22:00–23:00 is the last full hour.
    expect(
      computeSlots({
        day: MONDAY,
        durationMin: 60,
        stepMin: 60,
        specialistSchedule: on('mon', '20:00', '23:00'),
        locationHours: on('mon', '18:00', '02:30'),
      }),
    ).toEqual(['20:00', '21:00', '22:00']);
  });

  it('emits no duplicates when own hours overlap the previous day’s spill', () => {
    const sched: WeekScheduleInput = {
      sun: { enabled: true, start: '22:00', end: '01:00' },
      mon: { enabled: true, start: '00:00', end: '06:00' },
    };
    const slots = computeSlots({ day: MONDAY, durationMin: 60, stepMin: 60, specialistSchedule: sched });
    expect(slots).toEqual([...new Set(slots)]);
    expect(slots).toEqual(['00:00', '01:00', '02:00', '03:00', '04:00', '05:00']);
  });

  it('handles a shift that closes at midnight', () => {
    expect(
      computeSlots({
        day: MONDAY,
        durationMin: 60,
        stepMin: 60,
        specialistSchedule: on('mon', '21:00', '00:00'),
      }),
    ).toEqual(['21:00', '22:00', '23:00']);
    expect(
      computeSlots({ day: TUESDAY, durationMin: 60, specialistSchedule: on('mon', '21:00', '00:00') }),
    ).toEqual([]);
  });
});

describe('computeCapacitySlots — overnight venues', () => {
  const overnight = on('mon', '20:00', '01:00');

  it('offers evening slots then the tail on the next day', () => {
    expect(
      computeCapacitySlots({
        day: MONDAY,
        durationMin: 60,
        stepMin: 60,
        locationHours: overnight,
        capacity: 2,
      }),
    ).toEqual(['20:00', '21:00', '22:00', '23:00']);

    expect(
      computeCapacitySlots({
        day: TUESDAY,
        durationMin: 60,
        stepMin: 60,
        locationHours: overnight,
        capacity: 2,
      }),
    ).toEqual(['00:00']);
  });

  it('still respects capacity across midnight', () => {
    const busy = [
      { startAt: new Date(2026, 8, 1, 0, 0), endAt: new Date(2026, 8, 1, 1, 0) },
      { startAt: new Date(2026, 8, 1, 0, 30), endAt: new Date(2026, 8, 1, 1, 0) },
    ];
    expect(
      computeCapacitySlots({
        day: TUESDAY,
        durationMin: 60,
        stepMin: 60,
        locationHours: overnight,
        capacity: 2,
        busy,
      }),
    ).toEqual([]);
  });
});

describe('isWithinWorkingHours', () => {
  const overnight = on('mon', '18:00', '02:30');
  const normal = on('mon', '10:00', '19:00');

  it('accepts a booking inside an ordinary day and rejects one outside', () => {
    expect(isWithinWorkingHours(normal, null, MONDAY, 600, 660)).toBe(true);
    expect(isWithinWorkingHours(normal, null, MONDAY, 1080, 1140)).toBe(true); // 18:00–19:00
    expect(isWithinWorkingHours(normal, null, MONDAY, 540, 600)).toBe(false); // 09:00–10:00
    expect(isWithinWorkingHours(normal, null, MONDAY, 1110, 1170)).toBe(false); // 18:30–19:30
  });

  it('accepts an evening booking during an overnight shift', () => {
    expect(isWithinWorkingHours(overnight, null, MONDAY, 1140, 1200)).toBe(true); // 19:00–20:00
  });

  it('accepts a booking that itself straddles midnight', () => {
    // 23:30 + 1h = minutes 1410→1470, i.e. past 1440.
    expect(isWithinWorkingHours(overnight, null, MONDAY, 1410, 1470)).toBe(true);
  });

  it('accepts an early-hours booking belonging to the previous day’s shift', () => {
    // Tuesday 01:00–02:00 is inside MONDAY's 18:00→02:30 shift.
    expect(isWithinWorkingHours(overnight, null, TUESDAY, 60, 120)).toBe(true);
  });

  it('rejects an early-hours booking past the overnight close', () => {
    expect(isWithinWorkingHours(overnight, null, TUESDAY, 180, 240)).toBe(false); // 03:00
    expect(isWithinWorkingHours(overnight, null, TUESDAY, 120, 180)).toBe(false); // 02:00–03:00
  });

  it('rejects a booking before the shift opens', () => {
    expect(isWithinWorkingHours(overnight, null, MONDAY, 1020, 1080)).toBe(false); // 17:00–18:00
  });

  it('requires the booking to satisfy BOTH specialist and location', () => {
    const loc = on('mon', '18:00', '02:30');
    const sp = on('mon', '20:00', '23:00');
    expect(isWithinWorkingHours(sp, loc, MONDAY, 1200, 1260)).toBe(true); // 20:00–21:00
    expect(isWithinWorkingHours(sp, loc, MONDAY, 1380, 1440)).toBe(false); // 23:00–00:00, past sp
  });

  it('does not constrain when no schedule covers the date', () => {
    expect(isWithinWorkingHours(null, null, MONDAY, 0, 60)).toBe(true);
    expect(isWithinWorkingHours(on('tue', '10:00', '19:00'), null, MONDAY, 0, 60)).toBe(true);
  });
});

/**
 * LOAD-BEARING LEGACY BEHAVIOUR — do not "tighten" without a migration.
 *
 * `Specialist.schedule` is `Json @default("{}")` and specialists.service fills
 * in a default on create, so the schedule is never null — it is `{}` for anyone
 * whose hours were never configured. The engine therefore treats a schedule
 * with NOTHING to say about a date as "does not constrain" and falls back to the
 * location's hours. Making a date-less schedule mean "closed" instead would make
 * every specialist carrying the `{}` default instantly unbookable.
 *
 * The same rule means a specialist with a DISABLED weekday also inherits the
 * location's hours for that day. That is pre-existing behaviour, unchanged by
 * overnight support, and it is why an overnight location can put early-hours
 * slots on a day the specialist has not explicitly enabled.
 */
describe('schedule fallback semantics', () => {
  const locHours = on('mon', '10:00', '13:00');

  it('falls back to location hours for the empty `{}` default schedule', () => {
    expect(
      computeSlots({
        day: MONDAY,
        durationMin: 60,
        stepMin: 60,
        specialistSchedule: {} as WeekScheduleInput,
        locationHours: locHours,
      }),
    ).toEqual(['10:00', '11:00', '12:00']);
  });

  it('falls back to location hours on a weekday the specialist disabled', () => {
    expect(
      computeSlots({
        day: MONDAY,
        durationMin: 60,
        stepMin: 60,
        specialistSchedule: { mon: { enabled: false, start: '09:00', end: '17:00' } },
        locationHours: locHours,
      }),
    ).toEqual(['10:00', '11:00', '12:00']);
  });

  it('applies the same fallback to working-hours validation', () => {
    expect(isWithinWorkingHours({} as WeekScheduleInput, locHours, MONDAY, 600, 660)).toBe(true);
    expect(isWithinWorkingHours({} as WeekScheduleInput, locHours, MONDAY, 540, 600)).toBe(false);
  });

  it('yields nothing when neither side opens the date', () => {
    expect(
      computeSlots({
        day: MONDAY,
        durationMin: 60,
        specialistSchedule: {} as WeekScheduleInput,
        locationHours: {} as WeekScheduleInput,
      }),
    ).toEqual([]);
  });
});
