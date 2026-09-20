/**
 * demoExchange/structureSteps — compose one step of a structure's birth
 * ceremony (UNSIGNED), and verify a hash the operator reports against the
 * ledger before it is believed.
 *
 * Every builder here already existed; this file only picks the right one for
 * the step and states who signs it. Nothing signs, nothing submits, no seed.
 *
 * WHY VERIFICATION IS NOT OPTIONAL. The registry's whole job is to gate the
 * irreversible step (the door) behind the ones before it. If a step could be
 * marked done by a POST saying so, the gate would be decoration: a typo, a
 * replayed hash or an optimistic operator would unlock
 * `AccountSet(asfDisableMaster)` over a quorum nobody ever convened, and that
 * account is gone for good. So `verifyStructureStep` re-reads the transaction
 * and checks four things — validated, succeeded, the right type, the right
 * account — and the route writes nothing when any of them fails.
 */
import { buildDisableMaster, buildSignerListSet } from '../../connectors/protocols/xrpl/XrplCouncilService';
import { buildEscrowCreate } from '../../connectors/protocols/xrpl/XrplEscrowService';
import type { XrplTxHandoff } from '../../connectors/protocols/xrpl/XrplTxHandoff';
import type { BirthStepId } from '../../connectors/protocols/xrpl/XrplStructureBirth';
import { composeCredentialCreate } from '../XrplCredentialCeremony';
import { attributionForSigner, withSourceTag } from '../../config/xrplSourceTag';
import { xrplJsonRpc } from '../flare/DirectMintExecutorService';
import type { DemoStructure } from './structures';

export class StructureStepError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'StructureStepError';
  }
}

/** Who has to sign the composed bytes — said in the words the screen uses. */
export type StepSigner = 'funder' | 'structure-master' | 'structure-quorum' | 'root';

export interface ComposedStep {
  step: BirthStepId;
  signer: StepSigner;
  handoff: XrplTxHandoff<Record<string, unknown>>;
}

export interface ComposeContext {
  structure: DemoStructure;
  /** Who issues the designation: the user's PERSONAL account (the root that commands). */
  rootAddress: string;
  /** Who sponsors the reserve: the exchange's omnibus, or the personal account itself. */
  omnibusAddress: string;
  /** Live per-object owner reserve (server_info reserve_inc_xrp). */
  ownerReserveXrp: number;
  /** Credential type of the designation (root→subordinate). */
  designationType: string;
  /** Short expiry: a designation is a re-appointment, not a title deed. */
  designationDays: number;
  nowMs?: number;
}

const XRPL_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

function xrpToDrops(amountXrp: number): string {
  return String(Math.round(amountXrp * 1_000_000));
}

/** The transaction type each step must be, on the ledger and in the composer. */
export const STEP_TX_TYPE: Record<BirthStepId, string> = {
  fund: 'Payment',
  constitute: 'SignerListSet',
  rehearse: 'EscrowCreate',
  designate: 'CredentialCreate',
  'close-door': 'AccountSet',
};

/** Whose `Account` field the validated transaction must carry. */
export function expectedSignerAccount(step: BirthStepId, ctx: Pick<ComposeContext, 'structure' | 'rootAddress' | 'omnibusAddress'>): string {
  switch (step) {
    case 'fund':
      return ctx.omnibusAddress;
    case 'designate':
      return ctx.rootAddress;
    default:
      // constitute / rehearse / close-door are all signed BY the structure —
      // by its birth key or by its quorum. Either way `Account` is the structure —
      // and that is the fact behind COMMANDED_PAYS_THROUGH_GATE: in a multi-sign
      // the SENDER is the commanded account, never the personal one that signs.
      return ctx.structure.address;
  }
}

