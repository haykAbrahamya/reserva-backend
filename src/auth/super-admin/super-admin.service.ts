import { Injectable } from '@nestjs/common';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import type { PlatformUser, User } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { PasswordService } from '../password.service';
import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';
import { newId, newTokenId } from '@/common/ids';
import type { JwtPayload } from '../auth.types';
import type { PublicUser } from '../auth.service';

/**
 * How long a super admin stays signed in without signing in again. Shorter
 * than a partner's own session on purpose: this session can reach every
 * partner's data.
 */
export const SUPER_SESSION_TTL = '12h';

/** The super admin's own access token: lists partners and enters one — nothing else. */
export interface SuperAccessPayload {
  sub: string; // platform user id
  type: 'super-access';
}

export interface SuperStaff {
  id: string;
  name: string;
  email: string;
}

export interface SuperPartner {
  id: string;
  name: string;
  slug: string | null;
  type: string;
  accent: string;
  active: boolean;
  kind: 'salon' | 'single';
}

export interface SuperSession {
  accessToken: string;
  refreshToken: string;
  staff: SuperStaff;
}

/** Inside a partner: an ordinary partner access token for its admin, marked with the super admin. */
export interface SuperEntry {
  accessToken: string;
  partner: SuperPartner;
  /** The partner's admin the session acts as. */
  user: PublicUser;
}

const PARTNER_SELECT = { id: true, name: true, slug: true, type: true, accent: true, active: true, kind: true } as const;

/**
 * Super admins: platform staff an owner has allowed into the partner
 * backoffice, to see and change any partner's data as that partner's admin.
 *
 * Three tokens, three types, each accepted in one place only:
 *  - `super-access` — this session's own access token; only SuperAdminGuard
 *    takes it (listing partners, entering one). The partner API and the
 *    internal console refuse it.
 *  - `super-refresh` — rotated here only. Stored hashed with the console's
 *    refresh tokens, so a console password change ends it too.
 *  - an ordinary partner `access` token carrying `imp` — what the backoffice
 *    uses inside a partner. JwtAuthGuard re-checks the super admin behind it
 *    on every request.
 *
 * Every check reads the database, never only a token: a right withdrawn in the
 * console is withdrawn everywhere at once.
 */
