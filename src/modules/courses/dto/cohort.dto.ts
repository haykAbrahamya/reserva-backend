import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * A CourseCohort is one RUN of a course. Fields that vary per run (dates,
 * capacity, branch, registration) live here. Status is not set directly — it's
 * driven through explicit lifecycle transitions (see CohortsService).
 */
const cohortFields = z.object({
  /** Branch this run happens at (optional). */
  locationId: z.string().trim().min(1).nullable().optional(),
  /** Fixed dates for a group run (ISO date strings). Null = rolling/undated. */
  startDate: z.string().datetime({ offset: true }).nullable().optional(),
  endDate: z.string().datetime({ offset: true }).nullable().optional(),
  /** Free-text schedule, e.g. "Tue & Thu · 18:00–20:00". */
  scheduleText: z.string().trim().max(200).default(''),
  /** Max confirmed members. 0 = unlimited. */
  capacity: z.number().int().min(0).max(100_000).default(0),
  /** Whether self-registration from the public page is accepted for this run. */
  registrationOpen: z.boolean().default(true),
});

/** Patch the current run's details (never its status — use the transition endpoints). */
export const updateCohortSchema = cohortFields.partial().superRefine((v, ctx) => {
  if (v.startDate && v.endDate && new Date(v.endDate) < new Date(v.startDate)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: 'End date must be after the start date' });
  }
});
export class UpdateCohortDto extends createZodDto(updateCohortSchema) {}

/** Lifecycle transitions the backoffice can request on a run. `start-new-run`
 *  is a course-level action (archives the current run, creates a fresh one) and
 *  lives on the course controller, so it isn't listed here. */
export const cohortActionSchema = z.object({
  action: z.enum(['open', 'start', 'finish', 'archive']),
});
export class CohortActionDto extends createZodDto(cohortActionSchema) {}

/** Optionally seed the fresh run's details when starting a new run. */
export const startNewRunSchema = cohortFields.partial();
export class StartNewRunDto extends createZodDto(startNewRunSchema) {}
