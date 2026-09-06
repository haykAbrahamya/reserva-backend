import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { keyList } from './board.dto';

/**
 * The specialist directory's query contract — the other direction of the same
 * market the board serves.
 *
 * It reuses `keyList` from the board's query rather than restating it, because
 * the two searches are filtered by the SAME taxonomies: a salon looking for a
 * colourist in Arabkir and a colourist looking for work in Arabkir are typing
 * the same keys into opposite ends of the product. If the two ever parsed
 * `?area=a,b` differently, one of them would be quietly wrong.
 *
 * Deliberately narrower than the board's, though. There is no pay filter and no
 * schedule filter: those are properties of a JOB, and inventing the mirror
 * fields on a person ("wants ≥ 300,000") would ask everyone to publish a
 * salary expectation to be findable at all.
 */
export const professionalSearchSchema = z.object({
  /** Free text over the name and the "about" text. */
  q: z.string().trim().max(140).optional(),

  /** Same key spaces as the board: districts, specialties, specialty groups. */
  area: keyList(),
  specialty: keyList(),
  group: keyList(),

  /**
   * "At least this many years." One bound, not a range: a salon filters for a
   * floor of experience, and nobody has ever searched for a maximum.
   */
  experienceMin: z.coerce.number().int().min(0).max(60).optional(),

  /** Only profiles with at least one photo of their work. */
  withPhotos: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),

  /**
   * `relevant` leads with the profiles a salon can actually act on — ones with
   * a photo and a filled-in page — because a directory whose first screen is
   * empty avatars reads as an empty directory.
   */
  sort: z.enum(['relevant', 'newest', 'experience']).default('relevant'),

  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(48).default(12),
});

export class ProfessionalSearchDto extends createZodDto(professionalSearchSchema) {}
export type ProfessionalSearchQuery = z.infer<typeof professionalSearchSchema>;
