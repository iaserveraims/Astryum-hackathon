/**
 * Platform log — the "noticiero" behind the Summary's Orbit System card.
 * RULES (v2, founder 2026-07-26: "no quiero que dé tanto detalle"):
 *
 *   - Append a new entry (TOP of the array) with every user-visible release,
 *     bumping the version — PLATFORM_VERSION is DERIVED from the newest entry,
 *     so the card's chip bumps with it automatically.
 *   - DETAIL ONLY FOR DEFI: items of kind 'defi' (new capabilities or DeFi
 *     improvements — what the platform can now DO with the user's capital)
 *     carry their own es/en line. Everything else — performance, behaviour,
 *     visual, security — is listed WITHOUT text: the card renders one generic
 *     line per kind ("Mejoras de rendimiento", …). The user only needs to
 *     know the ship improved; the specifics live in git, not in their face.
 *   - Real, shipped features only — never roadmap, never promises, never
 *     yields (copy invariant §9). Write both languages on defi items.
 */

export type ChangeKind = 'defi' | 'performance' | 'behavior' | 'visual' | 'security';

export interface ChangeItem {
  kind: ChangeKind;
  /** Required for 'defi' items; ignored for every other kind. */
  es?: string;
  en?: string;
}

export interface ChangelogEntry {
  version: string;
  /** ISO date the release landed. */
  date: string;
  items: ChangeItem[];
}

/** The generic line each non-DeFi kind collapses into. */
export const KIND_LABEL: Record<Exclude<ChangeKind, 'defi'>, { es: string; en: string }> = {
  performance: { es: 'Mejoras de rendimiento', en: 'Performance improvements' },
  behavior: { es: 'Mejoras de comportamiento', en: 'Behaviour improvements' },
  visual: { es: 'Mejoras estéticas', en: 'Visual polish' },
  security: { es: 'Refuerzos de seguridad', en: 'Security hardening' },
};

