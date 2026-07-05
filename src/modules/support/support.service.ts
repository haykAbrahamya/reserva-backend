import { Inject, Injectable, forwardRef } from '@nestjs/common';
import type { SupportMessage, SupportSender } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { newId } from '@/common/ids';
import { AppException } from '@/common/errors/app.exception';
import { PushService } from '@/modules/notifications/push.service';
import { SupportGateway } from './support.gateway';

/** A support message serialized for the wire (dates → ISO strings). */
export interface SupportMessageDto {
  id: string;
  threadId: string;
  senderType: SupportSender;
  senderUserId: string | null;
  senderName: string;
  body: string;
  createdAt: string;
  /** ISO timestamp the OTHER side read this message, or null (unseen). */
  readAt: string | null;
}

/** A thread summary for the platform console list. */
export interface SupportThreadSummary {
  id: string;
  partnerId: string;
  partnerName: string;
  partnerSlug: string | null;
  status: 'open' | 'closed';
  lastMessageAt: string;
  platformUnread: number;
  lastMessage: string | null;
}

function toDto(m: SupportMessage): SupportMessageDto {
  return {
    id: m.id,
    threadId: m.threadId,
    senderType: m.senderType,
    senderUserId: m.senderUserId,
    senderName: m.senderName,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
    readAt: m.readAt ? m.readAt.toISOString() : null,
  };
}

/**
 * Support-chat domain logic: one thread per partner, messages from either side,
 * denormalized unread counters for cheap badges. Real-time fan-out goes through
 * SupportGateway (WebSocket); web push is the offline fallback. All writes are
 * additive — nothing here touches booking/tenant data.
 */
