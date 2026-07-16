import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';
import { newId } from '@/common/ids';
import { paginate, pageArgs } from '@/common/dto/pagination';
import { cleanLocalizedInput } from '@/common/schemas/localized';
import type {
  CreateSpecialistDto,
  UpdateSpecialistDto,
  ListSpecialistQueryDto,
} from './dto/specialist.dto';

/** Shape returned to clients: flatten the service-link join into serviceIds[]. */
function serialize(sp: {
  services?: { serviceId: string }[];
} & Record<string, unknown>) {
  const { services, ...rest } = sp;
  return { ...rest, serviceIds: (services ?? []).map((s) => s.serviceId) };
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
  constructor(private readonly prisma: PrismaService) {}

  async list(partnerId: string, q: ListSpecialistQueryDto) {
    const where: Prisma.SpecialistWhereInput = {
      partnerId,
      deletedAt: null,
      ...(q.locationId ? { locationId: q.locationId } : {}),
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
    const include = { services: { select: { serviceId: true } } };
    const orderBy: Prisma.SpecialistOrderByWithRelationInput = { name: 'asc' };

    if (q.all) {
      const rows = await this.prisma.specialist.findMany({ where, include, orderBy });
      return paginate(rows.map(serialize), rows.length, 1, rows.length || 1);
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.specialist.findMany({ where, include, orderBy, ...pageArgs(q.page, q.pageSize) }),
      this.prisma.specialist.count({ where }),
    ]);
    return paginate(rows.map(serialize), total, q.page, q.pageSize);
  }

  async get(partnerId: string, id: string) {
    const sp = await this.prisma.specialist.findFirst({
      where: { id, partnerId, deletedAt: null },
      include: { services: { select: { serviceId: true } } },
    });
    if (!sp) throw AppException.notFound('Specialist not found');
    return serialize(sp);
  }

  async create(partnerId: string, dto: CreateSpecialistDto) {
    await this.assertLocation(partnerId, dto.locationId);
    await this.assertServices(partnerId, dto.serviceIds);

    const id = newId();
    const sp = await this.prisma.specialist.create({
      data: {
        id,
        partnerId,
        locationId: dto.locationId,
        name: dto.name,
        title: dto.title ?? '',
        titleI18n: cleanLocalizedInput(dto.titleI18n) ?? Prisma.JsonNull,
        phone: dto.phone ?? '',
        active: dto.active ?? true,
        // New specialists get a sensible default week so the Hours editor is
        // immediately usable instead of empty.
        schedule: (dto.schedule ?? defaultSchedule()) as Prisma.InputJsonValue,
        services: {
          create: (dto.serviceIds ?? []).map((serviceId) => ({ serviceId })),
        },
      },
      include: { services: { select: { serviceId: true } } },
    });
    return serialize(sp);
  }

  async update(partnerId: string, id: string, dto: UpdateSpecialistDto) {
    await this.get(partnerId, id);
    if (dto.locationId) await this.assertLocation(partnerId, dto.locationId);
    if (dto.serviceIds) await this.assertServices(partnerId, dto.serviceIds);

    const sp = await this.prisma.$transaction(async (tx) => {
      await tx.specialist.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.title !== undefined && { title: dto.title }),
          ...(dto.titleI18n !== undefined && { titleI18n: cleanLocalizedInput(dto.titleI18n) ?? Prisma.JsonNull }),
          ...(dto.phone !== undefined && { phone: dto.phone }),
          ...(dto.locationId !== undefined && { locationId: dto.locationId }),
          ...(dto.active !== undefined && { active: dto.active }),
          ...(dto.schedule !== undefined && { schedule: dto.schedule as Prisma.InputJsonValue }),
        },
      });

      // Replace the service set if provided.
      if (dto.serviceIds) {
        await tx.specialistService.deleteMany({ where: { specialistId: id } });
        if (dto.serviceIds.length) {
          await tx.specialistService.createMany({
            data: dto.serviceIds.map((serviceId) => ({ specialistId: id, serviceId })),
          });
        }
      }

      return tx.specialist.findUniqueOrThrow({
        where: { id },
        include: { services: { select: { serviceId: true } } },
      });
    });
    return serialize(sp);
  }

  async remove(partnerId: string, id: string) {
    await this.get(partnerId, id);
    await this.prisma.specialist.update({
      where: { id },
      data: { deletedAt: new Date(), active: false },
    });
  }

  // ── guards ────────────────────────────────────────────────

  private async assertLocation(partnerId: string, locationId: string) {
    const loc = await this.prisma.location.findFirst({
      where: { id: locationId, partnerId, deletedAt: null },
      select: { id: true },
    });
    if (!loc) throw AppException.notFound('Location not found');
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
}
