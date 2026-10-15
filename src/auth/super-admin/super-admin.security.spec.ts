import { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { PrismaService } from '@/prisma/prisma.service';
import type { PasswordService } from '../password.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { NO_SUPER_ADMIN_KEY } from '../decorators';
import { SuperAdminGuard } from './super-admin.guard';
import { SuperAdminService } from './super-admin.service';

/**
 * The super admin boundary, end to end on real signed tokens: what each kind
 * of token can and cannot reach, and that a withdrawn right stops a session at
 * once. A partner's own login must never get anywhere a super admin can.
 */

const ACCESS = 'test-access-secret-0123456789';
const REFRESH = 'test-refresh-secret-0123456789';
const config = {
  get: (k: string) => ({ JWT_ACCESS_SECRET: ACCESS, JWT_REFRESH_SECRET: REFRESH, JWT_ACCESS_TTL: '15m' })[k],
  getOrThrow: (k: string) => ({ JWT_ACCESS_SECRET: ACCESS, JWT_REFRESH_SECRET: REFRESH, JWT_ACCESS_TTL: '15m' })[k],
} as unknown as ConfigService;
const jwt = new JwtService({});
const sign = (payload: object, secret = ACCESS) => jwt.signAsync(payload, { secret, expiresIn: '15m' });

type Staff = { id: string; active: boolean; deletedAt: Date | null; superAdmin: boolean };
const SUPER: Staff = { id: 'staff-1', active: true, deletedAt: null, superAdmin: true };

function db(staff: Staff | null = SUPER) {
  return {
    platformUser: { findUnique: jest.fn(async () => staff), update: jest.fn(async () => ({})) },
    platformRefreshToken: {
      findUnique: jest.fn(),
      create: jest.fn(async () => ({})),
      update: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    partner: { findFirst: jest.fn(async () => ({ id: 'p-2', name: 'Nails', slug: 'nails', type: 'Nail studio', accent: '#000', active: true, kind: 'salon' })) },
    user: {
      findFirst: jest.fn(async () => ({
        id: 'admin-2', name: 'Admin', email: 'a@x.am', phone: '+374', role: 'admin', partnerId: 'p-2', locationId: null, mustChangePassword: true,
      })),
    },
    superAdminVisit: { create: jest.fn(async () => ({})) },
  };
}

function httpCtx(token: string | null, noSuperAdmin = false) {
  const req: Record<string, unknown> = { headers: token ? { authorization: `Bearer ${token}` } : {} };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  const reflector = {
    getAllAndOverride: (key: string) => (key === NO_SUPER_ADMIN_KEY ? noSuperAdmin : false),
  } as unknown as Reflector;
  return { req, ctx, reflector };
}

const partnerToken = (extra: object = {}) =>
  sign({ sub: 'user-1', partnerId: 'p-1', role: 'admin', locationId: null, type: 'access', ...extra });

describe('Partner API (JwtAuthGuard) and super admins', () => {
  const guard = (staff: Staff | null, noSuperAdmin = false, token?: string) => {
    const prisma = db(staff);
    const { req, ctx, reflector } = httpCtx(token ?? null, noSuperAdmin);
    return { run: () => new JwtAuthGuard(reflector, jwt, config, prisma as unknown as PrismaService).canActivate(ctx), req, prisma };
  };

  it('lets a partner’s own token in, and never looks up any staff for it', async () => {
    const g = guard(SUPER, false, await partnerToken());
    await expect(g.run()).resolves.toBe(true);
    expect(g.req.user).toEqual({ id: 'user-1', partnerId: 'p-1', role: 'admin', locationId: null });
    expect(g.prisma.platformUser.findUnique).not.toHaveBeenCalled();
  });

  it('refuses the super admin’s own session token and a console token — only partner tokens get in', async () => {
    for (const type of ['super-access', 'platform-access']) {
      const g = guard(SUPER, false, await sign({ sub: 'staff-1', type, role: 'owner' }));
      await expect(g.run()).rejects.toMatchObject({ status: 401 });
    }
  });

  it('refuses a token without a user or a partner: no handler may run with an unscoped query', async () => {
    for (const bad of [{ partnerId: undefined }, { partnerId: '' }, { sub: '' }]) {
      const g = guard(SUPER, false, await partnerToken(bad));
      await expect(g.run()).rejects.toMatchObject({ status: 401 });
    }
  });

  it('lets a super admin session in as the partner’s admin, marked with who is behind it', async () => {
    const g = guard(SUPER, false, await partnerToken({ imp: 'staff-1' }));
    await expect(g.run()).resolves.toBe(true);
    expect(g.req.user).toMatchObject({ partnerId: 'p-1', impersonatedBy: 'staff-1' });
  });

  it('stops a super admin session the moment the right is withdrawn, the account disabled or deleted', async () => {
    const token = await partnerToken({ imp: 'staff-1' });
    for (const staff of [{ ...SUPER, superAdmin: false }, { ...SUPER, active: false }, { ...SUPER, deletedAt: new Date() }, null]) {
      await expect(guard(staff, false, token).run()).rejects.toMatchObject({ status: 401 });
    }
  });

  it('refuses a super admin on the partner-only routes — and lets the partner through them', async () => {
    await expect(guard(SUPER, true, await partnerToken({ imp: 'staff-1' })).run()).rejects.toMatchObject({ status: 403 });
    await expect(guard(SUPER, true, await partnerToken()).run()).resolves.toBe(true);
  });

  it('refuses a token signed with any other secret', async () => {
    const forged = await sign({ sub: 'user-1', partnerId: 'p-2', role: 'admin', locationId: null, type: 'access', imp: 'staff-1' }, 'not-the-secret-0123456789');
    await expect(guard(SUPER, false, forged).run()).rejects.toMatchObject({ status: 401 });
  });
});

describe('Super admin endpoints (SuperAdminGuard)', () => {
  const guard = async (token: string, staff: Staff | null = SUPER) => {
    const prisma = db(staff);
    const { req, ctx } = httpCtx(token);
    const result = new SuperAdminGuard(jwt, config, prisma as unknown as PrismaService).canActivate(ctx);
    return { result, req };
  };

  it('never lets a partner’s own token in — however privileged the partner user', async () => {
    const { result } = await guard(await partnerToken());
    await expect(result).rejects.toMatchObject({ status: 401 });
  });

  it('never lets a console token in', async () => {
    const { result } = await guard(await sign({ sub: 'staff-1', role: 'owner', type: 'platform-access' }));
    await expect(result).rejects.toMatchObject({ status: 401 });
  });

  it('lets the super admin in by their session token, or by the partner token they are using', async () => {
    for (const token of [await sign({ sub: 'staff-1', type: 'super-access' }), await partnerToken({ imp: 'staff-1' })]) {
      const { result, req } = await guard(token);
      await expect(result).resolves.toBe(true);
      expect(req.superAdmin).toEqual({ id: 'staff-1' });
    }
  });

  it('refuses staff who are not (or no longer) super admins', async () => {
    const { result } = await guard(await sign({ sub: 'staff-1', type: 'super-access' }), { ...SUPER, superAdmin: false });
    await expect(result).rejects.toMatchObject({ status: 401 });
  });
});

describe('SuperAdminService', () => {
  const passwords = (ok: boolean) => ({ verify: jest.fn(async () => ok) }) as unknown as PasswordService;
  const service = (prisma: ReturnType<typeof db>, ok = true) =>
    new SuperAdminService(prisma as unknown as PrismaService, jwt, config, passwords(ok));
  const staffRow = (extra: object = {}) => ({ ...SUPER, name: 'Hayk', email: 'hayk@reserva.am', passwordHash: 'h', mustChangePassword: false, ...extra });

  it('signs in only active super admins, with one answer for every refusal', async () => {
    for (const row of [staffRow({ superAdmin: false }), staffRow({ active: false }), null]) {
      const prisma = db(row as never);
      await expect(service(prisma).login('hayk@reserva.am', 'x')).rejects.toMatchObject({ status: 401 });
    }
    await expect(service(db(staffRow() as never), false).login('hayk@reserva.am', 'wrong')).rejects.toMatchObject({ status: 401 });
  });

  it('issues a session that the partner API refuses — it can only list partners and enter one', async () => {
    const session = await service(db(staffRow() as never)).login('hayk@reserva.am', 'right');
    expect(jwt.decode(session.accessToken)).toMatchObject({ sub: 'staff-1', type: 'super-access' });
    const g = new JwtAuthGuard(httpCtx(null).reflector, jwt, config, db() as unknown as PrismaService);
    await expect(g.canActivate(httpCtx(session.accessToken).ctx)).rejects.toMatchObject({ status: 401 });
  });

  it('enters a partner as its first active admin, writes the visit, and never forces a password change', async () => {
    const prisma = db(staffRow() as never);
    const entry = await service(prisma).enter('staff-1', 'p-2');
    expect(prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { partnerId: 'p-2', role: 'admin', active: true, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    }));
    expect(jwt.decode(entry.accessToken)).toMatchObject({ sub: 'admin-2', partnerId: 'p-2', role: 'admin', type: 'access', imp: 'staff-1' });
    expect(prisma.superAdminVisit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ platformUserId: 'staff-1', partnerId: 'p-2', actingUserId: 'admin-2' }),
    });
    expect(entry.user.mustChangePassword).toBe(false);
  });

  it('refuses a partner without an active admin to act as', async () => {
    const prisma = db(staffRow() as never);
    prisma.user.findFirst.mockResolvedValueOnce(null as never);
    await expect(service(prisma).enter('staff-1', 'p-2')).rejects.toMatchObject({ status: 409 });
  });

  it('refreshes only its own refresh tokens — never a console session’s', async () => {
    const consoleRefresh = await sign({ sub: 'staff-1', type: 'platform-refresh', jti: 'x' }, REFRESH);
    await expect(service(db(staffRow() as never)).refresh(consoleRefresh)).rejects.toMatchObject({ status: 401 });
  });

  it('leaves the session unrotated when renewing inside a removed partner fails', async () => {
    const prisma = db(staffRow() as never);
    const token = await sign({ sub: 'staff-1', type: 'super-refresh', jti: 'y' }, REFRESH);
    prisma.platformRefreshToken.findUnique.mockResolvedValue({ id: 'rt', userId: 'staff-1', revokedAt: null, expiresAt: new Date(Date.now() + 60_000) } as never);
    prisma.partner.findFirst.mockResolvedValueOnce(null as never);
    await expect(service(prisma).refresh(token, 'gone')).rejects.toMatchObject({ status: 404 });
    expect(prisma.platformRefreshToken.update).not.toHaveBeenCalled();
  });
});
