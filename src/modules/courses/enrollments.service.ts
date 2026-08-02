import { Injectable } from '@nestjs/common';
import { Prisma, EnrollmentStatus, EnrollmentSource } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';
import { newId } from '@/common/ids';
import { normalizePhone } from '@/common/utils/phone';
import { paginate, pageArgs } from '@/common/dto/pagination';
import { BookingNotifier } from '@/modules/notifications/booking-notifier.service';
import type {
  AddEnrollmentDto,
  UpdateEnrollmentDto,
  ListEnrollmentQueryDto,
} from './dto/enrollment.dto';

/** Statuses that occupy a seat (count against capacity). */
const OCCUPYING: EnrollmentStatus[] = ['pending', 'confirmed'];

/**
 * Course members (enrollments). Self-contained: a member's contact lives on the
 * enrollment — course students are deliberately NOT booking Clients. Capacity is
 * enforced here against confirmed seats; a course run can't over-fill.
 */
@Injectable()
export class EnrollmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: BookingNotifier,
  ) {}

  async list(partnerId: string, cohortId: string, q: ListEnrollmentQueryDto) {
    await this.assertCohort(partnerId, cohortId);
    const where: Prisma.CourseEnrollmentWhereInput = {
      partnerId,
      cohortId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.search
        ? {
            OR: [
              { memberName: { contains: q.search, mode: 'insensitive' } },
              { memberPhone: { contains: q.search } },
            ],
          }
        : {}),
    };
    // Pending first (the confirmation queue), then by join time.
    const orderBy: Prisma.CourseEnrollmentOrderByWithRelationInput[] = [
      { status: 'asc' },
      { createdAt: 'asc' },
    ];

    if (q.all) {
      const items = await this.prisma.courseEnrollment.findMany({ where, orderBy });
      return paginate(items, items.length, 1, items.length || 1);
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.courseEnrollment.findMany({ where, orderBy, ...pageArgs(q.page, q.pageSize) }),
      this.prisma.courseEnrollment.count({ where }),
    ]);
    return paginate(items, total, q.page, q.pageSize);
  }

  /** Backoffice: add a member manually → lands `confirmed` (takes a seat now). */
  async addManual(partnerId: string, cohortId: string, dto: AddEnrollmentDto, createdById?: string) {
    const cohort = await this.assertCohort(partnerId, cohortId);
    const phone = normalizePhone(dto.memberPhone);
    await this.assertCapacity(cohort.id, cohort.capacity, 'confirmed');

    return this.upsertMember(partnerId, cohort, {
      memberName: dto.memberName,
      memberPhone: phone,
      memberEmail: dto.memberEmail ?? '',
      notes: dto.notes ?? null,
      status: 'confirmed',
      source: 'backoffice',
      createdById: createdById ?? null,
    });
  }

  /**
   * Public: self-registration → lands `pending` for staff to confirm. Guarded by
   * the run's `registrationOpen` flag and capacity (pending seats included so a
   * run can't be flooded past capacity while awaiting confirmation).
   */
  async selfRegister(
    partnerId: string,
    cohortId: string,
    input: { memberName: string; memberPhone: string; memberEmail?: string; locale?: string; priceAtEnroll: number },
  ) {
    const cohort = await this.assertCohort(partnerId, cohortId);
    if (!cohort.registrationOpen || !['open', 'running'].includes(cohort.status)) {
      throw AppException.badRequest(ErrorCode.ENROLLMENT_CLOSED, 'Registration for this course is closed');
    }
    const phone = normalizePhone(input.memberPhone);

    // Block a duplicate active registration for the same phone.
    const existing = await this.prisma.courseEnrollment.findUnique({
      where: { cohortId_memberPhone: { cohortId: cohort.id, memberPhone: phone } },
    });
    if (existing && OCCUPYING.includes(existing.status)) {
      throw AppException.conflict(ErrorCode.ALREADY_ENROLLED, 'You are already registered for this course');
    }
    await this.assertCapacity(cohort.id, cohort.capacity, 'occupying', existing?.id);

    const enrollment = await this.upsertMember(partnerId, cohort, {
      memberName: input.memberName,
      memberPhone: phone,
      memberEmail: input.memberEmail ?? '',
      notes: null,
      status: 'pending',
      source: 'public',
      locale: input.locale ?? null,
      priceAtEnroll: input.priceAtEnroll,
    });

    // Notify backoffice admins (fire-and-forget) — surfaces in the bell + push.
    const course = await this.prisma.course.findUnique({
      where: { id: cohort.courseId },
      select: { title: true },
    });
    this.notifier.notifyEnrollment({
      partnerId,
      courseId: cohort.courseId,
      courseTitle: course?.title ?? 'a course',
      memberName: input.memberName,
    });

    return enrollment;
  }

  /** Edit a member's contact fields / notes. */
  async update(partnerId: string, id: string, dto: UpdateEnrollmentDto) {
    await this.assertEnrollment(partnerId, id);
    return this.prisma.courseEnrollment.update({
      where: { id },
      data: {
        ...(dto.memberName !== undefined && { memberName: dto.memberName }),
        ...(dto.memberPhone !== undefined && { memberPhone: normalizePhone(dto.memberPhone) }),
        ...(dto.memberEmail !== undefined && { memberEmail: dto.memberEmail }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });
  }

  /** Move a member to a new status (confirm a pending one, cancel, etc.).
   *  Confirming a member re-checks capacity so a full run can't be over-confirmed. */
  async setStatus(partnerId: string, id: string, status: EnrollmentStatus) {
    const enr = await this.assertEnrollment(partnerId, id);
    if (status === 'confirmed' && enr.status !== 'confirmed') {
      const cohort = await this.prisma.courseCohort.findUnique({
        where: { id: enr.cohortId },
        select: { capacity: true },
      });
      await this.assertCapacity(enr.cohortId, cohort?.capacity ?? 0, 'confirmed', enr.id);
    }
    return this.prisma.courseEnrollment.update({ where: { id }, data: { status } });
  }

  /** Hard-remove a member (e.g. added by mistake). Distinct from `cancelled`,
   *  which keeps them as a record. */
  async remove(partnerId: string, id: string) {
    await this.assertEnrollment(partnerId, id);
    await this.prisma.courseEnrollment.delete({ where: { id } });
  }

  // ── internals ─────────────────────────────────────────────

  /**
   * Insert a member, or reactivate an existing row for the same phone (the
   * @@unique([cohortId, memberPhone]) means re-registering after a cancel updates
   * in place rather than erroring).
   */
  private async upsertMember(
    partnerId: string,
    cohort: { id: string },
    data: {
      memberName: string;
      memberPhone: string;
      memberEmail: string;
      notes: string | null;
      status: EnrollmentStatus;
      source: EnrollmentSource;
      locale?: string | null;
      priceAtEnroll?: number;
      createdById?: string | null;
    },
  ) {
    return this.prisma.courseEnrollment.upsert({
      where: { cohortId_memberPhone: { cohortId: cohort.id, memberPhone: data.memberPhone } },
      create: {
        id: newId(),
        partnerId,
        cohortId: cohort.id,
        memberName: data.memberName,
        memberPhone: data.memberPhone,
        memberEmail: data.memberEmail,
        notes: data.notes,
        status: data.status,
        source: data.source,
        locale: data.locale ?? null,
        priceAtEnroll: data.priceAtEnroll ?? 0,
        createdById: data.createdById ?? null,
      },
      // Re-registration / re-add: refresh contact + revive the seat.
      update: {
        memberName: data.memberName,
        memberEmail: data.memberEmail,
        status: data.status,
        source: data.source,
        ...(data.notes !== null && { notes: data.notes }),
        ...(data.locale != null && { locale: data.locale }),
        ...(data.priceAtEnroll != null && { priceAtEnroll: data.priceAtEnroll }),
      },
    });
  }

  /**
   * Enforce capacity. `mode` decides which seats count:
   *   - 'confirmed'  → only confirmed members (manual add / confirm action)
   *   - 'occupying'  → pending + confirmed (self-registration, so a run can't be
   *                    flooded with pending sign-ups past capacity)
   * capacity 0 = unlimited. `excludeId` skips the row being updated in place.
   */
  private async assertCapacity(
    cohortId: string,
    capacity: number,
    mode: 'confirmed' | 'occupying',
    excludeId?: string,
  ) {
    if (!capacity || capacity <= 0) return; // unlimited
    const statusIn = mode === 'confirmed' ? (['confirmed'] as EnrollmentStatus[]) : OCCUPYING;
    const taken = await this.prisma.courseEnrollment.count({
      where: { cohortId, status: { in: statusIn }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    });
    if (taken >= capacity) {
      throw AppException.conflict(ErrorCode.COURSE_FULL, 'This course run is full');
    }
  }

  private async assertCohort(partnerId: string, cohortId: string) {
    const cohort = await this.prisma.courseCohort.findFirst({
      where: { id: cohortId, partnerId, deletedAt: null },
    });
    if (!cohort) throw AppException.notFound('Course run not found');
    return cohort;
  }

  private async assertEnrollment(partnerId: string, id: string) {
    const enr = await this.prisma.courseEnrollment.findFirst({ where: { id, partnerId } });
    if (!enr) throw AppException.notFound('Course member not found');
    return enr;
  }
}
