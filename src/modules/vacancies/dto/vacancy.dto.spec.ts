import { createVacancySchema, updateVacancySchema, listVacancyQuerySchema } from './vacancy.dto';
import { VACANCY_PERKS, isVacancyPerk } from '../vacancy-perks';

/** A valid listing, so each test can vary exactly one thing. */
const base = {
  locationId: 'loc-1',
  specialtyKey: 'barbering',
};

const parse = (input: Record<string, unknown>) => createVacancySchema.safeParse({ ...base, ...input });

/** The first issue path, which is what the client renders against a field. */
const errorPath = (r: ReturnType<typeof parse>) =>
  r.success ? null : r.error.issues[0]?.path.join('.');

describe('vacancy terms — validation', () => {
  it('defaults to negotiable, so a listing never has to publish a number', () => {
    const r = parse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.payType).toBe('negotiable');
  });

  it('requires a percentage when paying by percentage', () => {
    expect(errorPath(parse({ payType: 'percentage' }))).toBe('salonPercent');
  });

  it('accepts zero percent — a salon taking nothing is unusual, not invalid', () => {
    const r = parse({ payType: 'percentage', salonPercent: 0 });
    expect(r.success).toBe(true);
  });

  it('requires an amount for rent and for salary', () => {
    expect(errorPath(parse({ payType: 'rent' }))).toBe('amount');
    expect(errorPath(parse({ payType: 'salary' }))).toBe('amount');
  });

  it('rejects a percentage above 100', () => {
    expect(parse({ payType: 'percentage', salonPercent: 101 }).success).toBe(false);
  });

  it('rejects a range that runs backwards', () => {
    expect(errorPath(parse({ payType: 'percentage', salonPercent: 50, salonPercentMax: 40 })))
      .toBe('salonPercentMax');
    expect(errorPath(parse({ payType: 'salary', amount: 300_000, amountMax: 200_000 })))
      .toBe('amountMax');
  });

  it('allows a range whose ends are equal', () => {
    expect(parse({ payType: 'salary', amount: 200_000, amountMax: 200_000 }).success).toBe(true);
  });
});

describe('vacancy terms — normalization', () => {
  // Switching a listing from rent to percentage must not leave the old rent in
  // the row, or any reader that forgets to check payType renders a stale number.
  it('clears amounts when switching to percentage', () => {
    const r = parse({ payType: 'percentage', salonPercent: 40, amount: 150_000, amountMax: 200_000 });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.amount).toBeNull();
      expect(r.data.amountMax).toBeNull();
      expect(r.data.salonPercent).toBe(40);
    }
  });

  it('clears percentages when switching to rent', () => {
    const r = parse({ payType: 'rent', amount: 150_000, salonPercent: 40, salonPercentMax: 50 });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.salonPercent).toBeNull();
      expect(r.data.salonPercentMax).toBeNull();
      expect(r.data.amount).toBe(150_000);
    }
  });

  it('clears every number when the terms are negotiable', () => {
    const r = parse({ payType: 'negotiable', amount: 150_000, salonPercent: 40 });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.amount).toBeNull();
      expect(r.data.salonPercent).toBeNull();
    }
  });

  // A partial update that doesn't touch payType must not wipe the numbers it
  // isn't sending — that would silently blank a listing's money on any edit.
  it('leaves the terms alone when an update omits payType', () => {
    const r = updateVacancySchema.safeParse({ description: 'new text' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).not.toHaveProperty('amount');
      expect(r.data).not.toHaveProperty('salonPercent');
    }
  });
});

describe('the "other" escape hatch', () => {
  it('requires a title, so a listing is never headlined "Other"', () => {
    expect(errorPath(parse({ specialtyKey: 'other' }))).toBe('title');
    expect(errorPath(parse({ specialtyKey: 'other', title: '   ' }))).toBe('title');
  });

  it('accepts "other" once it has a title', () => {
    expect(parse({ specialtyKey: 'other', title: 'Night security' }).success).toBe(true);
  });

  it('leaves the title optional for every real specialty', () => {
    const r = parse({ specialtyKey: 'manicure' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.title).toBe('');
  });
});

describe('perks vocabulary', () => {
  it('accepts known keys and refuses anything else', () => {
    expect(parse({ perks: ['materials-included', 'own-client-base'] }).success).toBe(true);
    expect(parse({ perks: ['free-unicorn'] }).success).toBe(false);
  });

  it('narrows keys at the type level too', () => {
    expect(isVacancyPerk('parking')).toBe(true);
    expect(isVacancyPerk('parkings')).toBe(false);
  });

  it('uses lowercase hyphenated keys, matching the i18n keys they resolve to', () => {
    for (const key of VACANCY_PERKS) expect(key).toMatch(/^[a-z][a-z0-9-]*$/);
  });
});

describe('required anchors', () => {
  // A position with no address cannot be listed, filtered by city, or mapped.
  it('refuses a listing with no branch', () => {
    const r = createVacancySchema.safeParse({ specialtyKey: 'barbering' });
    expect(r.success).toBe(false);
  });

  it('refuses a listing with no specialty', () => {
    const r = createVacancySchema.safeParse({ locationId: 'loc-1' });
    expect(r.success).toBe(false);
  });
});

describe('list query', () => {
  it('defaults to showing everything', () => {
    const r = listVacancyQuerySchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.status).toBe('all');
  });

  it('accepts `expired`, which is derived from the clock rather than stored', () => {
    const r = listVacancyQuerySchema.safeParse({ status: 'expired' });
    expect(r.success).toBe(true);
  });

  it('rejects an unknown status instead of silently ignoring it', () => {
    expect(listVacancyQuerySchema.safeParse({ status: 'archived' }).success).toBe(false);
  });
});
