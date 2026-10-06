/**
 * Generated imagery for the demo tenants.
 *
 * Same reasoning as prisma/seed-professionals.ts: `sharp` is already a
 * dependency, a seed has no business downloading stock photos, and a real
 * photo would put a stranger's face in a fixture. These are flat illustrated
 * scenes in each brand's own colours, at the dimensions the real upload
 * pipeline produces, so cards, galleries and the before/after slider can be
 * judged against something that looks like content rather than grey boxes.
 *
 * Files are written exactly where ImageStorageService writes uploads —
 * `<UPLOADS_DIR>/<partnerId>/<prefix>-<uuid>.webp` — and referenced by the same
 * public URL shape, so the backoffice can delete or reorder them like any
 * uploaded image.
 */
import sharp from 'sharp';
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { newId } from '../../src/common/ids';
import { rng } from './random';

const uploadsDir = () => resolve(process.env.UPLOADS_DIR || 'uploads');
const publicBase = () => process.env.UPLOADS_PUBLIC_URL || '/uploads';

/** Render an SVG to WebP under the scope's upload folder; returns its public URL. */
export async function storeSvg(scope: string, svg: string, prefix: string, quality = 82): Promise<string> {
  const dir = join(uploadsDir(), scope);
  await mkdir(dir, { recursive: true });
  const file = `${prefix}-${newId()}.webp`;
  await sharp(Buffer.from(svg)).webp({ quality }).toFile(join(dir, file));
  return `${publicBase()}/${scope}/${file}`;
}

/** Remove everything the seed (or anyone) uploaded for one partner. */
export async function removeUploads(scope: string): Promise<void> {
  await rm(join(uploadsDir(), scope), { recursive: true, force: true });
}

// ── Colour ────────────────────────────────────────────────────

type Hsl = [number, number, number];

