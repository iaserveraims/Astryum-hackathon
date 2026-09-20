/**
 * protocols — the catalogue as DATA: who offers what, and what is true about it.
 *
 * Why this exists (founder, 2026-08-23). Today a card IS a route with the asset
 * welded inside (`FXRP → Kinetic (carry)`), so every protocol × action × asset
 * combination is one more card, and the identity of a protocol lives smeared
 * across routes: PRODUCT_META repeats Kinetic twice, with two different texts,
 * and /product-info is indexed by route rather than by protocol.
 *
 * The shape here is the one the screen needs: a PROTOCOL is an entity, an
 * ACTION of that protocol is what a card shows, and the TYPOLOGY decides which
 * of its actions is on screen. Kinetic is one card that shows `supply` under
 * "earn" and `supply + borrow` under "cash" — not two cards.
 *
 * ADDITIVE ON PURPOSE: nothing here replaces strategyTaxonomy or DEMO_VAULTS
 * yet. Both keep working exactly as they do, and the test suite pins that this
 * file and strategyTaxonomy can never disagree about where a route belongs. A
 * second source of truth is only safe while something forces the two to agree.
 *
 * NOT a recommendation surface (invariant #9): every field is a FACT about the
 * route — what it does, who decides, what can happen to you, where the number
 * comes from. Nothing ranks and nothing promises.
 */

import type { VaultKind } from '@/components/earn/FlareDemoEarn';

/* ── What the user wants to happen ───────────────────────────────────────── */

/**
 * The five typologies the ecosystem actually needs (the 2026-08-23 Flare
 * sweep). Only three have a connected product today; `fixed` and `liquidity`
 * are declared so the screen is built for them and they appear the day Ēnosys
 * and Spectra have a connector — not as a hole, as an empty shelf.
 */
export type TypologyId = 'earn' | 'cash' | 'fixed' | 'liquidity';

export interface Typology {
  id: TypologyId;
  /** English IS the i18n key (house rule). */
  title: string;
  /** The factual line under the heading — never a promise. */
  sub: string;
  /** false = declared for the future; no product connected yet. */
  live: boolean;
}

export const TYPOLOGIES: Typology[] = [
  {
    id: 'earn',
    // Aquí vive TAMBIÉN la delegación al FTSO (fundador, 23-ago: «back the
    // network debe estar en make it earn porque al final es lo mismo»). Y tiene
    // razón: desde la pregunta del usuario —«que mi dinero rinda sin deuda»— un
    // FTSO es un sitio más donde ponerlo a trabajar. Que el token no se mueva de
    // la wallet es un HECHO de esa card, no una tipología aparte.
    title: 'Make it earn, simply',
    sub: 'Lend, stake, delegate or deposit in a vault — no debt, nothing that can be liquidated.',
    live: true,
  },
  {
    id: 'cash',
    title: 'Get cash without selling',
    sub: 'Your tokens stay as collateral and you borrow against them — this one can be liquidated.',
    live: true,
  },
  {
    id: 'fixed',
    title: 'Lock in your rate',
    sub: 'Know today what you will hold on a given date — with a maturity, and a penalty for leaving early.',
    live: false,
  },
  {
    id: 'liquidity',
    title: 'Provide liquidity',
    sub: 'Earn the fees of a market, carrying impermanent loss while you do.',
    live: false,
  },
];

/* ── Who offers it ───────────────────────────────────────────────────────── */

export type ProtocolId =
  | 'kinetic'
  | 'morpho'
  | 'firelight'
  | 'upshift-earnxrp'
  | 'upshift-monarq'
  | 'ftso';

/**
 * The technical family decides the adapter, not the brand: two implementations
 * cover the whole current catalogue, and a seventh protocol of a known family
 * costs a row rather than a connector.
 */
export type ProtocolFamily = 'compound-v2' | 'morpho-blue' | 'erc4626' | 'liquid-staking' | 'ftso';

/**
 * The kind of door, which is what decides the ORDER — never a promise about
 * how fast anyone answers. A help desk beats a chat room, a chat room beats a
 * forum, and a social account is the last resort because it is the one place
 * where nobody owes you an answer.
 */
export type ChannelKind = 'support' | 'chat' | 'forum' | 'docs' | 'social';

