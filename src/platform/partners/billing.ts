import type { Prisma } from '@prisma/client';

/**
 * A partner's billing as platform staff keep it in the internal console: a
 * free trial, then a month at a time. It reminds; it never blocks access.
 *
 * Calendar days throughout ('YYYY-MM-DD', Asia/Yerevan), stored as DATE, so
 * neither a time of day nor a time zone can move a deadline. Both ends of a
 * period are covered: a trial started on 15 Oct runs to 14 Nov, and payment
 * is due from 15 Nov.
 *
 *   trial — the trial runs today, and nothing is paid past today
 *   paid  — paid through today or later
 *   due   — what was covered has run out
 *   none  — billing not tracked for this partner yet
 */
export type BillingStatus = 'none' | 'trial' | 'paid' | 'due';

export interface BillingDates {
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  paidUntil: Date | null;
}

export interface Billing {
  status: BillingStatus;
  trialStartedAt: string | null;
  /** The trial's last day. */
  trialEndsAt: string | null;
  /** The last day paid for. */
  paidUntil: string | null;
  /** The first day nothing covered, when payment is due. */
  dueSince: string | null;
}

const YEREVAN_DAY = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Yerevan',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today in Yerevan — from the parts, never trusting a locale to print ISO order. */
export function billingToday(now = new Date()): string {
  const part = (type: string) => YEREVAN_DAY.formatToParts(now).find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** A DATE column's value as its calendar day. */
export const dayOf = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

/** A calendar day as a DATE column's value. */
export const dateOf = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

const addDays = (day: string, n: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** `day` a month later; the 31st into a shorter month lands on its last day. */
export function addMonth(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const lastOfNext = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, lastOfNext))).toISOString().slice(0, 10);
}

/** The last day of a month-long period that starts on `firstDay`. */
export const periodEnd = (firstDay: string): string => addDays(addMonth(firstDay), -1);

/** Where a partner's billing stands today. */
export function billingOf(b: BillingDates, today = billingToday()): Billing {
  const trialEndsAt = dayOf(b.trialEndsAt);
  const paidUntil = dayOf(b.paidUntil);
  const lastCovered = [trialEndsAt, paidUntil].filter((d): d is string => !!d).sort().at(-1) ?? null;
  const status: BillingStatus =
    paidUntil && paidUntil >= today ? 'paid'
    : trialEndsAt && trialEndsAt >= today ? 'trial'
    : lastCovered ? 'due'
    : 'none';
  return {
    status,
    trialStartedAt: dayOf(b.trialStartedAt),
    trialEndsAt,
    paidUntil,
    dueSince: status === 'due' && lastCovered ? addDays(lastCovered, 1) : null,
  };
}

/** "Start free trial": a month from today. */
export function trialFrom(today = billingToday()): { trialStartedAt: string; trialEndsAt: string } {
  return { trialStartedAt: today, trialEndsAt: periodEnd(today) };
}

/**
 * "Mark paid": the next month — from the day after what is already covered
 * (so paying early keeps the cycle), or from today when nothing covers today.
 */
export function nextPaidUntil(b: BillingDates, today = billingToday()): string {
  const covered = [dayOf(b.trialEndsAt), dayOf(b.paidUntil)]
    .filter((d): d is string => !!d && d >= today)
    .sort()
    .at(-1);
  return periodEnd(covered ? addDays(covered, 1) : today);
}

/** Partners whose billing is in `status` today — the same rules as {@link billingOf}. */
export function billingWhere(status: BillingStatus, today = billingToday()): Prisma.PartnerWhereInput {
  const t = dateOf(today);
  const notPaid: Prisma.PartnerWhereInput = { OR: [{ paidUntil: null }, { paidUntil: { lt: t } }] };
  const noTrial: Prisma.PartnerWhereInput = { OR: [{ trialEndsAt: null }, { trialEndsAt: { lt: t } }] };
  switch (status) {
    case 'paid':
      return { paidUntil: { gte: t } };
    case 'trial':
      return { AND: [{ trialEndsAt: { gte: t } }, notPaid] };
    case 'due':
      return { AND: [notPaid, noTrial, { OR: [{ paidUntil: { not: null } }, { trialEndsAt: { not: null } }] }] };
    case 'none':
      return { paidUntil: null, trialEndsAt: null };
  }
}
