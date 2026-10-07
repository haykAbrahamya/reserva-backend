import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Wire format of POST /public/pulse — the public site's analytics beacon:
 *
 *   base64url( version (1 byte) | nonce (12 bytes) | ciphertext | tag (16 bytes) )
 *
 * ChaCha20-Poly1305 (RFC 8439) with the ASCII bytes of `reserva.pulse.v1` as
 * additional authenticated data; the plaintext is the batch JSON.
 *
 * The key ships inside the public JS bundle, so this is obfuscation plus tamper
 * rejection, not secrecy. What actually protects the data is the schema
 * validation that runs on whatever this returns.
 *
 * Pure functions. Every failure — malformed text, an unknown version, a single
 * flipped bit, bad JSON — returns null instead of throwing, and the cases are
 * indistinguishable to the caller on purpose: the endpoint answers 204 to all
 * of them and must never reveal why a payload was dropped.
 */

/** Version byte of the current format; it selects key K1. */
export const PULSE_VERSION = 0x01;

/** Additional authenticated data bound into every tag. */
export const PULSE_AAD = Buffer.from('reserva.pulse.v1', 'ascii');

/**
 * Default K1 (base64url, 32 bytes). Public by design — the client bundles the
 * same value. `SITE_PULSE_KEY` overrides it, as `VITE_SITE_PULSE_KEY` does on
 * the client; the two must change together.
 */
export const DEFAULT_PULSE_KEY = 'gHGgXRZFRUzCXtcUn1UiOQdJI4F_7Hfb_PeG0HjYdz4';

/** Largest encoded body accepted (contract: ≤ 64 KB). */
export const MAX_PULSE_BODY_CHARS = 64 * 1024;

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
/** Strict base64url alphabet, no padding — Buffer.from would silently skip anything else. */
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** Decode a base64url key; null unless it is exactly 32 bytes. */
export function parsePulseKey(encoded: string | null | undefined): Buffer | null {
  const text = encoded?.trim();
  if (!text || !BASE64URL.test(text)) return null;
  const key = Buffer.from(text, 'base64url');
  return key.length === KEY_BYTES ? key : null;
}

/**
 * Seal a plaintext the way the client does. The server only ever opens; this
 * is the other half of the format, for tests and tooling. `nonce` is random
 * unless given (a fixed one exists only to reproduce the contract's vector).
 */
export function sealPulse(
  plaintext: string,
  key: Buffer,
  nonce: Buffer = randomBytes(NONCE_BYTES),
  version = PULSE_VERSION,
): string {
  const cipher = createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: TAG_BYTES });
  const data = Buffer.from(plaintext, 'utf8');
  cipher.setAAD(PULSE_AAD, { plaintextLength: data.length });
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([Buffer.from([version]), nonce, ciphertext, cipher.getAuthTag()]).toString(
    'base64url',
  );
}

/**
 * Decrypt one pulse body and parse its JSON. Returns the parsed value — still
 * untrusted: it goes through the batch schema next — or null on any failure.
 */
export function openPulse(body: unknown, key: Buffer): unknown {
  try {
    if (typeof body !== 'string') return null;
    const text = body.trim();
    // A length of 4n+1 cannot be base64 of anything; reject it rather than
    // let the decoder drop the stray character.
    if (
      !text ||
      text.length > MAX_PULSE_BODY_CHARS ||
      text.length % 4 === 1 ||
      !BASE64URL.test(text)
    ) {
      return null;
    }

    const bytes = Buffer.from(text, 'base64url');
    // Smallest possible sealed payload: version + nonce + 1 byte + tag.
    if (bytes.length < 1 + NONCE_BYTES + 1 + TAG_BYTES || bytes[0] !== PULSE_VERSION) return null;

    const nonce = bytes.subarray(1, 1 + NONCE_BYTES);
    const ciphertext = bytes.subarray(1 + NONCE_BYTES, bytes.length - TAG_BYTES);
    const tag = bytes.subarray(bytes.length - TAG_BYTES);

    const decipher = createDecipheriv('chacha20-poly1305', key, nonce, {
      authTagLength: TAG_BYTES,
    });
    // plaintextLength is required by the typings; Node only reads it for CCM.
    decipher.setAAD(PULSE_AAD, { plaintextLength: ciphertext.length });
    decipher.setAuthTag(tag);
    // final() throws when the tag does not verify — any tampering lands here.
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8')) as unknown;
  } catch {
    return null;
  }
}
