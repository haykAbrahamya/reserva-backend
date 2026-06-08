import { Injectable } from '@nestjs/common';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import type { PlatformUser } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { PasswordService } from '@/auth/password.service';
import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';
import { newId } from '@/common/ids';
import type { PlatformJwtPayload } from '../platform.types';

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export interface PlatformAuthResult extends Tokens {
  user: PublicPlatformUser;
}

export interface PublicPlatformUser {
  id: string;
  name: string;
  email: string;
  role: PlatformUser['role'];
  mustChangePassword: boolean;
}

@Injectable()
export class PlatformAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly passwords: PasswordService,
  ) {}

  async login(email: string, password: string): Promise<PlatformAuthResult> {
    const user = await this.prisma.platformUser.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (!user || !user.active || user.deletedAt) throw this.invalidCreds();

    const ok = await this.passwords.verify(user.passwordHash, password);
    if (!ok) throw this.invalidCreds();

    await this.prisma.platformUser.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    const tokens = await this.issueTokens(user);
    return { ...tokens, user: toPublic(user) };
  }

  async refresh(refreshToken: string): Promise<PlatformAuthResult> {
    const payload = await this.verifyRefresh(refreshToken);
    const tokenHash = hashToken(refreshToken);

    const stored = await this.prisma.platformRefreshToken.findUnique({ where: { tokenHash } });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new AppException(ErrorCode.TOKEN_INVALID, 'Refresh token is no longer valid', 401);
    }

    const user = await this.prisma.platformUser.findUnique({ where: { id: payload.sub } });
    if (!user || !user.active || user.deletedAt) throw this.invalidCreds();

    await this.prisma.platformRefreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    const tokens = await this.issueTokens(user);
    return { ...tokens, user: toPublic(user) };
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = hashToken(refreshToken);
    await this.prisma.platformRefreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(userId: string): Promise<PublicPlatformUser> {
    const user = await this.prisma.platformUser.findUnique({ where: { id: userId } });
    if (!user) throw AppException.notFound('User not found');
    return toPublic(user);
  }

  async changePassword(userId: string, current: string, next: string): Promise<void> {
    const user = await this.prisma.platformUser.findUnique({ where: { id: userId } });
    if (!user) throw AppException.notFound('User not found');

    const ok = await this.passwords.verify(user.passwordHash, current);
    if (!ok) {
      throw new AppException(ErrorCode.WRONG_CURRENT_PASSWORD, 'Current password is incorrect', 400);
    }

    await this.prisma.$transaction([
      this.prisma.platformUser.update({
        where: { id: userId },
        data: { passwordHash: await this.passwords.hash(next), mustChangePassword: false },
      }),
      this.prisma.platformRefreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  // ── Internals ─────────────────────────────────────────────

  private async issueTokens(user: PlatformUser): Promise<Tokens> {
    const accessPayload: PlatformJwtPayload = {
      sub: user.id,
      role: user.role,
      type: 'platform-access',
    };

    const accessOpts = {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.config.getOrThrow<string>('JWT_ACCESS_TTL'),
    } as JwtSignOptions;
    const accessToken = await this.jwt.signAsync({ ...accessPayload }, accessOpts);

    const refreshOpts = {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.config.getOrThrow<string>('JWT_REFRESH_TTL'),
    } as JwtSignOptions;
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, type: 'platform-refresh' },
      refreshOpts,
    );

    const decoded = this.jwt.decode(refreshToken) as { exp: number };
    await this.prisma.platformRefreshToken.create({
      data: {
        id: newId(),
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(decoded.exp * 1000),
      },
    });

    return { accessToken, refreshToken };
  }

  private async verifyRefresh(token: string): Promise<{ sub: string }> {
    try {
      const p = await this.jwt.verifyAsync<{ sub: string; type: string }>(token, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
      if (p.type !== 'platform-refresh') throw new Error('wrong type');
      return p;
    } catch {
      throw new AppException(ErrorCode.TOKEN_INVALID, 'Invalid refresh token', 401);
    }
  }

  private invalidCreds() {
    return new AppException(
      ErrorCode.INVALID_CREDENTIALS,
      'Invalid credentials. Check the email and password.',
      401,
    );
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toPublic(u: PlatformUser): PublicPlatformUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    mustChangePassword: u.mustChangePassword,
  };
}