export function composeStructureStep(step: BirthStepId, ctx: ComposeContext): ComposedStep {
  const s = ctx.structure;
  if (!XRPL_RE.test(s.address)) {
    throw new StructureStepError('BAD_STRUCTURE_ADDRESS', `the structure address is not a valid XRPL address: ${s.address}`);
  }

  switch (step) {
    case 'fund': {
      const drops = xrpToDrops(s.fundingXrp);
      // The omnibus is a scripted account of the exchange: never the project
      // SourceTag (Make Waves T&C §7 — attributionForSigner decides, not a list).
      const xrplTx = withSourceTag(
        {
          TransactionType: 'Payment' as const,
          Account: ctx.omnibusAddress,
          Destination: s.address,
          Amount: drops,
        },
        attributionForSigner(ctx.omnibusAddress),
      ) as unknown as Record<string, unknown>;
      return {
        step,
        signer: 'funder',
        handoff: {
          xrplTx,
          disclosure: {
            disclosedToUser: true,
            astryumSigns: false,
            note: `The omnibus sponsors ${s.fundingXrp} XRP of reserve so "${s.label}" can be born. Sponsored and charged afterwards — never a prepaid balance.`,
            facts: {
              from: ctx.omnibusAddress,
              to: s.address,
              amountXrp: s.fundingXrp,
              recoverableXrp: Math.max(0, s.fundingXrp - ctx.ownerReserveXrp),
            },
          },
        },
      };
    }

    case 'constitute': {
      const handoff = buildSignerListSet({
        account: s.address,
        quorum: s.quorum,
        signers: s.seats.map((seat) => ({ account: seat.account, weight: seat.weight })),
      });
      return { step, signer: 'structure-master', handoff: handoff as unknown as XrplTxHandoff<Record<string, unknown>> };
    }

    case 'rehearse': {
      // The rehearsal is an escrow the structure creates on ITSELF: every seat
      // has to appear in `Signers` at least once, which is the only on-chain
      // proof that the quorum can be convened (XrplLegacyRehearsal).
      const now = ctx.nowMs ?? Date.now();
      const handoff = buildEscrowCreate({
        account: s.address,
        amountDrops: xrpToDrops(1),
        finishAfterISO: new Date(now + 10 * 60_000).toISOString(),
        cancelAfterISO: new Date(now + 48 * 3_600_000).toISOString(),
        ownerReserveXrp: ctx.ownerReserveXrp,
      });
      return { step, signer: 'structure-quorum', handoff: handoff as unknown as XrplTxHandoff<Record<string, unknown>> };
    }

    case 'designate': {
      if (!s.designation) {
        throw new StructureStepError('NO_DESIGNATION', 'this structure was declared without a designation credential');
      }
      const tx = composeCredentialCreate({
        issuer: ctx.rootAddress,
        subject: s.address,
        credentialType: ctx.designationType,
        expirationDays: ctx.designationDays,
        nowMs: ctx.nowMs,
      });
      const xrplTx = withSourceTag(tx, attributionForSigner(ctx.rootAddress)) as unknown as Record<string, unknown>;
      return {
        step,
        signer: 'root',
        handoff: {
          xrplTx,
          disclosure: {
            disclosedToUser: true,
            astryumSigns: false,
            note: `The personal account names "${s.label}" as its own on the ledger, for ${ctx.designationDays} days. The commanded account accepts it with its quorum; revoking it undoes the appointment without ever touching anyone's exit.`,
            facts: {
              issuer: ctx.rootAddress,
              subject: s.address,
              credentialType: ctx.designationType,
              expiresInDays: ctx.designationDays,
              reserveXrp: ctx.ownerReserveXrp,
            },
          },
        },
      };
    }

    case 'close-door': {
      const handoff = buildDisableMaster({ account: s.address });
      return { step, signer: 'structure-master', handoff: handoff as unknown as XrplTxHandoff<Record<string, unknown>> };
    }

    default: {
      throw new StructureStepError('UNKNOWN_STEP', `unknown ceremony step: ${String(step)}`);
    }
  }
}

