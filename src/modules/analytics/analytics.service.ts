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

/** Reserved subdomains that are never a partner slug. */
const RESERVED_SUBDOMAINS = new Set(['www', 'app', 'api', 'admin', 'demo', 'jenkins']);

/** Translate a high-level page-type filter into a Prisma `path` condition. */
function pageTypeWhere(pageType?: string): Record<string, unknown> {
  switch (pageType) {
    case 'signup':
      return { path: '/signup' };
    case 'home':
      return { path: '/' };
    case 'marketplace':
      return { path: '/salons' };
    // Any partner booking page: subdomain visits (path '/') carry a partnerSlug,
    // and '/p/:slug' visits start with '/p/'. Match either.
    case 'partner':
      return { OR: [{ path: { startsWith: '/p/' } }, { partnerSlug: { not: null } }] };
    default:
      return {};
  }
}

/**
 * Derive the partner slug a visit landed on, from the page host/path:
 *  - tenant subdomain "<slug>.reserva.am" → slug
 *  - otherwise "/p/<slug>" → slug
 * Returns null for the apex/marketplace and reserved hosts.
 */
function partnerSlugFrom(host?: string, path?: string): string | null {
  const h = host?.trim().toLowerCase();
  if (h) {
    const m = /^([a-z0-9-]+)\.reserva\.am$/.exec(h);
    if (m && !RESERVED_SUBDOMAINS.has(m[1])) return m[1];
  }
  const p = path?.trim().toLowerCase();
  if (p) {
    const m = /^\/p\/([a-z0-9-]+)/.exec(p);
    if (m) return m[1];
  }
  return null;
}

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

    // Prefer the slug the client resolved; fall back to deriving it from the
    // host/path so attribution works even for older/edge clients.
    const partnerSlug = orNull(dto.partnerSlug) ?? partnerSlugFrom(dto.host, dto.path);

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
        partnerSlug,
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
      ...(q.partnerSlug ? { partnerSlug: q.partnerSlug } : {}),
      ...pageTypeWhere(q.pageType),
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
