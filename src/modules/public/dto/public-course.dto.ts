import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * Self-registration for a course from the public page. Mirrors the public
 * booking contact shape (name + E.164 phone), plus the locale the visitor
 * registered in so staff can follow up in their language.
 */
export const publicCourseRegisterSchema = z.object({
  /** The course to register for; we resolve its current open run server-side. */
  courseId: z.string().min(1),
  memberName: z.string().trim().min(1).max(120),
  memberPhone: z.string().trim().min(4).max(40),
  memberEmail: z.string().trim().email().max(160).or(z.literal('')).optional(),
  /** UI language ('en' | 'hy' | 'ru'); stored for localized follow-up. */
  locale: z.enum(['en', 'hy', 'ru']).optional(),
});
export class PublicCourseRegisterDto extends createZodDto(publicCourseRegisterSchema) {}
