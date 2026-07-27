/**
 * P0-5 — RLS exposure guard.
 *
 * Fails if ANY table in the `public` schema is missing Row Level Security — i.e.
 * a new table was added (new migration) without RLS and is therefore exposed
 * through Supabase's Data API. The `20260615000000_enable_rls` migration turns
 * RLS on for all existing tables; this test catches regressions going forward.
 *
 * Requires a real database: skipped automatically when DATABASE_URL is unset
 * (so the no-DB CI lane passes). Run it against staging/prod to enforce.
 *   DATABASE_URL=... npx jest rlsExposure
 */
import type { PrismaClient } from '@prisma/client';

const hasDb = !!process.env.DATABASE_URL;
const suite = hasDb ? describe : describe.skip;

suite('RLS exposure (P0-5) — requires DATABASE_URL', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    // Lazy require so the client is only constructed when the suite actually runs.
    const { PrismaClient: Client } = require('@prisma/client');
    prisma = new Client();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('no public table is missing Row Level Security', async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = false AND tablename NOT LIKE '\\_prisma%'",
    );
    const exposed = rows.map((r) => r.tablename);
    // Empty = every public table has RLS on. A non-empty list names the offenders.
    expect(exposed).toEqual([]);
  }, 30_000);
});
