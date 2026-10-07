import {
  analyticsClearQuerySchema,
  analyticsEventsQuerySchema,
  analyticsRangeQuerySchema,
  analyticsSourcesQuerySchema,
} from './site-analytics-query.dto';
import { addDays, daysInclusive, eachDay, isCalendarDay } from '../calendar-day';

describe('analytics range query', () => {
  const parse = (q: Record<string, unknown>) => analyticsRangeQuerySchema.safeParse(q);

  it('accepts an inclusive range and defaults to excluding staff traffic', () => {
    const r = parse({ from: '2026-09-01', to: '2026-09-30' });
    expect(r.success && r.data).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
      includeInternal: false,
    });
  });

  it('reads includeInternal as a query-string flag, not a JS truthy string', () => {
    const flag = (v: string) => {
      const r = parse({ from: '2026-09-01', to: '2026-09-01', includeInternal: v });
      return r.success && r.data.includeInternal;
    };
    expect(flag('true')).toBe(true);
    expect(flag('1')).toBe(true);
    expect(flag('false')).toBe(false);
    expect(flag('0')).toBe(false);
  });

  it('accepts a single day and up to 1096 days (3 years), not 1097', () => {
    expect(parse({ from: '2026-09-01', to: '2026-09-01' }).success).toBe(true);
    expect(parse({ from: '2026-01-01', to: '2027-01-01' }).success).toBe(true); // 366 days
    expect(parse({ from: '2024-01-01', to: '2026-12-31' }).success).toBe(true); // 1096 days
    const tooLong = parse({ from: '2024-01-01', to: '2027-01-01' }); // 1097 days
    expect(tooLong.success).toBe(false);
    expect(!tooLong.success && tooLong.error.issues[0].message).toMatch(/1096/);
  });

  it('rejects to before from', () => {
    const r = parse({ from: '2026-09-02', to: '2026-09-01' });
    expect(r.success).toBe(false);
    expect(!r.success && r.error.issues[0].path).toEqual(['to']);
  });

  it('requires real calendar days in YYYY-MM-DD form', () => {
    for (const [from, to] of [
      ['2026-02-30', '2026-03-01'],
      ['2026-9-01', '2026-09-02'],
      ['01.09.2026', '2026-09-02'],
      ['2026-09-01T00:00:00Z', '2026-09-02'],
      [undefined, '2026-09-02'],
      ['2026-09-01', undefined],
    ]) {
      expect(parse({ from, to }).success).toBe(false);
    }
    expect(parse({ from: '2028-02-29', to: '2028-02-29' }).success).toBe(true); // leap day
  });

  it('takes an optional partner filter on sources', () => {
    const id = '01a1126b-a870-7688-b747-b10953a0abc0';
    const r = analyticsSourcesQuerySchema.safeParse({
      from: '2026-09-01',
      to: '2026-09-30',
      partnerId: id,
    });
    expect(r.success && r.data.partnerId).toBe(id);
    expect(
      analyticsSourcesQuerySchema.safeParse({
        from: '2026-09-01',
        to: '2026-09-30',
        partnerId: 'x',
      }).success,
    ).toBe(false);
  });

  it('pages the event log at most 100 rows at a time', () => {
    const r = analyticsEventsQuerySchema.safeParse({ from: '2026-09-01', to: '2026-09-30' });
    expect(r.success && [r.data.page, r.data.pageSize]).toEqual([1, 50]);
    const q = { from: '2026-09-01', to: '2026-09-30' };
    expect(
      analyticsEventsQuerySchema.safeParse({ ...q, page: '3', pageSize: '100', name: 'book_click' })
        .success,
    ).toBe(true);
    expect(analyticsEventsQuerySchema.safeParse({ ...q, pageSize: '101' }).success).toBe(false);
    expect(analyticsEventsQuerySchema.safeParse({ ...q, page: '0' }).success).toBe(false);
    expect(analyticsEventsQuerySchema.safeParse({ ...q, name: "x' OR 1=1" }).success).toBe(false);
  });
});

describe('analytics clear query', () => {
  const parse = (q: Record<string, unknown>) => analyticsClearQuerySchema.safeParse(q);

  it('takes an optional calendar day', () => {
    expect(parse({}).success && parse({}).data).toEqual({});
    const r = parse({ before: '2026-09-01' });
    expect(r.success && r.data.before).toBe('2026-09-01');
  });

  it('refuses an empty or malformed day rather than reading it as "everything"', () => {
    for (const before of ['', ' ', '2026-02-30', '2026-9-1', 'yesterday', '2026-09-01T00:00:00Z']) {
      expect(parse({ before }).success).toBe(false);
    }
  });
});

describe('calendar days', () => {
  it('steps across month, year and leap-day boundaries', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30'); // a DST change elsewhere is irrelevant
  });

  it('counts inclusive days and lists each one', () => {
    expect(daysInclusive('2026-09-01', '2026-09-01')).toBe(1);
    expect(daysInclusive('2026-09-01', '2026-09-30')).toBe(30);
    expect(daysInclusive('2026-09-02', '2026-09-01')).toBe(0);
    expect(eachDay('2026-09-29', '2026-10-02')).toEqual([
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
    ]);
    expect(eachDay('2026-09-02', '2026-09-01')).toEqual([]);
  });

  it('recognises real calendar days only', () => {
    expect(isCalendarDay('2026-12-31')).toBe(true);
    expect(isCalendarDay('2026-13-01')).toBe(false);
    expect(isCalendarDay('2027-02-29')).toBe(false);
    expect(isCalendarDay('2026-1-1')).toBe(false);
  });
});
