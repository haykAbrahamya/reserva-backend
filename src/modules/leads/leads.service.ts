import { Injectable, Logger } from '@nestjs/common';
import type { DemoRequest, LeadStatus, PendingRegistration, Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AppException } from '@/common/errors/app.exception';
import { newId } from '@/common/ids';
import { paginate, pageArgs } from '@/common/dto/pagination';
import { LEAD_STATUSES, type CreateLeadDto, type ListLeadsQueryDto, type UpdateLeadDto } from './dto/lead.dto';

/** A tools export signed with a contact line, as the analytics ingest hands it over. */
export interface ToolExport {
  /** The contact line, exactly as typed. */
  contact: string;
  /** The Instagram username the tools read from it, if any. */
  ig?: string;
  /** Registry id of the tool. */
  tool: string;
  at: Date;
}

/** The examples a first visit to the tools starts from are signed with this: it is nobody's. */
const SAMPLE_CONTACT = '@anna.beauty';

/** One key per contact line: trimmed, single-spaced, lower-case. */
export const contactKey = (contact: string) => contact.trim().replace(/\s+/g, ' ').toLowerCase();

/** Empty → null, so a cleared field stores NULL rather than ''. */
const orNull = (v?: string | null) => {
  const t = v?.trim();
  return t ? t : null;
};

/** "@Mane.Nails", "instagram.com/mane.nails/" or "mane.nails" → "mane.nails". */
export function instagramUsername(value?: string | null): string | null {
  const v = value?.trim();
  if (!v) return null;
  const fromLink = /instagram\.com\/([A-Za-z0-9._]+)/i.exec(v)?.[1];
  return (fromLink ?? v.replace(/^@/, '')).replace(/\/+$/, '').toLowerCase() || null;
}

/** "Manicure salon · /ruzanna": what a sign-up said about itself. */
const signupContext = (companyType: string, slug: string) =>
  [companyType.trim(), slug ? `/${slug}` : ''].filter(Boolean).join(' · ') || null;

/**
 * Leads: potential partners, in one work list for platform staff — gathered
 * automatically from the sign-up form, demo requests and the free tools, or
 * added by hand — with where each one stands and what was said.
 *
 * Capture rides on other actions (a sign-up, a demo request, an analytics
 * beacon), so every capture method is best-effort: it logs, and never throws
 * into the action it rides on.
 */
@Injectable()
export class LeadsService {
  private readonly logger = new Logger('Leads');

  constructor(private readonly prisma: PrismaService) {}

  // ── Automatic capture ────────────────────────────────────

  /**
   * Someone filled in the sign-up form: a pending registration. Signing up
   * again with the same email replaces the earlier registration, so it moves
   * that lead — and whatever staff noted on it — to the new one.
   */
  async fromSignup(
    p: Pick<PendingRegistration, 'id' | 'adminName' | 'companyName' | 'companyType' | 'slug' | 'adminPhone' | 'adminEmail'>,
  ): Promise<void> {
    await this.capture('sign-up', async () => {
      const data = {
        sourceRef: p.id,
        name: orNull(p.adminName),
        company: orNull(p.companyName),
        phone: orNull(p.adminPhone),
        email: orNull(p.adminEmail),
        context: signupContext(p.companyType, p.slug),
        lastActivityAt: new Date(),
      };
      const earlier = await this.prisma.lead.findFirst({
        where: { source: 'signup', email: { equals: p.adminEmail, mode: 'insensitive' }, status: { not: 'partner' } },
        orderBy: { lastActivityAt: 'desc' },
        select: { id: true },
      });
      if (earlier) await this.prisma.lead.update({ where: { id: earlier.id }, data });
      else await this.prisma.lead.create({ data: { id: newId(), source: 'signup', ...data } });
    });
  }

  /** That sign-up was activated: its lead is a partner now. */
  async signupActivated(pendingId: string, partnerId: string): Promise<void> {
    await this.capture('activation', () =>
      this.prisma.lead.updateMany({
        where: { source: 'signup', sourceRef: pendingId },
        data: { status: 'partner', partnerId, lastActivityAt: new Date() },
      }),
    );
  }

  /** A demo request came in from the website. */
  async fromDemoRequest(d: Pick<DemoRequest, 'id' | 'name' | 'company' | 'phone' | 'email' | 'notes'>): Promise<void> {
    await this.capture('demo request', () =>
      this.prisma.lead.upsert({
        where: { source_sourceRef: { source: 'demo', sourceRef: d.id } },
        create: {
          id: newId(),
          source: 'demo',
          sourceRef: d.id,
          name: orNull(d.name),
          company: orNull(d.company),
          phone: orNull(d.phone),
          email: orNull(d.email),
          context: orNull(d.notes),
        },
        update: {},
      }),
    );
  }

