/**
 * PartnerRegistry — Three-Tier Model
 *
 * The single source of truth for "who routes an execution intent" in Astryum.
 * Per the 2026-06-01 regulatory audit and architectural principles
 * (CLAUDE.md §0 + ASTRYUM DOCS):
 *
 *   "Astryum never executes, never broadcasts, never has discretion;
 *    every execution path passes through a registered partner."
 *
 * Three partner types — clean MiCA framing:
 *
 *   TIER 1 · WALLET_PARTNER
 *     For all self-custody DeFi onchain operations (lending, borrowing,
 *     staking, LP, vaults, swaps EVM↔EVM within one chain).
 *     The PARTNER IS THE USER'S WALLET — MetaMask / Phantom / Xaman / Petra.
 *     Astryum builds the unsigned tx, the wallet shows it to the user, the
 *     user signs, the wallet broadcasts. Aggregators that add value (Enso
 *     bundling, CoW MEV protection, 1inch routing) register as alternative
 *     WALLET_PARTNERS — they too produce calldata for the user's wallet.
 *
 *     Fee embedded in calldata is legitimate under this model — it is
 *     disclosed to the user before authorization.
 *
 *   TIER 2 · BRIDGE_PARTNER
 *     ONLY for cross-ecosystem moves where the two ecosystems are
 *     architecturally incompatible (EVM ↔ Solana, EVM ↔ XRPL, EVM ↔ Aptos).
 *     Same-ecosystem cross-chain swaps (e.g. Arbitrum → Base) are routed as
 *     WALLET_PARTNER swaps, NOT bridges.
 *
 *   TIER 3 · REGULATED_CASP
 *     ONLY for fiat on-ramp / off-ramp. The only flow where Astryum hands
 *     to a licensed Crypto-Asset Service Provider (MoonPay, Transak, Meld).
 *     KYC is required by the partner.
 *
 * Resolver semantics (resolveForOperation):
 *   - Self-custody DeFi MUST ALWAYS resolve to SOME WALLET_PARTNER — either a
 *     value-add aggregator (Enso/CoW/1inch/...) if enabled, or the
 *     ecosystem-default wallet partner ('wallet-evm-defi'/'wallet-solana-defi'/
 *     'wallet-xrpl-defi'/'wallet-aptos-defi') which is ALWAYS enabled.
 *   - This means Aave V3 supply on Ethereum NEVER fails for lack of an
 *     external aggregator — the user's own wallet is a valid partner.
 *   - BRIDGE_PARTNER and REGULATED_CASP are NOT used as fallback for
 *     self-custody DeFi — they have distinct operation domains.
 */

export type PartnerType = 'WALLET_PARTNER' | 'BRIDGE_PARTNER' | 'REGULATED_CASP';

export type PartnerOperation =
  | 'supply'
  | 'borrow'
  | 'repay'
  | 'withdraw'
  | 'stake'
  | 'unstake'
  | 'vault_deposit'
  | 'vault_withdraw'
  | 'swap'
  | 'bridge'
  | 'onramp'
  | 'offramp';

/**
 * Ecosystem-level identifier. EVM chains use their numeric chainId; non-EVM
 * ecosystems use a literal string. CAIP-2 mapping is handled elsewhere — this
 * is the in-process key the resolver uses.
 */
export type ChainKey = number | 'solana' | 'xrpl' | 'aptos' | 'cosmos';

export type EcosystemKey = 'evm' | 'solana' | 'xrpl' | 'aptos' | 'cosmos';

/** Self-custody DeFi operations the user's wallet can perform directly. */
const SELF_CUSTODY_DEFI_OPERATIONS: ReadonlyArray<PartnerOperation> = Object.freeze([
  'supply',
  'borrow',
  'repay',
  'withdraw',
  'stake',
  'unstake',
  'vault_deposit',
  'vault_withdraw',
  'swap',
]);

