import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';
import type { PlatformJwtPayload, PlatformAuthUser } from '../platform.types';

/**
 * Verifies a platform access token and attaches `req.platformUser`. Platform
 * routes are flagged @Public() so the global tenant JwtAuthGuard skips them,
 * then add this guard explicitly. Platform tokens are signed with a distinct
 * type ('platform-access') so a tenant token can never authenticate here.
 */
@Injectable()
export class PlatformAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const token = this.extractToken(req);
    if (!token) throw AppException.unauthenticated();

    let payload: PlatformJwtPayload;
    try {
      payload = await this.jwt.verifyAsync<PlatformJwtPayload>(token, {
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

    if (payload.type !== 'platform-access') {
      throw AppException.unauthenticated('Wrong token type');
    }

    const platformUser: PlatformAuthUser = { id: payload.sub, role: payload.role };
    (req as Request & { platformUser: PlatformAuthUser }).platformUser = platformUser;
    return true;
  }

  private extractToken(req: Request): string | null {
    const header = req.headers.authorization;
    if (!header) return null;
    const [scheme, value] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && value ? value : null;
  }
}
