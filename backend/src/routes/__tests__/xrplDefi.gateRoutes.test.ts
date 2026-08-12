/**
 * Tripwire (2026-08-06) — the twin of flareDemo.capRoutes.test.ts for the
 * council router: every POST route on /api/xrpl-defi is CLASSIFIED. A council
 * route must carry requireLegacyAccess; a personal composition route must be
 * on the explicit OPEN list. A new unclassified POST turns this test red
 * instead of becoming a production discovery — the 2026-07-29 audit found
 * UI-only gating by accident, and this makes that class of drift impossible
 * to miss again.
 */
import xrplDefiRouter from '../xrplDefi';

/**
 * Personal (non-council) composition routes — session-authed at the mount
 * (requireSiweAuth in index-simple), intentionally NOT Legacy-gated. Adding a
 * route here is a deliberate decision, reviewed like one.
 */
const OPEN_POST_ROUTES = new Set<string>([
  '/escrow-create/prepare',
  '/escrow-finish/prepare',
  '/escrow-cancel/prepare',
  '/offer-create/prepare',
  '/offer-cancel/prepare',
  '/amm-deposit/prepare',
  '/amm-withdraw/prepare',
  '/simulate',
]);

function postRoutes(): Array<{ path: string; gated: boolean }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (xrplDefiRouter as any).stack
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((l: any) => l.route && l.route.methods?.post)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((l: any) => ({
      path: l.route.path as string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      gated: l.route.stack.some((h: any) => h.handle?.name === 'requireLegacyAccess'),
    }));
}

describe('xrpl-defi — every POST route is CLASSIFIED (gate tripwire)', () => {
  it('has no unclassified POST route (council → requireLegacyAccess, personal → OPEN_POST_ROUTES)', () => {
    const unclassified = postRoutes()
      .filter((r) => !r.gated && !OPEN_POST_ROUTES.has(r.path))
      .map((r) => r.path);
    expect(unclassified).toEqual([]);
  });

  it('keeps the OPEN list honest both ways (no gated route listed as open)', () => {
    const gatedButListedOpen = postRoutes()
      .filter((r) => r.gated && OPEN_POST_ROUTES.has(r.path))
      .map((r) => r.path);
    expect(gatedButListedOpen).toEqual([]);
  });

  it('the council surface is actually gated (representative routes)', () => {
    const byPath = new Map(postRoutes().map((r) => [r.path, r.gated]));
    for (const p of [
      '/council-order/prepare',
      '/council-order/relay',
      '/multisign/prepare',
      '/vault-fund/prepare',
      '/cage-create/prepare',
      '/disable-master/prepare',
    ]) {
      expect({ path: p, gated: byPath.get(p) }).toEqual({ path: p, gated: true });
    }
  });
});
