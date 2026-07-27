/**
 * PartnerRegistry — three-tier resolver tests.
 *
 * Locks in the behavior promised by the 2026-06-01 audit §1.3:
 *   - Self-custody DeFi NEVER fails for lack of an aggregator API key.
 *   - The user's own wallet (wallet-evm-defi etc.) is a valid WALLET_PARTNER.
 *   - Aggregators (Enso/CoW/1inch) only win when enabled AND value-add.
 *   - REGULATED_CASP only for fiat. BRIDGE_PARTNER only for cross-ecosystem.
 *   - No fallback from CASP/bridge domain to wallet partner — those operations
 *     fail loud when no matching partner exists.
 */

import { partnerRegistry } from '../PartnerRegistry';

// Snapshot env vars we toggle in tests and restore in afterEach.
const SAVED_ENV: Record<string, string | undefined> = {
  ENSO_API_KEY: process.env.ENSO_API_KEY,
  ONEINCH_API_KEY: process.env.ONEINCH_API_KEY,
  DEFIBRO_FEE_WALLET: process.env.DEFIBRO_FEE_WALLET,
  SQUID_INTEGRATOR_ID: process.env.SQUID_INTEGRATOR_ID,
  TRANSAK_API_KEY: process.env.TRANSAK_API_KEY,
  MELD_API_KEY: process.env.MELD_API_KEY,
  MOONPAY_ENABLED: process.env.MOONPAY_ENABLED,
  MOONPAY_API_KEY: process.env.MOONPAY_API_KEY,
  MOONPAY_TRADE_API_KEY: process.env.MOONPAY_TRADE_API_KEY,
  MOONPAY_TRADE_ENABLED: process.env.MOONPAY_TRADE_ENABLED,
};

function clearAggregatorKeys() {
  delete process.env.ENSO_API_KEY;
  delete process.env.ONEINCH_API_KEY;
  delete process.env.SQUID_INTEGRATOR_ID;
  delete process.env.MOONPAY_TRADE_API_KEY;
  delete process.env.MOONPAY_TRADE_ENABLED;
}