/** EVM chains that Astryum supports for self-custody DeFi via the user's wallet. */
const EVM_DEFI_CHAINS: ReadonlyArray<ChainKey> = Object.freeze([
  1,       // Ethereum
  42161,   // Arbitrum
  8453,    // Base
  10,      // Optimism
  137,     // Polygon
  56,      // BSC
  43114,   // Avalanche
  100,     // Gnosis
  14,      // Flare
]);

export interface RegisteredPartner {
  /** Provider id — stable identifier referenced from intents, audit logs, UI. */
  readonly id: string;
  /** Display name shown to the user before they authorize. */
  readonly displayName: string;
  /**
   * Tier classification (2026-06-01 audit §1.3).
   * Determines resolver semantics and which fee/audit rules apply.
   */
  readonly type: PartnerType;
  /**
   * Whether this partner is currently enabled. Default WALLET_PARTNER entries
   * are always enabled (the user's own wallet has no env gate). Aggregators
   * and CASPs typically gate on API keys.
   */
  readonly enabled: () => boolean;
  /** Operations the partner can route. */
  readonly operations: ReadonlyArray<PartnerOperation>;
  /** Chains the partner supports. Numeric for EVM, string literal for non-EVM. */
  readonly chains: ReadonlyArray<ChainKey>;
  /**
   * Optional whitelist of DefiLlama protocol slugs the partner can route to.
   * When unset, the partner is treated as universal for its `operations` and
   * `chains` (e.g. the user's own wallet can interact with ANY protocol —
   * subject to PolicyGuard + allowlist).
   */
  readonly protocolSlugs?: ReadonlyArray<string>;
  /**
   * Whether Astryum is permitted to embed a referral/integrator fee in
   * intents routed through this partner. Wallet partners + aggregators where
   * the protocol exposes a referrer field → true. Partners with surplus-share
   * models (CoW) or gasless models (UniswapX) → false.
   */
  readonly allowsReferralFee: boolean;
  /**
   * Regulatory jurisdictions where the partner is licensed (informational —
   * surfaced in the audit log + UI disclosure).
   */
  readonly jurisdictions: ReadonlyArray<string>;
  /** Short human-readable rationale shown in disclosure copy and audit log. */
  readonly disclosureText: string;
  /**
   * Resolution priority (higher = preferred). Default wallet partners get
   * priority 0 so they only win when no value-add aggregator is enabled.
   * Aggregators get 50–80 depending on value-add. Allows the resolver to
   * pick the "best" enabled partner deterministically.
   */
  readonly priority: number;
}

// ─── PARTNER DEFINITIONS ─────────────────────────────────────────────────────

