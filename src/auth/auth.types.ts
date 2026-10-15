import type { UserRole } from '@prisma/client';

/** Decoded JWT access-token payload. */
export interface JwtPayload {
  sub: string; // user id
  partnerId: string;
  role: UserRole;
  locationId: string | null;
  type: 'access';
  /**
   * Set only on a super admin's session (auth/super-admin): the platform user
   * acting as this partner's admin. Re-checked against the database on every
   * request, so withdrawing the right takes effect at once.
   */
  imp?: string;
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
  /** The super admin (platform user id) signed in as this partner's admin, if one is. */
  impersonatedBy?: string;
}