@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
    @Inject(forwardRef(() => SupportGateway))
    private readonly gateway: SupportGateway,
  ) {}

  /**
   * Get the partner's thread, creating it ONLY on first message (send path). A
   * partner merely opening the chat must NOT create an empty ticket — so reads
   * use `findThread` (nullable) and `sendMessage` uses this creator.
   */
  async getOrCreateThread(partnerId: string) {
    const existing = await this.prisma.supportThread.findUnique({ where: { partnerId } });
    if (existing) return existing;
    return this.prisma.supportThread.create({
      data: { id: newId(), partnerId, lastMessageAt: new Date() },
    });
  }

  /** Partner-side view. Returns an EMPTY conversation without creating a thread
   *  when none exists yet — the ticket is born only when they send. */
  async partnerThreadView(partnerId: string) {
    const thread = await this.prisma.supportThread.findUnique({ where: { partnerId } });
    if (!thread) return { threadId: null, status: 'open' as const, messages: [] };
    const messages = await this.prisma.supportMessage.findMany({
      where: { threadId: thread.id },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    return {
      threadId: thread.id,
      status: thread.status,
      messages: messages.reverse().map(toDto),
    };
  }

  /** The partner's thread id, or null if they've never messaged. */
  async findThreadId(partnerId: string): Promise<string | null> {
    const t = await this.prisma.supportThread.findUnique({
      where: { partnerId },
      select: { id: true },
    });
    return t?.id ?? null;
  }

  /** Older-than-cursor history page (either side), returned oldest-first. */
  async history(threadId: string, before: string | undefined, take: number) {
    let cursorClause = {};
    if (before) {
      const anchor = await this.prisma.supportMessage.findUnique({ where: { id: before } });
      if (anchor) cursorClause = { createdAt: { lt: anchor.createdAt } };
    }
    const rows = await this.prisma.supportMessage.findMany({
      where: { threadId, ...cursorClause },
      orderBy: { createdAt: 'desc' },
      take,
    });
    return rows.reverse().map(toDto);
  }

  /** Unread count for the partner side (drives the widget badge). */
  async partnerUnread(partnerId: string): Promise<number> {
    const thread = await this.prisma.supportThread.findUnique({
      where: { partnerId },
      select: { partnerUnread: true },
    });
    return thread?.partnerUnread ?? 0;
  }

  /** Mark the partner side caught up (reset counter + stamp readAt). Emits a read
   *  receipt so the platform's sent messages show as "seen". */
  async partnerMarkRead(partnerId: string) {
    const thread = await this.prisma.supportThread.findUnique({ where: { partnerId } });
    if (!thread) return;
    await this.prisma.$transaction([
      this.prisma.supportThread.update({
        where: { id: thread.id },
        data: { partnerUnread: 0 },
      }),
      this.prisma.supportMessage.updateMany({
        where: { threadId: thread.id, senderType: 'platform', readAt: null },
        data: { readAt: new Date() },
      }),
    ]);
    this.gateway.emitRead(partnerId, 'partner');
  }

  /** Platform-side: paged thread list, most-recent activity first. */
  async listThreads(): Promise<SupportThreadSummary[]> {
    const threads = await this.prisma.supportThread.findMany({
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
      include: {
        partner: { select: { name: true, slug: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { body: true } },
      },
    });
    return threads.map((t) => ({
      id: t.id,
      partnerId: t.partnerId,
      partnerName: t.partner.name,
      partnerSlug: t.partner.slug,
      status: t.status,
      lastMessageAt: t.lastMessageAt.toISOString(),
      platformUnread: t.platformUnread,
      lastMessage: t.messages[0]?.body ?? null,
    }));
  }

  /** Total unread across all threads for the platform badge. */
  async platformUnreadTotal(): Promise<number> {
    const agg = await this.prisma.supportThread.aggregate({ _sum: { platformUnread: true } });
    return agg._sum.platformUnread ?? 0;
  }

  /** Platform-side: one thread's messages (oldest-first) + reset its unread. */
  async platformThreadMessages(threadId: string) {
    const thread = await this.prisma.supportThread.findUnique({ where: { id: threadId } });
    if (!thread) throw AppException.notFound('Support thread not found');
    const messages = await this.prisma.supportMessage.findMany({
      where: { threadId },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    return { threadId, status: thread.status, messages: messages.reverse().map(toDto) };
  }

  async platformMarkRead(threadId: string) {
    const thread = await this.prisma.supportThread.findUnique({
      where: { id: threadId },
      select: { partnerId: true },
    });
    if (!thread) return;
    await this.prisma.$transaction([
      this.prisma.supportThread.update({ where: { id: threadId }, data: { platformUnread: 0 } }),
      this.prisma.supportMessage.updateMany({
        where: { threadId, senderType: 'partner', readAt: null },
        data: { readAt: new Date() },
      }),
    ]);
    this.gateway.emitRead(thread.partnerId, 'platform');
  }

  /**
   * Close a ticket: HARD-DELETE the thread and all its messages (cascade) to keep
   * the DB light. Both ends are told to clear; the partner's widget then starts
   * fresh on their next message (getOrCreateThread makes a new empty thread).
   */
  async closeTicket(threadId: string) {
    const thread = await this.prisma.supportThread.findUnique({
      where: { id: threadId },
      select: { partnerId: true },
    });
    if (!thread) throw AppException.notFound('Support thread not found');
    // messages cascade-delete via the FK (onDelete: Cascade).
    await this.prisma.supportThread.delete({ where: { id: threadId } });
    this.gateway.emitClosed(thread.partnerId);
  }

  /** Resolve a thread's partnerId (platform reply path). 404s if unknown. */
  async threadPartnerId(threadId: string): Promise<string> {
    const t = await this.prisma.supportThread.findUnique({
      where: { id: threadId },
      select: { partnerId: true },
    });
    if (!t) throw AppException.notFound('Support thread not found');
    return t.partnerId;
  }

  /**
   * Core send. `senderType` decides which unread counter bumps and who gets the
   * push. Persists → bumps thread → emits over WS to both rooms → best-effort
   * push to the offline recipient side.
   */
  /** Resolve a display name for the sender at send time (captured on the row so
   *  it survives later renames/removals). Falls back to a generic label. */
  private async resolveSenderName(senderType: SupportSender, userId: string | null): Promise<string> {
    if (!userId) return senderType === 'platform' ? 'Reserva' : 'Partner';
    if (senderType === 'platform') {
      const u = await this.prisma.platformUser.findUnique({ where: { id: userId }, select: { name: true } });
      return u?.name || 'Reserva';
    }
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    return u?.name || 'Partner';
  }

  async sendMessage(input: {
    partnerId: string;
    senderType: SupportSender;
    senderUserId: string | null;
    body: string;
  }): Promise<SupportMessageDto> {
    const thread = await this.getOrCreateThread(input.partnerId);
    const senderName = await this.resolveSenderName(input.senderType, input.senderUserId);

    const bumpToRecipient =
      input.senderType === 'partner'
        ? { platformUnread: { increment: 1 } }
        : { partnerUnread: { increment: 1 } };

    const [message] = await this.prisma.$transaction([
      this.prisma.supportMessage.create({
        data: {
          id: newId(),
          threadId: thread.id,
          senderType: input.senderType,
          senderUserId: input.senderUserId,
          senderName,
          body: input.body,
        },
      }),
      this.prisma.supportThread.update({
        where: { id: thread.id },
        data: { lastMessageAt: new Date(), status: 'open', ...bumpToRecipient },
      }),
    ]);

    const dto = toDto(message);

    // Real-time fan-out to whoever's connected (both rooms so the sender's other
    // devices and the recipient all update live).
    this.gateway.emitMessage(input.partnerId, dto);

    // Offline fallback: push to the recipient side. Best-effort, never throws.
    void this.notifyRecipient(input.senderType, senderName, thread.partnerId, dto).catch(
      () => undefined,
    );

    return dto;
  }

  private async notifyRecipient(
    senderType: SupportSender,
    senderName: string,
    partnerId: string,
    dto: SupportMessageDto,
  ) {
    const preview = dto.body.length > 90 ? `${dto.body.slice(0, 90)}…` : dto.body;
    if (senderType === 'partner') {
      // Notify platform staff.
      await this.push.notifyPlatform({
        title: `Support · ${senderName || 'Partner'}`,
        body: preview,
        url: `/support?thread=${dto.threadId}`,
        tag: `support-${dto.threadId}`,
      });
      this.gateway.emitPlatformBadge();
    } else {
      // Notify the partner's staff users.
      const users = await this.prisma.user.findMany({
        where: { partnerId, active: true },
        select: { id: true },
      });
      await this.push.notifyUsers(
        users.map((u) => u.id),
        {
          title: 'Reserva Support',
          body: preview,
          url: `/support`,
          tag: `support-${dto.threadId}`,
        },
      );
    }
  }
}