const PARTNERS: ReadonlyArray<RegisteredPartner> = Object.freeze([
  // ───────────────────────────────────────────────────────────────────────────
  // TIER 1 — WALLET_PARTNER — default per-ecosystem self-custody
  // ───────────────────────────────────────────────────────────────────────────
  // These are ALWAYS enabled. The "partner" is the user's own wallet
  // (MetaMask, WalletConnect, Phantom, Xaman, Petra). Astryum builds calldata,
  // the wallet shows it to the user, the user signs, the wallet broadcasts.
  // They serve as the resolver's fallback for self-custody DeFi so the user
  // never gets blocked by lack of an aggregator API key.
  {
    id: 'wallet-evm-defi',
    displayName: 'Your EVM Wallet',
    type: 'WALLET_PARTNER',
    enabled: () => true,
    operations: SELF_CUSTODY_DEFI_OPERATIONS,
    chains: EVM_DEFI_CHAINS,
    // No protocolSlugs whitelist — the user's wallet can interact with any
    // protocol allowed by PolicyGuard + allowlist.
    allowsReferralFee: true,
    jurisdictions: ['Self-custody (not a service provider)'],
    disclosureText:
      'Your wallet (MetaMask/WalletConnect/Coinbase/Rabby/Bifrost) signs and broadcasts. ' +
      'Astryum builds the unsigned tx — you authorize it in your wallet.',
    priority: 0,
  },
  {
    id: 'wallet-solana-defi',
    displayName: 'Your Solana Wallet',
    type: 'WALLET_PARTNER',
    enabled: () => true,
    operations: SELF_CUSTODY_DEFI_OPERATIONS,
    chains: ['solana'],
    allowsReferralFee: true,
    jurisdictions: ['Self-custody (not a service provider)'],
    disclosureText:
      'Your Solana wallet (Phantom/Solflare) signs and broadcasts. Astryum never holds the key.',
    priority: 0,
  },
  {
    id: 'wallet-xrpl-defi',
    displayName: 'Your XRPL Wallet (Xaman)',
    type: 'WALLET_PARTNER',
    enabled: () => true,
    operations: SELF_CUSTODY_DEFI_OPERATIONS,
    chains: ['xrpl'],
    allowsReferralFee: false,  // XRPL transactions do not have a referrer field
    jurisdictions: ['Self-custody (not a service provider)'],
    disclosureText:
      'Xaman shows the unsigned XRPL transaction on your phone; you sign there. Astryum never holds the seed.',
    priority: 0,
  },
  {
    id: 'wallet-aptos-defi',
    displayName: 'Your Aptos Wallet (Petra)',
    type: 'WALLET_PARTNER',
    enabled: () => true,
    operations: SELF_CUSTODY_DEFI_OPERATIONS,
    chains: ['aptos'],
    allowsReferralFee: false,
    jurisdictions: ['Self-custody (not a service provider)'],
    disclosureText: 'Petra signs and broadcasts on Aptos. Astryum never holds the key.',
    priority: 0,
  },

  // ───────────────────────────────────────────────────────────────────────────
  // TIER 1 — WALLET_PARTNER — value-add aggregators
  // ───────────────────────────────────────────────────────────────────────────
  // These also produce unsigned calldata for the user's wallet to sign — same
  // regulatory model as the default wallet partner. They are preferred over
  // the default when they add real value (atomic bundling, MEV protection,
  // better routing) AND they are enabled (env-gated). When their API key is
  // missing, the resolver silently falls back to the default wallet partner.
  {
    id: 'enso',
    displayName: 'Enso Finance',
    type: 'WALLET_PARTNER',
    enabled: () => !!process.env.ENSO_API_KEY,
    operations: ['supply', 'borrow', 'repay', 'withdraw', 'vault_deposit', 'vault_withdraw', 'swap'],
    chains: [1, 42161, 8453, 10, 137, 56, 43114],
    protocolSlugs: [
      'aave-v3', 'compound-v3', 'morpho-blue', 'spark', 'yearn-finance',
      'curve-finance', 'uniswap-v3', 'balancer-v2',
    ],
    allowsReferralFee: true,
    jurisdictions: ['Aggregator (not custodial)'],
    disclosureText:
      'Enso Finance routes the calldata atomically across protocols. Fee: 0.15% via integrator. ' +
      'Astryum never holds funds.',
    priority: 70,
  },
  {
    id: 'moonpay-trade',
    displayName: 'MoonPay Trade',
    type: 'WALLET_PARTNER',
    enabled: () => !!(process.env.MOONPAY_TRADE_API_KEY && process.env.MOONPAY_TRADE_ENABLED === 'true'),
    operations: ['supply', 'borrow', 'repay', 'withdraw', 'swap'],
    chains: [1, 42161, 8453, 10, 137, 56, 43114],
    protocolSlugs: ['aave-v3', 'morpho-blue', 'uniswap-v3', 'curve-finance', 'balancer-v2'],
    allowsReferralFee: true,
    jurisdictions: ['EU (MiCA)', 'UK', 'US (state-by-state)'],
    disclosureText:
      'MoonPay Trade is a regulated B2B DeFi execution partner. Fee: 0.20%. ' +
      'MoonPay is a registered VASP/CASP in EU and UK.',
    priority: 65,
  },
  {
    id: 'oneinch',
    displayName: '1inch Aggregation',
    type: 'WALLET_PARTNER',
    enabled: () => !!(process.env.ONEINCH_API_KEY && process.env.ASTRYUM_FEE_WALLET),
    operations: ['swap'],
    chains: [1, 42161, 8453, 10, 137, 56, 43114],
    allowsReferralFee: true,
    jurisdictions: ['Aggregator (not custodial)'],
    disclosureText: '1inch v6 swap aggregation. Fee: 0.25% via integrator. Astryum never holds funds.',
    priority: 60,
  },
  {
    id: 'cowswap',
    displayName: 'CoW Protocol',
    type: 'WALLET_PARTNER',
    enabled: () => true,
    operations: ['swap'],
    chains: [1, 100, 42161, 8453],
    allowsReferralFee: false,
    jurisdictions: ['Aggregator (not custodial)'],
    disclosureText:
      'CoW Protocol MEV-protected batch auction. Revenue via CoW surplus sharing — no explicit fee BPS.',
    priority: 55,
  },
  {
    id: 'uniswapx',
    displayName: 'UniswapX',
    type: 'WALLET_PARTNER',
    enabled: () => true,
    operations: ['swap'],
    chains: [1, 42161, 137, 8453, 10],
    allowsReferralFee: false,
    jurisdictions: ['Aggregator (not custodial)'],
    disclosureText: 'UniswapX Dutch auction. Gasless for swapper.',
    priority: 50,
  },
  {
    id: 'jupiter',
    displayName: 'Jupiter Aggregator',
    type: 'WALLET_PARTNER',
    enabled: () => true,
    operations: ['swap'],
    chains: ['solana'],
    allowsReferralFee: true,
    jurisdictions: ['Aggregator (not custodial)'],
    disclosureText: 'Jupiter Solana swap aggregator. Fee: 0.20% via platformFeeBps.',
    priority: 70,
  },

  // ───────────────────────────────────────────────────────────────────────────
  // TIER 2 — BRIDGE_PARTNER — cross-ecosystem only
  // ───────────────────────────────────────────────────────────────────────────
  // For bridges that cross ARCHITECTURALLY INCOMPATIBLE ecosystems
  // (EVM ↔ Solana, EVM ↔ XRPL, EVM ↔ Aptos). Same-ecosystem cross-chain swaps
  // (Arbitrum → Base) are routed as WALLET_PARTNER swaps via the user's wallet,
  // not as bridges.
  {
    id: 'lifi',
    displayName: 'LI.FI',
    type: 'BRIDGE_PARTNER',
    enabled: () => true,
    operations: ['bridge'],
    chains: [1, 42161, 8453, 10, 137, 56, 43114, 'solana'],
    allowsReferralFee: true,
    jurisdictions: ['Aggregator (not custodial)'],
    disclosureText:
      'LI.FI cross-ecosystem bridge aggregator. Fee: 0.15% via integrator. Astryum never holds funds.',
    priority: 70,
  },
  {
    id: 'squid',
    displayName: 'Squid Router',
    type: 'BRIDGE_PARTNER',
    enabled: () => !!process.env.SQUID_INTEGRATOR_ID,
    operations: ['bridge'],
    chains: [1, 42161, 8453, 10, 137, 56, 43114, 'cosmos'],
    allowsReferralFee: true,
    jurisdictions: ['Aggregator (not custodial)'],
    disclosureText: 'Squid Router Axelar-based cross-chain. Fee: 0.15% via integratorAddress.',
    priority: 65,
  },
  {
    id: 'across',
    displayName: 'Across Protocol',
    type: 'BRIDGE_PARTNER',
    enabled: () => true,
    operations: ['bridge'],
    chains: [1, 42161, 10, 8453, 137],
    allowsReferralFee: false,
    jurisdictions: ['Aggregator (not custodial)'],
    disclosureText: 'Across Protocol ERC-7683 GaslessCrossChainOrder. Relayers settle in ~30s.',
    priority: 55,
  },

  // ───────────────────────────────────────────────────────────────────────────
  // TIER 3 — REGULATED_CASP — fiat on/off-ramp ONLY
  // ───────────────────────────────────────────────────────────────────────────
  // The only flow where Astryum hands to a licensed Crypto-Asset Service
  // Provider. These partners hold the user's fiat funds, perform KYC, and
  // settle the crypto leg.
  {
    id: 'transak',
    displayName: 'Transak',
    type: 'REGULATED_CASP',
    enabled: () => !!process.env.TRANSAK_API_KEY,
    operations: ['onramp'],
    chains: [1, 42161, 8453, 10, 137, 56, 43114, 14],
    allowsReferralFee: true,
    jurisdictions: ['EU (MiCA)', 'UK (FCA)', 'India', 'AU'],
    disclosureText: 'Transak is a regulated fiat on-ramp (FCA-registered, MiCA-aware).',
    priority: 70,
  },
  {
    id: 'meld',
    displayName: 'Meld',
    type: 'REGULATED_CASP',
    enabled: () => !!process.env.MELD_API_KEY,
    operations: ['onramp'],
    chains: [1, 42161, 8453, 10, 137, 56, 43114],
    allowsReferralFee: true,
    jurisdictions: ['EU', 'US'],
    disclosureText: 'Meld is a regulated fiat on-ramp aggregator.',
    priority: 65,
  },
  {
    id: 'moonpay-onramp',
    displayName: 'MoonPay (on-ramp)',
    type: 'REGULATED_CASP',
    enabled: () => process.env.MOONPAY_ENABLED === 'true' || !!process.env.MOONPAY_API_KEY,
    operations: ['onramp', 'offramp'],
    chains: [1, 42161, 8453, 10, 137, 56, 43114],
    allowsReferralFee: true,
    jurisdictions: ['EU (MiCA)', 'UK (FCA)', 'US (state-by-state)'],
    disclosureText: 'MoonPay is a registered VASP/CASP. KYC required.',
    priority: 60,
  },
]);

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/**
 * Derive the ecosystem from a chain key. The resolver needs this to identify
 * cross-ecosystem operations (those that require a BRIDGE_PARTNER) and to
 * fall back to the correct default wallet partner per ecosystem.
 */
