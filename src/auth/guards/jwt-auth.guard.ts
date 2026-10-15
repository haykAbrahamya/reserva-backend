import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { PrismaService } from '@/prisma/prisma.service';
import { IS_PUBLIC_KEY, NO_SUPER_ADMIN_KEY } from '../decorators';
import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';
import type { JwtPayload, AuthUser } from '../auth.types';

/**
 * Verifies the Bearer access token and attaches `req.user`. Routes flagged
 * @Public() skip verification. Registered globally (see AuthModule), so every
 * route is protected by default — secure-by-default.
 *
 * A super admin's session (auth/super-admin) is an ordinary partner token
 * that also names the platform user behind it (`imp`). That user is looked up
 * on every request: once their super admin right is withdrawn, or their
 * account disabled, the session stops working on the next call — it does not
 * wait for the token to expire.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const token = this.extractToken(req);
    if (!token) throw AppException.unauthenticated();

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token, {
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

    if (payload.type !== 'access') throw AppException.unauthenticated('Wrong token type');
    // Every query is scoped by these. A token without them must never reach a
    // handler: `where: { partnerId: undefined }` would match every partner.
    if (typeof payload.sub !== 'string' || !payload.sub || typeof payload.partnerId !== 'string' || !payload.partnerId) {
      throw AppException.unauthenticated('Invalid access token');
    }

    if (payload.imp !== undefined) await this.assertSuperAdmin(payload.imp);

    const user: AuthUser = {
      id: payload.sub,
      partnerId: payload.partnerId,
      role: payload.role,
      locationId: payload.locationId,
      ...(payload.imp ? { impersonatedBy: payload.imp } : {}),
    };

    if (user.impersonatedBy) {
      const refused = this.reflector.getAllAndOverride<boolean>(NO_SUPER_ADMIN_KEY, [
        ctx.getHandler(),
        ctx.getClass(),
      ]);
      if (refused) {
        throw new AppException(
          ErrorCode.NOT_AS_SUPER_ADMIN,
          "Only the partner's own team can do this — not a super admin signed in as them",
          403,
        );
      }
    }

    (req as Request & { user: AuthUser }).user = user;
    return true;
  }

  /** The platform user behind a super admin session must still be an active super admin. */
  private async assertSuperAdmin(platformUserId: unknown): Promise<void> {
    const staff =
      typeof platformUserId === 'string' && platformUserId
        ? await this.prisma.platformUser.findUnique({
            where: { id: platformUserId },
            select: { active: true, deletedAt: true, superAdmin: true },
          })
        : null;
    if (!staff || !staff.active || staff.deletedAt || !staff.superAdmin) {
      throw new AppException(ErrorCode.TOKEN_INVALID, 'Super admin access was withdrawn', 401);
    }
  }

  private extractToken(req: Request): string | null {
    const header = req.headers.authorization;
    if (!header) return null;
    const [scheme, value] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && value ? value : null;
  }
}
