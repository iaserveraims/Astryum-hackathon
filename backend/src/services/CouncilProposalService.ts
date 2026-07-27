/**
 * CouncilProposalService — the engine-side path into the council inbox.
 *
 * Governed MoneyFlows are sign-at-trigger with N signers (decisión fundador
 * 2026-07-18): when a council rule fires, the trigger COMPOSES a proposal into
 * the existing inbox (councilProposals) and the QUORUM signs it there. The rule
 * itself holds ZERO authority — nothing moves without the quorum's signatures,
 * so pausing/creating rules never bypasses governance.
 *
 * The HTTP route (routes/councilProposals.ts) requires a SIWE browser session;
 * the AutomationEngine tick is a server process, so proposal creation from a
 * trigger goes through THIS service instead — same pinning (coordinator), same
 * persistence shape, same one-live-proposal-per-account constraint (XRPL pins
 * one Sequence at a time; two triggers firing serialize via cooldown+retry).
 *
 * Prepare-only intact (invariants #1/#8): this composes UNSIGNED txjson and
 * rows. It never signs, combines or broadcasts — members do, in their wallets.
 */

import { isValidClassicAddress, validate } from 'xrpl';
import { prisma } from '../database/prismaClient';
import { withSourceTag } from '../config/xrplSourceTag';
import { xrplProvider } from '../integrations/providers/chain/XRPLProvider';
import {
  prepareCouncilMultisig,
  NotACouncilError,
} from '../connectors/protocols/xrpl/XrplMultisigCoordinator';

const PROPOSAL_TTL_MS = 7 * 24 * 60 * 60 * 1000; // mirror of routes/councilProposals.ts
const LIVE_STATUSES = ['collecting', 'ready'] as const;

export interface ComposedCouncilTx {
  council: string;
  xrplTx: Record<string, unknown>;
  summary: string;
}

/**
 * Compose the UNSIGNED council tx a fired rule proposes. Two kinds:
 *  - 'councilPayment': a plain XRPL Payment from the council account — works on
 *    mainnet today (params: { council?, destination, amountDrops, memo? }).
 *  - 'councilOrder': a LegacyVault order Payment whose memo commits
 *    keccak256(orderData) — needs the deployed Legacy stack; the committed
 *    bytes are persisted for the relayer exactly like the HTTP prepare route
 *    (params: { council?, orderAction, orderParams }).
 * `fallbackCouncil` = the rule's wallet address, used when params carry no
 * explicit council (vault-scoped rules watch an EVM address and must name it).
 */
export async function composeCouncilRuleTx(
  kind: 'councilPayment' | 'councilOrder',
  params: Record<string, unknown>,
  fallbackCouncil: string,
): Promise<ComposedCouncilTx> {
  const council = String(params.council ?? fallbackCouncil);
  if (!isValidClassicAddress(council)) {
    throw new Error(
      `council rule needs an XRPL council account: params.council is missing and the rule's wallet (${fallbackCouncil}) is not an r-address`,
    );
  }

  if (kind === 'councilPayment') {
    const destination = String(params.destination ?? '');
    if (!isValidClassicAddress(destination)) throw new Error('councilPayment needs params.destination (an XRPL r-address)');
    if (destination === council) throw new Error('councilPayment destination must differ from the council account');
    const drops = BigInt(String(params.amountDrops ?? '0'));
    if (drops <= 0n) throw new Error('councilPayment needs params.amountDrops > 0 (XRP drops, integer)');
    const memo = typeof params.memo === 'string' && params.memo.trim() ? params.memo.trim().slice(0, 200) : null;
    const tx = withSourceTag({
      TransactionType: 'Payment' as const,
      Account: council,
      Destination: destination,
      Amount: drops.toString(),
      ...(memo
        ? { Memos: [{ Memo: { MemoData: Buffer.from(memo, 'utf8').toString('hex').toUpperCase() } }] }
        : {}),
    });
    validate(tx as never);
    return {
      council,
      xrplTx: tx,
      summary: `Payment of ${Number(drops) / 1_000_000} XRP from the council to ${destination}`,
    };
  }

  // councilOrder — the FDC-enforced vault rail (throws a readable error when
  // the Legacy stack env is not deployed; the tick surfaces it honestly).
  const orderAction = String(params.orderAction ?? '');
  const orderParams = (params.orderParams ?? {}) as Record<string, unknown>;
  const { buildCouncilOrderHandoff } = await import('../connectors/protocols/xrpl/XrplCouncilOrderService');
  const { saveCouncilOrderRecord } = await import('./flare/LegacyOrderStore');
  const handoff = await buildCouncilOrderHandoff({
    council,
    action: orderAction as never,
    params: orderParams,
  });
  await saveCouncilOrderRecord({
    orderHash: handoff.order.orderHash,
    orderData: handoff.order.orderData,
    action: handoff.order.action,
    summary: handoff.order.summary,
    nonce: handoff.order.nonce,
    chain: handoff.order.chain,
    bridge: handoff.order.bridge,
    vault: handoff.order.vault,
    council,
  });
  return { council, xrplTx: handoff.xrplTx, summary: handoff.order.summary };
}

// The `?: undefined` counter-fields keep property access typeable without
// narrowing — this repo compiles with strict off, where boolean-discriminant
// narrowing is unavailable (same trick as CanonicalEvmTranslator.TranslateResult).
export type CouncilProposalOutcome =
  | { ok: true; proposalId: string; reason?: undefined; detail?: undefined }
  | { ok: false; reason: 'LIVE_PROPOSAL_EXISTS' | 'NOT_A_COUNCIL' | 'PREPARE_FAILED'; detail: string; proposalId?: undefined };

/**
 * Create a proposal in the council inbox from a fired rule. Mirrors the HTTP
 * route's flow: live-proposal check → coordinator pin (Sequence/Fee/
 * SigningPubKey identical for every member) → persist. `createdByUserId` is
 * the rule owner's app user (the proposer of record).
 */
export async function createCouncilProposalFromRule(input: {
  account: string;
  xrplTx: Record<string, unknown>;
  title: string;
  createdByUserId: string;
}): Promise<CouncilProposalOutcome> {
  const live = await prisma.councilProposal.findFirst({
    where: {
      account: input.account,
      status: { in: [...LIVE_STATUSES] },
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  if (live) {
    return {
      ok: false,
      reason: 'LIVE_PROPOSAL_EXISTS',
      detail: `council ${input.account} already has proposal ${live.id} collecting signatures — XRPL pins one Sequence at a time`,
    };
  }
  try {
    const prepared = await prepareCouncilMultisig(xrplProvider, {
      account: input.account,
      xrplTx: input.xrplTx,
    });
    const proposal = await prisma.councilProposal.create({
      data: {
        account: input.account,
        createdByUserId: input.createdByUserId,
        title: input.title,
        txType: String((input.xrplTx as { TransactionType?: unknown }).TransactionType ?? 'Unknown'),
        txjson: prepared.multisigTx as never,
        quorum: prepared.council.quorum,
        signerList: prepared.council.signers as never,
        expiresAt: new Date(Date.now() + PROPOSAL_TTL_MS),
      },
      select: { id: true },
    });
    return { ok: true, proposalId: proposal.id };
  } catch (e) {
    if (e instanceof NotACouncilError) {
      return { ok: false, reason: 'NOT_A_COUNCIL', detail: (e as Error).message };
    }
    return { ok: false, reason: 'PREPARE_FAILED', detail: (e as Error).message };
  }
}