  /**
   * Tools exports signed with a contact line: one lead per contact, kept up to
   * date — the line as last typed, every tool used, the latest visit. Only the
   * contact and its activity change; the status and notes stay staff's. Staff
   * testing and bots are not leads, and neither are the examples' own contact.
   */
  async fromToolExports(sessionId: string, signed: ToolExport[]): Promise<void> {
    await this.capture('tools export', async () => {
      const session = await this.prisma.siteSession.findUnique({
        where: { id: sessionId },
        select: { isBot: true, isInternal: true },
      });
      if (!session || session.isBot || session.isInternal) return;

      for (const e of signed) {
        const key = contactKey(e.contact);
        if (!key || key === SAMPLE_CONTACT) continue;
        // Times go in as UTC wall-clock, like every timestamp Prisma writes.
        const at = e.at.toISOString();
        await this.prisma.$executeRaw`
          INSERT INTO "leads" ("id", "source", "sourceRef", "status", "contact", "instagram", "tools", "sessionId",
                               "lastActivityAt", "createdAt", "updatedAt")
          VALUES (${newId()}, 'tools'::"LeadSource", ${key}, 'new'::"LeadStatus", ${e.contact.trim()}, ${e.ig ?? null},
                  ARRAY[${e.tool}]::text[], ${sessionId},
                  (${at}::timestamptz AT TIME ZONE 'UTC'), (${at}::timestamptz AT TIME ZONE 'UTC'),
                  (${at}::timestamptz AT TIME ZONE 'UTC'))
          ON CONFLICT ("source", "sourceRef") DO UPDATE SET
            "contact" = EXCLUDED."contact",
            "instagram" = COALESCE(EXCLUDED."instagram", "leads"."instagram"),
            "tools" = ARRAY(SELECT DISTINCT t FROM unnest("leads"."tools" || EXCLUDED."tools") AS t ORDER BY t),
            "sessionId" = EXCLUDED."sessionId",
            "lastActivityAt" = GREATEST("leads"."lastActivityAt", EXCLUDED."lastActivityAt"),
            "updatedAt" = EXCLUDED."updatedAt"`;
      }
    });
  }

  private async capture(what: string, run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch (e) {
      this.logger.warn(`Lead not captured from a ${what}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ── Internal console ─────────────────────────────────────

  /** The work list, latest activity first, with a count per status for the filter tabs. */
  async list(q: ListLeadsQueryDto) {
    const search: Prisma.LeadWhereInput = q.search
      ? {
          OR: (['name', 'company', 'phone', 'email', 'instagram', 'contact', 'notes'] as const).map((field) => ({
            [field]: { contains: q.search, mode: 'insensitive' as const },
          })),
        }
      : {};
    // The tabs count across the source filter and the search, not the status.
    const scope: Prisma.LeadWhereInput = { ...(q.source ? { source: q.source } : {}), ...search };
    const where: Prisma.LeadWhereInput = { ...scope, ...(q.status ? { status: q.status } : {}) };

    const [items, total, byStatus] = await this.prisma.$transaction([
      this.prisma.lead.findMany({
        where,
        orderBy: [{ lastActivityAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(q.page, q.pageSize),
      }),
      this.prisma.lead.count({ where }),
      this.prisma.lead.groupBy({ by: ['status'], where: scope, orderBy: { status: 'asc' }, _count: { _all: true } }),
    ]);

    const counts = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0])) as Record<LeadStatus, number>;
    for (const row of byStatus) counts[row.status] = (row._count as { _all: number })._all;
    return { ...paginate(items, total, q.page, q.pageSize), counts };
  }

  /** A lead added by hand. */
  create(dto: CreateLeadDto, createdById?: string) {
    return this.prisma.lead.create({
      data: {
        id: newId(),
        source: 'manual',
        status: dto.status ?? 'new',
        name: orNull(dto.name),
        company: orNull(dto.company),
        phone: orNull(dto.phone),
        email: orNull(dto.email),
        instagram: instagramUsername(dto.instagram),
        notes: orNull(dto.notes),
        createdById: createdById ?? null,
      },
    });
  }

  /** Staff's changes: where it stands, what was said, a better way to reach them. */
  async update(id: string, dto: UpdateLeadDto) {
    const existing = await this.prisma.lead.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw AppException.notFound('Lead not found');

    const data: Prisma.LeadUpdateInput = {};
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.name !== undefined) data.name = orNull(dto.name);
    if (dto.company !== undefined) data.company = orNull(dto.company);
    if (dto.phone !== undefined) data.phone = orNull(dto.phone);
    if (dto.email !== undefined) data.email = orNull(dto.email);
    if (dto.instagram !== undefined) data.instagram = instagramUsername(dto.instagram);
    if (dto.notes !== undefined) data.notes = orNull(dto.notes);
    return this.prisma.lead.update({ where: { id }, data });
  }

  async remove(id: string) {
    const { count } = await this.prisma.lead.deleteMany({ where: { id } });
    if (count === 0) throw AppException.notFound('Lead not found');
  }
}
