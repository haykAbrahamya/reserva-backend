import { weekScheduleSchema } from './week-schedule.schema';

const day = (start: string, end: string, enabled = true) => ({
  mon: { enabled, start, end },
});

const ok = (start: string, end: string, enabled = true) =>
  weekScheduleSchema.safeParse(day(start, end, enabled)).success;

describe('weekScheduleSchema', () => {
  it('accepts an ordinary day', () => {
    expect(ok('10:00', '19:00')).toBe(true);
  });

  it('accepts an early-morning shift inside one day', () => {
    expect(ok('02:30', '10:00')).toBe(true);
  });

  // The bug this suite exists for: an end BEFORE the start is an overnight
  // shift, not invalid input. A lexicographic `start < end` check rejected it.
  it('accepts an overnight shift that closes after midnight', () => {
    expect(ok('18:00', '02:30')).toBe(true);
    expect(ok('20:00', '00:30')).toBe(true);
    expect(ok('23:00', '07:00')).toBe(true);
  });

  it('accepts a day that closes exactly at midnight', () => {
    expect(ok('10:00', '00:00')).toBe(true);
  });

  it('rejects a day whose start equals its end', () => {
    const res = weekScheduleSchema.safeParse(day('10:00', '10:00'));
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0].message).toMatch(/differ/);
    }
  });

  it('ignores the start/end relationship on a disabled day', () => {
    expect(ok('10:00', '10:00', false)).toBe(true);
  });

  it('still rejects malformed times', () => {
    expect(ok('24:00', '10:00')).toBe(false);
    expect(ok('7:5', '10:00')).toBe(false);
    expect(ok('10:60', '11:00')).toBe(false);
  });

  it('allows a partial week', () => {
    expect(weekScheduleSchema.safeParse({}).success).toBe(true);
    expect(
      weekScheduleSchema.safeParse({
        mon: { enabled: true, start: '18:00', end: '02:30' },
        sun: { enabled: false, start: '10:00', end: '17:00' },
      }).success,
    ).toBe(true);
  });
});
