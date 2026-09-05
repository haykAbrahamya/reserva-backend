import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';
import type { ProfessionalJwtPayload, ProfessionalAuthUser } from '../professional.types';

/**
 * Verifies a professional access token and attaches `req.professional`.
 *
 * The third realm, built exactly like the platform one: routes are flagged
 * @Public() so the global tenant JwtAuthGuard skips them, then add this guard
 * explicitly.
 *
 * The type check below is the whole security boundary between the three kinds
 * of principal. Professional tokens are signed `professional-access`, partner
 * tokens `access`, platform tokens `platform-access` — all with the same
 * secret, so without this check a token minted for a job seeker on a public
 * website would authenticate against a salon's data. Every realm refuses the
 * other two by type, and none of them is allowed to skip it.
 */
@Injectable()
export class ProfessionalAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const token = this.extractToken(req);
    if (!token) throw AppException.unauthenticated();

    let payload: ProfessionalJwtPayload;
    try {
      payload = await this.jwt.verifyAsync<ProfessionalJwtPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
    } catch (e) {
      const expired = e instanceof Error && e.name === 'TokenExpiredError';
      throw new AppException(
        expired ? ErrorCode.TOKEN_EXPIRED : ErrorCode.TOKEN_INVALID,
        expired ? 'Access token expired' : 'Invalid access token',
        401,
      );
    }

    if (payload.type !== 'professional-access') {
      throw AppException.unauthenticated('Wrong token type');
    }

    const professional: ProfessionalAuthUser = { id: payload.sub };
    (req as Request & { professional?: ProfessionalAuthUser }).professional = professional;
    return true;
  }

  private extractToken(req: Request): string | null {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    return header.slice(7).trim() || null;
  }
}
