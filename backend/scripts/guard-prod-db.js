#!/usr/bin/env node
/**
 * guard-prod-db — refuse `prisma migrate` / `seed` against the PRODUCTION database.
 *
 * The boot guard (src/config/bootGuards.ts → assertNotProductionDatabase) protects
 * the SERVER process, but `prisma migrate` and the seed scripts run as SEPARATE
 * processes the boot guard never sees. Worse, migrations read DIRECT_URL
 * (prisma/schema.prisma → directUrl), which also pointed at prod — the one door
 * the boot guard can't cover. This closes it: a dev/local migration against prod
 * exits non-zero before Prisma runs.
 *
 * Allowed only when NODE_ENV=production (the genuine deploy — backend/Dockerfile
 * sets `ENV NODE_ENV=production`) or CONFIRM_PROD_DB=1 (deliberate, eyes-open).
 * Keep PROD_DB_HOST_MARKERS in sync with src/config/bootGuards.ts.
 */
'use strict';

const PROD_DB_HOST_MARKERS = ['supabase.com', 'supabase.co'];

function markerFor(url) {
  return PROD_DB_HOST_MARKERS.find((m) => (url || '').includes(m)) || null;
}

const hit = markerFor(process.env.DATABASE_URL) || markerFor(process.env.DIRECT_URL);
if (!hit) process.exit(0); // local/dev DB — fine
if (process.env.NODE_ENV === 'production') process.exit(0); // genuine prod deploy
if (process.env.CONFIRM_PROD_DB === '1') process.exit(0); // deliberate opt-in

console.error(
  `\n[migrate] REFUSED — DATABASE_URL/DIRECT_URL points at the PRODUCTION database ` +
    `(${hit}) but this is not a production process (NODE_ENV=${process.env.NODE_ENV || 'unset'}).\n` +
    `A migration or seed here would ALTER REAL USER DATA. Point the URLs at a local ` +
    `database (see backend/.env), or set CONFIRM_PROD_DB=1 to override deliberately.\n`,
);
process.exit(1);
