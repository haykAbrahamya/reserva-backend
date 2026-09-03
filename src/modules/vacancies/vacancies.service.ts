import { Injectable } from '@nestjs/common';
import { Prisma, type Vacancy } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { SpecialtiesService } from '@/modules/specialties/specialties.service';
import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';
import { newId } from '@/common/ids';
import { cleanLocalizedInput } from '@/common/schemas/localized';
import { paginate, pageArgs } from '@/common/dto/pagination';
import type { CreateVacancyDto, UpdateVacancyDto, ListVacancyQueryDto } from './dto/vacancy.dto';

/**
 * How long a published listing stays live before it needs renewing.
 *
 * A board that quietly advertises positions filled six months ago is how every
 * job board loses trust, so listings expire by default and renewing is one
 * click. Deliberately generous — long enough not to nag, short enough that a
 * forgotten listing falls off by itself.
 */
const LISTING_TTL_DAYS = 30;

const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000);

/** The relations every listing is read with — a listing without its branch and
 *  its specialty cannot be rendered. */
const LISTING_INCLUDE = {
  location: {
    select: {
      id: true,
      name: true,
      address: true,
      areaKey: true,
      /// The place, resolved for display — "Yerevan / Arabkir".
      area: {
        select: {
          key: true,
          name: true,
          nameI18n: true,
          parent: { select: { key: true, name: true, nameI18n: true } },
        },
      },
    },
  },
  specialty: {
    select: { key: true, name: true, nameI18n: true, roleName: true, roleNameI18n: true, groupKey: true },
  },
} satisfies Prisma.VacancyInclude;

type VacancyRow = Prisma.VacancyGetPayload<{ include: typeof LISTING_INCLUDE }>;

/**
 * A listing is expired when its clock has run out, regardless of the stored
 * status.
 *
 * Computed at read time rather than swept by a scheduled job: the truth is a
 * timestamp comparison, so deriving it needs no cron, cannot drift, and behaves
 * identically on a machine that was asleep. The `expired` enum value exists for
 * a future sweeper that wants to make the state explicit for reporting.
 */
function isExpired(v: Pick<Vacancy, 'status' | 'expiresAt'>): boolean {
  return v.status === 'published' && v.expiresAt != null && v.expiresAt.getTime() < Date.now();
}

function serialize(v: VacancyRow) {
  return {
    ...v,
    /** The status to render — `published` but out of time reads as expired. */
    effectiveStatus: isExpired(v) ? ('expired' as const) : v.status,
    isExpired: isExpired(v),
  };
}

export type VacancyView = ReturnType<typeof serialize>;

/**
 * A partner's job/chair listings.
 *
 * Every method is tenant-scoped by `partnerId` and additionally branch-scoped
 * by `scopeLocationId`, which carries a manager's own branch (null for admins)
 * exactly as bookings does — a branch manager hires for their branch, not the
 * whole company.
 */