export function ecosystemForChain(chain: ChainKey): EcosystemKey {
  if (typeof chain === 'number') return 'evm';
  return chain as EcosystemKey;
}

/**
 * The default WALLET_PARTNER id per ecosystem. Used as the resolver's
 * unconditional fallback for self-custody DeFi.
 */
function defaultWalletPartnerForEcosystem(eco: EcosystemKey): string {
  switch (eco) {
    case 'evm':    return 'wallet-evm-defi';
    case 'solana': return 'wallet-solana-defi';
    case 'xrpl':   return 'wallet-xrpl-defi';
    case 'aptos':  return 'wallet-aptos-defi';
    case 'cosmos': return 'wallet-evm-defi'; // no default Cosmos wallet partner yet
  }
}

// ─── REGISTRY API ────────────────────────────────────────────────────────────

export interface ResolveQuery {
  operation: PartnerOperation;
  chain: ChainKey;
  /** DefiLlama protocol slug — when the operation targets a specific protocol. */
  protocolSlug?: string;
  /**
   * Optional preferred partner id. When set and the partner is enabled and
   * supports the (operation, chain, protocol) tuple, it wins regardless of
   * priority. Use this for user-driven overrides ("I want this swap via CoW").
   */
  preferred?: string;
  /**
   * If true, the resolver MUST return a WALLET_PARTNER (never a CASP/bridge
   * as fallback). Default true for self-custody DeFi operations.
   */
  requireSelfCustody?: boolean;
}