const CHANNEL_ORDER: Record<ChannelKind, number> = {
  support: 0,
  chat: 1,
  forum: 2,
  docs: 3,
  social: 4,
};

export interface SupportChannel {
  kind: ChannelKind;
  /**
   * The door as the venue itself names it — «Discord», «Forum», «Help centre».
   * A proper noun: it is NOT passed through t(), because translating the name
   * of a place is how a person stops recognising it.
   */
  name: string;
  url: string;
}

export interface Protocol {
  id: ProtocolId;
  /** What a person calls it. */
  name: string;
  /**
   * The VENUE — the place the money goes, which is not always the product.
   * earnXRP and Monarq are two products of ONE venue (Upshift): the summary
   * shows the venue once, and only on opening it do the two appear with what
   * separates them (who manages, and whether it can be checked on-chain).
   * Collapsing them earlier would hide exactly the fact that matters.
   */
  venue: string;
  /** The company or team behind it, when it is not the same as the name. */
  company?: string;
  website: string;
  family: ProtocolFamily;
  /**
   * A LOCATABLE audit report, or null.
   *
   * The 2026-08-23 sweep found that most of the Flare ecosystem publishes no
   * findable report: only Kinetic (Hacken) and FAssets (Zellic, Coinspect,
   * Code4rena) do. So this field is either a link a person can open, or null —
   * which the card renders as "not published", a true and useful fact. A badge
   * with no link is worse than no badge (#9).
   */
  audit: { firm: string; url: string } | null;
  /**
   * Who to NAME as the builder, when the venue's name is not a team's name.
   * The FTSO is a protocol of the Flare network, not a company, so «FTSO built
   * this» would be a sentence about nobody. Omitted = the venue is the builder.
   */
  builtBy?: string;
  /**
   * The venue's OWN doors — where a person goes when the problem is THEIRS.
   *
   * Why this field exists (founder, 2026-08-28). Astryum already declares the
   * risk it inherits from each venue; what it never gave was the other half of
   * that sentence: an address. Without one, a person whose vault is paused, or
   * whose rate moved, or whose withdrawal is queued, writes to the Astryum
   * Discord — where nobody can do anything about it, because we did not build
   * the thing that broke.
   *
   * Same discipline as `audit` (#9): every entry is a link a person can open,
   * READ FROM THE VENUE'S OWN SITE on 2026-08-28, never guessed. A venue that
   * publishes nothing gets an empty array, which the screen renders as the true
   * fact that it is — a dead invite would be worse than no invite.
   *
   * This does NOT move responsibility. The user still sees the inherited risk
   * declared; this only stops the declaration from being a dead end.
   */
  support: SupportChannel[];
}

/**
 * earnXRP and Monarq are two products of ONE venue, so they share ONE set of
 * doors — written once, because two copies is how they drift.
 * Read from upshift.finance on 2026-08-28.
 */
const UPSHIFT_SUPPORT: SupportChannel[] = [
  { kind: 'chat', name: 'Discord', url: 'https://discord.gg/eMGRewH6vY' },
  { kind: 'chat', name: 'Telegram', url: 'https://t.me/upshiftfi' },
  { kind: 'docs', name: 'Docs', url: 'https://docs.upshift.finance' },
  { kind: 'social', name: 'X', url: 'https://x.com/upshift_fi' },
];

