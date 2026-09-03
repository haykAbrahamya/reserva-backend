import { z } from 'zod';

/**
 * Optional per-language overrides for a tenant-authored field. Every locale is
 * optional; a blank/absent locale falls back to the base string at read time.
 * `null` clears all translations. Mirrors the client's LocalizedText type.
 */
export const localizedTextSchema = z
  .object({
    hy: z.string().trim().max(500).nullable().optional(),
    en: z.string().trim().max(500).nullable().optional(),
    ru: z.string().trim().max(500).nullable().optional(),
  })
  .nullable()
  .optional();

export type LocalizedTextInput = z.infer<typeof localizedTextSchema>;

/**
 * Translations for a PLATFORM catalog row (specialties, areas, …).
 *
 * The distinction from `localizedTextSchema` above is deliberate and matters:
 * partner-authored content treats translations as optional OVERRIDES with a
 * fallback to the base value, whereas a platform catalog is rendered to every
 * partner in the country in their own language — so a missing Armenian name is
 * a bug that reaches production UI, not a fallback. Required, therefore.
 *
 * English lives in the row's base column (`name`), which stays the source of
 * truth for search and sort; this blob carries the other two.
 */
export const requiredI18nSchema = z.object({
  hy: z.string().trim().min(1).max(160),
  ru: z.string().trim().min(1).max(160),
});

export type RequiredI18n = z.infer<typeof requiredI18nSchema>;

/** Trim + drop empty locales; return null when nothing meaningful remains, so we
 *  never persist an empty {} (clean "no translations" signal). */
export function cleanLocalizedInput(input: LocalizedTextInput): Record<string, string> | null {
  if (!input || typeof input !== 'object') return null;
  const out: Record<string, string> = {};
  let any = false;
  for (const l of ['hy', 'en', 'ru'] as const) {
    const v = input[l];
    if (typeof v === 'string' && v.trim()) {
      out[l] = v.trim();
      any = true;
    }
  }
  return any ? out : null;
}
