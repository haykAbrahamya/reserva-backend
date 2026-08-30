/**
 * The conditions a listing can advertise, as stable keys.
 *
 * Deliberately a code constant rather than a table: unlike specialties (market
 * vocabulary that grows per city and is edited by staff), this is a small,
 * fixed product vocabulary. A table would buy a CRUD screen nobody opens and an
 * extra join on every read.
 *
 * The backend only enforces membership — the labels, the grouping into
 * "offered" versus "expected", and the translations live in the frontend
 * locale files, so wording changes ship without touching the API.
 *
 * Two of these are what every professional asks before calling: whether
 * materials are included, and whether they must bring their own clientele.
 */
export const VACANCY_PERKS = [
  // Offered by the salon
  'materials-included',
  'tools-provided',
  'client-base-provided',
  'online-booking',
  'training-provided',
  'official-contract',
  'flexible-schedule',
  'uniform-provided',
  'parking',
  'meals',
  'transport',
  // Expected from the candidate
  'own-client-base',
  'own-tools',
] as const;

export type VacancyPerk = (typeof VACANCY_PERKS)[number];

export function isVacancyPerk(value: string): value is VacancyPerk {
  return (VACANCY_PERKS as readonly string[]).includes(value);
}