@Injectable()
export class SuperAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly passwords: PasswordService,
  ) {}

  async login(email: string, password: string): Promise<SuperSession> {
    const staff = await this.prisma.platformUser.findUnique({ where: { email: email.trim().toLowerCase() } });
    // One answer for every refusal: a probe learns nothing about which accounts exist or may do this.
    if (!staff || !isSuperAdmin(staff)) throw invalidCreds();
    if (!(await this.passwords.verify(staff.passwordHash, password))) throw invalidCreds();
    if (staff.mustChangePassword) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Set your own password in the internal console first', 403);
    }

    await this.prisma.platformUser.update({ where: { id: staff.id }, data: { lastLogin: new Date() } });
    return { ...(await this.issueSession(staff)), staff: toStaff(staff) };
  }

  /** Rotate the session; with a partner, also renew the access token inside it. */
  async refresh(refreshToken: string, partnerId?: string): Promise<SuperSession & Partial<SuperEntry>> {
    const payload = await this.verifyRefresh(refreshToken);
    const stored = await this.prisma.platformRefreshToken.findUnique({ where: { tokenHash: hashToken(refreshToken) } });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date() || stored.userId !== payload.sub) {
      throw new AppException(ErrorCode.TOKEN_INVALID, 'Refresh token is no longer valid', 401);
    }
    const staff = await this.prisma.platformUser.findUnique({ where: { id: payload.sub } });
    if (!staff || !isSuperAdmin(staff)) {
      throw new AppException(ErrorCode.TOKEN_INVALID, 'Super admin access was withdrawn', 401);
    }

    // Inside a partner first: should that fail (the partner was removed), the
    // session is left as it was rather than rotated away. Renewing is not a
    // new visit, so no audit row.
    const entry = partnerId ? await this.actAs(staff.id, partnerId, false) : undefined;

    await this.prisma.platformRefreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
    const session = { ...(await this.issueSession(staff)), staff: toStaff(staff) };
    return entry ? { ...session, ...entry } : session;
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.platformRefreshToken.updateMany({
      where: { tokenHash: hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Every partner to choose from, by name. */
  partners(search?: string): Promise<SuperPartner[]> {
    return this.prisma.partner.findMany({
      where: {
        deletedAt: null,
        ...(search
          ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { slug: { contains: search, mode: 'insensitive' } }] }
          : {}),
      },
      select: PARTNER_SELECT,
      orderBy: { name: 'asc' },
      take: 500,
    });
  }

  /** Enter, or switch to, a partner's backoffice. Written to the audit trail. */
  enter(staffId: string, partnerId: string): Promise<SuperEntry> {
    return this.actAs(staffId, partnerId, true);
  }

  // ── Internals ─────────────────────────────────────────────

  /**
   * An ordinary partner access token for the partner's first active admin,
   * marked with the super admin behind it — so every partner endpoint works
   * exactly as it does for that admin, and nothing new is trusted.
   */
  private async actAs(staffId: string, partnerId: string, audit: boolean): Promise<SuperEntry> {
    const partner = await this.prisma.partner.findFirst({ where: { id: partnerId, deletedAt: null }, select: PARTNER_SELECT });
    if (!partner) throw AppException.notFound('Partner not found');
    const admin = await this.prisma.user.findFirst({
      where: { partnerId, role: 'admin', active: true, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!admin) throw AppException.conflict(ErrorCode.NO_PARTNER_ADMIN, 'This partner has no active admin to sign in as');

    if (audit) {
      await this.prisma.superAdminVisit.create({
        data: { id: newId(), platformUserId: staffId, partnerId, actingUserId: admin.id },
      });
    }

    const payload: JwtPayload = {
      sub: admin.id,
      partnerId: admin.partnerId,
      role: 'admin',
      locationId: null,
      type: 'access',
      imp: staffId,
    };
    const accessToken = await this.jwt.signAsync({ ...payload }, this.accessOpts());
    return { accessToken, partner, user: toPublicUser(admin) };
  }

  private async issueSession(staff: PlatformUser): Promise<Omit<SuperSession, 'staff'>> {
    const access: SuperAccessPayload = { sub: staff.id, type: 'super-access' };
    const accessToken = await this.jwt.signAsync({ ...access }, this.accessOpts());

    const refreshToken = await this.jwt.signAsync(
      // `jti` keeps two tokens minted in the same second distinct — see newTokenId.
      { sub: staff.id, type: 'super-refresh', jti: newTokenId() },
      {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: SUPER_SESSION_TTL,
      } as JwtSignOptions,
    );
    const decoded = this.jwt.decode(refreshToken) as { exp: number };
    await this.prisma.platformRefreshToken.create({
      data: { id: newId(), userId: staff.id, tokenHash: hashToken(refreshToken), expiresAt: new Date(decoded.exp * 1000) },
    });
    return { accessToken, refreshToken };
  }

  private accessOpts(): JwtSignOptions {
    return {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.config.getOrThrow<string>('JWT_ACCESS_TTL'),
    } as JwtSignOptions;
  }

  private async verifyRefresh(token: string): Promise<{ sub: string }> {
    try {
      const p = await this.jwt.verifyAsync<{ sub: string; type: string }>(token, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
      // A console session's refresh token is signed with the same secret: the type is what tells them apart.
      if (p.type !== 'super-refresh' || typeof p.sub !== 'string') throw new Error('wrong type');
      return p;
    } catch {
      throw new AppException(ErrorCode.TOKEN_INVALID, 'Invalid refresh token', 401);
    }
  }
}

/** Active, not deleted, and granted the right by an owner. */
export const isSuperAdmin = (u: Pick<PlatformUser, 'active' | 'deletedAt' | 'superAdmin'>) =>
  u.active && !u.deletedAt && u.superAdmin;

function invalidCreds() {
  return new AppException(ErrorCode.INVALID_CREDENTIALS, 'Invalid credentials. Check the email and password.', 401);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const toStaff = (u: PlatformUser): SuperStaff => ({ id: u.id, name: u.name, email: u.email });

/** The partner admin as the backoffice knows a user — never asked to change their password here. */
function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    partnerId: u.partnerId,
    locationId: u.locationId,
    mustChangePassword: false,
  };
}
