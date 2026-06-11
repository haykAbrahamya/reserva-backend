import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';

/** A salon card for the public marketplace (/salons). Lean — only what the grid
 *  + search need; the full profile is fetched per-slug on the booking page. */
export interface SalonCard {
  id: string;
  slug: string | null;
  name: string;
  type: string;
  accent: string;
  tagline: string;
  rating: number;
  reviews: number;
  heroTints: string[];
  /** Distinct location addresses (first few) for the card + location search. */
  locations: { id: string; name: string; address: string }[];
  /** Service categories offered (deduped) — chips on the card + service search. */
  categories: string[];
  serviceCount: number;
  specialistCount: number;
}

export interface SalonSearch {
  /** Free-text across name, service name/category and location address. */
  q?: string;
  /** Service term (name or category). */
  service?: string;
  /** Location term (address). */
  location?: string;
}

@Injectable()
export class SalonsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Listed, active salons for the public marketplace. Optional search narrows by
   * name, offered service (name/category) and location (address). Matching is
   * case-insensitive substring. Only salons with a public slug are returned
   * (others have no booking page to link to).
   */
  async list(search: SalonSearch = {}): Promise<SalonCard[]> {
    const and: Prisma.PartnerWhereInput[] = [
      { marketplaceListed: true, active: true, deletedAt: null, slug: { not: null } },
    ];

    const ci = (v: string): Prisma.StringFilter => ({ contains: v.trim(), mode: 'insensitive' });

    // Combined free-text: match across the salon name OR a service OR a location.
    if (search.q?.trim()) {
      const q = search.q;
      and.push({
        OR: [
          { name: ci(q) },
          { type: ci(q) },
          { presentation: { is: { tagline: ci(q) } } },
          { services: { some: { deletedAt: null, active: true, OR: [{ name: ci(q) }, { category: ci(q) }] } } },
          { locations: { some: { deletedAt: null, OR: [{ name: ci(q) }, { address: ci(q) }] } } },
        ],
      });
    }
    // Field-scoped filters (AND-combined with the free text).
    if (search.service?.trim()) {
      and.push({
        services: {
          some: {
            deletedAt: null,
            active: true,
            OR: [{ name: ci(search.service) }, { category: ci(search.service) }],
          },
        },
      });
    }
    if (search.location?.trim()) {
      and.push({
        locations: { some: { deletedAt: null, OR: [{ name: ci(search.location) }, { address: ci(search.location) }] } },
      });
    }

    const partners = await this.prisma.partner.findMany({
      where: { AND: and },
      orderBy: [{ name: 'asc' }],
      take: 60,
      include: {
        presentation: true,
        locations: { where: { deletedAt: null }, orderBy: { name: 'asc' }, select: { id: true, name: true, address: true } },
        services: { where: { deletedAt: null, active: true }, select: { category: true, name: true } },
        _count: {
          select: {
            services: { where: { deletedAt: null, active: true } },
            specialists: { where: { deletedAt: null, active: true } },
          },
        },
      },
    });

    return partners.map((p): SalonCard => {
      const categories = Array.from(
        new Set(p.services.map((s) => s.category).filter((c): c is string => !!c && c.trim() !== '')),
      ).slice(0, 6);
      const heroTints = Array.isArray(p.presentation?.heroTints)
        ? (p.presentation!.heroTints as unknown as string[])
        : [];
      return {
        id: p.id,
        slug: p.slug,
        name: p.name,
        type: p.type,
        accent: p.accent,
        tagline: p.presentation?.tagline ?? '',
        rating: p.presentation ? Number(p.presentation.rating) : 0,
        reviews: p.presentation?.reviews ?? 0,
        heroTints,
        locations: p.locations.slice(0, 4),
        categories,
        serviceCount: p._count.services,
        specialistCount: p._count.specialists,
      };
    });
  }
}