export const CHANGELOG: ChangelogEntry[] = [
  {
    // Founder batch 2026-08-12: (1) wallet rows/cards show EVERY readable
    // token with its money in plain sight (qty when priced + USD on the
    // chip) — a wallet holding ~10 FXRP no longer reads «0 FLR» and nothing
    // else; (2) clicking a wallet on Home lands Portfolio on Overview with
    // the wallet pre-selected (tab=overview explicit — the page used to
    // restore the last lens); (3) the strategy finder gained a result step
    // that TEACHES each matching route (plain sentence, live rate with
    // source, risk fact, answers echoed back) before landing on the cards.
    version: '0.9.40',
    date: '2026-08-12',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // Legacy pointers now have an owner: switching to a different signed-in
    // account wipes the previous user's on-device Legacy traces (pointers,
    // nicknames, drafts, plans) BEFORE the registry sync runs — a second
    // email no longer inherits, nor registers as its own, the first
    // account's Legacies. Same clean-start philosophy as the wallet-session
    // release on account switch.
    version: '0.9.39',
    date: '2026-08-11',
    items: [{ kind: 'security' }, { kind: 'behavior' }],
  },
  {
    // Removing a Legacy from "My Legacies" now removes ALL its local traces
    // — nickname, constitution draft, council plan — so re-adding it starts
    // clean instead of resurrecting half-written work. The ledger side is
    // untouched by design: the wizard still honestly resumes whatever the
    // chain says is done.
    version: '0.9.38',
    date: '2026-08-11',
    items: [{ kind: 'behavior' }],
  },
  {
    // The constitution is born in the page's language: template bodies are
    // bilingual now (Spanish untouched; faithful English twins), the builder
    // assembles in the active language, the [PENDING]/[PENDIENTE] marker and
    // linguistic defaults follow along. The user still rewrites the document
    // freely — the anchored text is whatever they edit.
    version: '0.9.37',
    date: '2026-08-11',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // The constitution builder speaks one language at a time: its field
    // placeholders were Spanish literals leaking into the English UI — now
    // they are t() keys like the labels, English page shows English hints,
    // Spanish page keeps the exact hints it always had.
    version: '0.9.36',
    date: '2026-08-08',
    items: [{ kind: 'visual' }],
  },
  {
    // The signature ceremony moved INSIDE each operation (founder: the
    // full-screen blur takeover felt bolted-on): SignedMark — the same
    // stroke + seal, compact — now plays once in the operation's own
    // progress view (SettlementIndicator on every EVM/Flare flow, the QR
    // cover in Xaman signatures) and rests there as the signed emblem while
    // settlement continues. The shell-level overlay is retired.
    version: '0.9.35',
    date: '2026-08-08',
    items: [{ kind: 'visual' }],
  },
  {
    // The "XRPL 1" mystery solved at the root: the backend used to INVENT a
    // "<Chain> n" nickname for every unnamed wallet, and since the nickname
    // wins the display rule, it shadowed the provider name on every surface.
    // The generator is retired (nickname stays NULL), and rows already
    // carrying the machine pattern are neutralised at display time — the
    // founder's Xaman reads "Xaman" again in Wallets, Summary and Portfolio.
    version: '0.9.34',
    date: '2026-08-08',
    items: [{ kind: 'behavior' }],
  },
  {
    // Sidebar slimmed (founder): the search row is gone — questions go to the
    // Co-pilot (⌘K survives as a keyboard-only shortcut) — and the ES/EN
    // toggle moved into Settings › Preferences, next to the theme.
    version: '0.9.33',
    date: '2026-08-08',
    items: [{ kind: 'behavior' }],
  },
  {
    // Founder batch 2026-08-08: (1) the floating bottom-right settlement
    // cards moved into the sidebar under "To sign" as a minimised "In
    // progress" card that also picks up ops signed mid-session; (2) a
    // signature ceremony (login-manifest vocabulary: self-drawing stroke +
    // seal) plays on every successful signature and points at that card;
    // (3) Earn's pick view gained the two-question StrategyFinder that
    // FILTERS the six routes (never recommends); (4) the Wallets screen now
    // shows what each wallet holds (shared walletHoldings reading) and every
    // surface resolves wallet names through ONE rule (nickname → provider →
    // short address; dedupe merges identity across duplicate rows — the
    // "Xaman here, XRPL 1 there" split is gone).
    version: '0.9.32',
    date: '2026-08-08',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // Full i18n pass (founder: "hay textos que no se traducen"): 352 t() keys
    // that fell back to English in ES got their Spanish (Legacy vault/cage
    // surfaces, founders panel, position modals, governed movements…), and 12
    // components whose copy was HARDCODED (security settings, chain matrix,
    // error boundary, shell a11y labels, charts, access gates) now go through
    // t() — the AST audit reports 0 missing keys. The Orbit System log shows
    // the last 12 versions instead of 4, so DeFi entries stop vanishing.
    version: '0.9.31',
    date: '2026-08-08',
    items: [{ kind: 'behavior' }],
  },
  {
    // The gold standalone mark is now the neon-glow asteroid (cropped square
    // from astryum_logo-nobackground.png, founder's pick) in the copilot
    // avatar, the cream footer and the to-personal crossing — new filename
    // so no cache can keep serving the old crop.
    version: '0.9.30',
    date: '2026-08-08',
    items: [{ kind: 'visual' }],
  },
  {
    // First-wallet guide for exchange-only users: a step-by-step wizard
    // (Xaman·XRPL / MetaMask·Flare — install, guard the secret, withdraw from
    // the exchange, connect) opened from the Summary's welcome panel and from
    // Add Wallet's "I don't have a wallet yet" row; /app/wallets?add=1 lands
    // with the connect door already open. Plus the brand third pass (founder
    // review): marks re-cropped square and TEXT-FREE (the gold one carried a
    // sliver of the wordmark's "A" — visible in the copilot avatar, footer
    // and crossing), the crossing choreography re-aired for the bigger marks,
    // and the Legacy sun re-composed to the gold hero's exact geometry so
    // both suns render the same size.
    version: '0.9.29',
    date: '2026-08-08',
    items: [
      {
        kind: 'defi',
        es: 'Guía interactiva de primera wallet: de un exchange a tu propia wallet conectada, paso a paso (Xaman en XRPL o MetaMask en Flare).',
        en: 'Interactive first-wallet guide: from an exchange to your own connected wallet, step by step (Xaman on XRPL or MetaMask on Flare).',
      },
      { kind: 'visual' },
    ],
  },
  {
    // Brand pass, round two (founder review): the crossing marks are BIGGER
    // (tight crops — the huge transparent canvases read tiny), the abstract
    // homeward comet is gone (the gold mark IS the centre), the landing's
    // solar-system sun follows the product (blue asteroid in Legacy), the
    // cream footer wears the real mark per product, and the copilot avatar
    // shows its product's asteroid.
    version: '0.9.28',
    date: '2026-08-08',
    items: [{ kind: 'visual' }],
  },
  {
    // The brand dresses for the product: in Legacy the sidebar/mobile lockup
    // (and the landing header) turn to the blue asteroid, and each crossing
    // now carries its destination's own mark — the blue asteroid ignites at
    // the constellation's heart entering Legacy; the gold one blooms at the
    // centre riding home.
    version: '0.9.27',
    date: '2026-08-08',
    items: [{ kind: 'visual' }],
  },
  {
    // The ceremony holds your hand: a fixed station header (n/6 · name ·
    // purpose · honest effort estimate), a first-contact orientation card
    // ("six stations, one irreversible moment — gated"), a folded 60-second
    // "never created a Xaman account" primer on station 0, and a Continue
    // button waiting wherever a station completes.
    version: '0.9.26',
    date: '2026-08-05',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // First-run tour, polished: the popover lost its top hairline (read as a
    // glitch), rises in with a spring instead of popping, and each step's
    // title/body cascade one beat apart; progress rail refined.
    version: '0.9.25',
    date: '2026-08-04',
    items: [{ kind: 'visual' }],
  },
  {
    // The landing's gold CTAs open the beta itself (/login) — registration is
    // open (BETA_REGISTRATION_OPEN=true), so the door stops asking for early
    // access. The demo-list secondary path keeps pointing at /early-access.
    version: '0.9.24',
    date: '2026-08-04',
    items: [{ kind: 'behavior' }],
  },
  {
    // The Council station, rebuilt from the founder's own run: the council is
    // created in Xaman, so the page is now the illustrated tutorial (real
    // Xaman captures at the steps they belong to), each block in its own
    // card — no more one giant rectangle with the scene floating in reserved
    // emptiness — and the "enter the wallets" plan form is folded as the
    // optional scratchpad it always was.
    version: '0.9.23',
    date: '2026-08-05',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // The Guía moved into the co-pilot: in Legacy mode the sidebar guide IS
    // the Legacy guide (same public endpoint, journey-aware), and the
    // ceremony takes the full width its embedded column used to eat. Station
    // briefs breathe (numbered chips, shorter Council copy), stations slide
    // toward the direction of travel, the rail marks completion with a snap,
    // Movements pops on the house curve, and the Legacy cards cascade in.
    version: '0.9.22',
    date: '2026-08-04',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // The authority palette now stamps <html> (ThemeApplier), not only the
    // shell div — the copilot and every body portal (tour, gate modals,
    // Xaman QR) wore gold inside Legacy because they sat outside the stamp.
    version: '0.9.21',
    date: '2026-08-04',
    items: [{ kind: 'visual' }],
  },
  {
    // The lobby no longer leaks: in Legacy mode with nothing constituted,
    // the shared pages (Home, Portfolio, Earn…) show the lobby invitation —
    // never Personal capital under the indigo shell. /app/legacy, admin and
    // settings keep working; a loading beat shows neither product's data.
    version: '0.9.20',
    date: '2026-08-04',
    items: [{ kind: 'behavior' }],
  },
  {
    // The ceremony explains itself: every Constitute station opens with a
    // numbered "what you do here" brief — starting with the truth nobody
    // wrote down (create a NEW Xaman account first; it becomes the Legacy's
    // main account). On phones and for screen readers the ceremony now comes
    // before the helper chat instead of below it.
    version: '0.9.19',
    date: '2026-08-04',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // Legacy, reorganized for first contact: the workspace is titled after the
    // Legacy it holds, a Constitute ↔ Govern switcher lives in its chrome (no
    // more walking back to the list to change surface), the card doors say
    // where they go (Constitute / Govern / Movements), Info shows the anchored
    // constitution with a jump to its station, and the whole surface got its
    // accessibility pass — tablist semantics, keyboard navigation, focus trap
    // + Escape on the Movements dialog, visible focus everywhere.
    version: '0.9.18',
    date: '2026-08-04',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // Legacy is a first-class product now: flipping the toggle ALWAYS enters
    // it — with a governed account when one exists, or as the LOBBY (indigo
    // shell, crossing, Legacy nav, the constitute door) when nothing is
    // constituted yet. A fresh account's toggle is no longer a dead switch.
    version: '0.9.17',
    date: '2026-08-04',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // Legacy entry, done right: clicking the toggle while accounts were still
    // loading no longer bounces to the panel in Personal tint — the intent is
    // parked and the REAL flip (re-tint, crossing, nav swap) completes the
    // moment the registry answers. Panel only when truly nothing governed.
    version: '0.9.16',
    date: '2026-08-04',
    items: [{ kind: 'behavior' }],
  },
  {
    // Legacy gate dead-end fixed: an allowlisted account with no governed
    // account yet clicked the toggle into pure silence (no popup — access is
    // fine — and no switch — nothing to activate). Now it lands on the
    // Legacy panel, whose door offers Constitute.
    version: '0.9.15',
    date: '2026-08-04',
    items: [{ kind: 'behavior' }],
  },
  {
    // The overview at /app is now NAMED "Home" (Inicio) — sidebar, ⌘K, tour,
    // copilot and the landing's journey labels all follow. Routes untouched.
    version: '0.9.14',
    date: '2026-08-04',
    items: [{ kind: 'visual' }],
  },
  {
    // Home page REMOVED (founder): the Summary already welcomes a wallet-less
    // account with its connect panel — two front doors confused more than
    // they calmed. Nav/login/copilot/tour all point back at /app.
    version: '0.9.13',
    date: '2026-08-04',
    items: [{ kind: 'behavior' }],
  },
  {
    // Earn's highlight, final take: position only. Both colored treatments
    // (tint, solid) are retired — the row is normal again, sitting above
    // Wallets. Gold in the nav belongs to the selected state alone.
    version: '0.9.12',
    date: '2026-08-04',
    items: [{ kind: 'visual' }],
  },
  {
    // Earn's highlight, take two: the soft gold tint read as "selected" and
    // confused testers — now a SOLID gold button (copilot recipe), ring when
    // it is the active page. Selected rows keep tint + rail untouched.
    version: '0.9.11',
    date: '2026-08-04',
    items: [{ kind: 'visual' }],
  },
  {
    // Accessibility pass, round 2: landing buttons lose their arrows (the
    // scroll cue is the page's ONE arrow — now a big symbol-only chevron),
    // and Earn becomes the sidebar's highlighted action row (volt tint,
    // above Wallets/Legacy). Behaviour + visual; nothing DeFi-new.
    version: '0.9.10',
    date: '2026-08-03',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // First-user accessibility pass: Home page as the dashboard's calm front
    // door (+ nav reorder), Wallets re-organized (list default, origin
    // shelves, origin/balance selectors), landing scroll cue made page-long
    // and the closing links row. Behaviour + visual; nothing DeFi-new.
    version: '0.9.9',
    date: '2026-08-03',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // Founder portraits on /about — the trust page now has the real faces.
    version: '0.9.8',
    date: '2026-07-27',
    items: [{ kind: 'visual' }],
  },
  {
    // Demo terms as public docs (/demo-terms) + notice-line acceptance on
    // sign-up (recorded server-side) + live on-chain transparency feed on
    // /what-we-offer. Landing + registro: behavior; recorded acceptance +
    // server-enforced literal: security.
    version: '0.9.7',
    date: '2026-07-26',
    items: [{ kind: 'behavior' }, { kind: 'security' }],
  },
  {
    // Legacy gate v2: the toggle shows for every beta account; without access
    // it opens the in-development popup instead of hiding the product.
    version: '0.9.6',
    date: '2026-07-26',
    items: [{ kind: 'behavior' }],
  },
  {
    version: '0.9.5',
    date: '2026-07-26',
    items: [
      {
        kind: 'defi',
        es: 'Net APY por posición: interés base, recompensas y coste de deuda en una sola cifra, con su fuente.',
        en: 'Net APY per position: base interest, rewards and debt cost in one figure, with its source.',
      },
      {
        kind: 'defi',
        es: 'Cada operación se ensaya on-chain antes de pedirte la firma — la wallet solo se abre si el ensayo pasa.',
        en: 'Every operation is rehearsed on-chain before asking for your signature — the wallet only opens if the rehearsal passes.',
      },
      {
        kind: 'defi',
        es: 'Una firma en curso sobrevive a recargar la página: los pendientes se rehidratan con su reloj original.',
        en: 'An in-flight signature survives a page reload: pendings rehydrate with their original clock.',
      },
      { kind: 'performance' },
      { kind: 'visual' },
    ],
  },
  {
    version: '0.9.4',
    date: '2026-07-25',
    items: [{ kind: 'visual' }, { kind: 'behavior' }],
  },
  {
    version: '0.9.3',
    date: '2026-07-25',
    items: [
      {
        kind: 'defi',
        es: 'Las reglas de protección activas se editan en sitio: umbral, importe y cooldown.',
        en: 'Active protection rules are editable in place: threshold, amount and cooldown.',
      },
      {
        kind: 'defi',
        es: 'El repay de protección puede salir del propio agente — la pierna sin wallet.',
        en: 'Protection repay can run from the agent account itself — the walletless leg.',
      },
      {
        kind: 'defi',
        es: 'Los avisos de trigger llegan con firma Xaman a un toque.',
        en: 'Trigger alerts arrive with one-tap Xaman signing.',
      },
    ],
  },
  {
    version: '0.9.2',
    date: '2026-07-24',
    items: [{ kind: 'visual' }],
  },
  {
    version: '0.9.1',
    date: '2026-07-23',
    items: [{ kind: 'security' }],
  },
  {
    version: '0.9.0',
    date: '2026-07-22',
    items: [{ kind: 'visual' }, { kind: 'behavior' }],
  },
];

/** The chip the Orbit System card wears — always the newest entry's version. */
export const PLATFORM_VERSION = `v${CHANGELOG[0].version}`;
