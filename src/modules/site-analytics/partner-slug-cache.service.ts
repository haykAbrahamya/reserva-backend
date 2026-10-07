import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

/** How long a snapshot of the slug → id map is trusted. */
const TTL_MS = 5 * 60_000;
/** A miss may refresh early (a partner who just set a slug), but at most this often. */
const MISS_REFRESH_MS = 60_000;

/**
 * slug → partner id, for attributing beacon events without a query per batch.
 *
 * Slugs change rarely, so a snapshot of all of them (a few hundred short rows)
 * refreshed every few minutes is plenty. An unknown slug — a typo, a crafted
 * value — attributes to nobody; it can trigger at most one early refresh a
 * minute, so junk slugs cannot turn into a query per request.
 */
@Injectable()
export class PartnerSlugCache {
  private bySlug = new Map<string, string>();
  private loadedAt = 0;
  private loading: Promise<void> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Partner id per slug (lower-cased); null for an unknown or missing slug. */
  async resolve(slugs: Iterable<string | undefined>): Promise<Map<string, string | null>> {
    const wanted = new Set<string>();
    for (const s of slugs) {
      const slug = normalizeSlug(s);
      if (slug) wanted.add(slug);
    }
    const out = new Map<string, string | null>();
    if (!wanted.size) return out;

    const age = Date.now() - this.loadedAt;
    const missing = () => [...wanted].some((s) => !this.bySlug.has(s));
    if (age > TTL_MS || (age > MISS_REFRESH_MS && missing())) await this.refresh();

    for (const slug of wanted) out.set(slug, this.bySlug.get(slug) ?? null);
    return out;
  }

  /** Concurrent callers share one query. */
  private refresh(): Promise<void> {
    this.loading ??= this.prisma.partner
      .findMany({ where: { slug: { not: null } }, select: { id: true, slug: true } })
      .then((rows) => {
        this.bySlug = new Map(rows.map((r) => [r.slug!.toLowerCase(), r.id]));
        this.loadedAt = Date.now();
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }
}

/** The form slugs are stored in: trimmed, lower-case; '' → undefined. */
export function normalizeSlug(slug: string | undefined): string | undefined {
  const s = slug?.trim().toLowerCase();
  return s ? s : undefined;
}
