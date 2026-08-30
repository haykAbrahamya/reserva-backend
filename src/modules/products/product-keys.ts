/**
 * Product keys the application code knows about.
 *
 * The `products` table is the source of truth for which products EXIST — a new
 * one is seeded with an INSERT, no migration. This union is the narrower set the
 * code can reason about: guards, setup hooks and switch statements. A key may
 * therefore exist in the database before it appears here (seeded ahead of the
 * code that implements it), which is exactly the intended order.
 *
 * Naming convention — lowercase plural domain nouns, matching the existing
 * `*Enabled` columns and route names, so one word identifies a product across
 * the database, the API and the URL space.
 */
export const PRODUCT_KEYS = ['bookings', 'courses', 'vacancies'] as const;

export type ProductKey = (typeof PRODUCT_KEYS)[number];

/** Narrow an arbitrary string (query param, DB row) to a known product key. */
export function isProductKey(value: string): value is ProductKey {
  return (PRODUCT_KEYS as readonly string[]).includes(value);
}
