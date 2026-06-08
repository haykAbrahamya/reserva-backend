import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { PlatformRole } from '@prisma/client';
import type { PlatformAuthUser } from './platform.types';

/** Restricts a platform route to the given role(s). Used with PlatformRolesGuard. */
export const PLATFORM_ROLES_KEY = 'platformRoles';
export const PlatformRoles = (...roles: PlatformRole[]) =>
  SetMetadata(PLATFORM_ROLES_KEY, roles);

/** Injects the authenticated platform operator: `@CurrentPlatformUser() u`. */
export const CurrentPlatformUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PlatformAuthUser => {
    const req = ctx.switchToHttp().getRequest();
    return req.platformUser as PlatformAuthUser;
  },
);
