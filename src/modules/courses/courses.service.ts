import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AppException } from '@/common/errors/app.exception';
import { newId } from '@/common/ids';
import { paginate, pageArgs } from '@/common/dto/pagination';
import { cleanLocalizedInput } from '@/common/schemas/localized';
import { CohortsService } from './cohorts.service';
import type { CreateCourseDto, UpdateCourseDto, ListCourseQueryDto } from './dto/course.dto';

/**
 * Course templates (the reusable definition). Every method is tenant-scoped by
 * `partnerId`. Runs (cohorts) and members (enrollments) are owned by their own
 * services — this one stays focused on the course record itself.
 *
 * A course always has exactly one current run, so create() delegates to
 * CohortsService to spin up the first one atomically.
 */
@Injectable()
export class CoursesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cohorts: CohortsService,
  ) {}

  async list(partnerId: string, q: ListCourseQueryDto) {
    const where: Prisma.CourseWhereInput = {
      partnerId,
      deletedAt: null,
      ...(q.includeInactive ? {} : { active: true }),
      ...(q.search ? { title: { contains: q.search, mode: 'insensitive' } } : {}),
    };
    const orderBy: Prisma.CourseOrderByWithRelationInput = { createdAt: 'desc' };

    if (q.all) {
      const items = await this.prisma.course.findMany({ where, orderBy, include: courseInclude });
      return paginate(items.map(serializeCourse), items.length, 1, items.length || 1);
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.course.findMany({ where, orderBy, include: courseInclude, ...pageArgs(q.page, q.pageSize) }),
      this.prisma.course.count({ where }),
    ]);
    return paginate(items.map(serializeCourse), total, q.page, q.pageSize);
  }

  /** Tenant-scoped existence check reused by update/remove/get. Returns the row. */
  async get(partnerId: string, id: string) {
    const course = await this.prisma.course.findFirst({
      where: { id, partnerId, deletedAt: null },
      include: courseInclude,
    });
    if (!course) throw AppException.notFound('Course not found');
    return serializeCourse(course);
  }

  async create(partnerId: string, dto: CreateCourseDto) {
    const { titleI18n, summaryI18n, descriptionI18n, tutorSpecialistId, ...rest } = dto;
    const courseId = newId();

    await this.prisma.$transaction(async (tx) => {
      await tx.course.create({
        data: {
          ...(rest as Prisma.CourseUncheckedCreateInput),
          id: courseId,
          partnerId,
          tutorSpecialistId: await this.resolveTutor(partnerId, tutorSpecialistId, tx),
          titleI18n: cleanLocalizedInput(titleI18n) ?? Prisma.JsonNull,
          summaryI18n: cleanLocalizedInput(summaryI18n) ?? Prisma.JsonNull,
          descriptionI18n: cleanLocalizedInput(descriptionI18n) ?? Prisma.JsonNull,
        },
      });
      // Every course starts with one open run so it's immediately usable.
      await this.cohorts.createInitial(partnerId, courseId, tx);
    });

    return this.get(partnerId, courseId);
  }

  async update(partnerId: string, id: string, dto: UpdateCourseDto) {
    await this.assertExists(partnerId, id);
    const { titleI18n, summaryI18n, descriptionI18n, tutorSpecialistId, ...rest } = dto;

    const data: Prisma.CourseUncheckedUpdateInput = { ...rest };
    if (tutorSpecialistId !== undefined) {
      data.tutorSpecialistId = await this.resolveTutor(partnerId, tutorSpecialistId);
    }
    if (titleI18n !== undefined) data.titleI18n = cleanLocalizedInput(titleI18n) ?? Prisma.JsonNull;
    if (summaryI18n !== undefined) data.summaryI18n = cleanLocalizedInput(summaryI18n) ?? Prisma.JsonNull;
    if (descriptionI18n !== undefined) data.descriptionI18n = cleanLocalizedInput(descriptionI18n) ?? Prisma.JsonNull;

    await this.prisma.course.update({ where: { id }, data });
    return this.get(partnerId, id);
  }

  /** Soft-delete so historical runs/members keep their references. */
  async remove(partnerId: string, id: string) {
    await this.assertExists(partnerId, id);
    await this.prisma.course.update({
      where: { id },
      data: { deletedAt: new Date(), active: false },
    });
  }

  // ── internals ─────────────────────────────────────────────

  private async assertExists(partnerId: string, id: string) {
    const c = await this.prisma.course.findFirst({
      where: { id, partnerId, deletedAt: null },
      select: { id: true },
    });
    if (!c) throw AppException.notFound('Course not found');
  }

  /** Validate an optional tutor-specialist link belongs to this partner. Returns
   *  the id to store (or null to clear). Guest tutors pass null here. */
  private async resolveTutor(
    partnerId: string,
    tutorSpecialistId: string | null | undefined,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<string | null> {
    if (!tutorSpecialistId) return null;
    const sp = await tx.specialist.findFirst({
      where: { id: tutorSpecialistId, partnerId, deletedAt: null },
      select: { id: true },
    });
    if (!sp) throw AppException.notFound('Tutor specialist not found');
    return sp.id;
  }
}

/** Rows fetched with each course for the API shape (tutor + run summary). */
const courseInclude = {
  tutorSpecialist: { select: { id: true, name: true, nameI18n: true, title: true, titleI18n: true, avatarUrl: true } },
  cohorts: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' as const },
    include: { _count: { select: { enrollments: { where: { status: 'confirmed' as const } } } } },
  },
} satisfies Prisma.CourseInclude;

type CourseWithRelations = Prisma.CourseGetPayload<{ include: typeof courseInclude }>;

/**
 * Serialize a course for the API: expose the tutor (linked or guest), and a
 * lightweight rollup — the current (non-archived) run + total run count — so the
 * backoffice list can render "active run · N members" without extra fetches.
 */
function serializeCourse(course: CourseWithRelations) {
  const { cohorts, ...rest } = course;
  const current = cohorts.find((c) => c.status !== 'archived') ?? cohorts[0] ?? null;
  return {
    ...rest,
    currentCohort: current
      ? {
          id: current.id,
          status: current.status,
          startDate: current.startDate,
          endDate: current.endDate,
          scheduleText: current.scheduleText,
          capacity: current.capacity,
          registrationOpen: current.registrationOpen,
          locationId: current.locationId,
          confirmedCount: current._count.enrollments,
        }
      : null,
    cohortCount: cohorts.length,
  };
}
