import type { PlatformRole } from '@prisma/client';

/** Decoded platform JWT access-token payload (no tenant/partner scope). */
export interface PlatformJwtPayload {
  sub: string; // platform user id
  role: PlatformRole;
  type: 'platform-access';
  iat?: number;
  exp?: number;
}

/** The authenticated platform operator attached to each request. */
export interface PlatformAuthUser {
  id: string;
  role: PlatformRole;
}
