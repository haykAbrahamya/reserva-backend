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
