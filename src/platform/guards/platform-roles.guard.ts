import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PlatformRole } from '@prisma/client';
import { PLATFORM_ROLES_KEY } from '../platform.decorators';
import { AppException } from '@/common/errors/app.exception';
import type { PlatformAuthUser } from '../platform.types';

/** Enforces @PlatformRoles(...) on platform routes. Runs after PlatformAuthGuard. */
@Injectable()
export class PlatformRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PlatformRole[]>(PLATFORM_ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = ctx.switchToHttp().getRequest<{ platformUser?: PlatformAuthUser }>().platformUser;
    if (!user) throw AppException.unauthenticated();
    if (!required.includes(user.role)) {
      throw AppException.forbidden('This action requires owner privileges');
    }
    return true;
  }
}
