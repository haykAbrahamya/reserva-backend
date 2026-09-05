/**
 * Decoded professional JWT access-token payload.
 *
 * No partnerId and no role. That absence is the point: a professional belongs
 * to no organization and has no standing inside one, so there is nothing here
 * a tenant-scoped guard could mistake for authority.
 */
export interface ProfessionalJwtPayload {
  sub: string; // professional id
  type: 'professional-access';
  iat?: number;
  exp?: number;
}

/** The authenticated professional attached to each request as `req.professional`. */
export interface ProfessionalAuthUser {
  id: string;
}
