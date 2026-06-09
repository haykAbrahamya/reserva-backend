import * as Sentry from '@sentry/node';

let enabled = false;

/**
 * Initialize Sentry error monitoring. No-op when SENTRY_DSN is unset (dev/local
 * stay clean). Call once at the very start of bootstrap, before app creation.
 */
export function initSentry(dsn?: string, environment?: string): void {
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: environment || 'production',
    // We only report explicitly (5xx from the exception filter), so keep
    // performance tracing off to stay well within the free tier.
    tracesSampleRate: 0,
    // Strip anything sensitive before an event leaves the server.
    beforeSend(event) {
      scrubSensitive(event);
      return event;
    },
  });
  enabled = true;
}

export function sentryEnabled(): boolean {
  return enabled;
}

/** Report an unexpected (5xx / unhandled) error with request context. */
export function reportException(
  error: unknown,
  context: { method?: string; url?: string; partnerId?: string; userId?: string },
): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    if (context.method && context.url) {
      scope.setTag('http.method', context.method);
      scope.setTag('http.route', context.url);
    }
    if (context.partnerId) scope.setTag('partnerId', context.partnerId);
    if (context.userId) scope.setUser({ id: context.userId });
    Sentry.captureException(error);
  });
}

/** Remove auth headers / secret-looking fields from outgoing events. */
function scrubSensitive(event: Sentry.ErrorEvent): void {
  const headers = event.request?.headers as Record<string, unknown> | undefined;
  if (headers) {
    delete headers['authorization'];
    delete headers['cookie'];
    delete headers['x-internal-key'];
  }
  // Never ship request bodies (may contain passwords/tokens/PII).
  if (event.request) delete event.request.data;
}
