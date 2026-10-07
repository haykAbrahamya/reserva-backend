import type { IncomingMessage, ServerResponse } from 'node:http';
import { MAX_PULSE_BODY_CHARS } from './pulse-codec';

/** The beacon's path under the global prefix + version (see PulseController). */
export const PULSE_PATH = '/api/v1/public/pulse';

/**
 * Express middleware that reads the beacon's body as a string, for that route
 * only (main.ts mounts it on PULSE_PATH).
 *
 * The tracker posts `text/plain` — a CORS "simple request", so sendBeacon can
 * send it cross-origin with no preflight — and Nest parses only JSON and
 * urlencoded bodies. Mounted before Nest registers its own parsers (they are
 * added at init); since this consumes the stream, they find it already read
 * and skip it whatever the content type.
 *
 * It never fails the request. A body over the limit or a broken stream leaves
 * an empty string, which the endpoint drops with its usual 204 (contract §1:
 * the response never says why). An oversize body is drained, not buffered.
 */
export function pulseBodyReader(limit = MAX_PULSE_BODY_CHARS) {
  return (req: IncomingMessage & { body?: unknown }, _res: ServerResponse, next: () => void) => {
    if (req.method !== 'POST') return next();

    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const settle = (body: string) => {
      if (settled) return;
      settled = true;
      req.body = body;
      next();
    };

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
      else chunks.length = 0;
    });
    req.on('end', () => settle(size <= limit ? Buffer.concat(chunks).toString('utf8') : ''));
    req.on('error', () => settle(''));
  };
}
