import { boardQuerySchema, applySchema } from './board.dto';

/**
 * The board's query string is a PUBLIC contract: it is what a shared link, a
 * bookmark and a search-engine crawl all carry. These tests pin the parts that
 * are easy to break silently — a cap that stops applying, an unknown value that
 * starts throwing instead of being ignored — because the failure shows up as a
 * dead link someone sent a friend, not as an error anyone sees.
 */
describe('boardQuerySchema — list params', () => {
  const parse = (input: Record<string, unknown>) => boardQuerySchema.parse(input);

  it('accepts a repeated param and a comma-separated one identically', () => {
    expect(parse({ area: ['yerevan-arabkir', 'yerevan-kentron'] }).area).toEqual([
      'yerevan-arabkir',
      'yerevan-kentron',
    ]);
    expect(parse({ area: 'yerevan-arabkir,yerevan-kentron' }).area).toEqual([
      'yerevan-arabkir',
      'yerevan-kentron',
    ]);
  });

  it('trims, drops blanks and de-duplicates', () => {
    expect(parse({ area: ' a , ,a, b ' }).area).toEqual(['a', 'b']);
  });

  it('caps a list so a crafted URL cannot become a 500-item IN clause', () => {
    const many = Array.from({ length: 500 }, (_, i) => `area-${i}`);
    expect(parse({ area: many }).area).toHaveLength(40);
  });

  it('defaults every list to empty rather than undefined', () => {
    const q = parse({});
    expect(q.area).toEqual([]);
    expect(q.specialty).toEqual([]);
    expect(q.perks).toEqual([]);
    expect(q.payType).toEqual([]);
  });

  /**
   * The important one. An old bookmark naming a pay type we renamed must still
   * return a board, not an error page — so unknown values are dropped, never
   * rejected.
   */
  it('drops unrecognized enum values instead of rejecting the request', () => {
    expect(parse({ payType: 'salary,unicorn' }).payType).toEqual(['salary']);
    expect(parse({ perks: 'materials-included,free-lambo' }).perks).toEqual([
      'materials-included',
    ]);
    expect(parse({ experience: 'nonsense' }).experience).toEqual([]);
  });

  it('coerces money from strings, because a query string has no numbers', () => {
    const q = parse({ salaryMin: '250000', percentMax: '45' });
    expect(q.salaryMin).toBe(250_000);
    expect(q.percentMax).toBe(45);
  });

  it('refuses a percentage outside 0-100', () => {
    expect(() => parse({ percentMax: '140' })).toThrow();
  });

  it('bounds pageSize so one request cannot ask for the whole board', () => {
    expect(parse({}).pageSize).toBe(12);
    expect(() => parse({ pageSize: '5000' })).toThrow();
  });
});

describe('applySchema — the public apply form', () => {
  const base = { name: 'Anna Petrosyan', phone: '+37493111222' };

  it('requires only a name and a phone', () => {
    const v = applySchema.parse(base);
    expect(v.email).toBe('');
    expect(v.note).toBe('');
    expect(v.locale).toBe('hy');
  });

  it('rejects a one-character name', () => {
    expect(() => applySchema.parse({ ...base, name: 'A' })).toThrow();
  });

  /** An empty string is what a browser sends for an untouched optional field,
   *  so it has to mean "not given" rather than "invalid email". */
  it('treats an empty email as absent but still validates a real one', () => {
    expect(applySchema.parse({ ...base, email: '' }).email).toBe('');
    expect(() => applySchema.parse({ ...base, email: 'not-an-email' })).toThrow();
  });
});
