import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { AppException } from '@/common/errors/app.exception';
import { newId } from '@/common/ids';
import { paginate, pageArgs } from '@/common/dto/pagination';
import type {
  CreateDemoRequestDto,
  ListDemoRequestsQueryDto,
} from './dto/demo-request.dto';

/** Empty string → undefined, so optional fields store NULL not ''. */
const orNull = (v?: string) => {
  const t = v?.trim();
  return t ? t : null;
};

@Injectable()
export class DemoRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Public: store a demo lead. */
  async create(dto: CreateDemoRequestDto) {
    await this.prisma.demoRequest.create({
      data: {
        id: newId(),
        name: dto.name.trim(),
        company: orNull(dto.company),
        phone: orNull(dto.phone),
        email: orNull(dto.email),
        notes: orNull(dto.notes),
      },
    });
    // Don't leak the row id to the public; a simple ack is enough.
    return { ok: true };
  }

  /** Platform: paginated list, optionally filtered by status, newest first. */
  async list(q: ListDemoRequestsQueryDto) {
    const where = q.status ? { status: q.status } : {};
    const [items, total, newCount] = await this.prisma.$transaction([
      this.prisma.demoRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...pageArgs(q.page, q.pageSize),
      }),
      this.prisma.demoRequest.count({ where }),
      this.prisma.demoRequest.count({ where: { status: 'new' } }),
    ]);
    return { ...paginate(items, total, q.page, q.pageSize), newCount };
  }

  /** Platform: mark a request new/done (with light audit trail). */
  async setStatus(id: string, status: 'new' | 'done', handledBy?: string) {
    const existing = await this.prisma.demoRequest.findUnique({ where: { id } });
    if (!existing) throw AppException.notFound('Demo request not found');

    return this.prisma.demoRequest.update({
      where: { id },
      data: {
        status,
        handledBy: status === 'done' ? (handledBy ?? null) : null,
        handledAt: status === 'done' ? new Date() : null,
      },
    });
  }

  /** Permanently remove a demo request. */
  async remove(id: string) {
    const { count } = await this.prisma.demoRequest.deleteMany({ where: { id } });
    if (count === 0) throw AppException.notFound('Demo request not found');
  }
}
