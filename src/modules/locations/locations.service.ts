import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';
import { newId } from '@/common/ids';
import { paginate, pageArgs } from '@/common/dto/pagination';
import type { CreateLocationDto, UpdateLocationDto, ListLocationQueryDto } from './dto/location.dto';

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

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

  async get(partnerId: string, id: string) {
    const location = await this.prisma.location.findFirst({
      where: { id, partnerId, deletedAt: null },
    });
    if (!location) throw AppException.notFound('Location not found');
    return location;
  }

  create(partnerId: string, dto: CreateLocationDto) {
    return this.prisma.location.create({
      data: {
        id: newId(),
        partnerId,
        name: dto.name,
        address: dto.address,
        phone: dto.phone ?? '',
        hours: (dto.hours ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  async update(partnerId: string, id: string, dto: UpdateLocationDto) {
    await this.get(partnerId, id);
    return this.prisma.location.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.address !== undefined && { address: dto.address }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.hours !== undefined && { hours: dto.hours as Prisma.InputJsonValue }),
      },
    });
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
