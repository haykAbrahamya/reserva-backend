import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { PasswordService } from '@/auth/password.service';
import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';
import { newId } from '@/common/ids';
import { normalizePhone } from '@/common/utils/phone';
import { paginate, pageArgs } from '@/common/dto/pagination';
import type { CreatePartnerDto, UpdatePartnerDto } from '@/modules/partners/dto/partner.dto';
import type {
  ListPlatformPartnersQueryDto,
  PlatformUpdateUserDto,
  PlatformResetPasswordDto,
} from './dto/platform-partner.dto';

/**
 * Platform-scoped partner administration for the internal-backoffice. Unlike the
 * tenant PartnersService (which is scoped to the caller's own partnerId), this
 * operates across all partners and includes lightweight counts for the list.
 */
@Injectable()
export class PlatformPartnersService {
  private readonly logger = new Logger(PlatformPartnersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly config: ConfigService,
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
          ...(rest.bookingsEnabled !== undefined && { bookingsEnabled: rest.bookingsEnabled }),
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

  /** Turn the public booking flow on/off (contact-only mode). Platform-only. */
  async setBookings(id: string, enabled: boolean) {
    await this.assertExists(id);
    await this.prisma.partner.update({ where: { id }, data: { bookingsEnabled: enabled } });
    return this.get(id);
  }

  /**
   * PERMANENTLY delete a partner and ALL connected data — bookings, specialists,
   * services, locations, clients, users, reviews, notifications, presentation —
   * plus the partner's uploaded images on disk. Irreversible.
   *
   * Done as one transaction in strict dependency order so the inter-child
   * Restrict FKs (Booking → service/specialist/location/client) never block the
   * delete (relying on a single Partner cascade is not order-safe here).
   */
  async hardDelete(id: string) {
    // Allow deleting already soft-deleted partners too (don't filter deletedAt).
    const partner = await this.prisma.partner.findUnique({ where: { id }, select: { id: true } });
    if (!partner) throw AppException.notFound('Partner not found');

    await this.prisma.$transaction(async (tx) => {
      // 1. Bookings first — they Restrict-reference services/specialists/locations
      //    /clients, and cascade-delete their own client push subscriptions.
      await tx.booking.deleteMany({ where: { partnerId: id } });

      // 2. Specialist sub-tables, then specialists (location is Restrict).
      await tx.specialistReview.deleteMany({ where: { partnerId: id } });
      await tx.specialistTimeOff.deleteMany({ where: { partnerId: id } });
      await tx.specialistService.deleteMany({ where: { specialist: { partnerId: id } } });
      await tx.specialist.deleteMany({ where: { partnerId: id } });

      // 3. Catalog + people.
      await tx.service.deleteMany({ where: { partnerId: id } });
      await tx.location.deleteMany({ where: { partnerId: id } });
      await tx.client.deleteMany({ where: { partnerId: id } });

      // 4. In-app notifications (no partner cascade) + users (cascade their own
      //    notifications/push subs/refresh tokens).
      await tx.notification.deleteMany({ where: { partnerId: id } });
      await tx.user.deleteMany({ where: { partnerId: id } });

      // 5. Presentation, then the partner row itself.
      await tx.partnerPresentation.deleteMany({ where: { partnerId: id } });
      await tx.partner.delete({ where: { id } });
    });

    // 6. Best-effort: remove the partner's uploaded images directory from disk.
    try {
      const uploadsDir = resolve(this.config.get<string>('UPLOADS_DIR') ?? './uploads');
      await rm(join(uploadsDir, id), { recursive: true, force: true });
    } catch (err) {
      this.logger.warn(`Failed to remove uploads for deleted partner ${id}: ${String(err)}`);
    }

    return { id };
  }

  // ── Partner's users (platform support) ────────────────────

  /** All active (non-deleted) users of a partner — admins + managers. */
  async listUsers(partnerId: string) {
    await this.assertExists(partnerId);
    const users = await this.prisma.user.findMany({
      where: { partnerId, deletedAt: null },
      include: { location: { select: { id: true, name: true } } },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
    return users.map(serializeUser);
  }

  /** Update a partner user's profile (name/phone/active). Platform support edit. */
  async updateUser(partnerId: string, userId: string, dto: PlatformUpdateUserDto) {
    const user = await this.getUser(partnerId, userId);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.phone !== undefined && { phone: normalizePhone(dto.phone) }),
        ...(dto.active !== undefined && { active: dto.active }),
      },
      include: { location: { select: { id: true, name: true } } },
    });
    return serializeUser(updated);
  }

  /**
   * Reset a partner user's password (platform support). Uses the provided
   * password or generates a one-time one, forces a change on next login, and
   * revokes all active sessions. Returns the password ONCE so the operator can
   * hand it over.
   */
  async resetUserPassword(partnerId: string, userId: string, dto: PlatformResetPasswordDto) {
    const user = await this.getUser(partnerId, userId);
    const password = dto.password?.trim() || this.passwords.generateOtp();
    const passwordHash = await this.passwords.hash(password);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: true },
      }),
      // Revoke active sessions so old credentials stop working immediately.
      this.prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return { password };
  }

  private async getUser(partnerId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, partnerId, deletedAt: null },
      select: { id: true },
    });
    if (!user) throw AppException.notFound('User not found');
    return user;
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

type UserWithLocation = {
  location?: { id: string; name: string } | null;
} & Record<string, unknown>;

/** Public-safe partner user shape (never expose passwordHash). */
function serializeUser(u: UserWithLocation) {
  return {
    id: u.id as string,
    name: u.name as string,
    email: u.email as string,
    phone: u.phone as string,
    role: u.role as 'admin' | 'manager',
    active: u.active as boolean,
    mustChangePassword: u.mustChangePassword as boolean,
    lastLogin: u.lastLogin as Date | null,
    createdAt: u.createdAt as Date,
    location: u.location ? { id: u.location.id, name: u.location.name } : null,
  };
}
