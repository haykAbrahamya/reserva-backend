import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';

/**
 * Handles a partner can never own.
 *
 * A partner's slug is also its address — `<slug>.reserva.am` serves its public
 * page — so a slug naming one of Reserva's own sites would sit on that site's
 * address: a salon called "tools" would claim tools.reserva.am. The list is the
 * subdomains Reserva serves today, the ones infrastructure conventionally takes,
 * and the product areas likely to get an address of their own.
 *
 * It is checked only when a slug is NEW or CHANGES — never against a partner's
 * existing one — so growing this list can never lock a live partner out of
 * saving its settings. `demo` is deliberately absent: it is a real partner.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  // Reserva's own sites and APIs
  'www', 'app', 'api', 'admin', 'backoffice', 'console', 'internal', 'tools', 'vacancies', 'jobs',
  // Infrastructure
  'cdn', 'static', 'assets', 'media', 'uploads', 'img',
  'mail', 'email', 'smtp', 'imap', 'webmail', 'mx', 'ns1', 'ns2', 'ftp',
  'status', 'jenkins', 'ci',
  // Environments
  'dev', 'staging', 'stage', 'test', 'beta',
  // Product areas likely to get an address of their own
  'help', 'support', 'docs', 'blog',
  'auth', 'login', 'signup', 'account', 'accounts', 'dashboard',
  'pay', 'payments', 'billing',
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.trim().toLowerCase());
}

/**
 * Refuse a reserved handle with the same conflict a taken one gets: to the
 * person choosing it, "reserved" and "taken" mean the same thing — pick
 * another — and every client already shows SLUG_TAKEN on the slug field.
 */
export function assertSlugNotReserved(slug: string): void {
  if (isReservedSlug(slug)) {
    throw AppException.conflict(ErrorCode.SLUG_TAKEN, `The handle "${slug}" is reserved`);
  }
}
