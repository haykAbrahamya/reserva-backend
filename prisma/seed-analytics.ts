/**
 * Regenerate ONLY the demo site analytics, for the demo partners that exist
 * right now — no tenant is touched, so signed-in sessions survive.
 *
 *   pnpm db:seed:analytics           # replace the demo analytics
 *   pnpm db:seed:analytics --clean   # just remove them
 *
 * The full `pnpm db:seed` builds the same data after rebuilding the tenants;
 * this is for refreshing the window (it ends "now") or after changing
 * prisma/demo/analytics.ts. Rows it owns all have ids starting with `demo-`;
 * real beacon data and the legacy-* copies are never touched. Against a
 * database that is not on localhost it refuses to run without --yes.
 */
// Pin the clock before any Date is built, as src/main.ts and prisma/seed.ts do:
// demo days are Asia/Yerevan days.
process.env.TZ = process.env.TZ || 'Asia/Yerevan';

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { DEMO_ANALYTICS_DAYS, cleanDemoAnalytics, seedDemoAnalytics } from './demo/analytics';

// Outside Nest, so load .env the way ConfigModule would.
const ENV_FILE = resolve(process.cwd(), '.env');
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const prisma = new PrismaClient();
const argv = process.argv.slice(2);
const CLEAN_ONLY = argv.includes('--clean');
const CONFIRMED = argv.includes('--yes');

async function main() {
  const url = process.env.DATABASE_URL ?? '';
  const host = url.replace(/^.*@/, '').replace(/\?.*$/, '') || '(DATABASE_URL is not set)';
  if (!/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url) && !CONFIRMED) {
    console.error(
      `\nRefusing to seed:\n  DATABASE_URL does not point at localhost (${host}).` +
        `\n  This replaces demo analytics rows — re-run with --yes if you really mean it.\n`,
    );
    process.exit(1);
  }
  console.log(`database : ${host}`);

  const removed = await cleanDemoAnalytics(prisma);
  console.log(`removed ${removed} demo session(s) and their events`);
  if (CLEAN_ONLY) return;

  const started = Date.now();
  const s = await seedDemoAnalytics(prisma);
  console.log(
    `✓ site analytics: ${DEMO_ANALYTICS_DAYS} days · ${s.sessions} sessions · ${s.visitors} visitors · ${s.events} events` +
      ` · ${s.internal} staff · ${s.bots} bot (${((Date.now() - started) / 1000).toFixed(1)} s)`,
  );
  for (const p of s.partners) {
    console.log(
      `  ${p.slug.padEnd(14)} ${String(p.sessions).padStart(6)} sessions · ${p.bookingsTracked}/${p.bookings} public bookings tracked`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
