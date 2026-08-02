import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { paginationSchema } from '@/common/dto/pagination';

// Phone is stored as entered but normalized to digits+leading-plus elsewhere;
// here we just require a plausible value. Matches the client's E.164 shape.
const memberPhone = z
  .string()
  .trim()
  .min(4)
  .max(40);

/** Add a member manually from the backoffice (lands `confirmed`). */
export const addEnrollmentSchema = z.object({
  memberName: z.string().trim().min(1).max(120),
  memberPhone,
  memberEmail: z.string().trim().email().max(160).or(z.literal('')).default(''),
  notes: z.string().trim().max(1000).nullable().optional(),
});
export class AddEnrollmentDto extends createZodDto(addEnrollmentSchema) {}

/** Patch a member's editable fields (contact + notes). */
export const updateEnrollmentSchema = addEnrollmentSchema.partial();
export class UpdateEnrollmentDto extends createZodDto(updateEnrollmentSchema) {}

/** Move a member between states (confirm a pending self-registration, cancel,
 *  mark completed/noshow). Kept separate from field edits so intent is explicit. */
export const enrollmentStatusSchema = z.object({
  status: z.enum(['pending', 'confirmed', 'cancelled', 'completed', 'noshow']),
});
export class EnrollmentStatusDto extends createZodDto(enrollmentStatusSchema) {}

export const listEnrollmentQuerySchema = paginationSchema.extend({
  /** Filter by status (e.g. only `pending` for the confirmation queue). */
  status: z.enum(['pending', 'confirmed', 'cancelled', 'completed', 'noshow']).optional(),
  /** Free-text search over member name / phone. */
  search: z.string().trim().optional(),
});
export class ListEnrollmentQueryDto extends createZodDto(listEnrollmentQuerySchema) {}
