import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';
import { AreasService } from '@/modules/areas/areas.service';
import { newId } from '@/common/ids';
import { paginate, pageArgs } from '@/common/dto/pagination';
import { cleanLocalizedInput } from '@/common/schemas/localized';
import type { CreateLocationDto, UpdateLocationDto, ListLocationQueryDto } from './dto/location.dto';

@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly areas: AreasService,
  ) {}

  async list(partnerId: string, q: ListLocationQueryDto) {
    const where: Prisma.LocationWhereInput = {
      partnerId,
      deletedAt: null,
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' } },
              { address: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const orderBy: Prisma.LocationOrderByWithRelationInput = { name: 'asc' };

    if (q.all) {
      const items = await this.prisma.location.findMany({ where, orderBy });
      return paginate(items, items.length, 1, items.length || 1);
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.location.findMany({ where, orderBy, ...pageArgs(q.page, q.pageSize) }),
      this.prisma.location.count({ where }),
    ]);
    return paginate(items, total, q.page, q.pageSize);
  }

  /** The area must exist and be active — a retired one must not spread. */
  private async assertArea(key: string) {
    if (!(await this.areas.isActive(key))) {
      throw AppException.badRequest(ErrorCode.VALIDATION_FAILED, `Unknown area "${key}"`);
    }
  }

  async get(partnerId: string, id: string) {
    const location = await this.prisma.location.findFirst({
      where: { id, partnerId, deletedAt: null },
    });
    if (!location) throw AppException.notFound('Location not found');
    return location;
  }

  async create(partnerId: string, dto: CreateLocationDto) {
    if (dto.areaKey) await this.assertArea(dto.areaKey);
    return this.prisma.location.create({
      data: {
        id: newId(),
        partnerId,
        name: dto.name,
        // Normalize translation blob: trim, drop empty locales, {} → null.
        nameI18n: cleanLocalizedInput(dto.nameI18n) ?? Prisma.JsonNull,
        address: dto.address,
        phone: dto.phone ?? '',
        hours: (dto.hours ?? {}) as Prisma.InputJsonValue,
        lat: dto.lat ?? null,
        lng: dto.lng ?? null,
        areaKey: dto.areaKey ?? null,
      },
    });
  }

  async update(partnerId: string, id: string, dto: UpdateLocationDto) {
    await this.get(partnerId, id);
    if (dto.areaKey) await this.assertArea(dto.areaKey);
    const data: Prisma.LocationUncheckedUpdateInput = {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.address !== undefined && { address: dto.address }),
      ...(dto.phone !== undefined && { phone: dto.phone }),
      ...(dto.hours !== undefined && { hours: dto.hours as Prisma.InputJsonValue }),
      ...(dto.lat !== undefined && { lat: dto.lat }),
      ...(dto.lng !== undefined && { lng: dto.lng }),
      // undefined = leave alone; null = clear the area.
      ...(dto.areaKey !== undefined && { areaKey: dto.areaKey }),
    };
    // Only touch the translation column when the client sent it (undefined =
    // leave as-is; present = set/clear, with empty → JsonNull).
    if (dto.nameI18n !== undefined) {
      data.nameI18n = cleanLocalizedInput(dto.nameI18n) ?? Prisma.JsonNull;
    }
    return this.prisma.location.update({ where: { id }, data });
  }

  /** Soft-delete. Blocks if specialists are still assigned to the branch. */
  async remove(partnerId: string, id: string) {
    await this.get(partnerId, id);
    const activeSpecialists = await this.prisma.specialist.count({
      where: { locationId: id, deletedAt: null },
    });
    if (activeSpecialists > 0) {
      throw AppException.conflict(
        ErrorCode.LOCATION_HAS_SPECIALISTS,
        'Reassign or remove this branch’s specialists before deleting it',
      );
    }
    await this.prisma.location.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}
