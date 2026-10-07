/**
 * Keyset cursor for "newest bookings first": the createdAt and id of the last
 * booking a page ended on. The next page is everything strictly older in
 * (createdAt, id) order — so bookings that arrive while someone is paging
 * land before the first page and never shift, duplicate or skip a later one,
 * which an OFFSET would.
 *
 * Opaque to clients: base64url of `<createdAt ISO>|<id>`.
 */
export interface BookingCursor {
  createdAt: Date;
  id: string;
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;
/** Booking ids are app-generated uuids (UUIDv7). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A cursor is ~70 characters; anything far longer is not one of ours. */
const MAX_CURSOR_CHARS = 200;

export function encodeBookingCursor(c: BookingCursor): string {
  return Buffer.from(`${c.createdAt.toISOString()}|${c.id}`, 'utf8').toString('base64url');
}

/** The cursor, or null when the text is not one this API issued. */
export function decodeBookingCursor(raw: string): BookingCursor | null {
  if (!raw || raw.length > MAX_CURSOR_CHARS || raw.length % 4 === 1 || !BASE64URL.test(raw)) {
    return null;
  }
  const parts = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  if (parts.length !== 2) return null;
  const [iso, id] = parts;
  const createdAt = new Date(iso);
  // Exactly the ISO form we write (so the instant is the one that was sent).
  if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== iso || !UUID.test(id)) {
    return null;
  }
  return { createdAt, id };
}
