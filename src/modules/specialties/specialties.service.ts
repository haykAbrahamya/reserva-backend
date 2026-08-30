import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

/**
 * One field of work, as every product reads it.
 *
 * Both names travel together on purpose: `name` labels the WORK ("Hair
 * styling") and `roleName` labels the PERSON ("Hair stylist"). A services
 * screen renders the first, a vacancy renders the second, and neither has to
 * invent vocabulary the other cannot understand.
 */
export interface SpecialtyView {
  key: string;
  groupKey: string;
  name: string;
  nameI18n: Record<string, string>;
  roleName: string;
  roleNameI18n: Record<string, string>;
  /** Search-only synonyms; the client filters over them locally. */
  aliases: string[];
}

export interface SpecialtyGroupView {
  key: string;
  name: string;
  nameI18n: Record<string, string>;
  specialties: SpecialtyView[];
}

const asI18n = (v: unknown): Record<string, string> =>
  v && typeof v === 'object' ? (v as Record<string, string>) : {};

/**
 * Read access to the platform specialty catalog.
 *
 * Deliberately NOT cached. It is ~60 rows behind a covering index, so a query
 * costs less than the cache-invalidation machinery would — and a translation
 * corrected by staff in the console appears immediately rather than after a TTL,
 * which matters when someone is fixing a typo they can see on a live page.
 */
@Injectable()
export class SpecialtiesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The active catalog, grouped and ordered — the shape every picker renders.
   *
   * Returned whole rather than paginated or searched server-side: the entire
   * vocabulary is small enough to filter in the browser, which makes the picker
   * feel instant instead of debounced.
   */
  async catalog(): Promise<SpecialtyGroupView[]> {
    const groups = await this.prisma.specialtyGroup.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        specialties: {
          where: { active: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    return groups
      .map((g) => ({
        key: g.key,
        name: g.name,
        nameI18n: asI18n(g.nameI18n),
        specialties: g.specialties.map((s) => ({
          key: s.key,
          groupKey: s.groupKey,
          name: s.name,
          nameI18n: asI18n(s.nameI18n),
          roleName: s.roleName,
          roleNameI18n: asI18n(s.roleNameI18n),
          aliases: s.aliases,
        })),
      }))
      // An empty group is noise in a picker — hide it rather than render a
      // heading with nothing under it.
      .filter((g) => g.specialties.length > 0);
  }

  /** Does this key name an active specialty? Used when validating writes. */
  async isActive(key: string): Promise<boolean> {
    const row = await this.prisma.specialty.findUnique({
      where: { key },
      select: { active: true },
    });
    return row?.active === true;
  }
}
