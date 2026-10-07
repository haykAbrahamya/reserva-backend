import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { geoFromIp, parseUserAgent } from '@/common/utils/visitor';
import { DEFAULT_PULSE_KEY, openPulse, parsePulseKey } from './pulse-codec';
import { parseBatch, type PulseBatch } from './pulse-batch';
import { deriveChannel, isBotUserAgent, referrerHostOf } from './traffic-source';
import { normalizeSlug, PartnerSlugCache } from './partner-slug-cache.service';

/** How far a client clock may stray before its timestamp is ignored. */
const CLIENT_TIME_PAST_MS = 7 * 24 * 60 * 60_000;
const CLIENT_TIME_FUTURE_MS = 24 * 60 * 60_000;

/** Empty string → null, so optional columns store NULL rather than ''. */
const orNull = (v: string | undefined) => {
  const t = v?.trim();
  return t ? t : null;
};

/** Thrown inside the store transaction to roll back a session that would get no event. */
class NothingToStore extends Error {}

/**
 * Stores what the public site's beacon sends: decrypt → validate → create the
 * session on first sight → append the events.
 *
 * A session never exists without an event: one is only created for a batch
 * with valid events, and in the same transaction as those events.
 *
 * Nothing here may reach the visitor. Every outcome, stored or dropped, ends in
 * the same 204, and errors are logged rather than thrown — analytics must never
 * break a page, and a probe must not learn why its payload was refused.
 */
@Injectable()
export class SiteIngestService {
  private readonly logger = new Logger('SiteAnalytics');
  private readonly key: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly partners: PartnerSlugCache,
    config: ConfigService,
  ) {
    // The env schema already rejects a malformed override at boot.
    this.key =
      parsePulseKey(config.get<string>('SITE_PULSE_KEY')) ?? parsePulseKey(DEFAULT_PULSE_KEY)!;
  }

  /** Handle one beacon body. Never throws. */
  async ingest(
    body: unknown,
    ip: string | undefined,
    userAgent: string | undefined,
  ): Promise<void> {
    try {
      const batch = parseBatch(openPulse(body, this.key));
      // No valid event left after validation: nothing to store, not even the session.
      if (!batch?.events.length) return;
      await this.store(batch, ip, userAgent);
    } catch (e) {
      if (e instanceof NothingToStore) return;
      this.logger.warn(`Beacon batch not stored: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * The session row and the batch's events commit together. If none of the
   * events is new — a retry, or a batch replayed under a fresh session id —
   * a session created for it is rolled back, and an existing one is left as
   * it was.
   */
  private async store(batch: PulseBatch, ip: string | undefined, userAgent: string | undefined) {
    const now = new Date();
    // Outside the transaction: it may query, and needs no lock.
    const partnerIds = await this.partners.resolve(batch.events.map((e) => e.partnerSlug));
    const events: Prisma.SiteEventCreateManyInput[] = batch.events.map((e) => {
      const slug = normalizeSlug(e.partnerSlug);
      return {
        id: e.id,
        sessionId: batch.sessionId,
        visitorId: batch.visitorId,
        name: e.name,
        partnerId: slug ? (partnerIds.get(slug) ?? null) : null,
        path: orNull(e.path),
        host: orNull(e.host),
        props: e.props as Prisma.InputJsonValue,
        clientAt: clientTime(e.clientTime, now),
        createdAt: now,
      };
    });

    await this.prisma.$transaction(
      async (tx) => {
        // First batch of a session creates it; ON CONFLICT DO NOTHING makes
        // two racing first batches safe. The IP and User-Agent are used right
        // here and never stored.
        const { count: created } = await tx.siteSession.createMany({
          data: [this.sessionRow(batch, ip, userAgent, now)],
          skipDuplicates: true,
        });
        // Dedupe on the client's event id: a retried or replayed batch adds nothing.
        const { count: stored } = await tx.siteEvent.createMany({
          data: events,
          skipDuplicates: true,
        });
        if (!stored) {
          if (created) throw new NothingToStore();
          return;
        }
        if (!created) {
          await tx.siteSession.updateMany({
            where: { id: batch.sessionId },
            data: { lastSeenAt: now },
          });
        }
      },
      // A little slack over the defaults when the pool is busy with reports.
      { maxWait: 5_000, timeout: 10_000 },
    );
  }

  private sessionRow(
    batch: PulseBatch,
    ip: string | undefined,
    userAgent: string | undefined,
    now: Date,
  ): Prisma.SiteSessionCreateManyInput {
    const s = batch.session;
    const ua = parseUserAgent(userAgent);
    const geo = geoFromIp(ip);
    return {
      id: batch.sessionId,
      visitorId: batch.visitorId,
      startedAt: now,
      lastSeenAt: now,
      landingPath: orNull(s.lp),
      landingHost: orNull(s.lh),
      referrer: orNull(s.ref),
      referrerHost: referrerHostOf(s.ref),
      channel: deriveChannel(s.utm?.source, s.ref),
      utmSource: orNull(s.utm?.source),
      utmMedium: orNull(s.utm?.medium),
      utmCampaign: orNull(s.utm?.campaign),
      utmContent: orNull(s.utm?.content),
      utmTerm: orNull(s.utm?.term),
      deviceType: ua.deviceType,
      browser: ua.browser,
      os: ua.os,
      country: geo.country,
      city: geo.city,
      language: orNull(s.lang),
      screenW: s.sw ?? null,
      screenH: s.sh ?? null,
      isBot: isBotUserAgent(userAgent),
      isInternal: s.int === true,
    };
  }
}

/** The client's clock for ordering, or null when it is missing or implausible. */
export function clientTime(t: number | undefined, now: Date): Date | null {
  if (t === undefined) return null;
  const delta = t - now.getTime();
  return delta >= -CLIENT_TIME_PAST_MS && delta <= CLIENT_TIME_FUTURE_MS ? new Date(t) : null;
}
