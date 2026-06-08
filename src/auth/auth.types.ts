import type { UserRole } from '@prisma/client';

/** Decoded JWT access-token payload. */
export interface JwtPayload {
  sub: string; // user id
  partnerId: string;
  role: UserRole;
  locationId: string | null;
  type: 'access';
  iat?: number;
  exp?: number;
}

/** The authenticated principal attached to each request as `req.user`. */
export interface AuthUser {
  id: string;
  partnerId: string;
  role: UserRole;
  /** Managers are scoped to one branch; admins have null. */
  locationId: string | null;
}
