import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';
import type { CreateAreaDto, UpdateAreaDto } from './dto/platform-area.dto';

/** Lowercase + de-duplicate + drop blanks, so client-side matching needs no
 *  normalization of its own. */
const cleanAliases = (aliases: string[]): string[] =>
  Array.from(new Set(aliases.map((a) => a.trim().toLowerCase()).filter(Boolean)));

/**
 * Staff administration of the shared area catalog.
 *
 * Destructive paths are deliberately conservative, matching the specialty
 * catalog: an area that branches sit in, or that has children, can be
 * DEACTIVATED (hidden from pickers, existing branches keep rendering) but never
 * deleted. That mirrors the database's own `onDelete: Restrict` rather than
 * relying on it to produce a readable error.
 */
@Injectable()
export class PlatformAreasService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The whole tree with usage counts, so staff can see which rows are
   * load-bearing before touching them. Flat, with `parentKey` — the console
   * renders the nesting.
   */
  async list(search?: string) {
    const where: Prisma.AreaWhereInput = search
      ? {
          OR: [
            { key: { contains: search, mode: 'insensitive' } },
            { name: { contains: search, mode: 'insensitive' } },
            { aliases: { has: search.toLowerCase() } },
          ],
        }
      : {};

    const rows = await this.prisma.area.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        _count: { select: { locations: true, children: true } },
        parent: { select: { key: true, name: true } },
      },
    });

    return rows.map(({ _count, ...a }) => ({
      ...a,
      /** Branches currently in this area — blocks deletion. */
      usageCount: _count.locations,
      childCount: _count.children,
    }));
  }

  async create(dto: CreateAreaDto) {
    const existing = await this.prisma.area.findUnique({
      where: { key: dto.key },
      select: { key: true },
    });
    if (existing) {
      throw AppException.conflict(ErrorCode.VALIDATION_FAILED, `The key "${dto.key}" is already taken`);
    }
    if (dto.parentKey) await this.assertParent(dto.key, dto.parentKey);

    return this.prisma.area.create({
      data: { ...dto, aliases: cleanAliases(dto.aliases) },
    });
  }

  async update(key: string, dto: UpdateAreaDto) {
    await this.get(key);
    if (dto.parentKey) await this.assertParent(key, dto.parentKey);

    return this.prisma.area.update({
      where: { key },
      data: { ...dto, ...(dto.aliases ? { aliases: cleanAliases(dto.aliases) } : {}) },
    });
  }

  /**
   * Hard delete, allowed ONLY while nothing references the row. An area in use
   * is deactivated instead — deleting it would strand branches with a dangling
   * key, which the FK would refuse anyway.
   */
  async remove(key: string) {
    await this.get(key);

    const [inUse, children] = await Promise.all([
      this.prisma.location.count({ where: { areaKey: key } }),
      this.prisma.area.count({ where: { parentKey: key } }),
    ]);
    if (children > 0) {
      throw AppException.conflict(
        ErrorCode.VALIDATION_FAILED,
        `This area still has ${children} ${children === 1 ? 'child area' : 'child areas'}. Move or remove them first.`,
      );
    }
    if (inUse > 0) {
      throw AppException.conflict(
        ErrorCode.VALIDATION_FAILED,
        `${inUse} ${inUse === 1 ? 'branch is' : 'branches are'} in this area. Deactivate it instead — it will disappear from pickers while existing branches keep working.`,
      );
    }
    await this.prisma.area.delete({ where: { key } });
  }

  // ── guards ────────────────────────────────────────────────

  private async get(key: string) {
    const row = await this.prisma.area.findUnique({ where: { key } });
    if (!row) throw AppException.notFound('Area not found');
    return row;
  }

  /**
   * A parent must exist, must not be the row itself, and must not be one of its
   * own descendants — otherwise the tree gains a cycle and every recursive read
   * (or a client expanding a parent into its children) loops forever.
   */
  private async assertParent(key: string, parentKey: string) {
    if (parentKey === key) {
      throw AppException.badRequest(ErrorCode.VALIDATION_FAILED, 'An area cannot be its own parent');
    }
    await this.get(parentKey);

    // Walk up from the proposed parent; if we meet `key`, this would close a loop.
    const seen = new Set<string>([key]);
    let cursor: string | null = parentKey;
    while (cursor) {
      if (seen.has(cursor) && cursor !== parentKey) break;
      seen.add(cursor);
      const row: { parentKey: string | null } | null = await this.prisma.area.findUnique({
        where: { key: cursor },
        select: { parentKey: true },
      });
      cursor = row?.parentKey ?? null;
      if (cursor === key) {
        throw AppException.badRequest(
          ErrorCode.VALIDATION_FAILED,
          'That would make the area a descendant of itself',
        );
      }
    }
  }
}
