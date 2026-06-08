import { Injectable } from '@nestjs/common';
import type { Prisma, PlatformUser } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { PasswordService } from '@/auth/password.service';
import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';
import { newId } from '@/common/ids';
import { paginate, pageArgs } from '@/common/dto/pagination';
import type { ListStaffQueryDto, CreateStaffDto, UpdateStaffDto } from './dto/platform-staff.dto';

/** Owner-only management of internal-backoffice operator accounts. */
@Injectable()
export class PlatformStaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  async list(q: ListStaffQueryDto) {
    const where: Prisma.PlatformUserWhereInput = {
      deletedAt: null,
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' } },
              { email: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.platformUser.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...pageArgs(q.page, q.pageSize),
      }),
      this.prisma.platformUser.count({ where }),
    ]);
    return paginate(rows.map(toPublic), total, q.page, q.pageSize);
  }

  async create(dto: CreateStaffDto) {
    await this.assertEmailFree(dto.email);

    const generatedOtp = dto.password ? null : this.passwords.generateOtp();
    const passwordHash = await this.passwords.hash(dto.password ?? generatedOtp!);

    const user = await this.prisma.platformUser.create({
      data: {
        id: newId(),
        name: dto.name,
        email: dto.email.toLowerCase(),
        role: dto.role,
        passwordHash,
        mustChangePassword: !dto.password,
      },
    });
    return { user: toPublic(user), otp: generatedOtp };
  }

  async update(id: string, dto: UpdateStaffDto, actingUserId: string) {
    const user = await this.getRaw(id);

    // Guard: an owner can't demote/deactivate themselves into a lockout.
    if (id === actingUserId && (dto.role === 'operator' || dto.active === false)) {
      throw AppException.badRequest(
        ErrorCode.VALIDATION_FAILED,
        'You cannot demote or deactivate your own account',
      );
    }
    // Guard: never remove the last active owner.
    if ((dto.role === 'operator' || dto.active === false) && user.role === 'owner') {
      await this.assertNotLastOwner(id);
    }

    const updated = await this.prisma.platformUser.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.role !== undefined && { role: dto.role }),
        ...(dto.active !== undefined && { active: dto.active }),
      },
    });
    return toPublic(updated);
  }

  async remove(id: string, actingUserId: string) {
    const user = await this.getRaw(id);
    if (id === actingUserId) {
      throw AppException.badRequest(ErrorCode.VALIDATION_FAILED, 'You cannot delete your own account');
    }
    if (user.role === 'owner') await this.assertNotLastOwner(id);

    await this.prisma.$transaction([
      this.prisma.platformUser.update({
        where: { id },
        data: { deletedAt: new Date(), active: false },
      }),
      this.prisma.platformRefreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  // ── guards ────────────────────────────────────────────────

  private async getRaw(id: string): Promise<PlatformUser> {
    const u = await this.prisma.platformUser.findFirst({ where: { id, deletedAt: null } });
    if (!u) throw AppException.notFound('Staff member not found');
    return u;
  }

  private async assertEmailFree(email: string) {
    const existing = await this.prisma.platformUser.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true },
    });
    if (existing) {
      throw AppException.conflict(ErrorCode.EMAIL_TAKEN, `The email "${email}" is already in use`);
    }
  }

  private async assertNotLastOwner(excludeId: string) {
    const owners = await this.prisma.platformUser.count({
      where: { role: 'owner', active: true, deletedAt: null, id: { not: excludeId } },
    });
    if (owners === 0) {
      throw AppException.badRequest(
        ErrorCode.VALIDATION_FAILED,
        'At least one active owner must remain',
      );
    }
  }
}

export interface PublicStaff {
  id: string;
  name: string;
  email: string;
  role: PlatformUser['role'];
  active: boolean;
  lastLogin: Date | null;
  mustChangePassword: boolean;
  createdAt: Date;
}

function toPublic(u: PlatformUser): PublicStaff {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    active: u.active,
    lastLogin: u.lastLogin,
    mustChangePassword: u.mustChangePassword,
    createdAt: u.createdAt,
  };
}
