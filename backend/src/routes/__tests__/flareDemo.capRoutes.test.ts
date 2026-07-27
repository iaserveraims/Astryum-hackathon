/**
 * §4 — the demo cap is not just body-sniffed; the mint routes are ENUMERATED. This test
 * walks the flare-demo router's registered POST routes and fails if any is UNCLASSIFIED
 * (a new route → red test, not a production discovery), and proves every enumerated mint
 * route is actually capped by the middleware.
 */
import express from 'express';
import request from 'supertest';
import flareDemoRouter from '../flareDemo';
import { MINT_PREPARE_ROUTES, CLASSIFIED_POST_PATHS } from '../../config/demoCapRoutes';
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
  it('has no unclassified POST route (new mint routes → MINT_PREPARE_ROUTES, others → NON_MINT_POST_ROUTES)', () => {
    const unclassified = registeredPostPaths().filter((p) => !CLASSIFIED_POST_PATHS.has(p));
    expect(unclassified).toEqual([]);
  });

  it('every enumerated mint route is actually registered on the router', () => {
    const registered = new Set(registeredPostPaths());
    const missing = MINT_PREPARE_ROUTES.map((r) => r.path).filter((p) => !registered.has(p));
    expect(missing).toEqual([]);
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
});
