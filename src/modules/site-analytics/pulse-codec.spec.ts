import { randomBytes } from 'node:crypto';
import {
  DEFAULT_PULSE_KEY,
  MAX_PULSE_BODY_CHARS,
  PULSE_VERSION,
  openPulse,
  parsePulseKey,
  sealPulse,
} from './pulse-codec';

/**
 * The wire format is shared with the public site's tracker, which is built and
 * deployed separately. These pin it to the contract's known-answer vector so
 * the two sides cannot drift apart unnoticed, and pin the "every failure is a
 * silent null" rule the 204-always endpoint depends on.
 */
const KEY = parsePulseKey(DEFAULT_PULSE_KEY)!;
const KAT = {
  nonce: Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
  plaintext: '{"v":1,"sid":"s","vid":"v","e":[]}',
  wire: 'AQABAgMEBQYHCAkKCwy7DbJiucJNtmpVSjQyNDk4sJ--G3ho5_aay12zXUCvydiL8C5FPxbGUJOafqSa80e0',
};

/** The wire string with one byte XOR-ed, re-encoded. */
const flipByte = (wire: string, index: number) => {
  const bytes = Buffer.from(wire, 'base64url');
  bytes[index < 0 ? bytes.length + index : index] ^= 0x01;
  return bytes.toString('base64url');
};

describe('pulse codec — contract known-answer vector', () => {
  it('decodes the vector to the exact plaintext', () => {
    const opened = openPulse(KAT.wire, KEY);
    expect(opened).toEqual({ v: 1, sid: 's', vid: 'v', e: [] });
    expect(JSON.stringify(opened)).toBe(KAT.plaintext);
  });

  it('seals the vector to the exact wire string', () => {
    expect(sealPulse(KAT.plaintext, KEY, KAT.nonce)).toBe(KAT.wire);
  });

  it('round-trips with a random nonce', () => {
    const payload = {
      v: 1,
      sid: 'a',
      vid: 'b',
      e: [{ n: 'page_view', x: { pt: 'home' } }],
      note: 'Երևան · Ереван',
    };
    expect(openPulse(sealPulse(JSON.stringify(payload), KEY), KEY)).toEqual(payload);
  });
});

describe('pulse codec — every failure is a silent null', () => {
  it('rejects a single flipped bit anywhere: nonce, ciphertext or tag', () => {
    const size = Buffer.from(KAT.wire, 'base64url').length;
    for (const index of [1, 12, 13, 20, size - 17, size - 16, size - 1]) {
      expect(openPulse(flipByte(KAT.wire, index), KEY)).toBeNull();
    }
  });

  it('rejects an unknown version byte', () => {
    expect(openPulse(flipByte(KAT.wire, 0), KEY)).toBeNull(); // 0x01 → 0x00
    // A correctly sealed payload that merely announces another version.
    expect(openPulse(sealPulse(KAT.plaintext, KEY, KAT.nonce, 0x02), KEY)).toBeNull();
    expect(PULSE_VERSION).toBe(0x01);
  });

  it('rejects the wrong key', () => {
    expect(openPulse(KAT.wire, randomBytes(32))).toBeNull();
  });

  it('rejects truncated payloads', () => {
    for (const cut of [1, 2, 4, 16, 40, KAT.wire.length - 2]) {
      expect(openPulse(KAT.wire.slice(0, KAT.wire.length - cut), KEY)).toBeNull();
    }
    expect(openPulse(KAT.wire.slice(0, 20), KEY)).toBeNull();
  });

  it('rejects garbage and non-base64url text', () => {
    for (const body of [
      '',
      '   ',
      'hello',
      'not base64 at all!',
      `${KAT.wire}=`, // padding is not base64url-without-padding
      KAT.wire.replace(/-/g, '+').replace(/_/g, '/'), // standard base64 alphabet
      `${KAT.wire}AAA`, // 4n+1 characters (89) cannot be base64
      '{"v":1,"sid":"s","vid":"v","e":[]}', // plaintext, unsealed
    ]) {
      expect(openPulse(body, KEY)).toBeNull();
    }
  });

  it('rejects bodies that are not a string', () => {
    for (const body of [undefined, null, 42, {}, [], Buffer.from(KAT.wire)]) {
      expect(openPulse(body, KEY)).toBeNull();
    }
  });

  it('rejects a payload that decrypts but is not JSON', () => {
    expect(openPulse(sealPulse('definitely { not json', KEY), KEY)).toBeNull();
  });

  it('rejects an oversize body even when it is correctly sealed', () => {
    const sealedSize = (chars: number) =>
      sealPulse(JSON.stringify({ pad: 'x'.repeat(chars) }), KEY);
    // Grow until the encoded body just crosses the limit.
    let pad = Math.floor((MAX_PULSE_BODY_CHARS * 3) / 4) - 64;
    while (sealedSize(pad).length <= MAX_PULSE_BODY_CHARS) pad += 1;
    const justOver = sealedSize(pad);
    const justUnder = sealedSize(pad - 3);

    expect(justOver.length).toBeGreaterThan(MAX_PULSE_BODY_CHARS);
    expect(openPulse(justOver, KEY)).toBeNull();
    expect(justUnder.length).toBeLessThanOrEqual(MAX_PULSE_BODY_CHARS);
    expect(openPulse(justUnder, KEY)).toEqual({ pad: 'x'.repeat(pad - 3) });
  });
});

describe('parsePulseKey', () => {
  it('accepts a base64url 32-byte key', () => {
    expect(parsePulseKey(DEFAULT_PULSE_KEY)?.length).toBe(32);
    expect(parsePulseKey(` ${DEFAULT_PULSE_KEY} `)?.length).toBe(32);
  });

  it('rejects anything else', () => {
    for (const key of [
      undefined,
      null,
      '',
      'short',
      randomBytes(16).toString('base64url'),
      `${DEFAULT_PULSE_KEY}AAAA`,
      '!'.repeat(43),
    ]) {
      expect(parsePulseKey(key)).toBeNull();
    }
  });
});
