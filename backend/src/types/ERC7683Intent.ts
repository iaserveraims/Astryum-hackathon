/**
 * ERC-7683 Intent Layer — Types
 *
 * ERC-7683 (Uniswap Labs + Across, ratified 2025) is the standard for cross-chain
 * intents in DeFi — swaps, deposits, staking between chains.
 *
 * IMPORTANT DISTINCTION (common confusion):
 *   ERC-7683 = cross-chain DeFi intents (swaps, bridges, deposits) — THIS FILE
 *   ERC-7824  = Yellow state channels for micropayments / HFT P2P — does NOT access
 *               DeFi pools, does NOT substitute Li.Fi/Enso/Across, not here.
 *
 * CanonicalIntent: high-level user intent that enters ERC-7683 solver competition.
 * Solvers that compete: Li.Fi · Across · UniswapX · CoW · 1inch Fusion+
 *
 * Flow:
 *   1. User expresses intent (CanonicalIntent)
 *   2. Multiple solvers receive it and return SolverQuote[]
 *   3. Best quote (highest outputAmount, canFill=true) wins
 *   4. Winning solver's IntentPayload (with erc7683 extension) goes to WalletSignTab
 *   5. User signs. Astryum never signs.
 */

/** Constraints that the user places on intent execution */
export interface CanonicalIntentConstraints {
  /** Risk score ceiling 0-100; intent blocked if portfolio risk would exceed this */
  maxRiskScore?: number;
  /** ISO 3166-1 alpha-2 country code (e.g. 'US', 'DE') — for future KYC/AML gating */
  jurisdiction?: string;
  /** Max capital as % of portfolio value (0–10000 basis points) */
  maxCapitalBps?: number;
  /** Required by some RWA protocols (Soil/RLUSD) — gated by KYC provider */
  kycVerified?: boolean;
}

/**
 * CanonicalIntent — the high-level description of what the user wants to do.
 * This is the INPUT to the solver competition, not the output.
 * ERC-7683 fillDeadline maps to execution_deadline.
 */
export interface CanonicalIntent {
  /** Human-readable goal: "Bridge 1000 USDC to Arbitrum" */
  goal: string;
  constraints: CanonicalIntentConstraints;
  /** ERC-7683 fillDeadline — unix timestamp, solvers must fill before this */
  execution_deadline: number;

  // ── Chain routing ──────────────────────────────────────────────────────────
  originChainId: number;
  /** Equal to originChainId for same-chain swaps */
  destinationChainId: number;

  // ── Token flow ─────────────────────────────────────────────────────────────
  /** ERC-20 address on origin chain. 0xEeee…EEeE = native */
  inputToken: string;
  /** In smallest unit (wei) */
  inputAmount: string;
  /** Desired output token address on destination chain */
  outputToken: string;
  /** Minimum acceptable output — slippage bound */
  minOutputAmount?: string;
  /** Recipient wallet on destination chain */
  recipient: string;

  // ── Meta ───────────────────────────────────────────────────────────────────
  intentId: string;
  createdAt: string;
  /** Wallet address of the initiating user */
  requestor: string;
}

/** One solver's response to a CanonicalIntent */
export interface SolverQuote {
  /** Provider id: 'across' | 'uniswapx' | 'lifi' | 'oneinch' | 'cow' */
  solverId: string;
  /** What the user receives on destination chain (wei string) */
  outputAmount: string;
  /** Combined protocol + relayer fee in basis points */
  feeBps: number;
  /** Expected seconds until the order is filled */
  estimatedFillSeconds: number;
  /** Unix timestamp — order expires if not filled by this time */
  fillDeadline: number;
  /**
   * ERC-7683 originSettler — the contract the user signs to.
   * Across: SpokePool address on origin chain.
   * UniswapX: ExclusiveDutchOrderReactor address.
   */
  originSettler: string;
  canFill: boolean;
  rejectReason?: string;
}

/** Metadata about the solver competition run for a given CanonicalIntent */
export interface SolverCompetition {
  canonicalIntentId: string;
  solversQueried: string[];
  quotes: SolverQuote[];
  /** Highest outputAmount among canFill=true quotes, null if none could fill */
  bestQuote: SolverQuote | null;
  competedAt: string;
}

/**
 * ERC-7683 extension added to IntentPayload when a standard-compliant solver wins.
 * Attached as the optional `erc7683` field on IntentPayload.
 */
export interface ERC7683Extension {
  standard: 'ERC-7683';
  /**
   * GaslessCrossChainOrder — user signs off-chain, relayer submits.
   * OnchainCrossChainOrder — user calls contract directly (less common).
   */
  orderType: 'GaslessCrossChainOrder' | 'OnchainCrossChainOrder';
  /** Contract address that the user's signature is directed to (the ERC-7683 settler) */
  originSettler: string;
  /** Unix timestamp — the order's hard deadline */
  fillDeadline: number;
  /** Full competition record — disclosed to user and stored in AuditLog */
  solverCompetition: SolverCompetition;
}
