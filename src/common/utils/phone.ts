/**
 * Normalize a phone number to a comparable key: keep a leading '+' (if any)
 * and digits only. Used for per-partner client dedup and user login matching.
 *   "+374 91 22 11 33" → "+37491221133"
 */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const plus = trimmed.startsWith('+') ? '+' : '';
  return plus + trimmed.replace(/\D/g, '');
}
