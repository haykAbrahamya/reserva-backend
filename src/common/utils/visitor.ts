import { UAParser } from 'ua-parser-js';
import geoip from 'geoip-lite';

/** Parsed User-Agent fields we persist. All optional — parsing can yield nothing. */
export interface ParsedUserAgent {
  deviceType: string | null;
  browser: string | null;
  browserVer: string | null;
  os: string | null;
  osVer: string | null;
}

/** Geo derived from an IP. Null for private/loopback IPs or unknown ranges. */
export interface GeoLocation {
  country: string | null;
  city: string | null;
}

const orNull = (v?: string | null) => {
  const t = v?.trim();
  return t ? t : null;
};

/**
 * Parse a raw User-Agent string into device/browser/os fields. Defensive: any
 * failure (or a missing UA) yields all-null rather than throwing — analytics
 * must never break a request.
 */
export function parseUserAgent(ua?: string | null): ParsedUserAgent {
  if (!ua) return { deviceType: null, browser: null, browserVer: null, os: null, osVer: null };
  try {
    const r = UAParser(ua);
    // ua-parser-js leaves device.type undefined for desktops; normalize to 'desktop'.
    const deviceType = r.device.type ?? 'desktop';
    return {
      deviceType: orNull(deviceType),
      browser: orNull(r.browser.name),
      browserVer: orNull(r.browser.version),
      os: orNull(r.os.name),
      osVer: orNull(r.os.version),
    };
  } catch {
    return { deviceType: null, browser: null, browserVer: null, os: null, osVer: null };
  }
}

/**
 * Resolve a country/city from an IP via the offline geoip-lite DB. Loopback and
 * private ranges return nulls (expected in local dev). Never throws.
 */
export function geoFromIp(ip?: string | null): GeoLocation {
  if (!ip) return { country: null, city: null };
  // req.ip can be an IPv4-mapped IPv6 address (::ffff:1.2.3.4); strip the prefix.
  const clean = ip.replace(/^::ffff:/, '');
  try {
    const geo = geoip.lookup(clean);
    if (!geo) return { country: null, city: null };
    return { country: orNull(geo.country), city: orNull(geo.city) };
  } catch {
    return { country: null, city: null };
  }
}
