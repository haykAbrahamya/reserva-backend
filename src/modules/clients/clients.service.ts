import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AppException } from '@/common/errors/app.exception';
import { newId } from '@/common/ids';
import { normalizePhone } from '@/common/utils/phone';
import { paginate, pageArgs } from '@/common/dto/pagination';
import type { ListClientsQueryDto, UpdateClientDto } from './dto/client.dto';

type Tx = PrismaService | Prisma.TransactionClient | PrismaClient;

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Find-or-create a client for a partner by normalized phone. Reused by the
   * booking flow so every booking ties to a real client row. Updates the stored
   * name to the latest provided (people fix typos over time). Accepts a tx so it
   * can run inside a booking transaction.
   */
  async upsertByPhone(
    partnerId: string,
    name: string,
    phone: string,
    tx: Tx = this.prisma,
  ) {
    const normalized = normalizePhone(phone);
    const existing = await tx.client.findUnique({
      where: { partnerId_phone: { partnerId, phone: normalized } },
    });
    if (existing) {
      if (existing.name !== name) {
        return tx.client.update({ where: { id: existing.id }, data: { name } });
      }
      return existing;
    }
    return tx.client.create({
      data: { id: newId(), partnerId, name, phone: normalized },
    });
  }

  async list(partnerId: string, q: ListClientsQueryDto) {
    const where: Prisma.ClientWhereInput = {
      partnerId,
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' } },
              { phone: { contains: normalizePhone(q.search) } },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.client.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        ...pageArgs(q.page, q.pageSize),
      }),
      this.prisma.client.count({ where }),
    ]);

    // Attach lightweight per-client stats for the page (two grouped queries)
    // so the list table renders without N detail round-trips.
    const ids = rows.map((c) => c.id);
    const visitGroups = await this.prisma.booking.groupBy({
      by: ['clientId'],
      where: { clientId: { in: ids }, status: { not: 'cancelled' } },
      _count: { _all: true },
      _max: { startAt: true },
    });
    // Effective spend = finalPrice when captured (range services), else the
    // booked price. Split into two aggregates so the coalesce stays server-side:
    //   • rows WITH a finalPrice → sum finalPrice
    //   • rows WITHOUT → sum priceAtBooking
    const [finalSpend, baseSpend] = await Promise.all([
      this.prisma.booking.groupBy({
        by: ['clientId'],
        where: { clientId: { in: ids }, status: 'completed', finalPrice: { not: null } },
        _sum: { finalPrice: true },
      }),
      this.prisma.booking.groupBy({
        by: ['clientId'],
        where: { clientId: { in: ids }, status: 'completed', finalPrice: null },
        _sum: { priceAtBooking: true },
      }),
    ]);

    const visitsById = new Map(visitGroups.map((g) => [g.clientId, g]));
    const spendById = new Map<string, number>();
    for (const g of finalSpend) spendById.set(g.clientId, g._sum.finalPrice ?? 0);
    for (const g of baseSpend) spendById.set(g.clientId, (spendById.get(g.clientId) ?? 0) + (g._sum.priceAtBooking ?? 0));

    const items = rows.map((c) => ({
      ...c,
      visits: visitsById.get(c.id)?._count._all ?? 0,
      totalSpend: spendById.get(c.id) ?? 0,
      lastVisit: visitsById.get(c.id)?._max.startAt ?? null,
    }));

    return paginate(items, total, q.page, q.pageSize);
  }

  /** Client detail with derived booking stats (visits, spend, last visit). */
  async get(partnerId: string, id: string) {
    const client = await this.prisma.client.findFirst({ where: { id, partnerId } });
    if (!client) throw AppException.notFound('Client not found');

    const bookings = await this.prisma.booking.findMany({
      where: { clientId: id, partnerId },
      orderBy: { startAt: 'desc' },
      take: 50,
      include: {
        service: { select: { id: true, name: true, price: true, duration: true } },
        specialist: { select: { id: true, name: true, title: true } },
        location: { select: { id: true, name: true, address: true } },
      },
    });

    const completed = bookings.filter((b) => b.status === 'completed');
    // Effective charge: the captured final price (range services) or the booked price.
    const totalSpend = completed.reduce((sum, b) => sum + (b.finalPrice ?? b.priceAtBooking), 0);

    return {
      ...client,
      stats: {
        visits: bookings.length,
        completed: completed.length,
        totalSpend,
        lastVisit: bookings[0]?.startAt ?? null,
      },
      bookings,
    };
  }

  async update(partnerId: string, id: string, dto: UpdateClientDto) {
    await this.assertOwned(partnerId, id);
    return this.prisma.client.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });
  }

  private async assertOwned(partnerId: string, id: string) {
    const c = await this.prisma.client.findFirst({ where: { id, partnerId }, select: { id: true } });
    if (!c) throw AppException.notFound('Client not found');
  }
}
