import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { PasswordService } from '@/auth/password.service';
import { AppException } from '@/common/errors/app.exception';
import { newId } from '@/common/ids';
import { normalizePhone } from '@/common/utils/phone';
import type { CreatePartnerDto, UpdatePartnerDto } from './dto/partner.dto';

@Injectable()
export class PartnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
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
      },
    });
    if (!partner) throw AppException.notFound('Salon not found');
    return serializePartner(partner);
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

    return this.prisma.$transaction(async (tx) => {
      await tx.partner.update({
        where: { id: partnerId },
        data: {
          ...(rest.name !== undefined && { name: rest.name }),
          ...(rest.type !== undefined && { type: rest.type }),
          ...(rest.accent !== undefined && { accent: rest.accent }),
          ...(rest.active !== undefined && { active: rest.active }),
        },
      });

      if (presentation) {
        await tx.partnerPresentation.upsert({
          where: { partnerId },
          create: {
            partnerId,
            tagline: presentation.tagline ?? '',
            about: presentation.about ?? '',
            hours: presentation.hours ?? '',
            rating: presentation.rating ?? 0,
            reviews: presentation.reviews ?? 0,
            heroTints: (presentation.heroTints ?? []) as Prisma.InputJsonValue,
            gallery: (presentation.gallery ?? []) as Prisma.InputJsonValue,
          },
          update: {
            ...(presentation.tagline !== undefined && { tagline: presentation.tagline }),
            ...(presentation.about !== undefined && { about: presentation.about }),
            ...(presentation.hours !== undefined && { hours: presentation.hours }),
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

      return this.getOwn(partnerId);
    });
  }

  private async assertExists(partnerId: string) {
    const p = await this.prisma.partner.findFirst({
      where: { id: partnerId, deletedAt: null },
      select: { id: true },
    });
    if (!p) throw AppException.notFound('Partner not found');
  }
}

type SpecialistWithServices = { services?: { serviceId: string }[] } & Record<string, unknown>;

/** Flatten specialist service-links into serviceIds[] for the API shape. */
function serializePartner<T extends Record<string, unknown>>(partner: T) {
  const specialists = partner.specialists as SpecialistWithServices[] | undefined;
  if (!specialists) return partner;
  return {
    ...partner,
    specialists: specialists.map((sp) => {
      const { services, ...rest } = sp;
      return { ...rest, serviceIds: (services ?? []).map((s) => s.serviceId) };
    }),
  };
}
