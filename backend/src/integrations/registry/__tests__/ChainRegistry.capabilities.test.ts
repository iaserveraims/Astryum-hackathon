import { getChainCapabilities, allChainCapabilities } from '../ChainRegistry';

describe('ChainRegistry capability matrix (audit P2-3)', () => {
  const ORIGINAL = process.env.FLARE_DEFI_ENABLED;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.FLARE_DEFI_ENABLED;
    else process.env.FLARE_DEFI_ENABLED = ORIGINAL;
  });

  test('EVM Tier 1 chain (Ethereum) exposes the full pipeline', () => {
    expect(getChainCapabilities(1)).toEqual({
      discovery: true, balances: true, positions: true, prepare: true, sign: true, reconcile: true,
    });
  });

  test('unknown chain → all false (never over-claims)', () => {
    expect(getChainCapabilities(999999)).toEqual({
      discovery: false, balances: false, positions: false, prepare: false, sign: false, reconcile: false,
    });
  });

  test('disabled chain (Algorand) → all false', () => {
    // Algorand (1500002) is registered but enabled:false.
    expect(getChainCapabilities(1500002).balances).toBe(false);
    expect(getChainCapabilities(1500002).sign).toBe(false);
  });

  test('Flare execution caps are gated by FLARE_DEFI_ENABLED', () => {
    delete process.env.FLARE_DEFI_ENABLED;
    const off = getChainCapabilities(14);
    expect(off.balances).toBe(true);      // monitoring always available
    expect(off.discovery).toBe(true);
    expect(off.positions).toBe(false);    // execution-side gated off
    expect(off.prepare).toBe(false);

    process.env.FLARE_DEFI_ENABLED = 'true';
    const on = getChainCapabilities(14);
    expect(on.positions).toBe(true);
    expect(on.prepare).toBe(true);
    expect(on.reconcile).toBe(true);
  });

  test('non-EVM chains are honest, not blanket-supported', () => {
    // Stellar: Blend lending + Soroswap + Freighter → positions/prepare/sign.
    const stellar = getChainCapabilities(1500001);
    expect(stellar.positions).toBe(true);
    expect(stellar.prepare).toBe(true);
    expect(stellar.sign).toBe(true);

    // Bitcoin: read-only — Astryum never signs BTC, no DeFi.
    const btc = getChainCapabilities(1500000);
    expect(btc.balances).toBe(true);
    expect(btc.sign).toBe(false);
    expect(btc.positions).toBe(false);

    // Aptos: Petra can sign, but native DeFi execution is pending.
    const aptos = getChainCapabilities(1500003);
    expect(aptos.sign).toBe(true);
    expect(aptos.prepare).toBe(false);
  });

  test('allChainCapabilities covers every registered chain with metadata', () => {
    const all = allChainCapabilities();
    expect(Object.keys(all).length).toBeGreaterThan(20);
    expect(all[1].name).toBe('Ethereum');
    expect(all[1].tier).toBe(1);
  });
});
