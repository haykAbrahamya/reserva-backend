import { addMonth, billingOf, billingToday, billingWhere, dateOf, nextPaidUntil, periodEnd, trialFrom } from './billing';

const dates = (b: { trialStartedAt?: string; trialEndsAt?: string; paidUntil?: string }) => ({
  trialStartedAt: b.trialStartedAt ? dateOf(b.trialStartedAt) : null,
  trialEndsAt: b.trialEndsAt ? dateOf(b.trialEndsAt) : null,
  paidUntil: b.paidUntil ? dateOf(b.paidUntil) : null,
});

describe('billing', () => {
  it('reads today on the Yerevan calendar, whatever the server clock', () => {
    // 22:30 UTC on 15 Oct is already 16 Oct in Yerevan (UTC+4).
    expect(billingToday(new Date('2026-10-15T22:30:00Z'))).toBe('2026-10-16');
    expect(billingToday(new Date('2026-10-15T10:00:00Z'))).toBe('2026-10-15');
  });

  it('counts a month as a calendar month, the 31st landing on a shorter month’s last day', () => {
    expect(addMonth('2026-10-15')).toBe('2026-11-15');
    expect(addMonth('2026-01-31')).toBe('2026-02-28');
    expect(addMonth('2028-01-31')).toBe('2028-02-29');
    expect(addMonth('2026-12-10')).toBe('2027-01-10');
    expect(periodEnd('2026-10-15')).toBe('2026-11-14');
  });

  it('starts a free trial today, for a month, both ends included', () => {
    expect(trialFrom('2026-10-15')).toEqual({ trialStartedAt: '2026-10-15', trialEndsAt: '2026-11-14' });
  });

  it('tells where billing stands: trial to its last day, then due; paid through its last day', () => {
    const trial = dates({ trialStartedAt: '2026-10-15', trialEndsAt: '2026-11-14' });
    expect(billingOf(trial, '2026-11-14')).toMatchObject({ status: 'trial', dueSince: null });
    expect(billingOf(trial, '2026-11-15')).toMatchObject({ status: 'due', dueSince: '2026-11-15' });

    const paid = dates({ trialEndsAt: '2026-11-14', paidUntil: '2026-12-14' });
    expect(billingOf(paid, '2026-11-20')).toMatchObject({ status: 'paid', paidUntil: '2026-12-14' });
    expect(billingOf(paid, '2026-12-15')).toMatchObject({ status: 'due', dueSince: '2026-12-15' });

    expect(billingOf(dates({}), '2026-10-15')).toEqual({
      status: 'none', trialStartedAt: null, trialEndsAt: null, paidUntil: null, dueSince: null,
    });
  });

  it('marks a month paid from the end of what is covered — or from today once it ran out', () => {
    // Paid on time, during the trial: the month follows the trial.
    expect(nextPaidUntil(dates({ trialEndsAt: '2026-11-14' }), '2026-11-10')).toBe('2026-12-14');
    // Paid early for the next month: the cycle is kept.
    expect(nextPaidUntil(dates({ trialEndsAt: '2026-11-14', paidUntil: '2026-12-14' }), '2026-12-01')).toBe('2027-01-14');
    // Paid late: a fresh month from today.
    expect(nextPaidUntil(dates({ trialEndsAt: '2026-11-14' }), '2026-11-20')).toBe('2026-12-19');
    // Nothing tracked yet: a month from today.
    expect(nextPaidUntil(dates({}), '2026-10-15')).toBe('2026-11-14');
  });

  it('filters partners by the same rules, on DATE values', () => {
    const t = dateOf('2026-10-15');
    expect(billingWhere('paid', '2026-10-15')).toEqual({ paidUntil: { gte: t } });
    expect(billingWhere('none', '2026-10-15')).toEqual({ paidUntil: null, trialEndsAt: null });
    expect(JSON.stringify(billingWhere('due', '2026-10-15'))).toContain('"lt":"2026-10-15T00:00:00.000Z"');
  });
});
