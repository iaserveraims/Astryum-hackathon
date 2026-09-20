/**
 * strategyTaxonomy — ONE vocabulary for the strategy catalogue. The interactive path, the filter chips and the kinship notes
 * all read from here, so the screen can never speak two languages about the
 * same route.
 *
 * WHY OUTCOME FIRST: six of the eight routes are FXRP, so
 * asking for the token first barely narrows anything. What actually separates
 * them is what the user wants to HAPPEN — and it can be asked without DeFi
 * jargon, keeping the mechanism (lend/borrow/stake/vault) as the subtitle.
 *
 * NOT a recommendation surface (invariant #9): every label here is factual
 * (what the route does, what it risks). Nothing ranks, nothing promises.
 */

import type { VaultKind } from '@/components/earn/FlareDemoEarn';

/* ── What the user wants to happen ───────────────────────────────────────── */

export type OutcomeId = 'earn' | 'liquidity' | 'network';

export interface Outcome {
  id: OutcomeId;
  /** English IS the i18n key (house rule). */
  title: string;
  /** The mechanism, said plainly — the subtitle under the outcome. */
  sub: string;
  kinds: VaultKind[];
}

export const OUTCOMES: Outcome[] = [
  {
    id: 'earn',
    title: 'Make it earn, simply',
    sub: 'Lend, stake or deposit in a vault — no debt, nothing that can be liquidated.',
    kinds: ['e3', 'v-firelight', 'v-earnxrp', 'v-monarq', 'em-lend'],
  },
  {
    id: 'liquidity',
    title: 'Get cash without selling',
    sub: 'Your tokens stay as collateral and you borrow against them — this one can be liquidated.',
    kinds: ['e1', 'em-carry'],
  },
  {
    id: 'network',
    title: 'Back the network and get paid',
    sub: 'Delegate to the FTSO — the tokens never leave your wallet.',
    kinds: ['e2'],
  },
];

export function outcomeOf(kind: VaultKind): OutcomeId | null {
  return OUTCOMES.find((o) => o.kinds.includes(kind))?.id ?? null;
}

/* ── The catalogue's COLUMNS — INERTE ────────────────── */

/**
 * NADA DE ESTO SE PINTA HOY. Se deja en pie, sin usar, porque el componente que lo lee
 * —StrategyColumns— también sigue en el árbol: código construido se deja
 * inerte, no se borra, y volver a montarlo es cambiar un elemento por otro.
 *
 * Lo de abajo describe cómo REPARTÍAN esas columnas; nada de ello afecta hoy
 * al camino de filtros ni al orden «sin deuda primero», que leen OUTCOMES.
 */

/**
 * How the catalogue is LAID OUT: two vertical stacks side by side, «make it
 * earn» on the left and «get cash» in the middle. The horizontal hand pushed
 * eight cards across the width and clipped every title after ~20 characters.
 */
export interface CatalogueColumn {
  id: 'earn' | 'liquidity';
  /** English IS the i18n key (house rule). Reused from OUTCOMES on purpose. */
  title: string;
  /** True of EVERY route in the column — see the note above. */
  sub: string;
  outcomes: OutcomeId[];
}

export const CATALOGUE_COLUMNS: CatalogueColumn[] = [
  {
    id: 'earn',
    title: 'Make it earn, simply',
    sub: 'No debt and nothing that can be liquidated — each card says what it does with your tokens.',
    outcomes: ['earn', 'network'],
  },
  {
    id: 'liquidity',
    title: 'Get cash without selling',
    sub: 'Your tokens stay as collateral and you borrow against them — this one can be liquidated.',
    outcomes: ['liquidity'],
  },
];

/** Which column a route belongs to, or null if its outcome is unknown. */
export function columnOf(kind: VaultKind): CatalogueColumn['id'] | null {
  const o = outcomeOf(kind);
  if (!o) return null;
  return CATALOGUE_COLUMNS.find((c) => c.outcomes.includes(o))?.id ?? null;
}

/* ── What it is made of ──────────────────────────────────────────────────── */

export type AssetGroupId = 'xrp' | 'flr' | 'rlusd';

export interface AssetGroup {
  id: AssetGroupId;
  title: string;
  sub: string;
  /** The TokenLogo symbol that represents the group. */
  symbol: string;
  kinds: VaultKind[];
}

export const ASSET_GROUPS: AssetGroup[] = [
  {
    id: 'xrp',
    title: 'XRP',
    sub: 'In Xaman/XRPL, or already as FXRP on Flare',
    symbol: 'XRP',
    kinds: ['e1', 'e3', 'v-firelight', 'v-earnxrp', 'v-monarq', 'em-carry'],
  },
  {
    id: 'flr',
    title: 'FLR',
    sub: 'The Flare network token, in an EVM wallet',
    symbol: 'FLR',
    kinds: ['e2'],
  },
  {
    id: 'rlusd',
    title: 'RLUSD',
    sub: 'Ripple’s stablecoin, on Ethereum',
    symbol: 'RLUSD',
    kinds: ['em-lend'],
  },
];

export function assetGroupOf(kind: VaultKind): AssetGroupId | null {
  return ASSET_GROUPS.find((g) => g.kinds.includes(kind))?.id ?? null;
}

/* ── Routes that share a market ──────────────────────────────────────────── */

/**
 * The two
 * relationships are NOT the same, so neither is the sentence:
 *
 *   · Kinetic — one route is the other PLUS a step (supply, then borrow).
 *   · Morpho  — opposite SIDES of one market: the RLUSD borrowed on one is
 *     lent on the other. Saying so is honest and teaches how a market works.
 *
 * `line` is written from the point of view of the card that carries it.
 */
export interface Kinship {
  /** Chip label — the market both routes share. */
  market: string;
  sibling: VaultKind;
  line: string;
}

export const KINSHIP: Partial<Record<VaultKind, Kinship>> = {
  e3: {
    market: 'Kinetic',
    sibling: 'e1',
    line: 'Same route as the carry, minus its last step: there you also borrow USDT0 against this same deposit.',
  },
  e1: {
    market: 'Kinetic',
    sibling: 'e3',
    line: 'Same route as lend-only, plus one step: the deposit is identical, and here you borrow USDT0 against it.',
  },
  'em-carry': {
    market: 'Morpho',
    sibling: 'em-lend',
    line: 'The other side of this same market: the RLUSD you borrow here is the RLUSD someone lends in the other route.',
  },
  'em-lend': {
    market: 'Morpho',
    sibling: 'em-carry',
    line: 'The other side of this same market: the RLUSD you lend here is what someone borrows in the other route.',
  },
};

/* ── Ordering the list (a user gesture, never a ranking) ─────────────────── */

export type SortId = 'catalogue' | 'rate' | 'risk' | 'market';

export const SORTS: Array<{ id: SortId; title: string }> = [
  { id: 'catalogue', title: 'Default order' },
  { id: 'rate', title: 'Current rate' },
  { id: 'risk', title: 'Without debt first' },
  { id: 'market', title: 'Market' },
];

/** No-debt routes first when sorting by risk — factual, not advice. */
export function hasDebt(kind: VaultKind): boolean {
  return outcomeOf(kind) === 'liquidity';
}
