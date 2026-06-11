import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { PasswordService } from '@/auth/password.service';
import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';
import { newId } from '@/common/ids';
import { normalizePhone } from '@/common/utils/phone';
import { paginate, pageArgs } from '@/common/dto/pagination';
import type { CreatePartnerDto, UpdatePartnerDto } from '@/modules/partners/dto/partner.dto';
import type { ListPlatformPartnersQueryDto } from './dto/platform-partner.dto';

/**
 * Platform-scoped partner administration for the internal-backoffice. Unlike the
 * tenant PartnersService (which is scoped to the caller's own partnerId), this
 * operates across all partners and includes lightweight counts for the list.
 */
@Injectable()
export class PlatformPartnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  async list(q: ListPlatformPartnersQueryDto) {
    const where: Prisma.PartnerWhereInput = {
      deletedAt: null,
      ...(q.active !== undefined ? { active: q.active } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' } },
              { slug: { contains: q.search, mode: 'insensitive' } },
              { type: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const include = {
      _count: {
        select: {
          locations: { where: { deletedAt: null } },
          specialists: { where: { deletedAt: null } },
          users: { where: { deletedAt: null } },
        },
      },
    } satisfies Prisma.PartnerInclude;
    const orderBy: Prisma.PartnerOrderByWithRelationInput = { createdAt: 'desc' };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.partner.findMany({ where, include, orderBy, ...pageArgs(q.page, q.pageSize) }),
      this.prisma.partner.count({ where }),
    ]);
    return paginate(rows.map(serialize), total, q.page, q.pageSize);
  }

  async get(id: string) {
    const partner = await this.prisma.partner.findFirst({
      where: { id, deletedAt: null },
      include: {
        presentation: true,
        _count: {
          select: {
            locations: { where: { deletedAt: null } },
            specialists: { where: { deletedAt: null } },
            services: { where: { deletedAt: null } },
            users: { where: { deletedAt: null } },
            bookings: true,
          },
        },
        users: {
          where: { deletedAt: null, role: 'admin' },
          select: { id: true, name: true, email: true, phone: true, lastLogin: true, active: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!partner) throw AppException.notFound('Partner not found');
    return serialize(partner);
  }

  /** Provision a partner + presentation + first admin user atomically. */
  async create(dto: CreatePartnerDto) {
    await this.assertSlugFree(dto.slug);
    await this.assertEmailFree(dto.admin.email);

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

    return { partner, adminOtp: generatedOtp };
  }

  async update(id: string, dto: UpdatePartnerDto) {
    await this.assertExists(id);
    const { presentation, ...rest } = dto;

    await this.prisma.$transaction(async (tx) => {
      await tx.partner.update({
        where: { id },
        data: {
          ...(rest.name !== undefined && { name: rest.name }),
          ...(rest.type !== undefined && { type: rest.type }),
          ...(rest.accent !== undefined && { accent: rest.accent }),
          ...(rest.active !== undefined && { active: rest.active }),
        },
      });

      if (presentation) {
        await tx.partnerPresentation.upsert({
          where: { partnerId: id },
          create: {
            partnerId: id,
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
    });

    return this.get(id);
  }

  /** Enable/disable a partner (controls public visibility + staff login). */
  async setActive(id: string, active: boolean) {
    await this.assertExists(id);
    await this.prisma.partner.update({ where: { id }, data: { active } });
    return this.get(id);
  }

  /** Feature/unfeature a salon in the public marketplace (/salons). Platform-only. */
  async setMarketplace(id: string, listed: boolean) {
    await this.assertExists(id);
    await this.prisma.partner.update({ where: { id }, data: { marketplaceListed: listed } });
    return this.get(id);
  }

  // ── guards ────────────────────────────────────────────────

  private async assertExists(id: string) {
    const p = await this.prisma.partner.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!p) throw AppException.notFound('Partner not found');
  }

  private async assertSlugFree(slug: string) {
    const existing = await this.prisma.partner.findUnique({ where: { slug }, select: { id: true } });
    if (existing) {
      throw AppException.conflict(ErrorCode.SLUG_TAKEN, `The slug "${slug}" is already in use`);
    }
  }

  private async assertEmailFree(email: string) {
    const existing = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true },
    });
    if (existing) {
      throw AppException.conflict(ErrorCode.EMAIL_TAKEN, `The email "${email}" is already in use`);
    }
  }
}

type PartnerWithCount = {
  _count?: Record<string, number>;
} & Record<string, unknown>;

/** Flatten Prisma _count into top-level counts for the API shape. */
function serialize<T extends PartnerWithCount>(partner: T) {
  const { _count, ...rest } = partner;
  return {
    ...rest,
    counts: {
      locations: _count?.locations ?? 0,
      specialists: _count?.specialists ?? 0,
      services: _count?.services ?? 0,
      users: _count?.users ?? 0,
      bookings: _count?.bookings ?? 0,
    },
  };
}
