import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { requiredI18nSchema } from '@/common/schemas/localized';

/**
 * A catalog key is permanent: it is stored on every row that references it and
 * appears in URLs and API payloads. Constrained to a lowercase slug so it stays
 * readable in a query and can never collide by case.
 */
const keySchema = z
  .string()
  .trim()
  .min(2)
  .max(48)
  .regex(/^[a-z][a-z0-9-]*$/, 'Use lowercase letters, digits and hyphens');

const groupFields = z.object({
  name: z.string().trim().min(1).max(120),
  nameI18n: requiredI18nSchema,
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  active: z.boolean().default(true),
});

export const createSpecialtyGroupSchema = groupFields.extend({ key: keySchema });
export class CreateSpecialtyGroupDto extends createZodDto(createSpecialtyGroupSchema) {}

export const updateSpecialtyGroupSchema = groupFields.partial();
export class UpdateSpecialtyGroupDto extends createZodDto(updateSpecialtyGroupSchema) {}

const specialtyFields = z.object({
  groupKey: z.string().trim().min(1),
  /** The field of work — "Hair styling". */
  name: z.string().trim().min(1).max(120),
  nameI18n: requiredI18nSchema,
  /** The practitioner — "Hair stylist". */
  roleName: z.string().trim().min(1).max(120),
  roleNameI18n: requiredI18nSchema,
  /** Search synonyms, any language. Lowercased and de-duplicated on save so the
   *  client can match without normalizing. */
  aliases: z.array(z.string().trim().min(1).max(60)).max(40).default([]),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  active: z.boolean().default(true),
});

export const createSpecialtySchema = specialtyFields.extend({ key: keySchema });
export class CreateSpecialtyDto extends createZodDto(createSpecialtySchema) {}

export const updateSpecialtySchema = specialtyFields.partial();
export class UpdateSpecialtyDto extends createZodDto(updateSpecialtySchema) {}