class PartnerRegistry {
  /** All partner definitions, regardless of enabled state. */
  list(): ReadonlyArray<RegisteredPartner> {
    return PARTNERS;
  }

  /** Currently-enabled partner ids (env-gated). */
  enabledIds(): ReadonlyArray<string> {
    return PARTNERS.filter((p) => p.enabled()).map((p) => p.id);
  }

  /** Look up a partner by id, regardless of enabled state. */
  get(id: string): RegisteredPartner | null {
    return PARTNERS.find((p) => p.id === id) ?? null;
  }

  /** List enabled partners of a given tier. */
  listByType(type: PartnerType): ReadonlyArray<RegisteredPartner> {
    return PARTNERS.filter((p) => p.enabled() && p.type === type);
  }

  /**
   * Resolve a partner for a given operation + chain (+ optional protocol slug).
   *
   * Resolution semantics (three-tier model):
   *
   *   1. If `preferred` is provided AND that partner is enabled AND supports
   *      the (operation, chain, protocol) → return it (user override wins).
   *
   *   2. For onramp / offramp → only REGULATED_CASP candidates considered.
   *      Returns null if no enabled CASP matches (fail-loud — operation
   *      genuinely does not exist without a fiat partner).
   *
   *   3. For bridge → only BRIDGE_PARTNER candidates considered. Returns null
   *      if no enabled bridge matches.
   *
   *   4. For self-custody DeFi (supply/borrow/...../swap):
   *        a. Enabled WALLET_PARTNER aggregators that explicitly support the
   *           protocolSlug (Enso for aave-v3) — best priority wins.
   *        b. Enabled WALLET_PARTNER aggregators without a protocolSlug
   *           whitelist (1inch/CoW universal swap routers) — best priority wins.
   *        c. The ecosystem's default wallet partner (wallet-evm-defi etc.) —
   *           ALWAYS enabled, ALWAYS the safety net.
   *
   *   Returns null only if (a) operation is onramp/offramp/bridge AND no enabled
   *   partner matches, or (b) the chain's ecosystem has no default wallet
   *   partner registered. Self-custody DeFi NEVER returns null.
   */
  resolveForOperation(q: ResolveQuery): RegisteredPartner | null {
    // 1. Honor preferred override first
    if (q.preferred) {
      const pref = this.get(q.preferred);
      if (pref && pref.enabled() && this._matches(pref, q)) {
        return pref;
      }
    }

    const isFiat = q.operation === 'onramp' || q.operation === 'offramp';
    const isBridge = q.operation === 'bridge';

    if (isFiat) {
      // Only CASPs may handle fiat. No fallback to wallet partner — there
      // is no self-custody path for fiat-to-crypto onboarding.
      const candidates = PARTNERS.filter(
        (p) => p.enabled() && p.type === 'REGULATED_CASP' && this._matches(p, q),
      );
      return this._highestPriority(candidates);
    }

    if (isBridge) {
      // Only BRIDGE_PARTNERs may handle cross-ecosystem bridges.
      const candidates = PARTNERS.filter(
        (p) => p.enabled() && p.type === 'BRIDGE_PARTNER' && this._matches(p, q),
      );
      return this._highestPriority(candidates);
    }

    // ── Self-custody DeFi: prefer enabled aggregators, fall back to wallet ──
    const aggregators = PARTNERS.filter(
      (p) =>
        p.enabled() &&
        p.type === 'WALLET_PARTNER' &&
        // Default wallets have priority 0; only aggregators rank above them.
        p.priority > 0 &&
        this._matches(p, q),
    );
    const bestAggregator = this._highestPriority(aggregators);
    if (bestAggregator) return bestAggregator;

    // Fallback: the ecosystem's default wallet partner (always enabled).
    const eco = ecosystemForChain(q.chain);
    const defaultId = defaultWalletPartnerForEcosystem(eco);
    const def = this.get(defaultId);
    if (def && def.enabled() && this._matches(def, q)) return def;

    // No matching default wallet partner for this ecosystem → null.
    return null;
  }

  /** Pick the highest-priority partner from a candidate list. */
  private _highestPriority(candidates: ReadonlyArray<RegisteredPartner>): RegisteredPartner | null {
    if (candidates.length === 0) return null;
    return [...candidates].sort((a, b) => b.priority - a.priority)[0];
  }

  /** Does this partner satisfy the resolve query (operation + chain + protocol)? */
  private _matches(p: RegisteredPartner, q: ResolveQuery): boolean {
    if (!p.operations.includes(q.operation)) return false;
    if (!p.chains.includes(q.chain)) return false;
    if (q.protocolSlug && p.protocolSlugs && !p.protocolSlugs.includes(q.protocolSlug)) {
      return false;
    }
    return true;
  }
}

export const partnerRegistry = new PartnerRegistry();
