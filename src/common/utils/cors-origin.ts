/**
 * Shared CORS origin check used by both the HTTP server (main.ts) and the
 * WebSocket gateway, so browser and socket connections apply the SAME rule:
 * an explicit allow-list entry, OR any subdomain of CORS_BASE_DOMAIN over https.
 * Single source of truth — no divergence between REST and WS.
 */
export function buildOriginChecker(allowedOrigins: string[], baseDomain: string) {
  const baseDomainRe = baseDomain
    ? new RegExp(`^https://([a-z0-9-]+\\.)*${baseDomain.replace(/\./g, '\\.')}$`, 'i')
    : null;

  return (origin: string | undefined): boolean => {
    // Non-browser clients (curl, server-to-server) send no Origin — allow.
    if (!origin) return true;
    return allowedOrigins.includes(origin) || (baseDomainRe?.test(origin) ?? false);
  };
}
