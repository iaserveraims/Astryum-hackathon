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
