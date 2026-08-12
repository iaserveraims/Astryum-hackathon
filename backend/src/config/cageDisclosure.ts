/**
 * cageDisclosure — the text a person must read and accept before any capital
 * enters a Legacy cage, and the hash that proves which text they saw.
 *
 * WHY THE SERVER OWNS THE TEXT (founder, 2026-08-06). The acknowledgement only
 * means something if we can say, later, exactly WHAT was on screen when the
 * quorum signed. If the frontend owned the wording and merely posted "accepted",
 * the record would prove nothing: the client could claim any version, and the
 * text could drift from the audit entry without anyone noticing. So the document
 * lives here, the server hashes its own copy, and the ack stores that hash. The
 * client renders it and translates it (the English strings are the i18n keys, as
 * everywhere else) but never authors it.
 *
 * VERSIONING. Change a single character below and the hash changes; bump
 * CAGE_DISCLOSURE_VERSION in the same edit and every user is asked to read and
 * accept again. An unbumped edit is a bug — `assertVersionBumped` is what the
 * test asserts against, so a silent reword cannot ship.
 *
 * WHAT THE TEXT MUST NOT DO. No numbers that live in env vars (the beta cap) and
 * no numbers that live on-chain (the fees of a specific mint): those go stale and
 * a disclosure contradicted by the screen next to it is worse than none. Only the
 * contract's IMMUTABLE facts are stated as facts here — the 10%/40% lineage
 * bounds, the 10% protocol-fee cap, the two 30-day delays — because `constant`
 * in LegacyVault.sol is the one thing that cannot drift. Everything variable is
 * rendered beside the document from live reads.
 *
 * Truthfulness is load-bearing (invariant #12, the repo is a due-diligence
 * document): every claim below is checkable in contracts/src/LegacyVault.sol.
 * "Principal never leaves" is deliberately NOT claimed — migrate() moves it to a
 * successor vessel after 30 days, and a disclosure a user can catch being wrong
 * protects nobody.
 */

import { createHash } from 'crypto';

export const CAGE_DISCLOSURE_VERSION = 1;

export interface CageDisclosureSection {
  id: string;
  title: string;
  lines: string[];
}

export interface CageAcknowledgement {
  id: string;
  text: string;
}

export interface CageDisclosureDocument {
  version: number;
  /** SHA-256 of the canonical text — what the ack record pins. */
  hash: string;
  title: string;
  lede: string;
  sections: CageDisclosureSection[];
  acknowledgements: CageAcknowledgement[];
}

/** The document itself. Everything below is quotable against the contract. */
const TEXT = {
  title: 'How a cage works',
  lede:
    'Read this before locking capital. Governing a Legacy on XRPL locks up nothing — only a cage does, ' +
    'and a cage is one-way by design.',
  sections: [
    {
      id: 'why',
      title: 'Why it is one-way',
      lines: [
        'A legacy is a legacy because nobody can undo it — not the family under pressure, not a future you, and not Astryum.',
        'So the cage is a contract with no way to pay principal back to an address. That is the product, not a limitation of it.',
        'The council, the quorum, the constitution and the programmed transfers lock up nothing. You can govern a Legacy for years without ever creating a cage.',
      ],
    },
    {
      id: 'code',
      title: 'What the code has, and what it does not',
      lines: [
        'There is no function that withdraws principal, no transfer to an arbitrary address, no proxy and no upgrade path. The rules are fixed from the first block.',
        'Principal only moves between the vault and the venues the council whitelisted. A newly added venue takes effect 30 days later — because adding a venue IS the power to extract.',
        'Only realized yield ever reaches people. It is split into the lineage cut (which capitalizes back into principal), the protocol fee, and the payees the council configured.',
        'The principal can be moved once more, and only sideways: into a successor vault with the SAME council and the SAME constitution, 30 days after the quorum proposes it. That is a move, not an exit.',
        'A venue can still lose value. The cage stops principal from leaving; it does not make the capital risk-free.',
      ],
    },
    {
      id: 'authority',
      title: 'Who can do what',
      lines: [
        'Astryum composes the payment and shows you the facts. Your council signs it, each member from their own device. The code does the rest.',
        'Astryum never holds a key of yours, never signs for you, and cannot open the cage. Nobody can — and that includes us.',
      ],
    },
    {
      id: 'architecture',
      title: 'The architecture, in three lines',
      lines: [
        'XRPL governs: the council, its quorum, and the constitution anchored on the ledger.',
        'Flare produces: the cage, and the venues it is allowed to work in.',
        'Astryum coordinates: it builds the unsigned payload, discloses the fees, and stops there.',
      ],
    },
    {
      id: 'fees',
      title: 'What it costs',
      lines: [
        'To enter: a FAssets minting fee, the executor fee for the proof it pays on Flare, and the XRPL transaction fee. The exact numbers appear on the hand-off, before anyone signs.',
        'Inside: the lineage cut takes between 10% and 40% of realized yield — chosen at birth, adjustable by quorum within those bounds, never below 10%.',
        'Astryum’s protocol fee applies to yield only, is capped at 10% for ever by the contract, and is 0 today.',
      ],
    },
    {
      id: 'beta',
      title: 'It is a beta',
      lines: [
        'This is beta software running on mainnet, and the vault contract has not been audited by a third party.',
        'A cage accepts a limited total through Astryum during the beta. The current limit is shown next to the amount.',
        'Cage only what you can afford to leave locked.',
      ],
    },
  ] as CageDisclosureSection[],
  acknowledgements: [
    {
      id: 'principal_one_way',
      text: 'I understand that the principal that enters the cage does not come back out to an address — not mine, and not Astryum’s.',
    },
    {
      id: 'beta_unaudited',
      text: 'I understand that this is beta, unaudited software on mainnet, and that I can lose what I put in.',
    },
    {
      id: 'no_custody',
      text: 'I understand that Astryum does not custody, does not sign, and cannot reverse this for me.',
    },
    {
      id: 'cap_affordable',
      text: 'I understand the beta limit, and I am not caging anything I cannot afford to leave locked.',
    },
  ] as CageAcknowledgement[],
};

/** Every acknowledgement id, in document order — the ack must carry them all. */
export const CAGE_ACK_IDS: string[] = TEXT.acknowledgements.map((a) => a.id);

let cachedHash: string | null = null;

/**
 * SHA-256 over the canonical text. Deterministic by construction: the object is
 * a literal, so JSON.stringify emits its keys in source order on every runtime.
 * The version is inside the hashed payload — a bump alone invalidates old acks.
 */
export function cageDisclosureHash(): string {
  if (cachedHash) return cachedHash;
  cachedHash = createHash('sha256')
    .update(JSON.stringify({ version: CAGE_DISCLOSURE_VERSION, ...TEXT }), 'utf8')
    .digest('hex');
  return cachedHash;
}

/** The document to render — text, version and the hash the ack will pin. */
export function cageDisclosureDocument(): CageDisclosureDocument {
  return {
    version: CAGE_DISCLOSURE_VERSION,
    hash: cageDisclosureHash(),
    title: TEXT.title,
    lede: TEXT.lede,
    sections: TEXT.sections,
    acknowledgements: TEXT.acknowledgements,
  };
}
