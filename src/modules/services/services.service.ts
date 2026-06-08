import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AppException } from '@/common/errors/app.exception';
import { newId } from '@/common/ids';
import { paginate, pageArgs } from '@/common/dto/pagination';
import type { CreateServiceDto, UpdateServiceDto, ListServiceQueryDto } from './dto/service.dto';

@Injectable()
export class ServicesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(partnerId: string, q: ListServiceQueryDto) {
    const where: Prisma.ServiceWhereInput = {
      partnerId,
      deletedAt: null,
      ...(q.includeInactive ? {} : { active: true }),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' } },
              { category: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const orderBy: Prisma.ServiceOrderByWithRelationInput[] = [
      { category: 'asc' },
      { name: 'asc' },
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

  create(partnerId: string, dto: CreateServiceDto) {
    return this.prisma.service.create({
      data: { id: newId(), partnerId, ...dto },
    });
  }

  async update(partnerId: string, id: string, dto: UpdateServiceDto) {
    await this.get(partnerId, id); // tenant-scoped existence check
    return this.prisma.service.update({ where: { id }, data: dto });
  }

  /** Soft-delete so historical bookings keep their service reference. */
  async remove(partnerId: string, id: string) {
    await this.get(partnerId, id);
    await this.prisma.service.update({
      where: { id },
      data: { deletedAt: new Date(), active: false },
    });
  }
}