function hexToHsl(hex: string): Hsl {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [Math.round(h * 60), Math.round(s * 100), Math.round(l * 100)];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const hsl = (h: number, s: number, l: number, a = 1) =>
  a === 1
    ? `hsl(${Math.round(h)}, ${Math.round(clamp(s, 0, 100))}%, ${Math.round(clamp(l, 0, 100))}%)`
    : `hsla(${Math.round(h)}, ${Math.round(clamp(s, 0, 100))}%, ${Math.round(clamp(l, 0, 100))}%, ${a})`;

/** A small palette derived from one brand accent. */
export interface Palette {
  hue: number;
  sat: number;
  accent: string;
  deep: string;
  light: string;
  wall: string;
  wallShade: string;
  floor: string;
  ink: string;
}

export function paletteFrom(accent: string): Palette {
  const [h, s, l] = hexToHsl(accent);
  const sat = Math.max(s, 18);
  return {
    hue: h,
    sat,
    accent,
    deep: hsl(h, sat * 0.85, Math.max(12, l - 24)),
    light: hsl(h, Math.min(65, sat), Math.min(90, l + 30)),
    wall: hsl(h, Math.min(28, sat * 0.4), 91),
    wallShade: hsl(h, Math.min(24, sat * 0.35), 82),
    floor: hsl(h + 18, Math.min(22, sat * 0.3), 58),
    ink: hsl(h, Math.min(35, sat * 0.5), 16),
  };
}

// ── Logo ──────────────────────────────────────────────────────

export function logoSvg(text: string, accent: string, style: 'serif' | 'sans' | 'italic' = 'serif'): string {
  const p = paletteFrom(accent);
  const size = text.length === 1 ? 300 : text.length === 2 ? 210 : 150;
  const family =
    style === 'sans' ? "'Segoe UI', 'Helvetica Neue', Arial, sans-serif" : "Georgia, 'Times New Roman', serif";
  const weight = style === 'sans' ? 800 : 700;
  const slant = style === 'italic' ? ' font-style="italic"' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${p.accent}"/>
      <stop offset="1" stop-color="${p.deep}"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="120" fill="url(#g)"/>
  <circle cx="430" cy="70" r="190" fill="#fff" fill-opacity="0.07"/>
  <circle cx="60" cy="470" r="150" fill="#000" fill-opacity="0.08"/>
  <text x="256" y="${Math.round(256 + size * 0.34)}" text-anchor="middle" font-family="${family}"
    font-size="${size}" font-weight="${weight}"${slant} fill="#fff" letter-spacing="${text.length > 1 ? -6 : 0}">${esc(text)}</text>
</svg>`;
}

// ── Interior "photos" (gallery) ───────────────────────────────

export type InteriorMotif = 'room' | 'reception' | 'mirror' | 'facade' | 'lounge' | 'detail';

export function interiorSvg(
  motif: InteriorMotif,
  accent: string,
  seed: string,
  opts: { w?: number; h?: number; sign?: string } = {},
): string {
  const w = opts.w ?? 1200;
  const h = opts.h ?? 900;
  const p = paletteFrom(accent);
  const r = rng(seed);
  const floorY = Math.round(h * 0.72);

  const defs = `<defs>
    <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${p.wall}"/><stop offset="1" stop-color="${p.wallShade}"/>
    </linearGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${p.floor}"/><stop offset="1" stop-color="${hsl(p.hue + 18, 18, 40)}"/>
    </linearGradient>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="hsl(205, 70%, 82%)"/><stop offset="1" stop-color="hsl(40, 80%, 90%)"/>
    </linearGradient>
    <linearGradient id="acc" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${p.accent}"/><stop offset="1" stop-color="${p.deep}"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="30%" r="70%">
      <stop offset="0" stop-color="#fff" stop-opacity="0.35"/><stop offset="1" stop-color="#000" stop-opacity="0.18"/>
    </radialGradient>
    <filter id="blur"><feGaussianBlur stdDeviation="${Math.round(w / 45)}"/></filter>
  </defs>`;

  const plant = (x: number, y: number, s: number) => `
    <rect x="${x - 34 * s}" y="${y - 70 * s}" width="${68 * s}" height="${70 * s}" rx="${10 * s}" fill="${p.ink}" fill-opacity="0.85"/>
    <ellipse cx="${x - 30 * s}" cy="${y - 120 * s}" rx="${26 * s}" ry="${62 * s}" fill="hsl(140, 35%, 34%)" transform="rotate(-25 ${x - 30 * s} ${y - 120 * s})"/>
    <ellipse cx="${x + 28 * s}" cy="${y - 128 * s}" rx="${24 * s}" ry="${66 * s}" fill="hsl(150, 38%, 40%)" transform="rotate(22 ${x + 28 * s} ${y - 128 * s})"/>
    <ellipse cx="${x}" cy="${y - 150 * s}" rx="${22 * s}" ry="${70 * s}" fill="hsl(135, 32%, 30%)"/>`;

  let scene = '';
  switch (motif) {
    case 'room': {
      const wx = w * 0.56;
      scene = `
        <rect width="${w}" height="${floorY}" fill="url(#wall)"/>
        <rect y="${floorY}" width="${w}" height="${h - floorY}" fill="url(#floor)"/>
        <path d="M${wx} ${floorY - 40} V${h * 0.28} a${w * 0.14} ${w * 0.14} 0 0 1 ${w * 0.28} 0 V${floorY - 40} Z" fill="url(#sky)" stroke="#fff" stroke-width="14"/>
        <line x1="${wx + w * 0.14}" y1="${h * 0.16}" x2="${wx + w * 0.14}" y2="${floorY - 40}" stroke="#fff" stroke-width="10"/>
        <rect x="${w * 0.12}" y="${floorY - 230}" width="${w * 0.2}" height="150" rx="40" fill="url(#acc)"/>
        <rect x="${w * 0.1}" y="${floorY - 110}" width="${w * 0.24}" height="70" rx="30" fill="url(#acc)"/>
        <rect x="${w * 0.21}" y="${floorY - 40}" width="22" height="60" fill="${p.ink}"/>
        <ellipse cx="${w * 0.22}" cy="${floorY + 24}" rx="${w * 0.09}" ry="16" fill="${p.ink}" fill-opacity="0.8"/>
        ${plant(w * 0.92, floorY + 10, 1.15)}`;
      break;
    }
    case 'reception': {
      scene = `
        <rect width="${w}" height="${floorY}" fill="url(#wall)"/>
        <rect y="${floorY}" width="${w}" height="${h - floorY}" fill="url(#floor)"/>
        <rect x="${w * 0.36}" y="${h * 0.14}" width="${w * 0.28}" height="${h * 0.2}" rx="12" fill="${p.light}" stroke="${p.deep}" stroke-width="10"/>
        <text x="${w / 2}" y="${h * 0.27}" text-anchor="middle" font-family="Georgia, serif" font-size="${Math.round(h * 0.07)}" fill="${p.deep}">${esc(opts.sign ?? '')}</text>
        ${[0.3, 0.5, 0.7].map((fx) => `
          <line x1="${w * fx}" y1="0" x2="${w * fx}" y2="${h * 0.42}" stroke="${p.ink}" stroke-width="4"/>
          <path d="M${w * fx - 46} ${h * 0.47} a46 46 0 0 1 92 0 Z" fill="${p.accent}"/>
          <ellipse cx="${w * fx}" cy="${h * 0.5}" rx="70" ry="22" fill="#fff8d6" fill-opacity="0.55" filter="url(#blur)"/>`).join('')}
        <rect x="${w * 0.2}" y="${floorY - 190}" width="${w * 0.6}" height="210" rx="26" fill="${p.ink}"/>
        <rect x="${w * 0.2}" y="${floorY - 190}" width="${w * 0.6}" height="38" rx="18" fill="url(#acc)"/>
        ${plant(w * 0.1, floorY + 6, 1)}`;
      break;
    }
    case 'mirror': {
      const cx = w * 0.4;
      const cy = h * 0.38;
      const rr = Math.min(w, h) * 0.24;
      const bottles = Array.from({ length: 6 }, (_, i) => {
        const bh = r.int(60, 140);
        const bx = w * 0.68 + i * 46;
        return `<rect x="${bx}" y="${floorY - 220 - bh}" width="34" height="${bh}" rx="10" fill="${i % 2 ? p.accent : p.light}" stroke="${p.deep}" stroke-width="3"/>`;
      }).join('');
      scene = `
        <rect width="${w}" height="${h}" fill="url(#wall)"/>
        <circle cx="${cx}" cy="${cy}" r="${rr + 22}" fill="${p.deep}"/>
        <circle cx="${cx}" cy="${cy}" r="${rr}" fill="url(#sky)"/>
        <path d="M${cx - rr * 0.6} ${cy - rr * 0.2} L${cx + rr * 0.1} ${cy - rr * 0.85}" stroke="#fff" stroke-opacity="0.6" stroke-width="18" stroke-linecap="round"/>
        <rect x="${w * 0.64}" y="${floorY - 220}" width="${w * 0.3}" height="16" rx="6" fill="${p.ink}"/>
        ${bottles}
        <rect x="${w * 0.08}" y="${floorY - 20}" width="${w * 0.84}" height="${h - floorY + 20}" fill="url(#floor)"/>
        <rect x="${w * 0.2}" y="${floorY - 70}" width="${w * 0.4}" height="60" rx="14" fill="url(#acc)"/>`;
      break;
    }
    case 'facade': {
      const stripes = Array.from({ length: 9 }, (_, i) =>
        `<path d="M${w * 0.18 + i * (w * 0.64) / 9} ${h * 0.34} h${(w * 0.64) / 9} l-12 54 h-${(w * 0.64) / 9 - 24} Z" fill="${i % 2 ? '#fff' : p.accent}"/>`,
      ).join('');
      scene = `
        <rect width="${w}" height="${h}" fill="hsl(205, 60%, 86%)"/>
        <rect x="${w * 0.08}" y="${h * 0.08}" width="${w * 0.84}" height="${h * 0.84}" fill="${hsl(p.hue + 25, 15, 80)}"/>
        <rect x="${w * 0.18}" y="${h * 0.14}" width="${w * 0.64}" height="${h * 0.16}" rx="10" fill="${p.ink}"/>
        <text x="${w / 2}" y="${h * 0.25}" text-anchor="middle" font-family="Georgia, serif" font-size="${Math.round(h * 0.075)}" fill="#fff">${esc(opts.sign ?? '')}</text>
        ${stripes}
        <rect x="${w * 0.2}" y="${h * 0.44}" width="${w * 0.36}" height="${h * 0.42}" rx="8" fill="#fff4cf" stroke="${p.ink}" stroke-width="12"/>
        <rect x="${w * 0.2}" y="${h * 0.44}" width="${w * 0.36}" height="${h * 0.42}" fill="url(#glow)"/>
        <rect x="${w * 0.62}" y="${h * 0.44}" width="${w * 0.17}" height="${h * 0.48}" rx="6" fill="${p.deep}"/>
        <circle cx="${w * 0.76}" cy="${h * 0.68}" r="8" fill="#f5d47a"/>
        <rect y="${h * 0.92}" width="${w}" height="${h * 0.08}" fill="hsl(30, 8%, 55%)"/>
        ${plant(w * 0.14, h * 0.94, 0.8)}`;
      break;
    }
    case 'lounge': {
      scene = `
        <rect width="${w}" height="${floorY}" fill="url(#wall)"/>
        <rect y="${floorY}" width="${w}" height="${h - floorY}" fill="url(#floor)"/>
        <rect x="${w * 0.14}" y="${h * 0.16}" width="${w * 0.22}" height="${h * 0.26}" fill="${p.light}" stroke="#fff" stroke-width="16"/>
        <circle cx="${w * 0.25}" cy="${h * 0.29}" r="${h * 0.07}" fill="${p.accent}" fill-opacity="0.7"/>
        <rect x="${w * 0.48}" y="${h * 0.2}" width="${w * 0.12}" height="${h * 0.16}" fill="${p.wallShade}" stroke="#fff" stroke-width="12"/>
        <rect x="${w * 0.18}" y="${floorY - 200}" width="${w * 0.52}" height="120" rx="50" fill="url(#acc)"/>
        <rect x="${w * 0.14}" y="${floorY - 120}" width="${w * 0.6}" height="110" rx="40" fill="url(#acc)"/>
        <rect x="${w * 0.2}" y="${floorY - 14}" width="16" height="40" fill="${p.ink}"/>
        <rect x="${w * 0.66}" y="${floorY - 14}" width="16" height="40" fill="${p.ink}"/>
        <ellipse cx="${w * 0.84}" cy="${floorY - 40}" rx="70" ry="16" fill="${p.ink}"/>
        <rect x="${w * 0.835}" y="${floorY - 40}" width="12" height="70" fill="${p.ink}"/>
        <circle cx="${w * 0.84}" cy="${floorY - 70}" r="22" fill="${p.light}"/>`;
      break;
    }
    case 'detail': {
      const blobs = Array.from({ length: 14 }, () => {
        const c = r.pick([p.accent, p.light, p.deep, '#fff']);
        return `<circle cx="${r.int(0, w)}" cy="${r.int(0, h)}" r="${r.int(40, 190)}" fill="${c}" fill-opacity="${(r.int(25, 70) / 100).toFixed(2)}"/>`;
      }).join('');
      scene = `<rect width="${w}" height="${h}" fill="${p.deep}"/><g filter="url(#blur)">${blobs}</g>`;
      break;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${defs}${scene}
    <rect width="${w}" height="${h}" fill="url(#glow)" fill-opacity="0.35"/></svg>`;
}

// ── Portfolio works (incl. before/after) ──────────────────────

export type WorkMotif = 'nails' | 'hair' | 'skin' | 'fade' | 'lashes' | 'spa';

/**
 * One portfolio tile. `before` renders the same composition in its "before"
 * state — dull, uneven, sparse — so a before/after pair reads as a pair.
 */
export function workSvg(motif: WorkMotif, accent: string, seed: string, before = false): string {
  const w = 960;
  const h = 1200;
  const p = paletteFrom(accent);
  const r = rng(seed);
  const skin = before ? 'hsl(28, 30%, 70%)' : 'hsl(26, 52%, 76%)';
  const bg = before ? hsl(p.hue, 6, 72) : p.wall;
  let art = '';

  switch (motif) {
    case 'nails': {
      art = `<path d="M180 1200 C 200 760, 300 560, 480 520 C 660 560, 760 760, 780 1200 Z" fill="${skin}"/>`;
      const fingers = [
        [250, 470, -18],
        [370, 360, -8],
        [490, 330, 0],
        [610, 370, 8],
        [720, 520, 22],
      ];
      for (const [i, [x, y, rot]] of fingers.entries()) {
        const polish = before ? (i % 2 ? 'hsl(20, 15%, 80%)' : 'hsl(20, 10%, 86%)') : `url(#acc)`;
        art += `<g transform="rotate(${rot} ${x} ${y + 200})">
          <rect x="${x - 52}" y="${y}" width="104" height="420" rx="52" fill="${skin}" stroke="hsl(25, 30%, 62%)" stroke-width="4"/>
          <rect x="${x - 36}" y="${y + 18}" width="72" height="${before ? 92 : 118}" rx="36" fill="${polish}"/>
          ${before ? `<path d="M${x - 20} ${y + 70} l12 -10 l8 14" stroke="hsl(20, 10%, 60%)" stroke-width="4" fill="none"/>` : `<ellipse cx="${x - 12}" cy="${y + 52}" rx="10" ry="26" fill="#fff" fill-opacity="0.55"/>`}
        </g>`;
      }
      break;
    }
    case 'hair': {
      const tone = before ? 'hsl(25, 12%, 38%)' : p.deep;
      const tone2 = before ? 'hsl(25, 10%, 45%)' : p.accent;
      art = Array.from({ length: 16 }, (_, i) => {
        const x = 80 + i * 52 + r.int(-10, 10);
        const sway = before ? r.int(-40, 40) : 160;
        return `<path d="M${x} 0 C ${x + sway} 300, ${x - sway} 700, ${x + sway / 2} 1200" stroke="${i % 3 ? tone : tone2}" stroke-width="${before ? 36 : 48}" fill="none" stroke-linecap="round" stroke-opacity="${before ? 0.7 : 0.95}"/>`;
      }).join('');
      if (!before) art += `<path d="M300 0 C 460 300, 140 700, 380 1200" stroke="#fff" stroke-opacity="0.35" stroke-width="22" fill="none"/>`;
      break;
    }
    case 'skin': {
      art = `<ellipse cx="480" cy="560" rx="300" ry="390" fill="${skin}"/>
        <ellipse cx="480" cy="520" rx="220" ry="300" fill="#fff" fill-opacity="${before ? 0.05 : 0.28}"/>`;
      if (before) {
        art += Array.from({ length: 26 }, () =>
          `<circle cx="${r.int(270, 690)}" cy="${r.int(300, 820)}" r="${r.int(6, 16)}" fill="hsl(5, 45%, 58%)" fill-opacity="0.55"/>`,
        ).join('');
      } else {
        art += `<ellipse cx="400" cy="420" rx="70" ry="40" fill="#fff" fill-opacity="0.45" filter="url(#blur)"/>`;
      }
      break;
    }
    case 'fade': {
      art = `<rect x="330" y="760" width="300" height="440" rx="60" fill="${skin}"/>
        <ellipse cx="480" cy="540" rx="270" ry="330" fill="${skin}"/>
        <path d="M210 540 C 210 220, 750 220, 750 540 L750 ${before ? 700 : 600} C 600 ${before ? 560 : 470}, 360 ${before ? 560 : 470}, 210 ${before ? 700 : 600} Z" fill="${before ? 'hsl(25, 14%, 30%)' : 'url(#fadeG)'}"/>
        <ellipse cx="760" cy="600" rx="34" ry="70" fill="${skin}"/>`;
      if (!before) art += `<path d="M300 300 C 400 250, 560 250, 660 300" stroke="#fff" stroke-opacity="0.35" stroke-width="10" fill="none"/>`;
      break;
    }
    case 'lashes': {
      art = `<rect width="${w}" height="${h}" fill="${skin}"/>
        <path d="M150 640 Q 480 360 810 640 Q 480 860 150 640 Z" fill="#fff"/>
        <circle cx="480" cy="630" r="120" fill="${before ? 'hsl(30, 20%, 40%)' : hsl(p.hue, 45, 35)}"/>
        <circle cx="480" cy="630" r="55" fill="#111"/>
        <circle cx="440" cy="590" r="20" fill="#fff" fill-opacity="0.8"/>`;
      const n = before ? 9 : 26;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const x = 170 + t * 620;
        const y = 640 - Math.sin(t * Math.PI) * 270 + 10;
        const len = before ? 40 : 110 + Math.sin(t * Math.PI) * 40;
        art += `<path d="M${x} ${y} q ${(t - 0.5) * 60} ${-len * 0.6} ${(t - 0.5) * 120} ${-len}" stroke="#111" stroke-width="${before ? 4 : 7}" fill="none" stroke-linecap="round"/>`;
      }
      art += `<path d="M180 330 Q 480 ${before ? 260 : 220} 790 330" stroke="${before ? 'hsl(25, 15%, 45%)' : '#2a1a10'}" stroke-width="${before ? 22 : 40}" fill="none" stroke-linecap="round"/>`;
      break;
    }
    case 'spa': {
      const stones = [0, 1, 2, 3].map((i) => {
        const sw = 360 - i * 70;
        return `<ellipse cx="480" cy="${980 - i * 150}" rx="${sw / 2}" ry="${70 - i * 6}" fill="hsl(${p.hue + 40}, 8%, ${before ? 45 : 22 + i * 6}%)"/>`;
      }).join('');
      art = `${stones}
        <rect x="170" y="860" width="70" height="150" rx="10" fill="#fff8e7"/><ellipse cx="205" cy="840" rx="12" ry="24" fill="#ffb648"/>
        <rect x="720" y="890" width="70" height="120" rx="10" fill="#fff8e7"/><ellipse cx="755" cy="870" rx="12" ry="24" fill="#ffb648"/>
        <ellipse cx="480" cy="250" rx="160" ry="60" fill="${before ? '#aaa' : 'hsl(140, 40%, 45%)'}" transform="rotate(-20 480 250)"/>`;
      break;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="acc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.accent}"/><stop offset="1" stop-color="${p.deep}"/></linearGradient>
    <linearGradient id="fadeG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1410"/><stop offset="0.7" stop-color="#3a2a20"/><stop offset="1" stop-color="#3a2a20" stop-opacity="0.15"/></linearGradient>
    <filter id="blur"><feGaussianBlur stdDeviation="24"/></filter>
  </defs>
  <rect width="${w}" height="${h}" fill="${bg}"/>
  ${art}
  ${before ? `<rect width="${w}" height="${h}" fill="#7a7a7a" fill-opacity="0.18"/>` : ''}
</svg>`;
}

// ── Avatars ───────────────────────────────────────────────────

/** An illustrated head-and-shoulders portrait (no real face). */
export function avatarSvg(seed: string, accent: string): string {
  const r = rng(seed);
  const p = paletteFrom(accent);
  const skin = r.pick(['hsl(28, 55%, 78%)', 'hsl(26, 45%, 68%)', 'hsl(24, 40%, 58%)', 'hsl(30, 60%, 84%)']);
  const hair = r.pick(['#1d1410', '#2e1e14', '#4a2f1d', '#6b4426', '#8a5a2b', '#111111']);
  const bgHue = (p.hue + r.int(-30, 30) + 360) % 360;
  const long = r.chance(0.5);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${hsl(bgHue, 45, 82)}"/><stop offset="1" stop-color="${hsl(bgHue, 40, 64)}"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  ${long ? `<path d="M150 230 C 140 420, 180 470, 256 470 C 332 470, 372 420, 362 230 Z" fill="${hair}"/>` : ''}
  <path d="M96 512 C 110 400, 180 360, 256 360 C 332 360, 402 400, 416 512 Z" fill="${p.accent}"/>
  <path d="M206 330 h100 v60 c0 30 -100 30 -100 0 Z" fill="${skin}"/>
  <ellipse cx="256" cy="240" rx="104" ry="124" fill="${skin}"/>
  <path d="M150 230 C 150 120, 362 120, 362 230 C 330 ${long ? 170 : 180}, 220 ${long ? 150 : 170}, 150 230 Z" fill="${hair}"/>
  <ellipse cx="218" cy="252" rx="10" ry="12" fill="#2b1d16"/>
  <ellipse cx="294" cy="252" rx="10" ry="12" fill="#2b1d16"/>
  <path d="M226 304 Q 256 324 286 304" stroke="#a5534a" stroke-width="7" fill="none" stroke-linecap="round"/>
</svg>`;
}

// ── Wide covers (courses, vacancies) ──────────────────────────

export function coverSvg(motif: WorkMotif, accent: string, seed: string, caption?: string): string {
  const w = 1280;
  const h = 720;
  const p = paletteFrom(accent);
  const r = rng(seed);
  const shapes = Array.from({ length: 7 }, () =>
    `<circle cx="${r.int(0, w)}" cy="${r.int(0, h)}" r="${r.int(80, 260)}" fill="#fff" fill-opacity="${(r.int(5, 14) / 100).toFixed(2)}"/>`,
  ).join('');
  // The portfolio art, scaled into the right-hand side of the banner.
  const art = workSvg(motif, accent, `${seed}:art`)
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="bgc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.accent}"/><stop offset="1" stop-color="${p.deep}"/></linearGradient>
    <clipPath id="clip"><rect x="0" y="0" width="960" height="1200" rx="120"/></clipPath>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bgc)"/>
  ${shapes}
  <g transform="translate(${w - 520} 60) scale(0.5)"><g clip-path="url(#clip)">${art}</g></g>
  ${caption ? `<text x="72" y="${h - 90}" font-family="'Segoe UI', Arial, sans-serif" font-size="46" font-weight="700" fill="#fff" fill-opacity="0.92">${esc(caption)}</text>` : ''}
</svg>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

