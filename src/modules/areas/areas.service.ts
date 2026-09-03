import { Injectable } from '@nestjs/common';
import type { AreaKind } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';

/** One place in the catalog, as every product reads it. */
export interface AreaView {
  key: string;
  parentKey: string | null;
  kind: AreaKind;
  name: string;
  nameI18n: Record<string, string>;
  /** Search-only synonyms; the client filters over them locally. */
  aliases: string[];
  lat: number | null;
  lng: number | null;
}

/** A top-level node with the places selectable underneath it. */
export interface AreaNode extends AreaView {
  children: AreaView[];
}

const asI18n = (v: unknown): Record<string, string> =>
  v && typeof v === 'object' ? (v as Record<string, string>) : {};

/**
 * Read access to the platform area catalog.
 *
 * Deliberately NOT cached, for the same reason as the specialty catalog: it is
 * ~60 rows behind a covering index, so the query costs less than the
 * invalidation machinery would — and a name corrected by staff appears
 * immediately rather than after a TTL.
 */
@Injectable()
export class AreasService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The active catalog as a one-level-deep tree: Yerevan with its districts, and
   * each province with its cities.
   *
   * Returned whole rather than searched server-side. The entire taxonomy fits in
   * one small payload, so a picker can filter it in the browser — instant, and
   * no debounced round trip per keystroke. It is also what lets the public board
   * expand "Yerevan" into its 12 district keys client-side, so the API filter
   * stays a plain `areaKey IN (...)` with no recursive query.
   */
  async catalog(): Promise<AreaNode[]> {
    const rows = await this.prisma.area.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    const view = (r: (typeof rows)[number]): AreaView => ({
      key: r.key,
      parentKey: r.parentKey,
      kind: r.kind,
      name: r.name,
      nameI18n: asI18n(r.nameI18n),
      aliases: r.aliases,
      lat: r.lat,
      lng: r.lng,
    });

    const childrenOf = new Map<string, AreaView[]>();
    for (const r of rows) {
      if (!r.parentKey) continue;
      const list = childrenOf.get(r.parentKey) ?? [];
      list.push(view(r));
      childrenOf.set(r.parentKey, list);
    }

    return rows
      .filter((r) => !r.parentKey)
      .map((r) => ({ ...view(r), children: childrenOf.get(r.key) ?? [] }))
      // A region with no cities seeded yet is noise in a picker — drop it rather
      // than render a heading with nothing under it. Yerevan survives because it
      // has districts; a province with no cities simply isn't offered yet.
      .filter((n) => n.children.length > 0 || n.kind === 'city');
  }

  /** Is this key an active area? Used when validating writes. */
  async isActive(key: string): Promise<boolean> {
    const row = await this.prisma.area.findUnique({
      where: { key },
      select: { active: true },
    });
    return row?.active === true;
  }
}
