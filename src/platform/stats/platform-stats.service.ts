import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

/** Aggregate platform-wide numbers for the internal-backoffice dashboard. */
@Injectable()
export class PlatformStatsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview() {
    const since = new Date();
    since.setDate(since.getDate() - 30);

    const [partners, activePartners, recentPartners, locations, specialists, bookings, staff, latest] =
      await this.prisma.$transaction([
        this.prisma.partner.count({ where: { deletedAt: null } }),
        this.prisma.partner.count({ where: { deletedAt: null, active: true } }),
        this.prisma.partner.count({ where: { deletedAt: null, createdAt: { gte: since } } }),
        this.prisma.location.count({ where: { deletedAt: null } }),
        this.prisma.specialist.count({ where: { deletedAt: null } }),
        this.prisma.booking.count(),
        this.prisma.platformUser.count({ where: { deletedAt: null, active: true } }),
        this.prisma.partner.findMany({
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            name: true,
            slug: true,
            type: true,
            accent: true,
            active: true,
            createdAt: true,
          },
        }),
      ]);

    return {
      partners: { total: partners, active: activePartners, inactive: partners - activePartners, recent: recentPartners },
      catalog: { locations, specialists, bookings },
      staff,
      recentPartners: latest,
    };
  }
}
