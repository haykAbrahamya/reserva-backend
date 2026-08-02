import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { PasswordService } from '@/auth/password.service';
import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';
import { newId } from '@/common/ids';
import { normalizePhone } from '@/common/utils/phone';
import { cleanLocalizedInput } from '@/common/schemas/localized';
import { SpecialistReviewsService } from '@/modules/specialist-reviews/specialist-reviews.service';
import type { CreatePartnerDto, UpdatePartnerDto } from './dto/partner.dto';

@Injectable()
export class PartnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly reviews: SpecialistReviewsService,
  ) {}

  /**
   * Authenticated backoffice: the caller's own partner identity + branding only.
   * The catalog (locations / services / specialists) is fetched on demand from
   * its own endpoints, so this stays a lean, cacheable read.
   */
  async getOwn(partnerId: string) {
    const partner = await this.prisma.partner.findFirst({
      where: { id: partnerId, deletedAt: null },
      include: {
        presentation: true,
        // Lightweight count so global chrome (sidebar) needs no catalog fetch.
        _count: { select: { locations: { where: { deletedAt: null } } } },
      },
    });
    if (!partner) throw AppException.notFound('Partner not found');
    const { _count, ...rest } = partner;
    return { ...rest, locationCount: _count.locations };
  }

  /**
   * Heartbeat: bump the user's `lastSeenAt`. Called from GET /partner, which the
   * backoffice fetches on every app load/refresh, so it reflects real usage
   * (not just credential logins). Throttled to ≥60s so rapid refreshes don't
   * hammer the DB. Callers invoke this fire-and-forget so it never adds latency
   * to — or fails — the profile fetch.
   */
  async touchLastSeen(userId: string): Promise<void> {
    const now = Date.now();
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { lastSeenAt: true },
    });
    if (!user) return;
    const stale = !user.lastSeenAt || now - user.lastSeenAt.getTime() > 60_000;
    if (!stale) return;
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastSeenAt: new Date(now) },
    });
  }

  /** Public booking page — read-only, active partners only, by slug. */
  async getPublicBySlug(slug: string) {
    const partner = await this.prisma.partner.findFirst({
      where: { slug, active: true, deletedAt: null },
      include: {
        presentation: true,
        locations: { where: { deletedAt: null }, orderBy: { name: 'asc' } },
        services: { where: { deletedAt: null, active: true }, orderBy: [{ category: 'asc' }, { name: 'asc' }] },
        specialists: {
          where: { deletedAt: null, active: true },
          include: { services: { select: { serviceId: true } } },
          orderBy: { name: 'asc' },
        },
        // Public courses: published (active) courses, newest first, each with its
        // tutor and current (non-archived) run + a confirmed-seat count so the
        // client can show "N spots left" and gate registration.
        courses: {
          where: { deletedAt: null, active: true },
          orderBy: { createdAt: 'desc' },
          include: {
            tutorSpecialist: { select: { id: true, name: true, nameI18n: true, title: true, titleI18n: true, avatarUrl: true } },
            cohorts: {
              where: { deletedAt: null, status: { not: 'archived' } },
              orderBy: { createdAt: 'desc' },
              take: 1,
              include: { _count: { select: { enrollments: { where: { status: { in: ['pending', 'confirmed'] } } } } } },
            },
          },
        },
      },
    });
    if (!partner) throw AppException.notFound('Salon not found');
    // Enrich each specialist with its computed rating (avg + count) so every
    // place that shows a specialist in the client app can show real stars.
    const aggregates = await this.reviews.aggregatesFor(partner.specialists.map((s) => s.id));
    return serializePartner(partner, aggregates);
  }

  /**
   * Internal-backoffice: provision a partner + presentation + first admin user
   * atomically. Returns the partner and (if generated) the admin's one-time
   * password so the operator can hand it over.
   */
  async create(dto: CreatePartnerDto) {
    const partnerId = newId();
    const generatedOtp = dto.admin.password ? null : this.passwords.generateOtp();
    const passwordHash = await this.passwords.hash(dto.admin.password ?? generatedOtp!);

    const partner = await this.prisma.$transaction(async (tx) => {
      const created = await tx.partner.create({
        data: {
          id: partnerId,
          slug: dto.slug,
          name: dto.name,
          type: dto.type,
          accent: dto.accent,
          presentation: {
            create: {
              tagline: dto.presentation?.tagline ?? '',
              about: dto.presentation?.about ?? '',
              hours: dto.presentation?.hours ?? '',
              rating: dto.presentation?.rating ?? 0,
              reviews: dto.presentation?.reviews ?? 0,
              heroTints: (dto.presentation?.heroTints ?? []) as Prisma.InputJsonValue,
              gallery: (dto.presentation?.gallery ?? []) as Prisma.InputJsonValue,
            },
          },
        },
        include: { presentation: true },
      });

      await tx.user.create({
        data: {
          id: newId(),
          partnerId,
          name: dto.admin.name,
          email: dto.admin.email.toLowerCase(),
          phone: normalizePhone(dto.admin.phone),
          role: 'admin',
          locationId: null,
          passwordHash,
          mustChangePassword: !dto.admin.password,
        },
      });

      return created;
    });

    return { partner: serializePartner(partner), adminOtp: generatedOtp };
  }

  async update(partnerId: string, dto: UpdatePartnerDto) {
    await this.assertExists(partnerId);
    const { presentation, ...rest } = dto;

    // Slug must be globally unique (when changing it to a new value).
    if (rest.slug !== undefined) {
      const taken = await this.prisma.partner.findFirst({
        where: { slug: rest.slug, id: { not: partnerId } },
        select: { id: true },
      });
      if (taken) {
        throw AppException.conflict(ErrorCode.SLUG_TAKEN, `The handle "${rest.slug}" is already taken`);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.partner.update({
        where: { id: partnerId },
        data: {
          ...(rest.name !== undefined && { name: rest.name }),
          ...(rest.type !== undefined && { type: rest.type }),
          ...(rest.accent !== undefined && { accent: rest.accent }),
          ...(rest.active !== undefined && { active: rest.active }),
          ...(rest.slug !== undefined && { slug: rest.slug }),
          ...(rest.autoConfirmBookings !== undefined && {
            autoConfirmBookings: rest.autoConfirmBookings,
          }),
          ...(rest.bookingsEnabled !== undefined && {
            bookingsEnabled: rest.bookingsEnabled,
          }),
          ...(rest.kind !== undefined && { kind: rest.kind }),
          ...(rest.template !== undefined && { template: rest.template }),
          ...(rest.supportWidget !== undefined && { supportWidget: rest.supportWidget }),
          ...(rest.defaultLocale !== undefined && { defaultLocale: rest.defaultLocale }),
        },
      });

      if (presentation) {
        await tx.partnerPresentation.upsert({
          where: { partnerId },
          create: {
            partnerId,
            tagline: presentation.tagline ?? '',
            taglineI18n: cleanLocalizedInput(presentation.taglineI18n) ?? Prisma.JsonNull,
            about: presentation.about ?? '',
            aboutI18n: cleanLocalizedInput(presentation.aboutI18n) ?? Prisma.JsonNull,
            hours: presentation.hours ?? '',
            instagram: presentation.instagram ?? '',
            facebook: presentation.facebook ?? '',
            whatsapp: presentation.whatsapp ?? '',
            rating: presentation.rating ?? 0,
            reviews: presentation.reviews ?? 0,
            heroTints: (presentation.heroTints ?? []) as Prisma.InputJsonValue,
            gallery: (presentation.gallery ?? []) as Prisma.InputJsonValue,
          },
          update: {
            ...(presentation.tagline !== undefined && { tagline: presentation.tagline }),
            ...(presentation.taglineI18n !== undefined && {
              taglineI18n: cleanLocalizedInput(presentation.taglineI18n) ?? Prisma.JsonNull,
            }),
            ...(presentation.about !== undefined && { about: presentation.about }),
            ...(presentation.aboutI18n !== undefined && {
              aboutI18n: cleanLocalizedInput(presentation.aboutI18n) ?? Prisma.JsonNull,
            }),
            ...(presentation.hours !== undefined && { hours: presentation.hours }),
            ...(presentation.instagram !== undefined && { instagram: presentation.instagram }),
            ...(presentation.facebook !== undefined && { facebook: presentation.facebook }),
            ...(presentation.whatsapp !== undefined && { whatsapp: presentation.whatsapp }),
            ...(presentation.rating !== undefined && { rating: presentation.rating }),
            ...(presentation.reviews !== undefined && { reviews: presentation.reviews }),
            ...(presentation.heroTints !== undefined && {
              heroTints: presentation.heroTints as Prisma.InputJsonValue,
            }),
            ...(presentation.gallery !== undefined && {
              gallery: presentation.gallery as Prisma.InputJsonValue,
            }),
          },
        });
      }
    });

    // Read AFTER the transaction commits — getOwn() uses the top-level client,
    // so calling it inside the tx would read the pre-commit row and return a
    // stale slug/settings (the source of "slug doesn't update until refresh").
    return this.getOwn(partnerId);
  }

  private async assertExists(partnerId: string) {
    const p = await this.prisma.partner.findFirst({
      where: { id: partnerId, deletedAt: null },
      select: { id: true },
    });
    if (!p) throw AppException.notFound('Partner not found');
  }
}

