/**
 * actionCatalog — the honest action×authority table (review 2026-07-17,
 * Fase 0: "mapear ese catálogo es parte del recon, no un descubrimiento a
 * mitad de build").
 *
 * The same button changes VERB with the product: a simple wallet executes
 * (you sign, it settles), a governed Legacy proposes (the council signs).
 * And some rails honestly do not exist for governed accounts yet — E1/0xFE
 * requires the PA owner's synchronous Xaman signature, which a council
 * cannot produce. Surfaces read this table instead of re-deriving the rule,
 * so the "no disponible (aún)" copy is consistent everywhere.
 *
 * This file states availability; it never builds calldata and never signs.
 */

export type AuthorityVerb = 'execute' | 'propose' | 'unavailable';

export interface ActionAvailability {
  /** English label — surfaces run it through t() for ES. */
  label: string;
  simple: AuthorityVerb;
  governed: AuthorityVerb;
  /** Why, when the answer is surprising (shown as helper copy). */
  note?: string;
}

export const ACTION_CATALOG = {
  /** Payment from the account (movements / transfer modals). */
  'xrpl.payment': {
    label: 'Send XRP',
    simple: 'execute',
    governed: 'propose',
  },
  /** Programmed transfer — EscrowCreate (savings + Legacy dated transfers). */
  'xrpl.escrow.create': {
    label: 'Programmed transfer',
    simple: 'execute',
    governed: 'propose',
  },
  /** EscrowFinish is permissionless after FinishAfter: ANY account can sign
   *  it from its own wallet — no quorum needed even for a governed Legacy. */
  'xrpl.escrow.finish': {
    label: 'Release programmed transfer',
    simple: 'execute',
    governed: 'execute',
    note: 'Release is permissionless: any signer finishes it from their own wallet.',
  },
  /** Constitution anchor (DIDSet) on the account. */
  'xrpl.anchor.constitution': {
    label: 'Anchor constitution',
    simple: 'execute',
    governed: 'propose',
  },
  /** Council order → Flare rail (CouncilOrderCard). A council-only rail:
   *  proposing IS its native verb; a simple wallet has no council to order. */
  'council.flare.order': {
    label: 'Council order to Flare',
    simple: 'unavailable',
    governed: 'propose',
  },
  /** Earn E1 — 0xFE direct-minting into the vault. The PA owner signs
   *  synchronously in Xaman; a quorum cannot produce that signature. */
  'earn.e1.mint': {
    label: 'Earn E1 (FXRP → vault)',
    simple: 'execute',
    governed: 'unavailable',
    note: 'E1 needs the account owner signing live in Xaman — not available for governed accounts (yet).',
  },
  /** Earn E2 — same synchronous-signature constraint. */
  'earn.e2': {
    label: 'Earn E2',
    simple: 'execute',
    governed: 'unavailable',
    note: 'E2 needs the account owner signing live in Xaman — not available for governed accounts (yet).',
  },
  /** MoneyFlows rules — designed, not wired (roadmap F5): honest on both. */
  'moneyflows.rule': {
    label: 'MoneyFlow rule',
    simple: 'unavailable',
    governed: 'unavailable',
    note: 'No active rules yet — the rule surface ships without simulation, gated on the deployed bridge.',
  },
} as const satisfies Record<string, ActionAvailability>;

export type ActionKey = keyof typeof ACTION_CATALOG;

/** The verb an authority kind gets for an action. */
export function verbFor(action: ActionKey, kind: 'simple' | 'governed'): AuthorityVerb {
  return ACTION_CATALOG[action][kind];
}
