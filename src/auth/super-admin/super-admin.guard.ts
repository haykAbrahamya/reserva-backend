import { CanActivate, ExecutionContext, Injectable, createParamDecorator } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { PrismaService } from '@/prisma/prisma.service';
import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';
import type { JwtPayload } from '../auth.types';
import { isSuperAdmin, type SuperAccessPayload } from './super-admin.service';

/** The super admin making the request. */
export interface SuperAdminPrincipal {
  id: string;
}

/**
 * Guards the super admin's own endpoints (listing partners, entering one).
 * Takes the session's `super-access` token, or — once inside a partner — the
 * partner token it carries, which names the super admin in `imp`. Any other
 * token is refused: a partner's own login, however privileged, never carries
 * `imp`, so it cannot get here. The platform user is then read fresh from the
 * database and must still be an active super admin.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) throw AppException.unauthenticated();

    let payload: SuperAccessPayload | JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<SuperAccessPayload | JwtPayload>(token, {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      });
    } catch (e) {
      const expired = e instanceof Error && e.name === 'TokenExpiredError';
      throw new AppException(
        expired ? ErrorCode.TOKEN_EXPIRED : ErrorCode.TOKEN_INVALID,
        expired ? 'Access token expired' : 'Invalid access token',
        401,
      );
    }

    const staffId =
      payload.type === 'super-access' ? payload.sub
      : payload.type === 'access' ? payload.imp
      : undefined;
    if (typeof staffId !== 'string' || !staffId) throw AppException.unauthenticated('Wrong token type');

    const staff = await this.prisma.platformUser.findUnique({
      where: { id: staffId },
      select: { id: true, active: true, deletedAt: true, superAdmin: true },
    });
    if (!staff || !isSuperAdmin(staff)) {
      throw new AppException(ErrorCode.TOKEN_INVALID, 'Super admin access was withdrawn', 401);
    }

    (req as Request & { superAdmin: SuperAdminPrincipal }).superAdmin = { id: staff.id };
    return true;
  }
}

/** Injects the super admin behind the request: `@CurrentSuperAdmin() staff`. */
export const CurrentSuperAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SuperAdminPrincipal =>
    ctx.switchToHttp().getRequest<Request & { superAdmin: SuperAdminPrincipal }>().superAdmin,
);
