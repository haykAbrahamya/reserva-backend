#!/usr/bin/env node
/**
 * Bulk-apply per-service name/category translations for a single partner.
 *
 * It does NOT create services — it UPDATES existing ones. Each row in the input
 * JSON is matched to an existing service by its base (Armenian) `name`, then the
 * `nameI18n` / `categoryI18n` translation blobs are set via PATCH /services/:id.
 *
 * INPUT JSON — an array of objects, one per service:
 *   {
 *     "name":        "<Armenian name, must match the service's base name exactly>",
 *     "name_en":     "English name",
 *     "name_ru":     "Russian name",
 *     "category":    "<Armenian category>",
 *     "category_en": "English category",
 *     "category_ru": "Russian category"
 *   }
 * The Armenian values are also written into the i18n blob as `hy` so every locale
 * is explicit. The service's base `name`/`category` columns are left untouched.
 *
 * USAGE:
 *   TOKEN=<partner-admin-bearer> node scripts/apply-service-translations.mjs <path-to.json>
 *
 *   # dry run — only fetch + match, no writes (do this first, always):
 *   DRY=1 TOKEN=... node scripts/apply-service-translations.mjs data.json
 *
 *   # override API (defaults to prod):
 *   API_URL=http://localhost:4000/api/v1 TOKEN=... node scripts/... data.json
 *
 *   # token via flag instead of env:
 *   node scripts/apply-service-translations.mjs data.json --token=<bearer>
 *
 * NOTES:
 *   - TOKEN is a partner ADMIN access token (role:admin). It scopes to that
 *     partner automatically — services from other partners are never touched.
 *   - Access tokens are short-lived (~15 min). Grab a fresh one right before running.
 *   - Matching is by NFC-normalized, whitespace-collapsed name. Any row whose name
 *     has no corresponding backend service is reported as UNMATCHED and skipped —
 *     nothing is created. Fix the name in the JSON (or the backend) and re-run.
 *   - Idempotent: re-running just re-sets the same translations.
 */
import fs from 'node:fs';
import path from 'node:path';

// ---- args / env -----------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};
const jsonPath = argv.find((a) => !a.startsWith('--'));

const API = process.env.API_URL || flag('api') || 'https://api.reserva.am/api/v1';
const TOKEN = process.env.TOKEN || flag('token');
const DRY = process.env.DRY === '1' || argv.includes('--dry');

if (!jsonPath) {
  console.error('Usage: TOKEN=<bearer> node scripts/apply-service-translations.mjs <translations.json> [--dry]');
  process.exit(1);
}
if (!TOKEN) {
  console.error('Missing partner admin token. Set TOKEN=... or pass --token=...');
  process.exit(1);
}

const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

// Normalize for matching: NFC, non-breaking spaces → normal, collapse whitespace.
const norm = (s) => (s ?? '').normalize('NFC').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

// ---- load input -----------------------------------------------------------
const abs = path.resolve(jsonPath);
const rows = JSON.parse(fs.readFileSync(abs, 'utf8'));
if (!Array.isArray(rows)) {
  console.error(`Input ${abs} must be a JSON array.`);
  process.exit(1);
}
console.log(`API: ${API}`);
console.log(`Input: ${abs} (${rows.length} rows)${DRY ? '  [DRY RUN — no writes]' : ''}\n`);

// ---- fetch existing services ---------------------------------------------
const listRes = await fetch(`${API}/services?all=true&includeInactive=true`, { headers: H });
if (!listRes.ok) {
  console.error('LIST failed', listRes.status, await listRes.text());
  process.exit(1);
}
const list = await listRes.json();
const items = list.items ?? list.data?.items ?? [];
console.log(`Fetched ${items.length} existing services for this partner.\n`);

const byName = new Map();
for (const s of items) {
  const k = norm(s.name);
  if (byName.has(k)) console.log(`  [warn] duplicate backend name "${s.name}" (${s.id} / ${byName.get(k).id})`);
  byName.set(k, s);
}

// ---- apply ----------------------------------------------------------------
let updated = 0, errors = 0;
const unmatched = [];

for (const r of rows) {
  const svc = byName.get(norm(r.name));
  if (!svc) { unmatched.push(r.name); continue; }

  const body = {
    nameI18n: { hy: r.name, en: r.name_en, ru: r.name_ru },
    categoryI18n: { hy: r.category, en: r.category_en, ru: r.category_ru },
  };

  if (DRY) { console.log(`match  ${svc.id}  ${r.name}  ->  ${r.name_en}`); updated++; continue; }

  const res = await fetch(`${API}/services/${svc.id}`, { method: 'PATCH', headers: H, body: JSON.stringify(body) });
  if (res.ok) { updated++; console.log(`OK   ${svc.id}  ${r.name}  ->  ${r.name_en}`); }
  else { errors++; console.log(`ERR  ${svc.id}  ${r.name}  ${res.status}  ${await res.text()}`); }
}

console.log(`\nDone. ${DRY ? 'matched' : 'updated'}=${updated}, errors=${errors}, unmatched=${unmatched.length}`);
if (unmatched.length) {
  console.log('\nUNMATCHED — no backend service with this base name (fix name in JSON or backend, then re-run):');
  unmatched.forEach((n) => console.log('  - ' + n));
}
process.exit(errors || unmatched.length ? 1 : 0);