export const PROTOCOLS: Record<ProtocolId, Protocol> = {
  kinetic: {
    id: 'kinetic',
    name: 'Kinetic',
    venue: 'Kinetic',
    website: 'https://kinetic.market',
    family: 'compound-v2',
    audit: { firm: 'Hacken', url: 'https://hacken.io' },
    // kinetic.market footer. The Telegram is the FLARE group specifically —
    // Kinetic also runs a Stellar one, and sending a Flare question there is
    // sending it to the wrong room.
    support: [
      { kind: 'chat', name: 'Discord', url: 'https://discord.com/invite/UvnDV44maD' },
      { kind: 'chat', name: 'Telegram', url: 'https://t.me/+kUPwG44Ssg5mZThh' },
      { kind: 'docs', name: 'Docs', url: 'https://docs.kinetic.market/' },
      { kind: 'social', name: 'X', url: 'https://x.com/Kinetic_Markets' },
    ],
  },
  morpho: {
    id: 'morpho',
    name: 'Morpho',
    venue: 'Morpho',
    company: 'Lend side curated by Sentora',
    website: 'https://app.morpho.org',
    family: 'morpho-blue',
    audit: null,
    // morpho.org footer. Morpho runs no Discord: it publishes a help centre and
    // a governance forum, which is why the order here starts at `support`.
    support: [
      { kind: 'support', name: 'Help centre', url: 'https://help.morpho.org/' },
      { kind: 'forum', name: 'Forum', url: 'https://forum.morpho.org/' },
      { kind: 'docs', name: 'Docs', url: 'https://docs.morpho.org/' },
      { kind: 'social', name: 'X', url: 'https://x.com/Morpho' },
    ],
  },
  firelight: {
    id: 'firelight',
    name: 'Firelight',
    venue: 'Firelight',
    website: 'https://firelight.finance',
    family: 'liquid-staking',
    audit: null,
    // firelight.finance publishes no chat room and no help desk — only docs and
    // an X account. That is the whole list, and the screen says so rather than
    // inventing a door: the same venue whose exit is an unbonding queue is also
    // the one with the fewest places to ask about it.
    support: [
      { kind: 'docs', name: 'Docs', url: 'https://docs.firelight.finance/' },
      { kind: 'social', name: 'X', url: 'https://x.com/Firelightfi' },
    ],
  },
  'upshift-earnxrp': {
    id: 'upshift-earnxrp',
    name: 'earnXRP',
    venue: 'Upshift',
    company: 'Upshift · curated on-chain by Clearstar',
    website: 'https://app.upshift.finance',
    family: 'erc4626',
    audit: null,
    support: UPSHIFT_SUPPORT,
  },
  'upshift-monarq': {
    id: 'upshift-monarq',
    name: 'Monarq',
    venue: 'Upshift',
    company: 'Upshift · managed off-chain by Monarq Asset Management',
    website: 'https://app.upshift.finance',
    family: 'erc4626',
    audit: null,
    // The doors are Upshift's, and for this product that is exactly the fact
    // worth seeing: the strategy is Monarq's and off-chain, but the place that
    // holds the money — and the place you can write to — is Upshift.
    support: UPSHIFT_SUPPORT,
  },
  ftso: {
    id: 'ftso',
    name: 'FTSO',
    venue: 'FTSO',
    company: 'Flare',
    website: 'https://flare.network',
    family: 'ftso',
    audit: null,
    builtBy: 'Flare',
    // flare.network footer + its own /resources/technical-support page.
    support: [
      { kind: 'support', name: 'Technical support', url: 'https://flare.network/resources/technical-support' },
      { kind: 'chat', name: 'Discord', url: 'https://discord.com/invite/flarenetwork' },
      { kind: 'forum', name: 'Forum', url: 'https://forum.flare.network' },
    ],
  },
};

/* ── What can happen to you ──────────────────────────────────────────────── */

/**
 * NOT a boolean. Lodestar (fixed-term loans on Flare) can never liquidate you
 * on price and CAN take your collateral on the calendar, so a two-state field
 * would be wrong the day it is integrated — and Ēnosys will need the same
 * vocabulary.
 */
export type Liquidation = 'none' | 'price' | 'calendar';

/** Who chooses where the money actually goes. The fact that separates earnXRP
 *  from Monarq, and the one a person most wants to know. */
export type Decides = 'you' | 'protocol' | 'curator' | 'offchain-manager';

/** How the money comes back out. `cooldown`/`epoch` mean it cannot host capital
 *  that might have to repay a debt today (the stop-loss cushion rule). */
export type ExitKind = 'anytime' | 'cooldown' | 'epoch' | 'liquidity' | 'repay-first';

export interface RiskFacts {
  liquidation: Liquidation;
  decides: Decides;
  /** Can a person check the strategy on-chain? Monarq: no, and it says so. */
  verifiable: boolean;
  exit: ExitKind;
  /** One factual line about the exit, when it needs one. */
  exitNote?: string;
}

/* ── What a card shows ───────────────────────────────────────────────────── */

export type ActionId = 'lend' | 'borrow' | 'stake' | 'vault' | 'delegate';

/**
 * What has to be chosen INSIDE a card, which is not always an asset — the hole
 * the sweep exposed. A lending market picks a market by asset; a vault picks
 * the VAULT (earnXRP and Monarq are both FXRP; what changes is the manager);
 * FTSO picks the data PROVIDER; liquid staking picks nothing.
 */
