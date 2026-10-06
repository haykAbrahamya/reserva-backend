/**
 * Deterministic randomness + wall-clock helpers for the demo seed.
 *
 * Every "random" choice in the seed comes from a PRNG seeded per tenant, so two
 * runs on the same day produce the same calendar, the same reviews and the same
 * applicants — a demo that reshuffles itself on every reseed is impossible to
 * write test notes against.
 *
 * Dates are built in process-local time, and the seed entry pins the process
 * to Asia/Yerevan exactly as src/main.ts does, so `at(0, 11)` is 11:00 in the
 * salon's own clock regardless of the machine it runs on.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max]. */
  int(min: number, max: number): number;
  /** One element of a non-empty list. */
  pick<T>(list: readonly T[]): T;
  /** True with probability p. */
  chance(p: number): boolean;
  /** Pick by weight: [[value, weight], …]. */
  weighted<T>(entries: readonly (readonly [T, number])[]): T;
  /** A shuffled copy. */
  shuffle<T>(list: readonly T[]): T[];
}

/** mulberry32 — tiny, fast, and good enough for fixtures. */
export function rng(seed: number | string): Rng {
  let a = typeof seed === 'number' ? seed >>> 0 : hash(seed);
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  return {
    next,
    int,
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
    weighted: (entries) => {
      const total = entries.reduce((s, [, w]) => s + w, 0);
      let roll = next() * total;
      for (const [value, w] of entries) {
        roll -= w;
        if (roll < 0) return value;
      }
      return entries[entries.length - 1][0];
    },
    shuffle: (list) => {
      const out = [...list];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
}

/** FNV-1a — turns a slug into a stable PRNG seed. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ── Wall clock ────────────────────────────────────────────────

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Local midnight today. */
export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Local midnight `dayOffset` days from today. */
export function dayStart(dayOffset: number): Date {
  const d = startOfToday();
  d.setDate(d.getDate() + dayOffset);
  return d;
}

/** A local wall-clock time `dayOffset` days from today. Minutes past 24:00 roll into the next day. */
export function at(dayOffset: number, hour: number, minute = 0): Date {
  const d = dayStart(dayOffset);
  d.setMinutes(hour * 60 + minute);
  return d;
}

/** Now ± whole days. */
export function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * DAY);
}

/** Now ± minutes. */
export function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * MINUTE);
}

/** Schedule weekday key for a date — matches the `{ mon: …, sun: … }` JSON shape. */
export function weekdayKey(d: Date): Weekday {
  return (['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const)[d.getDay()];
}

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/** 'HH:MM' → minutes since midnight. */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