type SpecialistWithServices = { id?: string; services?: { serviceId: string }[] } & Record<string, unknown>;

/** Flatten specialist service-links into serviceIds[] for the API shape, and
 *  attach the computed rating (avg + count) when an aggregates map is given. */
function serializePartner<T extends Record<string, unknown>>(
  partner: T,
  aggregates?: Map<string, { rating: number; reviewCount: number }>,
) {
  const specialists = partner.specialists as SpecialistWithServices[] | undefined;
  if (!specialists) return partner;

  // Partner-wide rating rollup, computed from REAL specialist reviews (never the
  // static presentation.rating column). This drives the rating shown at the top
  // of the client partner page and works for both salons (aggregate of the team)
  // and singles (their one specialist). Weighted by each specialist's count so a
  // 5★/1-review specialist doesn't outweigh a 4.6★/50-review one.
  let weightedSum = 0;
  let totalReviews = 0;
  for (const sp of specialists) {
    const agg = sp.id ? aggregates?.get(sp.id) : undefined;
    if (agg && agg.reviewCount > 0) {
      weightedSum += agg.rating * agg.reviewCount;
      totalReviews += agg.reviewCount;
    }
  }
  const partnerRating = totalReviews > 0 ? Math.round((weightedSum / totalReviews) * 10) / 10 : 0;

  const presentation = partner.presentation as Record<string, unknown> | null | undefined;

  return {
    ...partner,
    // Overwrite the presentation rating/reviews with the computed real values so
    // the client reads a single, trustworthy source.
    presentation: presentation
      ? { ...presentation, rating: partnerRating, reviews: totalReviews }
      : presentation,
    specialists: specialists.map((sp) => {
      const { services, ...rest } = sp;
      const agg = sp.id ? aggregates?.get(sp.id) : undefined;
      return {
        ...rest,
        serviceIds: (services ?? []).map((s) => s.serviceId),
        rating: agg?.rating ?? 0,
        reviewCount: agg?.reviewCount ?? 0,
      };
    }),
    // Courses are a platform-gated feature: when disabled for this partner, the
    // public page shows none (registration is also rejected server-side).
    courses: partner.coursesEnabled
      ? serializePublicCourses(partner.courses as PublicCourseRow[] | undefined)
      : [],
  };
}

type PublicCohortRow = {
  id: string;
  status: string;
  startDate: Date | null;
  endDate: Date | null;
  scheduleText: string;
  capacity: number;
  registrationOpen: boolean;
  locationId: string | null;
  _count: { enrollments: number };
};
type PublicCourseRow = { cohorts?: PublicCohortRow[] } & Record<string, unknown>;

/** Flatten each course's single current run into a lean public shape: the
 *  registration state + seats occupied so the client can show "N spots left"
 *  and gate the register button. Archived courses were already filtered out. */
function serializePublicCourses(courses: PublicCourseRow[] | undefined) {
  if (!courses) return undefined;
  return courses.map((course) => {
    const { cohorts, ...rest } = course;
    const run = cohorts?.[0];
    return {
      ...rest,
      currentCohort: run
        ? {
            id: run.id,
            status: run.status,
            startDate: run.startDate,
            endDate: run.endDate,
            scheduleText: run.scheduleText,
            capacity: run.capacity,
            registrationOpen: run.registrationOpen,
            locationId: run.locationId,
            takenCount: run._count.enrollments,
          }
        : null,
    };
  });
}
