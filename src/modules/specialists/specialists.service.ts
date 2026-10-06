import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';
import { newId } from '@/common/ids';
import { paginate, pageArgs } from '@/common/dto/pagination';
import { cleanLocalizedInput } from '@/common/schemas/localized';
import { PricingService } from '@/modules/pricing/pricing.service';
import type {
  CreateSpecialistDto,
  UpdateSpecialistDto,
  ListSpecialistQueryDto,
} from './dto/specialist.dto';

/** Statuses that make a booking "upcoming" for the leave-a-branch guard. */
const LIVE_STATUSES = ['pending', 'confirmed'] as const;

/** Joined rows every specialist response is built from. */
const SPECIALIST_INCLUDE = {
  services: { select: { serviceId: true } },
  locations: { select: { locationId: true, schedule: true }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.SpecialistInclude;

type SpecialistRow = Prisma.SpecialistGetPayload<{ include: typeof SPECIALIST_INCLUDE }>;

/** One branch a specialist works at, with the hours there. */
export interface BranchLink {
  locationId: string;
  schedule: Prisma.JsonValue;
}

/**
 * The branches a specialist works at, home branch first. A specialist ALWAYS
 * works at their home branch: if the link row is missing (it never should be —
 * a trigger guarantees it), fall back to the home branch + legacy hours rather
 * than dropping them from the booking page.
 */
function branchLinks(sp: Pick<SpecialistRow, 'locationId' | 'schedule' | 'locations'>): BranchLink[] {
  const links: BranchLink[] = (sp.locations ?? []).map((l) => ({ locationId: l.locationId, schedule: l.schedule }));
  const home = links.find((l) => l.locationId === sp.locationId) ?? { locationId: sp.locationId, schedule: sp.schedule };
  return [home, ...links.filter((l) => l.locationId !== sp.locationId)];
}

/**
 * Shape returned to clients: the service-link join flattened into `serviceIds`,
 * and the branch links as `locations` (+ `locationIds` for quick filtering).
 * `locationId` (home) and `schedule` (home hours) keep their original meaning,
 * so clients that predate branches see exactly what they always saw.
 */
function serialize(sp: SpecialistRow) {
  const { services, locations: _links, ...rest } = sp;
  const links = branchLinks(sp);
  return {
    ...rest,
    serviceIds: services.map((s) => s.serviceId),
    locationIds: links.map((l) => l.locationId),
    locations: links,
  };
}

/** Sensible starting hours for a new specialist: Mon–Sat 10:00–19:00, Sun off. */
function defaultSchedule(): Prisma.InputJsonValue {
  const day = { enabled: true, start: '10:00', end: '19:00' };
  return {
    mon: day,
    tue: day,
    wed: day,
    thu: day,
    fri: day,
    sat: day,
    sun: { enabled: false, start: '10:00', end: '19:00' },
  };
}

@Injectable()
export class SpecialistsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  async list(partnerId: string, q: ListSpecialistQueryDto) {
    const where: Prisma.SpecialistWhereInput = {
      partnerId,
      deletedAt: null,
      // Everyone who WORKS at the branch, not only those whose home it is.
      ...(q.locationId ? { locations: { some: { locationId: q.locationId } } } : {}),
      ...(q.includeInactive ? {} : { active: true }),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' } },
              { title: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const orderBy: Prisma.SpecialistOrderByWithRelationInput = { name: 'asc' };

    if (q.all) {
      const rows = await this.prisma.specialist.findMany({ where, include: SPECIALIST_INCLUDE, orderBy });
      return paginate(rows.map(serialize), rows.length, 1, rows.length || 1);
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.specialist.findMany({
        where,
        include: SPECIALIST_INCLUDE,
        orderBy,
        ...pageArgs(q.page, q.pageSize),
      }),
      this.prisma.specialist.count({ where }),
    ]);
    return paginate(rows.map(serialize), total, q.page, q.pageSize);
  }

  async get(partnerId: string, id: string) {
    return serialize(await this.load(partnerId, id));
  }

  async create(partnerId: string, dto: CreateSpecialistDto) {
    const branches = dto.locations ?? [{ locationId: dto.locationId, schedule: dto.schedule }];
    await this.assertLocations(partnerId, branches.map((b) => b.locationId));
    if (branches.length > 1) await this.pricing.assertEnabled(partnerId);
    await this.assertServices(partnerId, dto.serviceIds);

    // New specialists get a sensible default week so the Hours editor is
    // immediately usable instead of empty.
    const scheduleOf = (b: { locationId: string; schedule?: unknown }): Prisma.InputJsonValue =>
      (b.schedule ?? (b.locationId === dto.locationId ? dto.schedule : undefined) ?? defaultSchedule()) as Prisma.InputJsonValue;
    const homeSchedule = scheduleOf(branches.find((b) => b.locationId === dto.locationId)!);

    const id = newId();
    const sp = await this.prisma.$transaction(async (tx) => {
      await tx.specialist.create({
        data: {
          id,
          partnerId,
          locationId: dto.locationId,
          name: dto.name,
          nameI18n: cleanLocalizedInput(dto.nameI18n) ?? Prisma.JsonNull,
          title: dto.title ?? '',
          titleI18n: cleanLocalizedInput(dto.titleI18n) ?? Prisma.JsonNull,
          phone: dto.phone ?? '',
          active: dto.active ?? true,
          schedule: homeSchedule,
          services: {
            create: (dto.serviceIds ?? []).map((serviceId) => ({ serviceId })),
          },
        },
      });
      // The home-branch row already exists (a trigger writes it with the
      // specialist); upsert so every branch ends up with its own hours.
      await this.writeLinks(tx, partnerId, id, branches.map((b) => ({ locationId: b.locationId, schedule: scheduleOf(b) })));
      return tx.specialist.findUniqueOrThrow({ where: { id }, include: SPECIALIST_INCLUDE });
    });
    return serialize(sp);
  }

  async update(partnerId: string, id: string, dto: UpdateSpecialistDto) {
    const current = await this.load(partnerId, id);
    const currentLinks = branchLinks(current);
    if (dto.serviceIds) await this.assertServices(partnerId, dto.serviceIds);

    // ── Which branches, and which is home, after this update ──
    let home = current.locationId;
    let nextLinks: { locationId: string; schedule: Prisma.InputJsonValue }[] | null = null;
    const hoursAt = (locationId: string) =>
      currentLinks.find((l) => l.locationId === locationId)?.schedule as Prisma.InputJsonValue | undefined;

    if (dto.locations) {
      // The branch-aware editor sends the full list.
      await this.assertLocations(partnerId, dto.locations.map((l) => l.locationId));
      if (dto.locations.length > 1) await this.pricing.assertEnabled(partnerId);
      home =
        dto.locationId ??
        (dto.locations.some((l) => l.locationId === current.locationId) ? current.locationId : dto.locations[0].locationId);
      nextLinks = dto.locations.map((l) => ({
        locationId: l.locationId,
        schedule: (l.schedule ??
          (l.locationId === home ? dto.schedule : undefined) ??
          hoursAt(l.locationId) ??
          defaultSchedule()) as Prisma.InputJsonValue,
      }));
      // Leaving a branch where they still have upcoming bookings would strand
      // those clients, so it is refused until the bookings are moved.
      const leaving = currentLinks.map((l) => l.locationId).filter((l) => !dto.locations!.some((n) => n.locationId === l));
      if (leaving.length) await this.assertNoUpcomingBookings(partnerId, id, leaving);
    } else if (dto.locationId && dto.locationId !== current.locationId) {
      // A single-branch editor (older backoffice) changed the location select.
      await this.assertLocations(partnerId, [dto.locationId]);
      home = dto.locationId;
      nextLinks =
        currentLinks.length <= 1
          ? // One branch: a MOVE, exactly as before branches existed.
            [{ locationId: dto.locationId, schedule: (dto.schedule ?? current.schedule) as Prisma.InputJsonValue }]
          : // Several branches: only the home changes; make sure they work there.
            [
              ...currentLinks.map((l) => ({ locationId: l.locationId, schedule: l.schedule as Prisma.InputJsonValue })),
              ...(currentLinks.some((l) => l.locationId === dto.locationId)
                ? []
                : [{ locationId: dto.locationId, schedule: (dto.schedule ?? defaultSchedule()) as Prisma.InputJsonValue }]),
            ];
    } else if (dto.schedule) {
      // The single-branch Hours page: hours at the home branch.
      nextLinks = currentLinks.map((l) => ({
        locationId: l.locationId,
        schedule: (l.locationId === home ? dto.schedule : l.schedule) as Prisma.InputJsonValue,
      }));
    }
    const homeSchedule = nextLinks?.find((l) => l.locationId === home)?.schedule;

    const sp = await this.prisma.$transaction(async (tx) => {
      await tx.specialist.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.nameI18n !== undefined && { nameI18n: cleanLocalizedInput(dto.nameI18n) ?? Prisma.JsonNull }),
          ...(dto.title !== undefined && { title: dto.title }),
          ...(dto.titleI18n !== undefined && { titleI18n: cleanLocalizedInput(dto.titleI18n) ?? Prisma.JsonNull }),
          ...(dto.phone !== undefined && { phone: dto.phone }),
          ...(dto.active !== undefined && { active: dto.active }),
          ...(home !== current.locationId && { locationId: home }),
          // `schedule` mirrors the home branch's hours for older readers.
          ...(homeSchedule !== undefined && { schedule: homeSchedule }),
        },
      });

      if (nextLinks) {
        await this.writeLinks(tx, partnerId, id, nextLinks);
        // Removing a branch also removes the specialist's own prices there
        // (cascade through the composite foreign key).
        await tx.specialistLocation.deleteMany({
          where: { specialistId: id, locationId: { notIn: nextLinks.map((l) => l.locationId) } },
        });
      }

      // Service links are saved as a DIFF. Deleting and re-inserting the whole
      // set would churn rows for no reason and drop anything hanging off them.
      if (dto.serviceIds) {
        const want = new Set(dto.serviceIds);
        const have = new Set(current.services.map((s) => s.serviceId));
        const removed = [...have].filter((s) => !want.has(s));
        const added = [...want].filter((s) => !have.has(s));
        if (removed.length) {
          await tx.specialistService.deleteMany({ where: { specialistId: id, serviceId: { in: removed } } });
          // A service they no longer do has no price of theirs either.
          await tx.specialistPrice.deleteMany({ where: { specialistId: id, serviceId: { in: removed } } });
        }
        if (added.length) {
          await tx.specialistService.createMany({
            data: added.map((serviceId) => ({ specialistId: id, serviceId })),
            skipDuplicates: true,
          });
        }
      }

      return tx.specialist.findUniqueOrThrow({ where: { id }, include: SPECIALIST_INCLUDE });
    });
    return serialize(sp);
  }

  async remove(partnerId: string, id: string) {
    await this.load(partnerId, id);
    await this.prisma.specialist.update({
      where: { id },
      data: { deletedAt: new Date(), active: false },
    });
  }

  // ── internals ─────────────────────────────────────────────

  private async load(partnerId: string, id: string): Promise<SpecialistRow> {
    const sp = await this.prisma.specialist.findFirst({
      where: { id, partnerId, deletedAt: null },
      include: SPECIALIST_INCLUDE,
    });
    if (!sp) throw AppException.notFound('Specialist not found');
    return sp;
  }

  /** Upsert the given branch links with their hours (existing rows are updated). */
  private async writeLinks(
    tx: Prisma.TransactionClient,
    partnerId: string,
    specialistId: string,
    links: { locationId: string; schedule: Prisma.InputJsonValue }[],
  ) {
    for (const l of links) {
      await tx.specialistLocation.upsert({
        where: { specialistId_locationId: { specialistId, locationId: l.locationId } },
        create: { specialistId, locationId: l.locationId, partnerId, schedule: l.schedule },
        update: { schedule: l.schedule },
      });
    }
  }

  private async assertLocations(partnerId: string, locationIds: string[]) {
    const unique = [...new Set(locationIds)];
    const count = await this.prisma.location.count({
      where: { id: { in: unique }, partnerId, deletedAt: null },
    });
    if (count !== unique.length) throw AppException.notFound('Location not found');
  }

  private async assertServices(partnerId: string, serviceIds: string[]) {
    if (!serviceIds.length) return;
    const count = await this.prisma.service.count({
      where: { id: { in: serviceIds }, partnerId, deletedAt: null },
    });
    if (count !== serviceIds.length) {
      throw AppException.badRequest(
        ErrorCode.VALIDATION_FAILED,
        'One or more services are invalid',
      );
    }
  }

  /** Refuse to take a specialist off branches where they have upcoming bookings. */
  private async assertNoUpcomingBookings(partnerId: string, specialistId: string, locationIds: string[]) {
    const bookings = await this.prisma.booking.findMany({
      where: {
        partnerId,
        specialistId,
        locationId: { in: locationIds },
        status: { in: [...LIVE_STATUSES] },
        startAt: { gte: new Date() },
      },
      orderBy: { startAt: 'asc' },
      take: 20,
      select: { id: true, startAt: true, locationId: true, clientName: true },
    });
    if (bookings.length) {
      throw AppException.conflict(
        ErrorCode.BRANCH_HAS_BOOKINGS,
        'Move or cancel the upcoming bookings at this branch first',
        { bookings },
      );
    }
  }
}