export type ParamOf = 'market' | 'vault' | 'provider' | 'none';

/** Where the live number comes from. No source, no number (#9). */
export type RateSource = 'onchain' | 'defillama' | 'protocol-api' | 'none';

/** How the remaining room is read, when the venue has a cap at all. */
export type CapSource = 'erc4626-max-deposit' | 'protocol-api' | null;

export interface ProductAction {
  protocol: ProtocolId;
  id: ActionId;
  typology: TypologyId;
  /**
   * The route that EXECUTES this action today, or null when it can be read but
   * not signed. The screen never offers a button for a null.
   */
  kind: VaultKind | null;
  /** Assets this action can be signed with today. Reading is wider than this. */
  assets: string[];
  /** The asset that comes out on the debt side — `borrow` only, and today it is
   *  a FACT, not a menu: each market pays out exactly one. */
  debtAsset?: string;
  param: ParamOf;
  risk: RiskFacts;
  rate: RateSource;
  cap: CapSource;
  /** The prepare route that takes the money OUT. Entering by one door and
   *  leaving by another is how a catalogue stops being a place. */
  exitRoute?: string;
}

/**
 * The eight live routes, as six products. Kinetic and Morpho each appear twice
 * because they have two actions in two different typologies — same card, other
 * leg — which is exactly what stops the catalogue from multiplying.
 */
export const ACTIONS: ProductAction[] = [
  {
    protocol: 'kinetic',
    id: 'lend',
    typology: 'earn',
    kind: 'e3',
    assets: ['FXRP'],
    param: 'market',
    risk: { liquidation: 'none', decides: 'you', verifiable: true, exit: 'anytime' },
    rate: 'onchain',
    cap: null,
    exitRoute: '/flare-demo/iso-withdraw/prepare',
  },
  {
    protocol: 'kinetic',
    id: 'borrow',
    typology: 'cash',
    kind: 'e1',
    assets: ['FXRP'],
    debtAsset: 'USDT0',
    param: 'market',
    risk: { liquidation: 'price', decides: 'you', verifiable: true, exit: 'repay-first' },
    rate: 'onchain',
    cap: null,
    exitRoute: '/flare-demo/pa-repay/prepare',
  },
  {
    protocol: 'morpho',
    id: 'lend',
    typology: 'earn',
    kind: 'em-lend',
    assets: ['RLUSD'],
    param: 'vault',
    // No debt on the user's side, but Sentora decides the allocation.
    risk: { liquidation: 'none', decides: 'curator', verifiable: true, exit: 'liquidity',
      exitNote: 'Withdraw against the vault’s live liquidity' },
    rate: 'protocol-api',
    cap: null,
  },
  {
    protocol: 'morpho',
    id: 'borrow',
    typology: 'cash',
    kind: 'em-carry',
    assets: ['FXRP'],
    debtAsset: 'RLUSD',
    // Morpho Blue markets are FIXED PAIRS: with FXRP collateral only what is
    // deployed exists, so this is never an open menu.
    param: 'market',
    risk: { liquidation: 'price', decides: 'you', verifiable: true, exit: 'repay-first' },
    rate: 'onchain',
    cap: null,
  },
  {
    protocol: 'firelight',
    id: 'stake',
    typology: 'earn',
    kind: 'v-firelight',
    assets: ['FXRP'],
    param: 'none',
    risk: { liquidation: 'none', decides: 'protocol', verifiable: true, exit: 'cooldown',
      exitNote: 'Unbonding period on the XRP Ledger' },
    // Phase 1: the protocol pays no rewards yet, so there is no rate to show.
    // "—" is the honest answer; a 0% would read as a bad deal instead of a
    // stage of the product.
    rate: 'none',
    // The one that matters: 56.3M FXRP in, ~3.86M of room left (2026-08-23).
    // Read live before offering entry, or a prepared deposit reverts.
    cap: 'erc4626-max-deposit',
    exitRoute: '/flare-demo/vault-withdraw/prepare',
  },
  {
    protocol: 'upshift-earnxrp',
    id: 'vault',
    typology: 'earn',
    kind: 'v-earnxrp',
    assets: ['FXRP'],
    param: 'vault',
    risk: { liquidation: 'none', decides: 'curator', verifiable: true, exit: 'liquidity' },
    rate: 'protocol-api',
    cap: 'erc4626-max-deposit',
    exitRoute: '/flare-demo/vault-withdraw/prepare',
  },
  {
    protocol: 'upshift-monarq',
    id: 'vault',
    typology: 'earn',
    kind: 'v-monarq',
    assets: ['FXRP'],
    param: 'vault',
    // The whole reason this is its own card and not folded into earnXRP: same
    // protocol, same action, same asset — different manager, and off-chain.
    risk: { liquidation: 'none', decides: 'offchain-manager', verifiable: false, exit: 'epoch',
      exitNote: '7-day epoch, or instant with a 0.30% fee' },
    rate: 'protocol-api',
    cap: null,
    exitRoute: '/flare-demo/vault-withdraw/prepare',
  },
  {
    protocol: 'ftso',
    id: 'delegate',
    typology: 'earn',
    kind: 'e2',
    assets: ['FLR'],
    // The parameter is WHICH data provider — /e2/prepare already takes it.
    param: 'provider',
    risk: { liquidation: 'none', decides: 'you', verifiable: true, exit: 'anytime',
      exitNote: 'Undo the delegation at any time' },
    rate: 'protocol-api',
    cap: null,
    exitRoute: '/flare-demo/e2/exit/prepare',
  },
];

