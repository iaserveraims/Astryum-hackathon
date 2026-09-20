/**
 * §4 — the demo cap is not just body-sniffed; the mint routes are ENUMERATED. This test
 * walks the flare-demo router's registered POST routes and fails if any is UNCLASSIFIED
 * (a new route → red test, not a production discovery), and proves every enumerated mint
 * route is actually capped by the middleware.
 *
 * EXIT class (the exit is never gated): exit routes are classified in their
 * own list; their 0xFE carrier keeps the per-TRANSACTION cap, and the refusal says the
 * exit itself is not limited. Their geofence / daily-budget immunity is proven in
 * flareDemo.exitNotGated.test.ts.
 */
import express from 'express';
import request from 'supertest';
import flareDemoRouter from '../flareDemo';
import {
  MINT_PREPARE_ROUTES,
  EXIT_PREPARE_ROUTES,
  NON_MINT_POST_ROUTES,
  CLASSIFIED_POST_PATHS,
} from '../../config/demoCapRoutes';
import { _resetDemoCapState } from '../../config/demoCap';

const app = express();
app.use(express.json());
app.use('/api/flare-demo', flareDemoRouter);

const XRPL = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh';

/** Registered POST paths, read from the actual Express router stack. */
function registeredPostPaths(): string[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (flareDemoRouter as any).stack
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((l: any) => l.route && l.route.methods?.post)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((l: any) => l.route.path as string);
}

beforeEach(() => _resetDemoCapState());
afterEach(() => {
  delete process.env.FLARE_DEFI_ENABLED;
  delete process.env.DEMO_MAX_XRP_PER_TX;
});

describe('flare-demo — every POST route is CLASSIFIED (§4 tripwire)', () => {
  it('has no unclassified POST route (mint → MINT_PREPARE_ROUTES, exit → EXIT_PREPARE_ROUTES, others → NON_MINT_POST_ROUTES)', () => {
    const unclassified = registeredPostPaths().filter((p) => !CLASSIFIED_POST_PATHS.has(p));
    expect(unclassified).toEqual([]);
  });

  it('every enumerated route (mint, exit, non-mint) is actually registered on the router', () => {
    const registered = new Set(registeredPostPaths());
    const missing = [
      ...MINT_PREPARE_ROUTES.map((r) => r.path),
      ...EXIT_PREPARE_ROUTES.map((r) => r.path),
      ...NON_MINT_POST_ROUTES,
    ].filter((p) => !registered.has(p));
    expect(missing).toEqual([]);
  });

  it('each route lives in exactly ONE class (an exit cannot also be an entry mint)', () => {
    const all = [
      ...MINT_PREPARE_ROUTES.map((r) => r.path),
      ...EXIT_PREPARE_ROUTES.map((r) => r.path),
      ...NON_MINT_POST_ROUTES,
    ];
    const dupes = all.filter((p, i) => all.indexOf(p) !== i);
    expect(dupes).toEqual([]);
  });
});

describe('flare-demo — every enumerated mint route is actually capped', () => {
  it('rejects an over-cap request on each mint route with DEMO_TX_CAP_EXCEEDED', async () => {
    process.env.FLARE_DEFI_ENABLED = 'true';
    process.env.DEMO_MAX_XRP_PER_TX = '1';
    for (const { path, amountField } of MINT_PREPARE_ROUTES) {
      const field = amountField.split('|')[0];
      const res = await request(app)
        .post(`/api/flare-demo${path}`)
        .send({ xrplAddress: XRPL, [field]: 5 });
      expect({ path, error: res.body?.error }).toEqual({ path, error: 'DEMO_TX_CAP_EXCEEDED' });
    }
  });

  it('an exit carrier above the per-TRANSACTION cap is refused — and the refusal says the exit itself is not limited', async () => {
    process.env.FLARE_DEFI_ENABLED = 'true';
    process.env.DEMO_MAX_XRP_PER_TX = '1';
    for (const { path, carrierField } of EXIT_PREPARE_ROUTES) {
      if (!carrierField) continue; // EVM-direct exits ride no carrier
      const res = await request(app)
        .post(`/api/flare-demo${path}`)
        .send({ xrplAddress: XRPL, [carrierField]: 5 });
      expect({ path, status: res.status, error: res.body?.error }).toEqual({
        path,
        status: 400,
        error: 'DEMO_TX_CAP_EXCEEDED',
      });
      expect(res.body.detail).toMatch(/salida en sí no tiene límite/);
    }
  });
});
