/**
 * XrplCouncilService — compose the UNSIGNED SignerListSet that constitutes (or
 * amends) a council. This is "create the governed wallet from zero" (ADR-008
 * guardrail #1 / ADR-009 Capa 0): Astryum composes the txjson, the account signs
 * it in its own wallet, the ledger executes. We never sign, never hold a key.
 *
 * WHO SIGNS THIS (the correctness point): a SignerListSet on an account that has
 * no council yet is signed by the account's OWN master key — single-sig — because
 * there is no quorum to sign with. So this hand-off flows through the DIRECT sign
 * path (the account owner signs in Xaman), NOT the multisig coordinator. Once the
 * list exists, FURTHER SignerListSet amendments are signed by the current quorum
 * (and then flow through the coordinator). The two paths are correct as-is:
 * canSignDirect is true precisely when the account is the connected wallet and has
 * no council yet.
 *
 * The reason this is prepare-only and NOT "being a wallet" (ADR-006 revisited by
 * ADR-008): it composes calldata for the user's OWN account; the user's wallet
 * signs. Link-out to external multisign tools stays only as a fallback.
 */
import { AccountSetAsfFlags, convertStringToHex, isValidClassicAddress, validate } from 'xrpl';
import { withSourceTag } from '../../../config/xrplSourceTag';
import { quorumMargin } from './XrplLegacyRehearsal';
import type { XrplTxHandoff } from './XrplTxHandoff';

export interface SignerListMember {
  account: string;
  /** SignerWeight — a positive integer up to 65535 (XRPL field limit). */
  weight: number;
}

export interface BuildSignerListSetInput {
  /** The account whose authority becomes the quorum (the future Legacy account). */
  account: string;
  /** SignerQuorum — the weight sum that must sign for the account to act. */
  quorum: number;
  /** 1–32 signer entries (XRPL caps a SignerList at 32 members). */
  signers: SignerListMember[];
}

export interface BuildDisableMasterInput {
  /** The council account whose master key is being disabled ("close the door"). */
  account: string;
}

interface SignerListSetTx extends Record<string, unknown> {
  TransactionType: 'SignerListSet';
  Account: string;
  SignerQuorum: number;
  SignerEntries: Array<{ SignerEntry: { Account: string; SignerWeight: number } }>;
  SourceTag?: number;
}

interface DisableMasterTx extends Record<string, unknown> {
  TransactionType: 'AccountSet';
  Account: string;
  SetFlag: number; // asfDisableMaster
  SourceTag?: number;
}

const MAX_SIGNERS = 32; // XRPL protocol limit for a SignerList
const MAX_WEIGHT = 65535; // SignerWeight is a UInt16

export function buildSignerListSet(input: BuildSignerListSetInput): XrplTxHandoff<SignerListSetTx> {
  if (!isValidClassicAddress(input.account)) {
    throw new Error(`account is not a valid XRPL address: ${input.account}`);
  }
  const { signers, quorum, account } = input;

  if (!Array.isArray(signers) || signers.length < 1) {
    throw new Error('a council needs at least one signer');
  }
  if (signers.length > MAX_SIGNERS) {
    throw new Error(`a SignerList holds at most ${MAX_SIGNERS} signers (got ${signers.length})`);
  }

  const seen = new Set<string>();
  let totalWeight = 0;
  const weights: number[] = [];
  for (const s of signers) {
    if (!isValidClassicAddress(s.account)) {
      throw new Error(`signer is not a valid XRPL address: ${s.account}`);
    }
    if (s.account === account) {
      throw new Error('an account cannot be a signer on its own SignerList');
    }
    if (seen.has(s.account)) {
      throw new Error(`duplicate signer: ${s.account}`);
    }
    seen.add(s.account);
    if (!Number.isInteger(s.weight) || s.weight < 1 || s.weight > MAX_WEIGHT) {
      throw new Error(`signer weight must be an integer 1–${MAX_WEIGHT} (got ${s.weight} for ${s.account})`);
    }
    weights.push(s.weight);
    totalWeight += s.weight;
  }

  if (!Number.isInteger(quorum) || quorum < 1) {
    throw new Error('quorum must be a positive integer');
  }
  if (quorum > totalWeight) {
    throw new Error(
      `quorum ${quorum} exceeds the total signer weight ${totalWeight} — the account could never reach quorum`,
    );
  }

  const margin = quorumMargin(quorum, weights);

  const xrplTx = withSourceTag({
    TransactionType: 'SignerListSet' as const,
    Account: account,
    SignerQuorum: quorum,
    SignerEntries: signers.map((s) => ({
      SignerEntry: { Account: s.account, SignerWeight: s.weight },
    })),
  }) as SignerListSetTx;

  // xrpl.js validates the SignerListSet shape (quorum/entries/weights).
  validate(xrplTx);

  return {
    xrplTx,
    disclosure: {
      disclosedToUser: true,
      astryumSigns: false,
      note:
        'Astryum builds this unsigned SignerListSet; you sign it in your own wallet. ' +
        'It makes this account governed by a council: from then on, transactions need ' +
        'signatures whose weight sums to the quorum. If the account has no council yet, ' +
        'this is signed by its MASTER KEY (a single signature). Do NOT disable the master ' +
        'key until every member has proven they can sign (the rehearsal) — a disabled ' +
        'master key over a council that cannot reach quorum would lock the account forever. ' +
        (margin === 0
          ? 'WARNING: with this quorum, losing ONE key already drops you below quorum (margin 0). ' +
            'The recommended family setup is 5 signers, quorum 3. '
          : '') +
        'The SignerList sets aside owner reserve while it exists. Astryum never signs and ' +
        'charges nothing on native XRPL.',
      facts: {
        signerCount: signers.length,
        quorum,
        totalWeight,
        // Worst-case key losses the council survives (heaviest lost first).
        quorumMargin: margin,
        network: 'XRPL mainnet',
      },
    },
  };
}

