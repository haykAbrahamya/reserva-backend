import { Injectable } from '@nestjs/common';
import { Prisma, type Professional } from '@prisma/client';

import { PrismaService } from '@/prisma/prisma.service';
import { AppException } from '@/common/errors/app.exception';
import { readPhotos, toPublicProfileView, type PublicProfileView } from '@/professionals/professional.view';
import type { ProfessionalSearchQuery } from './dto/professional-search.dto';

/**
 * One card in the specialist directory.
 *
 * A card, not a truncated profile: it carries exactly what a salon needs to
 * decide whether to open the page — who, what they do, how long, where, and
 * whether there is work to look at — and nothing that would make a list of
 * twelve of them expensive. `about` is cut server-side so the payload does not
 * carry 1,200 characters per row to render three lines.
 */
export interface ProfessionalCard {
  id: string;
  name: string;
  avatarUrl: string;
  specialtyKeys: string[];
  areaKeys: string[];
  experienceYears: number | null;
  /** First ~180 characters of `about`, on a word boundary. */
  excerpt: string;
  /** Up to three photos, for the strip on the card. */
  previewPhotos: string[];
  photoCount: number;
  contactVisible: boolean;
  memberSince: string;
}

export interface ProfessionalSearchResult {
  items: ProfessionalCard[];
  total: number;
  page: number;
  pageSize: number;
}

const EXCERPT_CHARS = 180;
const PREVIEW_PHOTOS = 3;

/**
 * The specialist directory: the salon-facing half of a two-sided board.
 *
 * It lives in the board module rather than in `professionals/` because of what
 * it IS rather than what it reads: an unauthenticated public search, exactly
 * like the vacancy search beside it, sharing that module's query grammar and
 * its @Public() controller. The `professionals/` module is the account area —
 * everything there is written by the person it belongs to.
 *
 * The privacy line is drawn once, in `visible`: published, active, not deleted.
 * Every query in this file starts from it, and the public serializer in
 * professional.view.ts decides the rest.
 */
@Injectable()
export class ProfessionalsDirectoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The only definition of "may be seen by a stranger".
   *
   * A single object, referenced everywhere, because a directory that lists a
   * profile the detail route then 404s — or worse, the reverse — is the exact
   * bug this shape prevents.
   */
  private get visible(): Prisma.ProfessionalWhereInput {
    return { publicProfile: true, active: true, deletedAt: null };
  }

  async search(q: ProfessionalSearchQuery): Promise<ProfessionalSearchResult> {
    const where = await this.buildWhere(q);

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.professional.count({ where }),
      this.prisma.professional.findMany({
        where,
        orderBy: this.orderBy(q.sort),
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);

    return {
      items: rows.map(toCard),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /** One public profile, or 404 — including when it exists but is unpublished. */
  async findOne(id: string): Promise<PublicProfileView> {
    const pro = await this.prisma.professional.findFirst({ where: { id, ...this.visible } });
    /*
     * The same 404 for "no such profile" and "that profile is not public".
     *
     * Telling them apart would turn this route into a way to confirm that a
     * given person has an account here, which on a job board is a question
     * about someone's employment rather than about a URL.
     */
    if (!pro) throw AppException.notFound('Profile not found');
    return toPublicProfileView(pro);
  }

  private async buildWhere(q: ProfessionalSearchQuery): Promise<Prisma.ProfessionalWhereInput> {
    const filters: Prisma.ProfessionalWhereInput[] = [this.visible];

    /*
     * A group filter is expanded to its specialty keys here rather than stored
     * on the professional. `specialtyKeys` is a flat array of leaf keys — the
     * same vocabulary a vacancy is tagged with — so the group is resolved
     * through the catalog, which means re-parenting a specialty later changes
     * the search without a data migration.
     */
    const specialties = new Set(q.specialty);
    if (q.group.length) {
      const inGroups = await this.prisma.specialty.findMany({
        where: { groupKey: { in: q.group } },
        select: { key: true },
      });
      for (const s of inGroups) specialties.add(s.key);
    }
    if (specialties.size) filters.push({ specialtyKeys: { hasSome: [...specialties] } });

    /*
     * Areas expand DOWNWARD: a salon filtering by "Yerevan" means anyone who
     * works in any of its districts, and professionals tag themselves with the
     * districts. Without this, picking a city would match only the few people
     * who happened to tag the city itself.
     */
    if (q.area.length) {
      const children = await this.prisma.area.findMany({
        where: { parentKey: { in: q.area } },
        select: { key: true },
      });
      filters.push({ areaKeys: { hasSome: [...new Set([...q.area, ...children.map((a) => a.key)])] } });
    }

    if (q.experienceMin != null) filters.push({ experienceYears: { gte: q.experienceMin } });

    if (q.withPhotos) {
      // `photos` is JSON, so "has any" is "is not the empty array". Both the
      // literal `[]` and a NULL from an older row count as none.
      filters.push({ NOT: { photos: { equals: [] } } });
    }

    if (q.q) {
      // Prisma drops `contains` into a LIKE pattern unescaped, so a typed `%`
      // would be a wildcard matching the whole directory. Same treatment as the
      // vacancy search.
      const literal = q.q.replace(/[%_]/g, '');
      if (literal) {
        filters.push({
          OR: [
            { name: { contains: literal, mode: 'insensitive' } },
            { about: { contains: literal, mode: 'insensitive' } },
          ],
        });
      }
    }

    return { AND: filters };
  }

  private orderBy(sort: ProfessionalSearchQuery['sort']): Prisma.ProfessionalOrderByWithRelationInput[] {
    if (sort === 'newest') return [{ createdAt: 'desc' }];
    if (sort === 'experience') return [{ experienceYears: 'desc' }, { createdAt: 'desc' }];

    /*
     * "Relevant" is a proxy for "worth a salon's click", ordered by how much of
     * the profile exists: a photo first, then recency.
     *
     * Sorting by `avatarUrl desc` is a trick with a real meaning — a non-empty
     * string sorts above the empty default — and it is the cheapest way to
     * float finished profiles without a computed column. When the directory
     * grows enough to need real ranking this is the line to replace, and it is
     * one line.
     */
    return [{ avatarUrl: 'desc' }, { experienceYears: 'desc' }, { createdAt: 'desc' }];
  }
}

function toCard(p: Professional): ProfessionalCard {
  const photos = readPhotos(p.photos);
  return {
    id: p.id,
    name: p.name,
    avatarUrl: p.avatarUrl,
    specialtyKeys: p.specialtyKeys,
    areaKeys: p.areaKeys,
    experienceYears: p.experienceYears,
    excerpt: excerpt(p.about),
    previewPhotos: photos.slice(0, PREVIEW_PHOTOS).map((ph) => ph.url),
    photoCount: photos.length,
    contactVisible: p.showContact,
    memberSince: p.createdAt.toISOString(),
  };
}

/** Cut to a word boundary, so a card never ends mid-syllable. */
function excerpt(about: string): string {
  const text = about.replace(/\s+/g, ' ').trim();
  if (text.length <= EXCERPT_CHARS) return text;
  const cut = text.slice(0, EXCERPT_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > EXCERPT_CHARS * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
