import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';
import { EnrollmentsService } from '@/modules/courses/enrollments.service';
import type { PublicCourseRegisterDto } from './dto/public-course.dto';

/**
 * Public course self-registration. Resolves the partner + the course's current
 * open run by slug, snapshots the price, and delegates the actual enrollment
 * (capacity + duplicate guards, `pending` status) to EnrollmentsService — so the
 * business rules live in ONE place, shared with the backoffice.
 */
@Injectable()
export class PublicCoursesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enrollments: EnrollmentsService,
  ) {}

  async register(slug: string, dto: PublicCourseRegisterDto) {
    const partner = await this.prisma.partner.findFirst({
      where: { slug, active: true, deletedAt: null },
      select: { id: true, coursesEnabled: true },
    });
    if (!partner) throw AppException.notFound('Salon not found');
    // Courses is a platform-gated feature — reject if it's off for this partner.
    if (!partner.coursesEnabled) {
      throw AppException.badRequest(ErrorCode.ENROLLMENT_CLOSED, 'Registration for this course is not available');
    }

    // The course must be published, and have a current (non-archived) run.
    const course = await this.prisma.course.findFirst({
      where: { id: dto.courseId, partnerId: partner.id, deletedAt: null, active: true },
      select: {
        price: true,
        cohorts: {
          where: { deletedAt: null, status: { not: 'archived' } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true },
        },
      },
    });
    const cohort = course?.cohorts[0];
    if (!course || !cohort) {
      throw AppException.badRequest(ErrorCode.ENROLLMENT_CLOSED, 'Registration for this course is not available');
    }

    const enrollment = await this.enrollments.selfRegister(partner.id, cohort.id, {
      memberName: dto.memberName,
      memberPhone: dto.memberPhone,
      memberEmail: dto.memberEmail,
      locale: dto.locale,
      priceAtEnroll: course.price,
    });

    // Public response stays minimal — never leak internal ids/counts. The client
    // only needs to know it worked and that it's awaiting confirmation.
    return { status: enrollment.status };
  }
}
