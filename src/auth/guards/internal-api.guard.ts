import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AppException } from '@/common/errors/app.exception';

/**
 * Guards internal-only endpoints (partner provisioning) used by the
 * internal-backoffice service. Authenticated by a shared secret header
 * `x-internal-key` rather than a tenant JWT. Routes using this must be @Public()
 * so the JWT guard is skipped, then add this guard explicitly.
 */
@Injectable()
export class InternalApiGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const expected = this.config.get<string>('INTERNAL_API_KEY');
    if (!expected) throw AppException.forbidden('Internal API is not configured');

    const req = ctx.switchToHttp().getRequest<Request>();
    const provided = req.headers['x-internal-key'];
    if (provided !== expected) throw AppException.forbidden('Invalid internal API key');
    return true;
  }
}
