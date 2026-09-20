/**
 * G7 — the XRPL rail must be REACHABLE from the client.
 *
 * The silent failure these tests lock down (auditoría de los SILENCIOSOS,
 * 2026-08-17): `moneyflows.translate` hardcoded chainId 14, so the
 * `chainId === 1440002` branch of POST /api/moneyflows/translate had no caller
 * anywhere in the product. The CanonicalXrplTranslator — the ONLY producer of
 * PRICE_DROP_PCT (the M3 price protection), scheduledPayment and escrow rules —
 * was unreachable, and the person could not create the protection at all.
 * Nothing threw: the flow just came back with an EVM `verb_not_supported`.
 *
 * With the OLD signature `translate(cmf, chainId = 14)` the first test posts
 * `chainId: { chainId: 1440002 }` and fails; `cmfRailChainId` did not exist.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cmfRailChainId,
  moneyflows,
  FLARE_EVM_CHAIN_ID,
  XRPL_PSEUDO_CHAIN_ID,
  type CanonicalMoneyFlow,
  type CmfStep,
} from '../v1Api';

function flow(steps: CmfStep[]): CanonicalMoneyFlow {
  return {
    version: 'cmf/0.1',
    id: 'cmf-test-000000001',
    name: 'Test flow',
    description: 'A flow used by the rail tests.',
    direction: 'protect',
    origin: { source: 'ai_copilot' },
    steps,
    policy: { cooldownMinutes: 60, disclosedToUser: true },
  };
}

const DEST = 'rPdvC6ccq8hCdPKSPJkPmyZ4Mi1oG2FFkT'; // an XRPL classic r-address

/** The G7 flow: "if XRP falls below $2, send 25 XRP to my cold wallet". */
const PRICE_FLOOR_FLOW = flow([
  {
    level: 1,
    trigger: { kind: 'price', asset: { symbol: 'XRP' }, comparator: 'below', threshold: 2 },
    actions: [
      {
        verb: 'transfer',
        asset: { symbol: 'XRP' },
        amount: { type: 'absolute', value: '25' },
        venue: { params: { destination: DEST } },
      },
    ],
  },
]);

/** A plain Flare/EVM protection — must KEEP its rail (no over-eager routing). */
const FLARE_PROTECT_FLOW = flow([
  {
    level: 1,
    trigger: { kind: 'health-factor', comparator: 'below', threshold: 1.4 },
    actions: [
      {
        verb: 'repay',
        asset: { symbol: 'USDT0' },
        amount: { type: 'absolute', value: '100' },
        venue: { protocolId: 'kinetic' },
      },
    ],
  },
]);

describe('cmfRailChainId — which translator a flow needs (G7)', () => {
  it('routes the price-floor XRP payment to the XRPL rail', () => {
    expect(cmfRailChainId(PRICE_FLOOR_FLOW)).toBe(XRPL_PSEUDO_CHAIN_ID);
  });

  it('routes on the verb alone: "transfer" is not an EVM automation action', () => {
    const f = flow([
      {
        level: 1,
        trigger: { kind: 'time', cron: '0 12 1 * *' },
        actions: [{ verb: 'transfer', asset: { symbol: 'XRP' }, amount: { type: 'absolute', value: '5' } }],
      },
    ]);
    expect(cmfRailChainId(f)).toBe(XRPL_PSEUDO_CHAIN_ID);
  });

  it('routes the savings escrow (venue.params.lockDays) to the XRPL rail', () => {
    const f = flow([
      {
        level: 1,
        trigger: { kind: 'idle-balance', asset: { symbol: 'XRP' }, minUsd: 500 },
        actions: [
          {
            verb: 'supply',
            asset: { symbol: 'XRP' },
            amount: { type: 'absolute', value: '25' },
            venue: { params: { lockDays: 30 } },
          },
        ],
      },
    ]);
    expect(cmfRailChainId(f)).toBe(XRPL_PSEUDO_CHAIN_ID);
  });

  it('honours an explicit CAIP-2 xrpl:* chain on the asset', () => {
    const f = flow([
      {
        level: 1,
        trigger: { kind: 'idle-balance', asset: { symbol: 'XRP', chain: 'xrpl:0' }, minUsd: 100 },
        actions: [{ verb: 'supply', asset: { symbol: 'XRP' }, amount: { type: 'absolute', value: '10' } }],
      },
    ]);
    expect(cmfRailChainId(f)).toBe(XRPL_PSEUDO_CHAIN_ID);
  });

  it('leaves an ordinary Flare flow on 14 — no rail is ever guessed', () => {
    expect(cmfRailChainId(FLARE_PROTECT_FLOW)).toBe(FLARE_EVM_CHAIN_ID);
    expect(FLARE_EVM_CHAIN_ID).toBe(14);
  });
});

describe('moneyflows.translate — the rail travels to the server (G7)', () => {
  let bodies: Array<Record<string, unknown>>;

  beforeEach(() => {
    bodies = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        bodies.push(JSON.parse(init.body));
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, chain: 'xrpl:0', mode: 'sign-at-trigger', rules: [], notes: [] }),
        };
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the XRPL pseudo chain-id when asked for that rail', async () => {
    await moneyflows.translate(PRICE_FLOOR_FLOW, { chainId: XRPL_PSEUDO_CHAIN_ID });
    expect(bodies).toHaveLength(1);
    // The exact number routes/moneyflows.ts switches translator on.
    expect(bodies[0].chainId).toBe(1440002);
  });

  it('still defaults to Flare when no rail is given (nothing else changed)', async () => {
    await moneyflows.translate(FLARE_PROTECT_FLOW);
    expect(bodies[0].chainId).toBe(14);
    expect(bodies[0]).not.toHaveProperty('governed');
  });

  it('carries the governed flag only when the caller sets it', async () => {
    await moneyflows.translate(PRICE_FLOOR_FLOW, { chainId: XRPL_PSEUDO_CHAIN_ID, governed: true });
    expect(bodies[0].governed).toBe(true);
  });

  it('the rail the flow demands is the rail the request carries', async () => {
    await moneyflows.translate(PRICE_FLOOR_FLOW, { chainId: cmfRailChainId(PRICE_FLOOR_FLOW) });
    expect(bodies[0].chainId).toBe(XRPL_PSEUDO_CHAIN_ID);
  });
});
