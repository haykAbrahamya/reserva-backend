import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';
import type {
  CreateSpecialtyDto,
  UpdateSpecialtyDto,
  CreateSpecialtyGroupDto,
  UpdateSpecialtyGroupDto,
} from './dto/platform-specialty.dto';

/** Lowercase + de-duplicate + drop blanks, so client-side matching needs no
 *  normalization of its own. */
const cleanAliases = (aliases: string[]): string[] =>
  Array.from(new Set(aliases.map((a) => a.trim().toLowerCase()).filter(Boolean)));

/**
 * Staff administration of the shared specialty vocabulary.
 *
 * This is the taxonomy every product reads, so the destructive paths are
 * deliberately conservative: a specialty that is referenced by live listings can
 * be deactivated (hidden from pickers, existing rows keep rendering) but never
 * deleted. That mirrors the database's own `onDelete: Restrict` rather than
 * relying on it to produce a readable error.
 */
@Injectable()
export class PlatformSpecialtiesService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Groups ────────────────────────────────────────────────

  /** Every group, including inactive ones — staff need to see what they hid. */
  async listGroups() {
    const groups = await this.prisma.specialtyGroup.findMany({
      orderBy: { sortOrder: 'asc' },
      include: { _count: { select: { specialties: true } } },
    });
    return groups.map(({ _count, ...g }) => ({ ...g, specialtyCount: _count.specialties }));
  }

  async createGroup(dto: CreateSpecialtyGroupDto) {
    await this.assertGroupKeyFree(dto.key);
    return this.prisma.specialtyGroup.create({ data: dto });
  }

  async updateGroup(key: string, dto: UpdateSpecialtyGroupDto) {
    await this.getGroup(key);
    return this.prisma.specialtyGroup.update({ where: { key }, data: dto });
  }

  async removeGroup(key: string) {
    await this.getGroup(key);
    const inUse = await this.prisma.specialty.count({ where: { groupKey: key } });
    if (inUse > 0) {
      throw AppException.conflict(
        ErrorCode.VALIDATION_FAILED,
        `This group still holds ${inUse} ${inUse === 1 ? 'specialty' : 'specialties'}. Move or remove them first.`,
      );
    }
    await this.prisma.specialtyGroup.delete({ where: { key } });
  }

  // ── Specialties ───────────────────────────────────────────

  /**
   * The full catalog with usage counts, so staff can see at a glance which
   * entries are load-bearing before touching them.
   */
  async list(search?: string) {
    const where: Prisma.SpecialtyWhereInput = search
      ? {
          OR: [
            { key: { contains: search, mode: 'insensitive' } },
            { name: { contains: search, mode: 'insensitive' } },
            { roleName: { contains: search, mode: 'insensitive' } },
            { aliases: { has: search.toLowerCase() } },
          ],
        }
      : {};

    const rows = await this.prisma.specialty.findMany({
      where,
      orderBy: [{ groupKey: 'asc' }, { sortOrder: 'asc' }],
      include: { _count: { select: { vacancies: true } } },
    });
    return rows.map(({ _count, ...s }) => ({ ...s, usageCount: _count.vacancies }));
  }

  async create(dto: CreateSpecialtyDto) {
    const existing = await this.prisma.specialty.findUnique({
      where: { key: dto.key },
      select: { key: true },
    });
    if (existing) {
      throw AppException.conflict(ErrorCode.VALIDATION_FAILED, `The key "${dto.key}" is already taken`);
    }
    await this.getGroup(dto.groupKey);
    return this.prisma.specialty.create({
      data: { ...dto, aliases: cleanAliases(dto.aliases) },
    });
  }

  async update(key: string, dto: UpdateSpecialtyDto) {
    await this.get(key);
    if (dto.groupKey) await this.getGroup(dto.groupKey);

    // Deactivating something that is in use is allowed and useful — it stops new
    // listings choosing it while leaving existing ones readable. Say how many
    // are affected so the decision is informed rather than blind.
    return this.prisma.specialty.update({
      where: { key },
      data: { ...dto, ...(dto.aliases ? { aliases: cleanAliases(dto.aliases) } : {}) },
    });
  }

  /**
   * Hard delete, allowed ONLY while nothing references the row. A specialty in
   * use is deactivated instead — deleting it would strand live listings with a
   * dangling key, which the FK would refuse anyway.
   */
  async remove(key: string) {
    await this.get(key);
    const inUse = await this.prisma.vacancy.count({ where: { specialtyKey: key } });
    if (inUse > 0) {
      throw AppException.conflict(
        ErrorCode.VALIDATION_FAILED,
        `${inUse} ${inUse === 1 ? 'vacancy uses' : 'vacancies use'} this specialty. Deactivate it instead — it will disappear from pickers while existing listings keep working.`,
      );
    }
    await this.prisma.specialty.delete({ where: { key } });
  }

  // ── guards ────────────────────────────────────────────────

  private async get(key: string) {
    const row = await this.prisma.specialty.findUnique({ where: { key } });
    if (!row) throw AppException.notFound('Specialty not found');
    return row;
  }

  private async getGroup(key: string) {
    const row = await this.prisma.specialtyGroup.findUnique({ where: { key } });
    if (!row) throw AppException.notFound('Specialty group not found');
    return row;
  }

  private async assertGroupKeyFree(key: string) {
    const existing = await this.prisma.specialtyGroup.findUnique({
      where: { key },
      select: { key: true },
    });
    if (existing) {
      throw AppException.conflict(ErrorCode.VALIDATION_FAILED, `The key "${key}" is already taken`);
    }
  }
}
