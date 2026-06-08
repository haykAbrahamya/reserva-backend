import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { PasswordService } from '@/auth/password.service';
import { AppException } from '@/common/errors/app.exception';
import { newId } from '@/common/ids';
import { normalizePhone } from '@/common/utils/phone';
import type { CreateManagerDto, UpdateManagerDto } from './dto/user.dto';

function publicUser(u: User) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    partnerId: u.partnerId,
    locationId: u.locationId,
    active: u.active,
    mustChangePassword: u.mustChangePassword,
    otpChannel: u.otpChannel,
    lastLogin: u.lastLogin,
    createdAt: u.createdAt,
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  /** Managers belonging to a partner (admins manage their own team). */
  async listManagers(partnerId: string) {
    const rows = await this.prisma.user.findMany({
      where: { partnerId, role: 'manager', deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(publicUser);
  }

  /** Create a manager with a generated one-time password (returned once). */
  async createManager(partnerId: string, dto: CreateManagerDto) {
    const location = await this.prisma.location.findFirst({
      where: { id: dto.locationId, partnerId, deletedAt: null },
      select: { id: true },
    });
    if (!location) throw AppException.notFound('Location not found');

    const otp = this.passwords.generateOtp();
    const user = await this.prisma.user.create({
      data: {
        id: newId(),
        partnerId,
        name: dto.name,
        email: dto.email.toLowerCase(),
        phone: normalizePhone(dto.phone),
        role: 'manager',
        locationId: dto.locationId,
        passwordHash: await this.passwords.hash(otp),
        mustChangePassword: true,
        otpChannel: dto.otpChannel,
      },
    });

    return { user: publicUser(user), otp };
  }

  async updateManager(partnerId: string, id: string, dto: UpdateManagerDto) {
    const target = await this.getManager(partnerId, id);
    if (dto.locationId) {
      const loc = await this.prisma.location.findFirst({
        where: { id: dto.locationId, partnerId, deletedAt: null },
        select: { id: true },
      });
      if (!loc) throw AppException.notFound('Location not found');
    }
    const user = await this.prisma.user.update({
      where: { id: target.id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.email !== undefined && { email: dto.email.toLowerCase() }),
        ...(dto.phone !== undefined && { phone: normalizePhone(dto.phone) }),
        ...(dto.locationId !== undefined && { locationId: dto.locationId }),
        ...(dto.active !== undefined && { active: dto.active }),
      },
    });
    return publicUser(user);
  }

  /** Soft-delete a manager and revoke their sessions. */
  async removeManager(partnerId: string, id: string) {
    const target = await this.getManager(partnerId, id);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: target.id },
        data: { deletedAt: new Date(), active: false },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: target.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  private async getManager(partnerId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, partnerId, role: 'manager', deletedAt: null },
    });
    if (!user) throw AppException.notFound('Manager not found');
    return user;
  }
}
