import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * Public review submission from the booking page. No auth: the reviewer may give
 * a name (else shown as "Anonymous"); stars are required, free text is optional.
 */
export const createSpecialistReviewSchema = z.object({
  author: z.string().trim().max(80).optional().or(z.literal('')),
  rating: z.coerce.number().int().min(1).max(5),
  text: z.string().trim().max(1000).optional().or(z.literal('')),
});
export class CreateSpecialistReviewDto extends createZodDto(createSpecialistReviewSchema) {}
