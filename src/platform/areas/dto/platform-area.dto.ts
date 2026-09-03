import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { requiredI18nSchema } from '@/common/schemas/localized';

/**
 * A catalog key is permanent: it is stored on every branch that references it
 * and travels in URLs and API payloads. Constrained to a lowercase slug so it
 * stays readable in a query and can never collide by case.
 */
const keySchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/, 'Use lowercase letters, digits and hyphens');

const areaFields = z.object({
  /** Null for a top-level region or city. */
  parentKey: z.string().trim().min(1).nullable().optional(),
  kind: z.enum(['region', 'city', 'district']),
  /** English name — source of truth for search and sort. */
  name: z.string().trim().min(1).max(160),
  nameI18n: requiredI18nSchema,
  /**
   * Search synonyms in any language or era. Lowercased and de-duplicated on
   * save so the client can match without normalizing.
   */
  aliases: z.array(z.string().trim().min(1).max(80)).max(40).default([]),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  active: z.boolean().default(true),
});

export const createAreaSchema = areaFields.extend({ key: keySchema });
export class CreateAreaDto extends createZodDto(createAreaSchema) {}

export const updateAreaSchema = areaFields.partial();
export class UpdateAreaDto extends createZodDto(updateAreaSchema) {}
