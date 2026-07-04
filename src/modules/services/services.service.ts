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

  async create(partnerId: string, dto: CreateServiceDto) {
    const service = await this.prisma.service.create({
      data: { ...(dto as Prisma.ServiceUncheckedCreateInput), id: newId(), partnerId },
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
    // Switching to a fixed price must clear any previous upper bound so a stale
    // priceMax can't linger and re-render the service as a range.
    const data = dto.priceType === 'fixed' ? { ...dto, priceMax: null } : dto;
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
}