export interface StepVerdict {
  ok: boolean;
  /** What was read, so a reviewer can re-read the same thing. */
  observed: string;
  ledgerIndex?: number;
  code?: 'NOT_VALIDATED' | 'FAILED_ON_LEDGER' | 'WRONG_TYPE' | 'WRONG_ACCOUNT' | 'UNREADABLE';
  reason?: string;
}

/**
 * Re-read the reported transaction and decide whether it is really this step.
 * A step is never believed because a POST said so.
 *
 * `UNREADABLE` is retryable and is NOT a verdict: a frozen rippled answers
 * `txnNotFound` for a transaction another node has (incident 2026-07-31), so
 * "I could not read" must never be written down as "it did not happen".
 */
export async function verifyStructureStep(
  step: BirthStepId,
  txHash: string,
  ctx: Pick<ComposeContext, 'structure' | 'rootAddress' | 'omnibusAddress'>,
): Promise<StepVerdict> {
  let result: Record<string, unknown>;
  try {
    result = (await xrplJsonRpc('tx', { transaction: txHash, binary: false })) as unknown as Record<string, unknown>;
  } catch (e) {
    return {
      ok: false,
      observed: `tx ${txHash}: could not be read on any endpoint`,
      code: 'UNREADABLE',
      reason: `The ledger could not be read (${e instanceof Error ? e.message : 'unknown'}). Nothing was written down — try again.`,
    };
  }

  const tx = ((result.tx_json as Record<string, unknown> | undefined) ?? result) as Record<string, unknown>;
  const meta = (result.meta ?? (result as { metaData?: unknown }).metaData) as { TransactionResult?: string } | undefined;
  const validated = result.validated === true;
  const type = String(tx.TransactionType ?? '');
  const account = String(tx.Account ?? '');
  const ledgerIndex = Number(result.ledger_index ?? tx.ledger_index ?? NaN);
  const observed = `tx ${txHash}: ${type || '(no type)'} from ${account || '(no account)'}, validated=${validated}, result=${meta?.TransactionResult ?? '(none)'}`;

  if (!validated) {
    return { ok: false, observed, code: 'NOT_VALIDATED', reason: 'The transaction is not validated yet — wait a few seconds and report it again.' };
  }
  if (meta?.TransactionResult !== 'tesSUCCESS') {
    return { ok: false, observed, code: 'FAILED_ON_LEDGER', reason: `The transaction did not succeed (${meta?.TransactionResult ?? 'unknown'}) — this step did not happen.` };
  }
  const want = STEP_TX_TYPE[step];
  if (type !== want) {
    return { ok: false, observed, code: 'WRONG_TYPE', reason: `This hash is a ${type}, and step "${step}" is a ${want}.` };
  }
  const wantAccount = expectedSignerAccount(step, ctx);
  if (account !== wantAccount) {
    return { ok: false, observed, code: 'WRONG_ACCOUNT', reason: `Step "${step}" has to be signed by ${wantAccount}, and this one was signed by ${account}.` };
  }
  return { ok: true, observed, ledgerIndex: Number.isFinite(ledgerIndex) ? ledgerIndex : undefined };
}

/**
 * ¿Existe cada una de estas direcciones como cuenta del ledger? Hace falta para
 * decir la verdad en el plan (hecho 5: un asiento puede ser solo un par de
 * llaves, y entonces no cuesta reserva pero no se puede rotar ni acreditar).
 *
 * TRES ESTADOS, NO DOS. `true` = existe · `false` = el ledger contestó
 * `actNotFound` · AUSENTE = no se pudo leer. «No pude leer» jamás se escribe
 * como «no existe»: sobre eso se decide si una cuenta puede emitir.
 */
export async function readAccountsExist(addresses: string[]): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  const unique = Array.from(new Set(addresses.filter((a) => XRPL_RE.test(a)))).slice(0, 40);
  for (const account of unique) {
    try {
      await xrplJsonRpc('account_info', { account, ledger_index: 'validated' });
      out[account] = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Solo el veredicto explícito del ledger cuenta como «no existe».
      if (/actNotFound/i.test(msg)) out[account] = false;
    }
  }
  return out;
}
