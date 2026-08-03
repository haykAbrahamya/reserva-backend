import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AppException } from '@/common/errors/app.exception';
import { newId } from '@/common/ids';
import { paginate, pageArgs } from '@/common/dto/pagination';
import { cleanLocalizedInput } from '@/common/schemas/localized';
import type { CreateServiceDto, UpdateServiceDto, ListServiceQueryDto } from './dto/service.dto';

@Injectable()
export class ServicesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(partnerId: string, q: ListServiceQueryDto) {
    const where: Prisma.ServiceWhereInput = {
      partnerId,
      deletedAt: null,
      ...(q.includeInactive ? {} : { active: true }),
      // Name search matches the base name (case-insensitive) OR any translation
      // stored in nameI18n, so typing a term in hy/en/ru surfaces the service
      // regardless of which language the visitor-facing name is in.
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' } },
              ...(['hy', 'en', 'ru'] as const).map((lng) => ({
                nameI18n: { path: [lng], string_contains: q.search },
              })),
            ],
          }
        : {}),
      // Exact category filter from the dropdown. '' matches uncategorized
      // services; undefined means "all categories".
      ...(q.category !== undefined ? { category: q.category } : {}),
    };
    // Manual display order is the source of truth; createdAt is a stable
    // tiebreaker for rows that still share a position (e.g. freshly created).
    const orderBy: Prisma.ServiceOrderByWithRelationInput[] = [
      { sortOrder: 'asc' },
      { createdAt: 'asc' },
    ];

    if (q.all) {
      const items = await this.prisma.service.findMany({ where, orderBy });
      return paginate(items, items.length, 1, items.length || 1);
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.service.findMany({ where, orderBy, ...pageArgs(q.page, q.pageSize) }),
      this.prisma.service.count({ where }),
    ]);
    return paginate(items, total, q.page, q.pageSize);
  }

  async get(partnerId: string, id: string) {
    const service = await this.prisma.service.findFirst({
      where: { id, partnerId, deletedAt: null },
    });
    if (!service) throw AppException.notFound('Service not found');
    return service;
  }

  async create(partnerId: string, dto: CreateServiceDto) {
    // Normalize translation blobs: trim, drop empty locales, {} → null.
    const { nameI18n, categoryI18n, ...rest } = dto;
    // New services append to the end of the partner's list. `sortOrder` is
    // server-owned (never accepted from the client) — set it to one past the
    // current max so drag-to-reorder stays the only way to change positions.
    const last = await this.prisma.service.findFirst({
      where: { partnerId, deletedAt: null },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const nextSortOrder = last ? last.sortOrder + 1 : 0;
    const service = await this.prisma.service.create({
      data: {
        ...(rest as Prisma.ServiceUncheckedCreateInput),
        id: newId(),
        partnerId,
        sortOrder: nextSortOrder,
        nameI18n: cleanLocalizedInput(nameI18n) ?? Prisma.JsonNull,
        categoryI18n: cleanLocalizedInput(categoryI18n) ?? Prisma.JsonNull,
      },
    });

    // Single-mode partners have no Specialists page, so there's no UI to attach
    // a service to a specialist. Auto-link every new service to the partner's
    // sole specialist so it becomes bookable immediately. Skip facility/entry
    // services that aren't tied to a person.
    if (service.requiresSpecialist) {
      await this.linkToSoloSpecialist(partnerId, service.id);
    }

    return service;
  }

  /** When the partner is `single`, attach the given service to its one (and only)
   * specialist. No-op for salons or if the specialist is missing. */
  private async linkToSoloSpecialist(partnerId: string, serviceId: string) {
    const partner = await this.prisma.partner.findUnique({
      where: { id: partnerId },
      select: { kind: true },
    });
    if (partner?.kind !== 'single') return;

    const specialist = await this.prisma.specialist.findFirst({
      where: { partnerId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!specialist) return;

    await this.prisma.specialistService.upsert({
      where: { specialistId_serviceId: { specialistId: specialist.id, serviceId } },
      create: { specialistId: specialist.id, serviceId },
      update: {},
    });
  }

  async update(partnerId: string, id: string, dto: UpdateServiceDto) {
    await this.get(partnerId, id); // tenant-scoped existence check
    const { nameI18n, categoryI18n, ...rest } = dto;
    // Switching to a fixed price must clear any previous upper bound so a stale
    // priceMax can't linger and re-render the service as a range.
    const data: Prisma.ServiceUncheckedUpdateInput =
      rest.priceType === 'fixed' ? { ...rest, priceMax: null } : { ...rest };
    // Only touch a translation column when the client sent that key (undefined =
    // leave as-is; present = set/clear, with empty → JsonNull).
    if (nameI18n !== undefined) data.nameI18n = cleanLocalizedInput(nameI18n) ?? Prisma.JsonNull;
    if (categoryI18n !== undefined) data.categoryI18n = cleanLocalizedInput(categoryI18n) ?? Prisma.JsonNull;
    const service = await this.prisma.service.update({ where: { id }, data });

    // A service flipped from facility → requires-specialist needs the same
    // auto-link in single mode (upsert makes this idempotent if already linked).
    if (service.requiresSpecialist) {
      await this.linkToSoloSpecialist(partnerId, service.id);
    }

    return service;
  }

  /** Soft-delete so historical bookings keep their service reference. */
  async remove(partnerId: string, id: string) {
    await this.get(partnerId, id);
    await this.prisma.service.update({
      where: { id },
      data: { deletedAt: new Date(), active: false },
    });
  }

  /**
   * Persist a drag-to-reorder. `ids` is the partner's services in their new
   * order. We filter to ids the partner actually owns (tenant-scope + guard
   * against stale/foreign ids), assign 0-based positions in that order, then
   * append any owned services the client didn't mention so nothing is lost or
   * collapsed to the same position. All writes run in one transaction.
   */
  async reorder(partnerId: string, ids: string[]) {
    const rows = await this.prisma.service.findMany({
      where: { partnerId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    });
    const owned = new Set(rows.map((r) => r.id));

    // Requested order, restricted to owned ids and de-duplicated.
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const id of ids) {
      if (owned.has(id) && !seen.has(id)) {
        ordered.push(id);
        seen.add(id);
      }
    }
    // Append owned services the client omitted, keeping their current relative
    // order, so a partial payload can never strand or overwrite them.
    for (const r of rows) if (!seen.has(r.id)) ordered.push(r.id);

    await this.prisma.$transaction(
      ordered.map((id, i) =>
        this.prisma.service.update({
          where: { id }, // id already proven partner-owned above
          data: { sortOrder: i },
        }),
      ),
    );
  }
}
