import { Injectable } from '@nestjs/common';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import type { User } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { PasswordService } from './password.service';
import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';
import { newId } from '@/common/ids';
import { normalizePhone } from '@/common/utils/phone';
import type { AuthUser, JwtPayload } from './auth.types';

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult extends Tokens {
  user: PublicUser;
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: User['role'];
  partnerId: string;
  locationId: string | null;
  mustChangePassword: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly passwords: PasswordService,
  ) {}

  // ── Public API ────────────────────────────────────────────

  async login(login: string, password: string): Promise<AuthResult> {
    const user = await this.findByLogin(login);
    if (!user || !user.active) throw this.invalidCreds();

    const ok = await this.passwords.verify(user.passwordHash, password);
    if (!ok) throw this.invalidCreds();

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    const tokens = await this.issueTokens(user);
    return { ...tokens, user: toPublicUser(user) };
  }

  /**
   * Issue a session for an already-trusted User (e.g. immediately after a
   * verified self-serve signup activation). Skips password verification — the
   * caller is responsible for having authenticated the user another way.
   */
  async loginTrustedUser(user: User): Promise<AuthResult> {
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });
    const tokens = await this.issueTokens(user);
    return { ...tokens, user: toPublicUser(user) };
  }

  async refresh(refreshToken: string): Promise<AuthResult> {
    const payload = await this.verifyRefresh(refreshToken);
    const tokenHash = hashToken(refreshToken);

    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new AppException(ErrorCode.TOKEN_INVALID, 'Refresh token is no longer valid', 401);
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.active) throw this.invalidCreds();

    // Rotate: revoke the used token, issue a fresh pair.
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    const tokens = await this.issueTokens(user);
    return { ...tokens, user: toPublicUser(user) };
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = hashToken(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw AppException.notFound('User not found');
    // Heartbeat: /auth/me fires on every backoffice load/refresh, so it's the
    // natural "last active" signal. Throttle to ≥60s so rapid refreshes don't
    // hammer the DB, and never block the response on the write.
    const now = Date.now();
    const stale = !user.lastSeenAt || now - user.lastSeenAt.getTime() > 60_000;
    if (stale) {
      this.prisma.user
        .update({ where: { id: user.id }, data: { lastSeenAt: new Date(now) } })
        .catch(() => undefined);
    }
    return toPublicUser(user);
  }

  async changePassword(userId: string, current: string, next: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw AppException.notFound('User not found');

    const ok = await this.passwords.verify(user.passwordHash, current);
    if (!ok) {
      throw new AppException(
        ErrorCode.WRONG_CURRENT_PASSWORD,
        'Current password is incorrect',
        400,
      );
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: await this.passwords.hash(next), mustChangePassword: false },
      }),
      // Changing the password invalidates all existing sessions.
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  // ── Internals ─────────────────────────────────────────────

  /** Resolve a login that may be an email or a phone number. */
  private async findByLogin(login: string): Promise<User | null> {
    const value = login.trim();
    if (value.includes('@')) {
      return this.prisma.user.findUnique({ where: { email: value.toLowerCase() } });
    }
    return this.prisma.user.findUnique({ where: { phone: normalizePhone(value) } });
  }

  private async issueTokens(user: User): Promise<Tokens> {
    const accessPayload: JwtPayload = {
      sub: user.id,
      partnerId: user.partnerId,
      role: user.role,
      locationId: user.locationId,
      type: 'access',
    };

    // `expiresIn` is typed as the `ms` StringValue template; our config provides
    // a plain string ("15m"), so cast through the shared options type.
    const accessOpts = {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.config.getOrThrow<string>('JWT_ACCESS_TTL'),
    } as JwtSignOptions;
    const accessToken = await this.jwt.signAsync({ ...accessPayload }, accessOpts);

    const refreshOpts = {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.config.getOrThrow<string>('JWT_REFRESH_TTL'),
    } as JwtSignOptions;
    const refreshToken = await this.jwt.signAsync({ sub: user.id, type: 'refresh' }, refreshOpts);

    // Persist the refresh token hashed so it can be revoked/rotated.
    const decoded = this.jwt.decode(refreshToken) as { exp: number };
    await this.prisma.refreshToken.create({
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
      return await this.jwt.verifyAsync<{ sub: string; type: string }>(token, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new AppException(ErrorCode.TOKEN_INVALID, 'Invalid refresh token', 401);
    }
  }

  private invalidCreds() {
    return new AppException(
      ErrorCode.INVALID_CREDENTIALS,
      'Invalid credentials. Check the email/phone and password.',
      401,
    );
  }
}

// ── Helpers ──────────────────────────────────────────────────

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    partnerId: u.partnerId,
    locationId: u.locationId,
    mustChangePassword: u.mustChangePassword,
  };
}

export type { AuthUser };
