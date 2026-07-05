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

/**
 * Query for the public review list: `cursor` is the previous page's last review
 * id (omitted for the first page); `take` is the page size (clamped server-side).
 */
export const listSpecialistReviewsSchema = z.object({
  cursor: z.string().trim().min(1).optional(),
  take: z.coerce.number().int().min(1).max(50).optional(),
});
export class ListSpecialistReviewsDto extends createZodDto(listSpecialistReviewsSchema) {}