afterEach(() => {
  for (const [k, v] of Object.entries(SAVED_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('PartnerRegistry — Three-tier resolver', () => {
  // ─────────────────────────────────────────────────────────────────────────
  // TIER 1 — WALLET_PARTNER fallback never fails (the core promise)
  // ─────────────────────────────────────────────────────────────────────────

  test('Aave V3 supply on Ethereum WITHOUT any aggregator key → wallet-evm-defi', () => {
    clearAggregatorKeys();
    const partner = partnerRegistry.resolveForOperation({
      operation: 'supply',
      chain: 1,
      protocolSlug: 'aave-v3',
    });
    expect(partner).not.toBeNull();
    expect(partner!.id).toBe('wallet-evm-defi');
    expect(partner!.type).toBe('WALLET_PARTNER');
    expect(partner!.priority).toBe(0); // default wallet has lowest priority
  });

  test('Aave V3 supply on Ethereum WITH ENSO_API_KEY → enso wins on priority', () => {
    clearAggregatorKeys();
    process.env.ENSO_API_KEY = 'test-enso-key';
    const partner = partnerRegistry.resolveForOperation({
      operation: 'supply',
      chain: 1,
      protocolSlug: 'aave-v3',
    });
    expect(partner).not.toBeNull();
    expect(partner!.id).toBe('enso');
    expect(partner!.type).toBe('WALLET_PARTNER'); // Enso is also WALLET_PARTNER, just value-add
    expect(partner!.priority).toBeGreaterThan(0);
  });

  test('Aave V3 supply on Ethereum WITH ENSO + MoonPay Trade → highest priority wins', () => {
    clearAggregatorKeys();
    process.env.ENSO_API_KEY = 'test-enso-key';
    process.env.MOONPAY_TRADE_API_KEY = 'test-mp-key';
    process.env.MOONPAY_TRADE_ENABLED = 'true';
    const partner = partnerRegistry.resolveForOperation({
      operation: 'supply',
      chain: 1,
      protocolSlug: 'aave-v3',
    });
    expect(partner!.id).toBe('enso'); // priority 70 > 65
  });

  test('User override: preferred=wallet-evm-defi wins even if Enso enabled', () => {
    clearAggregatorKeys();
    process.env.ENSO_API_KEY = 'test-enso-key';
    const partner = partnerRegistry.resolveForOperation({
      operation: 'supply',
      chain: 1,
      protocolSlug: 'aave-v3',
      preferred: 'wallet-evm-defi',
    });
    expect(partner!.id).toBe('wallet-evm-defi');
  });

  test('Stake on Lido (chain 1) WITHOUT aggregator → wallet-evm-defi (works fine)', () => {
    clearAggregatorKeys();
    const partner = partnerRegistry.resolveForOperation({
      operation: 'stake',
      chain: 1,
      protocolSlug: 'lido',
    });
    expect(partner!.id).toBe('wallet-evm-defi');
  });

  test('Swap on Solana → wallet-solana-defi OR jupiter (both WALLET_PARTNER)', () => {
    const partner = partnerRegistry.resolveForOperation({
      operation: 'swap',
      chain: 'solana',
    });
    // Jupiter is always enabled, priority 70; wallet-solana-defi has priority 0.
    // Jupiter wins.
    expect(partner!.id).toBe('jupiter');
    expect(partner!.type).toBe('WALLET_PARTNER');
  });

  test('Supply on XRPL → wallet-xrpl-defi (default wallet partner)', () => {
    const partner = partnerRegistry.resolveForOperation({
      operation: 'supply',
      chain: 'xrpl',
    });
    expect(partner!.id).toBe('wallet-xrpl-defi');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TIER 2 — BRIDGE_PARTNER (no wallet fallback)
  // ─────────────────────────────────────────────────────────────────────────

  test('Bridge from chain 1 → resolves to a BRIDGE_PARTNER (LI.FI default)', () => {
    const partner = partnerRegistry.resolveForOperation({
      operation: 'bridge',
      chain: 1,
    });
    expect(partner).not.toBeNull();
    expect(partner!.type).toBe('BRIDGE_PARTNER');
    expect(['lifi', 'across', 'squid']).toContain(partner!.id);
  });

  test('Bridge on Solana → LI.FI handles it (BRIDGE_PARTNER)', () => {
    const partner = partnerRegistry.resolveForOperation({
      operation: 'bridge',
      chain: 'solana',
    });
    expect(partner!.id).toBe('lifi');
    expect(partner!.type).toBe('BRIDGE_PARTNER');
  });

  test('Bridge does NOT fall back to wallet partner (returns null when none match)', () => {
    // Aptos has no bridge partner registered today
    const partner = partnerRegistry.resolveForOperation({
      operation: 'bridge',
      chain: 'aptos',
    });
    expect(partner).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TIER 3 — REGULATED_CASP (fiat only, no wallet fallback)
  // ─────────────────────────────────────────────────────────────────────────

  test('Onramp WITHOUT any CASP key → null (fail-loud)', () => {
    clearAggregatorKeys();
    delete process.env.TRANSAK_API_KEY;
    delete process.env.MELD_API_KEY;
    delete process.env.MOONPAY_ENABLED;
    delete process.env.MOONPAY_API_KEY;
    const partner = partnerRegistry.resolveForOperation({
      operation: 'onramp',
      chain: 1,
    });
    expect(partner).toBeNull();
  });

  test('Onramp WITH TRANSAK_API_KEY → transak (REGULATED_CASP)', () => {
    delete process.env.MELD_API_KEY;
    delete process.env.MOONPAY_ENABLED;
    delete process.env.MOONPAY_API_KEY;
    process.env.TRANSAK_API_KEY = 'test-transak-key';
    const partner = partnerRegistry.resolveForOperation({
      operation: 'onramp',
      chain: 1,
    });
    expect(partner!.id).toBe('transak');
    expect(partner!.type).toBe('REGULATED_CASP');
  });

  test('Onramp does NOT fall back to wallet partner (returns null without CASP)', () => {
    delete process.env.TRANSAK_API_KEY;
    delete process.env.MELD_API_KEY;
    delete process.env.MOONPAY_ENABLED;
    delete process.env.MOONPAY_API_KEY;
    const partner = partnerRegistry.resolveForOperation({
      operation: 'onramp',
      chain: 1,
    });
    expect(partner).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Edge cases
  // ─────────────────────────────────────────────────────────────────────────

  test('Supply on an unknown chain (Cosmos with no wallet partner registered) → null', () => {
    const partner = partnerRegistry.resolveForOperation({
      operation: 'supply',
      chain: 'cosmos',
    });
    // No wallet-cosmos-defi yet; cosmos fallback maps to wallet-evm-defi which
    // does not include 'cosmos' in its chains. So null.
    expect(partner).toBeNull();
  });

  test('Unknown protocolSlug on a chain with default wallet → wallet still wins', () => {
    clearAggregatorKeys();
    const partner = partnerRegistry.resolveForOperation({
      operation: 'supply',
      chain: 1,
      protocolSlug: 'some-future-protocol-unknown-to-aggregators',
    });
    // No aggregator whitelists this slug, but wallet-evm-defi has NO protocolSlugs
    // whitelist — it accepts anything (subject to PolicyGuard + allowlist).
    expect(partner!.id).toBe('wallet-evm-defi');
  });
});
