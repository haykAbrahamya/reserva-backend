import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { paginate, pageArgs } from '@/common/dto/pagination';
import type { ListNotificationsQueryDto } from './dto/notification.dto';

/** Per-user in-app notification feed (the bell). All ops are scoped to userId. */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, q: ListNotificationsQueryDto) {
    const where = {
      userId,
      ...(q.unreadOnly ? { read: false } : {}),
    };
    const [items, total, unread] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...pageArgs(q.page, q.pageSize),
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, read: false } }),
    ]);
    return { ...paginate(items, total, q.page, q.pageSize), unread };
  }

  async unreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.prisma.notification.count({ where: { userId, read: false } });
    return { count };
  }

  async markRead(userId: string, id: string): Promise<void> {
    // Scope by userId so a user can only touch their own rows.
    await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { read: true },
    });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.prisma.notification.deleteMany({ where: { id, userId } });
  }
}