@Injectable()
export class VacanciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly specialties: SpecialtiesService,
  ) {}

  async list(partnerId: string, q: ListVacancyQueryDto, scopeLocationId: string | null) {
    // Composed through AND rather than spread into one object: both the status
    // filter and the search produce an `OR`, and spreading would let the second
    // silently overwrite the first (searching inside "Published" would start
    // matching expired listings).
    const filters: Prisma.VacancyWhereInput[] = [statusFilter(q.status)];
    if (scopeLocationId) filters.push({ locationId: scopeLocationId });
    if (q.locationId) filters.push({ locationId: q.locationId });
    if (q.specialtyKey) filters.push({ specialtyKey: q.specialtyKey });
    if (q.search) {
      filters.push({
        OR: [
          { title: { contains: q.search, mode: 'insensitive' } },
          { description: { contains: q.search, mode: 'insensitive' } },
        ],
      });
    }

    const where: Prisma.VacancyWhereInput = { partnerId, deletedAt: null, AND: filters };

    const [rows, total] = await Promise.all([
      this.prisma.vacancy.findMany({
        where,
        include: LISTING_INCLUDE,
        // Drafts first (they need finishing), then the newest activity.
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
        ...(q.all ? {} : pageArgs(q.page, q.pageSize)),
      }),
      this.prisma.vacancy.count({ where }),
    ]);

    return paginate(rows.map(serialize), total, q.page, q.all ? total : q.pageSize);
  }

  /**
   * Counts per status for the list's filter chips.
   *
   * `expired` is carved out of `published` rather than counted separately,
   * because both live under the same stored status — a chip claiming 8
   * published when 3 have run out would be the one number a partner most needs
   * to be right.
   */
  async counts(partnerId: string, scopeLocationId: string | null) {
    const scope: Prisma.VacancyWhereInput = {
      partnerId,
      deletedAt: null,
      ...(scopeLocationId ? { locationId: scopeLocationId } : {}),
    };

    const [rows, expired] = await Promise.all([
      this.prisma.vacancy.groupBy({ by: ['status'], where: scope, _count: { _all: true } }),
      this.prisma.vacancy.count({
        where: { ...scope, status: 'published', expiresAt: { lt: new Date() } },
      }),
    ]);

    const out: Record<string, number> = { all: 0, draft: 0, published: 0, paused: 0, closed: 0, expired };
    for (const r of rows) {
      out[r.status] = r._count._all;
      out.all += r._count._all;
    }
    out.published = Math.max(0, out.published - expired);
    return out;
  }

  async get(partnerId: string, id: string, scopeLocationId: string | null): Promise<VacancyView> {
    const row = await this.prisma.vacancy.findFirst({
      where: {
        id,
        partnerId,
        deletedAt: null,
        ...(scopeLocationId ? { locationId: scopeLocationId } : {}),
      },
      include: LISTING_INCLUDE,
    });
    if (!row) throw AppException.notFound('Vacancy not found');
    return serialize(row);
  }

  async create(
    partnerId: string,
    dto: CreateVacancyDto,
    createdById: string,
    scopeLocationId: string | null,
  ): Promise<VacancyView> {
    await this.assertLocation(partnerId, dto.locationId, scopeLocationId);
    await this.assertSpecialty(dto.specialtyKey);

    const { titleI18n, descriptionI18n, ...rest } = dto;
    const row = await this.prisma.vacancy.create({
      data: {
        ...(rest as Prisma.VacancyUncheckedCreateInput),
        id: newId(),
        partnerId,
        createdById,
        titleI18n: cleanLocalizedInput(titleI18n) ?? Prisma.JsonNull,
        descriptionI18n: cleanLocalizedInput(descriptionI18n) ?? Prisma.JsonNull,
      },
      include: LISTING_INCLUDE,
    });
    return serialize(row);
  }

  async update(
    partnerId: string,
    id: string,
    dto: UpdateVacancyDto,
    scopeLocationId: string | null,
  ): Promise<VacancyView> {
    await this.get(partnerId, id, scopeLocationId); // existence + scope
    if (dto.locationId) await this.assertLocation(partnerId, dto.locationId, scopeLocationId);
    if (dto.specialtyKey) await this.assertSpecialty(dto.specialtyKey);

    const { titleI18n, descriptionI18n, ...rest } = dto;
    const data: Prisma.VacancyUncheckedUpdateInput = { ...rest };
    // `undefined` means "not sent" and must leave the column alone; an explicit
    // null means "clear the translations".
    if (titleI18n !== undefined) data.titleI18n = cleanLocalizedInput(titleI18n) ?? Prisma.JsonNull;
    if (descriptionI18n !== undefined) {
      data.descriptionI18n = cleanLocalizedInput(descriptionI18n) ?? Prisma.JsonNull;
    }

    const row = await this.prisma.vacancy.update({
      where: { id },
      data,
      include: LISTING_INCLUDE,
    });
    return serialize(row);
  }

  /**
   * Lifecycle. The client sends a verb and the server owns the timestamps, so a
   * listing can never be `published` without a `publishedAt`, or live forever
   * because someone forgot to set an expiry.
   */
  async act(
    partnerId: string,
    id: string,
    action: 'publish' | 'pause' | 'close' | 'renew',
    scopeLocationId: string | null,
  ): Promise<VacancyView> {
    const current = await this.get(partnerId, id, scopeLocationId);
    // Publishing is the product boundary where a structured place becomes
    // mandatory: a listing whose branch has no area cannot be filtered by
    // region on the public board, so it would be invisible to the people
    // searching for it. Drafts are exempt — you can write one before deciding.
    if (action === 'publish' || action === 'renew') {
      await this.assertBranchHasArea(current.locationId);
    }

    const data: Prisma.VacancyUpdateInput =
      action === 'publish'
        ? {
            status: 'published',
            // First publish stamps the date; re-publishing a paused listing
            // keeps the original so "posted N days ago" stays honest.
            publishedAt: current.publishedAt ?? new Date(),
            expiresAt: daysFromNow(LISTING_TTL_DAYS),
            closedAt: null,
          }
        : action === 'pause'
          ? { status: 'paused' }
          : action === 'close'
            ? { status: 'closed', closedAt: new Date() }
            : // renew — push the clock out, and bring an expired listing back
              { status: 'published', expiresAt: daysFromNow(LISTING_TTL_DAYS), closedAt: null };

    const row = await this.prisma.vacancy.update({ where: { id }, data, include: LISTING_INCLUDE });
    return serialize(row);
  }

  /**
   * Soft delete, matching Location/Service/Specialist. It disappears from every
   * list exactly like a hard delete would, but the row survives — a listing that
   * people applied to must not take their applications with it.
   */
  async remove(partnerId: string, id: string, scopeLocationId: string | null): Promise<void> {
    await this.get(partnerId, id, scopeLocationId);
    await this.prisma.vacancy.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // ── guards ────────────────────────────────────────────────

  /** The branch must belong to this partner, be live, and be one the caller is
   *  allowed to hire for. */
  private async assertLocation(partnerId: string, locationId: string, scopeLocationId: string | null) {
    if (scopeLocationId && locationId !== scopeLocationId) {
      throw AppException.forbidden('You can only manage vacancies for your own branch');
    }
    const found = await this.prisma.location.findFirst({
      where: { id: locationId, partnerId, deletedAt: null },
      select: { id: true },
    });
    if (!found) throw AppException.notFound('Branch not found');
  }

  /**
   * A branch must have a structured area before its listings go public. The
   * column is nullable so existing branches keep working, so this is the check
   * that keeps the board's filter honest.
   */
  private async assertBranchHasArea(locationId: string) {
    const branch = await this.prisma.location.findUnique({
      where: { id: locationId },
      select: { name: true, areaKey: true },
    });
    if (!branch?.areaKey) {
      throw AppException.badRequest(
        ErrorCode.VALIDATION_FAILED,
        `Set the city or district for the branch "${branch?.name ?? ''}" before publishing — listings are filtered by area.`,
      );
    }
  }

  private async assertSpecialty(key: string) {
    if (!(await this.specialties.isActive(key))) {
      throw AppException.badRequest(ErrorCode.VALIDATION_FAILED, `Unknown specialty "${key}"`);
    }
  }
}

/**
 * Translate a status filter into a where clause. `expired` and `published` are
 * the interesting pair: both are stored as `published`, split by the clock, so
 * asking for one has to exclude the other.
 */
function statusFilter(status: ListVacancyQueryDto['status']): Prisma.VacancyWhereInput {
  const now = new Date();
  if (status === 'all') return {};
  if (status === 'expired') return { status: 'published', expiresAt: { lt: now } };
  if (status === 'published') {
    return { status: 'published', OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] };
  }
  return { status };
}
