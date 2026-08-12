/**
 * LST dedup — it must only ever remove an INDEXER's duplicate, never a balance
 * one of our own adapters read from the chain.
 *
 * Regression (founder, 2026-08-01, "revisa si puede suceder con otros
 * activos"): staking FLR does not consume the FLR left in the wallet. The rule
 * was applied to every FREE row regardless of source, so a wallet holding both
 * sFLR and loose FLR had the loose FLR silently erased from the dashboard —
 * NativeBalanceAdapter's eth_getBalance read mistaken for a double count.
 */
import { deduplicateLSTPositions } from '../LSTReceiptMap';

const stake = (usd: number) => ({
  asset: 'sFLR',
  kind: 'STAKE',
  amountUSD: usd,
  protocolId: 'sceptre',
  metadata: {},
});

/** What NativeBalanceAdapter emits: one chain read, never a duplicate. */
const ownFreeFlr = (usd: number) => ({
  asset: 'FLR',
  kind: 'FREE',
  amountUSD: usd,
  protocolId: 'wallet',
  metadata: { native: true },
});

/** What CoinStats/DeBank emit: `external: true`, stamped by the engine. */
const externalFreeFlr = (usd: number) => ({
  asset: 'FLR',
  kind: 'FREE',
  amountUSD: usd,
  protocolId: 'wallet-14',
  metadata: { external: true, source: 'coinstats' },
});

describe('deduplicateLSTPositions', () => {
  it('KEEPS the wallet FLR our own adapter read, whatever the sFLR is worth', () => {
    const out = deduplicateLSTPositions([stake(500), ownFreeFlr(120)]);
    expect(out).toHaveLength(2);
    expect(out.find((p) => p.asset === 'FLR')?.amountUSD).toBe(120);
  });

  it('drops an EXTERNAL free row fully covered by the receipt token', () => {
    const out = deduplicateLSTPositions([stake(500), externalFreeFlr(120)]);
    expect(out).toHaveLength(1);
    expect(out[0].asset).toBe('sFLR');
  });

  it('reduces a partially covered EXTERNAL row to the uncovered remainder', () => {
    const out = deduplicateLSTPositions([stake(100), externalFreeFlr(250)]);
    expect(out).toHaveLength(2);
    expect(out.find((p) => p.asset === 'FLR')?.amountUSD).toBe(150);
  });

  it('leaves everything alone when no receipt token is held', () => {
    const positions = [ownFreeFlr(120), externalFreeFlr(80)];
    expect(deduplicateLSTPositions(positions)).toEqual(positions);
  });
});