/**
 * buildDisableMaster — "close the door" (ADR-008): compose the UNSIGNED
 * AccountSet(asfDisableMaster) that hands the account's authority entirely to
 * the council.
 *
 * WHO SIGNS THIS (the correctness point — learned from tecNEED_MASTER_KEY on
 * mainnet): disabling the master key is the ONE operation the quorum CANNOT do.
 * XRPL requires the transaction to be signed by the account's MASTER KEY itself —
 * a multi-signature or a regular key is rejected with `tecNEED_MASTER_KEY`
 * (https://xrpl.org/accountset — "you cannot use a regular key pair or a
 * multi-signature" to enable asfDisableMaster). So this flows through the DIRECT
 * sign path (the account owner signs single-sig in their own wallet), NOT the
 * multisig coordinator. It is the master key's final act: after it, only the
 * council quorum can act.
 *
 * This replaces the LegacyPanel's link-out-to-xApp hand-off for closing the door
 * (ADR-008 supersedes it; link-out stays only as a fallback).
 *
 * SAFETY (ADR-008 guardrail #1): disabling the master key over a council that
 * cannot reach quorum bricks the account forever. This builder only composes the
 * bytes; the load-bearing gate — never offer this before the on-chain rehearsal
 * has passed — lives in the panel (`health.canCloseDoor`).
 */
export function buildDisableMaster(input: BuildDisableMasterInput): XrplTxHandoff<DisableMasterTx> {
  if (!isValidClassicAddress(input.account)) {
    throw new Error(`account is not a valid XRPL address: ${input.account}`);
  }

  const xrplTx = withSourceTag({
    TransactionType: 'AccountSet' as const,
    Account: input.account,
    SetFlag: AccountSetAsfFlags.asfDisableMaster,
  }) as DisableMasterTx;

  // xrpl.js validates the AccountSet shape (SetFlag is a known asf value).
  validate(xrplTx);

  return {
    xrplTx,
    disclosure: {
      disclosedToUser: true,
      astryumSigns: false,
      note:
        'Astryum builds this unsigned AccountSet; you sign it with this account’s MASTER KEY. ' +
        'XRPL requires the master key itself to disable it — a council multi-signature or a ' +
        'regular key cannot (the ledger returns tecNEED_MASTER_KEY). This is the master key’s ' +
        'final act: from then on the account obeys ONLY the council quorum. It is irreversible ' +
        'without the quorum — if the quorum can no longer sign, the account and its capital are ' +
        'locked forever. Only close the door once EVERY member has proven on-chain they can sign ' +
        '(the rehearsal). Astryum never signs and charges nothing on native XRPL.',
      facts: {
        action: 'Disable the master key (close the door)',
        signedBy: 'This account’s master key (single-signature)',
        governedAfter: 'The council quorum only',
        reversibleWithoutQuorum: false,
        network: 'XRPL mainnet',
      },
    },
  };
}