/* ── Reading it ──────────────────────────────────────────────────────────── */

/** The actions of one typology, in catalogue order (never ranked, #9). */
export function actionsOfTypology(t: TypologyId): ProductAction[] {
  return ACTIONS.filter((a) => a.typology === t);
}

/** The action a live route belongs to — the bridge to today's VaultKind world. */
export function actionOfKind(kind: VaultKind): ProductAction | null {
  return ACTIONS.find((a) => a.kind === kind) ?? null;
}

export function protocolOf(action: ProductAction): Protocol {
  return PROTOCOLS[action.protocol];
}

/** Who to name as the builder of a venue. Never «Astryum». */
export function builderOf(p: Protocol): string {
  return p.builtBy ?? p.venue;
}

/**
 * The venue's doors, best first — a help desk before a chat room, a chat room
 * before a forum, a social account last. `limit` trims the tail for the tight
 * surfaces (a receipt is not a directory); it never re-orders, so the first
 * door shown is always the best one the venue publishes.
 */
export function channelsOf(p: Protocol, limit?: number): SupportChannel[] {
  const sorted = [...p.support].sort((a, b) => CHANNEL_ORDER[a.kind] - CHANNEL_ORDER[b.kind]);
  return limit == null ? sorted : sorted.slice(0, limit);
}

/** Distinct products behind a typology's actions — what a person counts as
 *  "places", since Kinetic showing two legs is still one Kinetic. */
export function productsOfTypology(t: TypologyId): ProtocolId[] {
  return [...new Set(actionsOfTypology(t).map((a) => a.protocol))];
}

/** Can this action be SIGNED with that asset today? Reading is always wider:
 *  Kinetic has six markets and one of them has a route. */
export function isExecutable(action: ProductAction, asset?: string): boolean {
  if (action.kind === null) return false;
  return asset ? action.assets.includes(asset) : action.assets.length > 0;
}

/**
 * The risk band a route belongs to — DERIVED from the facts, never written by
 * hand, so a label can never contradict the fields underneath it.
 */
export type RiskBand = 'safe' | 'delegated' | 'liquidatable';

export function riskBand(action: ProductAction): RiskBand {
  if (action.risk.liquidation !== 'none') return 'liquidatable';
  if (action.risk.decides === 'curator' || action.risk.decides === 'offchain-manager') {
    return 'delegated';
  }
  return 'safe';
}

export const RISK_BANDS: Array<{ id: RiskBand; title: string; sub: string }> = [
  {
    id: 'safe',
    title: 'Nothing can liquidate you',
    sub: 'No debt, and nobody else decides where your money goes.',
  },
  {
    id: 'delegated',
    title: 'Someone else decides where it goes',
    sub: 'A curator or a manager allocates it — on-chain or off it, and the card says which.',
  },
  {
    id: 'liquidatable',
    title: 'It can be liquidated',
    sub: 'There is debt against your collateral.',
  },
];
