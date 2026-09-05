import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { ProfessionalJwtPayload, ProfessionalAuthUser } from '../professional.types';

/**
 * Attaches `req.professional` IF a valid professional token is present, and
 * never refuses the request.
 *
 * For routes that are genuinely public but behave slightly better when they
 * know who is calling — applying to a listing being the only one today.
 * Applying has never needed an account and must not start needing one; a signed
 * in professional simply gets the application filed under their name so it
 * shows up in their own history.
 *
 * Deliberately silent on every failure. An expired or malformed token here is
 * not an error to report — it means "anonymous", which is a perfectly valid way
 * to use this endpoint. Throwing would turn a cosmetic feature into a way to
 * break applying for anyone whose session happened to lapse mid-form.
 */
@Injectable()
export class OptionalProfessionalGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return true;

    const token = header.slice(7).trim();
    if (!token) return true;

    try {
      const payload = await this.jwt.verifyAsync<ProfessionalJwtPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
      // The type check still matters: a partner token presented here must not
      // be read as a professional, even though nothing is refused either way.
      if (payload.type === 'professional-access') {
        const professional: ProfessionalAuthUser = { id: payload.sub };
        (req as Request & { professional?: ProfessionalAuthUser }).professional = professional;
      }
    } catch {
      /* anonymous — see above */
    }
    return true;
  }
}
