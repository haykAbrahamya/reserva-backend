import { Injectable } from '@nestjs/common';
import { Prisma, CohortStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';
import { newId } from '@/common/ids';
import type { UpdateCohortDto, StartNewRunDto } from './dto/cohort.dto';

/** A lifecycle action the backoffice can request on a run. */
export type CohortAction = 'open' | 'start' | 'finish' | 'archive';

/**
 * Explicit cohort (run) lifecycle as a small state machine — one place that owns
 * every legal transition, so new states/rules are a table edit, not scattered
 * `if`s. This keeps the domain safe to extend as the product grows.
 *
 *   draft ─open→ open ─start→ running ─finish→ completed ─archive→ archived
 *   (open/running/completed can also be archived directly)
 */
const TRANSITIONS: Record<CohortAction, { from: CohortStatus[]; to: CohortStatus }> = {
  open: { from: ['draft'], to: 'open' },
  start: { from: ['draft', 'open'], to: 'running' },
  finish: { from: ['open', 'running'], to: 'completed' },
  archive: { from: ['draft', 'open', 'running', 'completed'], to: 'archived' },
};

@Injectable()
export class CohortsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Create a course's first run inside the create-course transaction. Runs are
   *  born `open` (accepting members) so a new course is immediately usable. */
  async createInitial(partnerId: string, courseId: string, tx: Prisma.TransactionClient) {
    await tx.courseCohort.create({
      data: { id: newId(), partnerId, courseId, status: 'open' },
    });
  }

  /** The current (non-archived) run for a course, or the most recent if all are
   *  archived. Tenant-scoped. Throws if the course has no runs (shouldn't happen). */
  async getCurrent(partnerId: string, courseId: string) {
    await this.assertCourse(partnerId, courseId);
    const cohort = await this.prisma.courseCohort.findFirst({
      where: { courseId, partnerId, deletedAt: null },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
    // Prefer a live run over an archived one.
    const live = await this.prisma.courseCohort.findFirst({
      where: { courseId, partnerId, deletedAt: null, status: { not: 'archived' } },
      orderBy: { createdAt: 'desc' },
    });
    const chosen = live ?? cohort;
    if (!chosen) throw AppException.notFound('This course has no runs');
    return chosen;
  }

  /** Past runs (archived + completed), newest first, for the History view. */
  async listHistory(partnerId: string, courseId: string) {
    await this.assertCourse(partnerId, courseId);
    return this.prisma.courseCohort.findMany({
      where: { courseId, partnerId, deletedAt: null, status: { in: ['completed', 'archived'] } },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { enrollments: { where: { status: 'confirmed' } } } } },
    });
  }

  /** Update a run's details (dates/capacity/branch/registration) — never status. */
  async update(partnerId: string, cohortId: string, dto: UpdateCohortDto) {
    const cohort = await this.assertCohort(partnerId, cohortId);
    if (dto.locationId !== undefined && dto.locationId !== null) {
      await this.assertLocation(partnerId, dto.locationId);
    }
    return this.prisma.courseCohort.update({
      where: { id: cohort.id },
      data: {
        ...(dto.locationId !== undefined && { locationId: dto.locationId }),
        ...(dto.startDate !== undefined && { startDate: dto.startDate ? new Date(dto.startDate) : null }),
        ...(dto.endDate !== undefined && { endDate: dto.endDate ? new Date(dto.endDate) : null }),
        ...(dto.scheduleText !== undefined && { scheduleText: dto.scheduleText }),
        ...(dto.capacity !== undefined && { capacity: dto.capacity }),
        ...(dto.registrationOpen !== undefined && { registrationOpen: dto.registrationOpen }),
      },
    });
  }

  /** Apply a lifecycle transition, validated against the state machine. */
  async transition(partnerId: string, cohortId: string, action: CohortAction) {
    const cohort = await this.assertCohort(partnerId, cohortId);
    const rule = TRANSITIONS[action];
    if (!rule.from.includes(cohort.status)) {
      throw AppException.badRequest(
        ErrorCode.INVALID_COHORT_TRANSITION,
        `Can't ${action} a run that is "${cohort.status}"`,
      );
    }
    return this.prisma.courseCohort.update({
      where: { id: cohort.id },
      data: { status: rule.to },
    });
  }

  /**
   * "Start a new run" (the user's "start the same course from zero"): archive the
   * current live run and create a fresh `open` one, atomically. The new run can
   * carry over run details (dates/capacity/branch) if the caller supplies them.
   */
  async startNewRun(partnerId: string, courseId: string, seed: StartNewRunDto) {
    await this.assertCourse(partnerId, courseId);
    if (seed.locationId) await this.assertLocation(partnerId, seed.locationId);

    return this.prisma.$transaction(async (tx) => {
      // Archive any live (non-archived) run for this course.
      await tx.courseCohort.updateMany({
        where: { courseId, partnerId, deletedAt: null, status: { not: 'archived' } },
        data: { status: 'archived' },
      });
      return tx.courseCohort.create({
        data: {
          id: newId(),
          partnerId,
          courseId,
          status: 'open',
          locationId: seed.locationId ?? null,
          startDate: seed.startDate ? new Date(seed.startDate) : null,
          endDate: seed.endDate ? new Date(seed.endDate) : null,
          scheduleText: seed.scheduleText ?? '',
          capacity: seed.capacity ?? 0,
          registrationOpen: seed.registrationOpen ?? true,
        },
      });
    });
  }

  // ── guards ────────────────────────────────────────────────

  private async assertCourse(partnerId: string, courseId: string) {
    const c = await this.prisma.course.findFirst({
      where: { id: courseId, partnerId, deletedAt: null },
      select: { id: true },
    });
    if (!c) throw AppException.notFound('Course not found');
  }

  /** Load a run scoped to the partner, or 404. */
  async assertCohort(partnerId: string, cohortId: string) {
    const cohort = await this.prisma.courseCohort.findFirst({
      where: { id: cohortId, partnerId, deletedAt: null },
    });
    if (!cohort) throw AppException.notFound('Course run not found');
    return cohort;
  }

  private async assertLocation(partnerId: string, locationId: string) {
    const loc = await this.prisma.location.findFirst({
      where: { id: locationId, partnerId, deletedAt: null },
      select: { id: true },
    });
    if (!loc) throw AppException.notFound('Location not found');
  }
}
