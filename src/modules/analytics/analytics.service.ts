import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { newId } from '@/common/ids';
import { paginate, pageArgs } from '@/common/dto/pagination';
import { parseUserAgent, geoFromIp } from '@/common/utils/visitor';
import type { CreateVisitorEventDto, ListVisitorEventsQueryDto } from './dto/visitor-event.dto';

/** Empty string → undefined, so optional fields store NULL not ''. */
const orNull = (v?: string) => {
  const t = v?.trim();
  return t ? t : null;
};

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Public: record one page view. The client sends page context; IP (→ geo) and
   * User-Agent (→ device/browser/os) are derived here from the request itself.
   */
  async record(dto: CreateVisitorEventDto, ip?: string, userAgent?: string) {
    const ua = parseUserAgent(userAgent);
    const geo = geoFromIp(ip);

    await this.prisma.visitorEvent.create({
      data: {
        id: newId(),
        ip: orNull(ip),
        userAgent: orNull(userAgent),
        deviceType: ua.deviceType,
        browser: ua.browser,
        browserVer: ua.browserVer,
        os: ua.os,
        osVer: ua.osVer,
        path: orNull(dto.path),
        host: orNull(dto.host),
        referrer: orNull(dto.referrer),
        language: orNull(dto.language),
        screenW: dto.screenW ?? null,
        screenH: dto.screenH ?? null,
        country: geo.country,
        city: geo.city,
      },
    });
    // Don't leak the row id to the public; a simple ack is enough.
    return { ok: true };
  }

  /** Platform: paginated list, optionally filtered, newest first. */
  async list(q: ListVisitorEventsQueryDto) {
    const where = {
      ...(q.deviceType ? { deviceType: q.deviceType } : {}),
      ...(q.country ? { country: q.country } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.visitorEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...pageArgs(q.page, q.pageSize),
      }),
      this.prisma.visitorEvent.count({ where }),
    ]);
    return paginate(items, total, q.page, q.pageSize);
  }

  /** Platform: wipe the entire visit history. Returns how many rows were removed. */
  async clearAll(): Promise<{ deleted: number }> {
    const { count } = await this.prisma.visitorEvent.deleteMany({});
    return { deleted: count };
  }
}
