'use client';

/**
 * ProposalInbox — the governed mode's centrepiece (prompt §2.1).
 *
 * Single-key is synchronous (compose → sign → done); a quorum is ASYNC
 * (compose → propose → collect signatures over hours or days → combine →
 * emit). This inbox is the surface of that asymmetry: proposals waiting for
 * YOUR signature / waiting for others / ready to emit / emitted.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { multisign } from 'xrpl';
import {
  Check,
  Clock,
  Copy,
  ExternalLink,
  Inbox,
  Loader2,
  PenLine,
  RefreshCw,
  Send,
  Undo2,
} from 'lucide-react';
import { Card, EmptyState, GhostButton, Pill, PrimaryButton, SectionTitle } from '../ui/primitives';
import FormalPositions from './FormalPositions';
import { InlineNotice } from './InlineNotice';
import { useT } from '../../i18n/LanguageProvider';
import { useMyWallets } from '../../hooks/useMyWallets';
import { useXrplWalletPartner } from '../../lib/wallet/useXrplWalletPartner';
import { startPending } from '../../lib/settlement/settlement';
import { useSettlement } from '../../lib/settlement/useSettlement';
import { councilProposalsApi, xrplLegacy, type CouncilProposalRecord } from '../../services/v1Api';
import { xrplTxTypeLabel } from '../../lib/xrpl/txTypeLabels';
import {
  describeServerRefusal,
  describeUnreadableRows,
  serverRefusalText,
  type ReadableRefusal,
  type UnreadableRowsNotice,
} from '../../lib/errors/serverRefusal';
import { ServerRefusalBody } from '../ui/ServerRefusalBody';
import { decideEmitReport, unreportedPanel } from '../../lib/xrpl/councilEmitReport';
import { verifySignerBlob, BlobVerificationError } from '../../lib/xrpl/verifySignerBlob';
import {
  cancelPayloadAndDecide,
  decideCloseStep,
  payloadStrayNotice,
  strayStateOf,
  type XamanCancelAction,
  type XamanCancelUi,
  type XamanStrayState,
} from '../../lib/xaman/payloadBus';
import {
  XRPSCAN_TX,
  type ConfirmedSubmit,
  awaitValidation,
  broadcast,
  broadcastMayLand,
  createMemberPayload,
  pollStatus,
  readCouncilRedaction,
  shortAddr,
} from '../../lib/xrpl/councilSigning';
import { flareInstructionMemoOf } from '../../lib/xaman/liveRequests';
import { notifyHandoffSigned } from '../../lib/wallet/handoffRelease';
import { describeWithdrawnSeat, type WithdrawnSeatView } from '../../lib/xaman/seatRefusal';

const LIVE: ReadonlyArray<CouncilProposalRecord['status']> = ['collecting', 'ready'];
/** The explorer host already lives in councilSigning (XRPSCAN_TX); the account
 *  view is the same host, so it is derived — not a second copy to drift. */
const XRPSCAN_ACCOUNT = XRPSCAN_TX.replace(/\/tx\/$/, '/account/');

/**
 * G1-cadena — WHICH TRAY A ROW BELONGS TO.
 *
 * Round 1 taught the server to read the ledger before writing the word
 * "expired": past its deadline, a proposal whose pinned Sequence was already
 * CONSUMED (it may have executed) or could not be READ keeps its stored status
 * and carries `ledgerCheck`. Nobody told this screen. So the bucketing, which
 * splits on status ALONE, kept filing those rows as live work:
 */
type ProposalTray = 'unresolved' | 'toSign' | 'waiting' | 'ready' | 'emitted' | 'archived';

function trayOf(status: string, ledgerState: string | null, myPendingSeats: number): ProposalTray {
  const live = status === 'collecting' || status === 'ready';
  // `unused` is the ONLY verdict that clears a row: the server already archived
  // it as `expired`. Everything else means the seat is not settled.
  if (live && ledgerState && ledgerState !== 'unused') return 'unresolved';
  if (status === 'collecting') return myPendingSeats > 0 ? 'toSign' : 'waiting';
  if (status === 'ready') return 'ready';
  if (status === 'submitted') return 'emitted';
  return 'archived';
}

/**
 * G1-cadena (round 3, finding 3) — WHICH MOVES AN UNRESOLVED ROW REALLY OFFERS.
 *
 * WHAT FAILED IN SILENCE: the panel offered "record its hash" only on `ready`
 * (right — `/submitted` refuses a proposal that never met its quorum) and
 * labelled filing "(proposer only)" always (wrong, and a dead end). A council
 * whose proposer is not around had NO way out of a `collecting` row whose seat
 * the ledger says is spent: 422 on every compose, for ever.
 */
function unresolvedSeatMoves(status: string): { registerHash: boolean; file: 'proposer' | 'anyone' } {
  const quorumMet = status === 'ready';
  return { registerHash: quorumMet, file: quorumMet ? 'proposer' : 'anyone' };
}

/**
 * consejo-superficies 3 — WHERE A CANCEL ANSWER MUST LAND.
 *
 * WHAT FAILED IN SILENCE: the DELETE's answer was written into the sign box
 * with `cur.uuid === uuid`, and dropped otherwise. But "the box moved on" is
 * exactly when the answer matters MOST: «Sign as …» was not disabled while the
 * round trip was in flight, so one press started a new session, the late answer
 * found a different uuid — and a Xaman that had REFUSED the kill, or never
 * answered at all, was swallowed. The request stayed signable on that member's
 * phone for the rest of its 24 hours with nothing on screen to say so, which is
 * the very silence this rail exists to end.
 */
type CancelAnswerSink = 'close-box' | 'in-box' | 'banner' | 'drop';

function cancelAnswerSink(action: XamanCancelAction, stillOnScreen: boolean): CancelAnswerSink {
  // 'ignore' cannot reach here (we always ask about the payload we are
  // cancelling), and it carries no outcome — mapping it to anything else would
  // invent one.
  if (action === 'ignore') return 'drop';
  // Confirmed dead, or dead before we asked: nothing is left to warn about.
  // The box only closes if it is still the box this answer is about.
  if (action === 'close') return stillOnScreen ? 'close-box' : 'drop';
  return stillOnScreen ? 'in-box' : 'banner';
}

/**
 * consejo-superficies 4 — WHAT CLAIM TO THIS COUNCIL THE SERVER CAN ACTUALLY SEE.
 *
 * The UI's idea of "mine" is the linked wallets PLUS the Xaman connected right
 * now. The server's is narrower and different: `sessionIsCouncilMember`
 * (routes/councilProposals.ts) asks `prisma.wallet` — the addresses this
 * account has REGISTERED. A councillor whose Xaman is connected but never
 * registered is a member here and a stranger there.
 */
type SeatClaim = 'linked' | 'unlinked' | 'none';

function seatClaimOf(seats: string[], linkedAddrs: Set<string>, myAddrs: Set<string>): SeatClaim {
  if (seats.some((a) => linkedAddrs.has(a))) return 'linked';
  if (seats.some((a) => myAddrs.has(a))) return 'unlinked';
  return 'none';
}

/**
 * prosa-y-lectores — WHAT WE MAY ADD TO THE SERVER'S OWN REFUSAL.
 *
 * The listing's 403 says "you are not a member of this council". True, and on
 * its own useless: the commonest cause is not that the person is a stranger but
 * that the wallet holding their seat was never REGISTERED — the server reads
 * membership from `prisma.wallet`, never from the tab. Naming that cause is the
 * difference between a closed door and a door with the key beside it.
 */
type RefusalCause = 'unlinked-wallet' | 'prove-membership' | 'none';

/**
 * REGISTERING IS NO LONGER THE CURE, AND THIS SAID IT WAS.
 *
 * Until the server read membership from `prisma.wallet`, so «link it in
 * Wallets and the inbox opens as soon as it is registered» was true. It is not
 * any more: membership is decided by a PROVEN address — the wallet the session
 * signed in with, or one that signed a binding challenge — because a council's
 * signer addresses are public and anyone could type one in. A person who
 * follows the old sentence registers the wallet, comes back, and meets the same
 * wall with no idea why. The recovery prose has to name the SIGNATURE.
 */
export function refusalExplainsProof(detail: string | null | undefined): boolean {
  const d = (detail ?? '').toLowerCase();
  return (
    d.includes('proven') ||
    d.includes('binding challenge') ||
    d.includes('signed in with') ||
    d.includes('signer list opens the inbox')
  );
}

// eslint-disable-next-line max-len
function inboxRefusalCause(code: string, seats: string[], linkedAddrs: Set<string>, myAddrs: Set<string>, registryWasRead: boolean, serverExplained = false): RefusalCause {
  if (code !== 'NOT_A_COUNCIL_MEMBER') return 'none';
  if (serverExplained) return 'none';
  if (registryWasRead && seatClaimOf(seats, linkedAddrs, myAddrs) === 'unlinked') return 'unlinked-wallet';
  return 'prove-membership';
}

/**
 * Server refusals carry the honest prose in `detail`; the bare code is a dead
 * end in front of a family (G1-cadena).
 *
 * prosa-y-lectores — this was one of the six near-twins `serverRefusal` was
 * written to replace, and it was the SHORTEST of them: `detail || message`
 * fell straight back to the slug when the server sent no prose, printed the
 * bare r-address `POST /:id/signatures` echoes as NOT_A_COUNCIL_MEMBER's
 * detail, and had no sentence for an infrastructure refusal. It now delegates
 * to the one reader (the superset, not the average) and keeps its name, which
 * is what the seven call sites below read.
 */
function errText(e: unknown, t: (s: string) => string): string {
  return serverRefusalText(e, t);
}

/** An XRPL tx hash as the explorer shows it — 64 hex. Refusing anything else
 *  keeps a typo from being recorded as this proposal's ledger hash. */
const TX_HASH_RE = /^[0-9A-Fa-f]{64}$/;

interface SignSession {
  proposalId: string;
  memberAccount: string;
  uuid?: string;
  qrPng?: string;
  deeplink?: string;
  /** Xaman rang this member's phone (it had their push token). */
  pushed?: boolean;
  status: 'creating' | 'waiting' | 'error';
  error?: string;
  /**
   * xaman-cancelar 4 — state of the DELETE for THIS payload, in the same
   * vocabulary as the signing modal (payloadBus). Cancel used to be
   * `setSign(null)`: the request stayed alive in Xaman, signable for the 24
   * hours of its `expire: 1440` window, with nothing on screen to say so.
   */
  cancelUi?: XamanCancelUi;
}

function daysLeft(expiresAt: string): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000));
}

export default function ProposalInbox({
  account,
  onSettled,
}: {
  account: string;
  /** Called with the tx hash after a successful browser broadcast. */
  onSettled?: (hash: string) => void;
}) {
  const { t } = useT();
  // `useT` hands back a NEW `t` on every render (LanguageProvider builds it
  // inline), so a refusal reader that closed over it would rebuild `reload`
  // every render — and `reload` feeds a useEffect. Same ref pattern as
  // CouncilMultisigFlow and `signRef` below: the dictionary is read at
  // call time, the callbacks stay stable.
  const tRef = useRef(t);
  tRef.current = t;
  // `loading` is deliberately NOT read here any more: it says the fetch
  // finished, not that it succeeded (see `walletsRead` below).
  const { wallets } = useMyWallets();
  const { address: xrplConnected } = useXrplWalletPartner();

  // The r-addresses that are MINE (linked wallets + the connected Xaman):
  // membership in a proposal's signer list is computed against this set.
  const myAddrs = useMemo(() => {
    const set = new Set<string>();
    for (const w of wallets) if (w.address.startsWith('r')) set.add(w.address);
    if (xrplConnected) set.add(xrplConnected);
    return set;
  }, [wallets, xrplConnected]);

  /**
   * consejo-superficies 4 — the subset the SERVER can see: rows that came from
   * `GET /api/wallets/mine`, i.e. `prisma.wallet`. `id` is what separates
   * them — `dedupeWallets` appends the SIWE login address as a synthetic row
   * without one precisely when that address is not registered, and the
   * connected Xaman above may never have been registered at all.
   */
  const linkedAddrs = useMemo(() => {
    const set = new Set<string>();
    for (const w of wallets) if (w.id && w.address.startsWith('r')) set.add(w.address);
    return set;
  }, [wallets]);

  /**
   * prosa-y-lectores — POSITIVE EVIDENCE THAT `linkedAddrs` IS A READ.
   *
   * `!walletsLoading` was never that evidence: `fetchMyWallets`
   * (lib/portfolioMerge.ts) catches every error and returns `[]`, and
   * `useMyWallets` then flips `loading` to false all the same — so "finished"
   * and "read" are different facts and only one of them was being checked. A
   * row with an `id` came from `GET /api/wallets/mine`; the synthetic SIWE
   * login row `dedupeWallets` appends has none, exactly in the case where the
   * address is NOT registered. So this is true only when the server really
   * answered, and it is what gates any claim made about linkage.
   */
  const walletsRead = useMemo(() => wallets.some((w) => !!w.id), [wallets]);

  /**
   * prosa-y-lectores — the listing's refusal keeps its CODE, not only its
   * sentence: the 403 the new permission floor answers is the one refusal this
   * screen can add an actionable cause to (`inboxRefusalCause`).
   */
  const [proposals, setProposals] = useState<CouncilProposalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  // `detail` travels too (R2 N6): the server's own membership hint is
  // what decides whether this screen adds a sentence of its own or stays quiet.
  /**
   * El rechazo ENTERO, no tres campos elegidos a mano. El lector
   * compartido ya trae `headline`, `ways[]`, `retryAfterSeconds` y la puerta, y
   * este es EL sitio donde el usuario de email/Google se come el 403
   * `NOT_A_COUNCIL_MEMBER`: leía «Register the wallet that holds your seat» y no
   * tenía nada que pulsar.
   */
  const [error, setError] = useState<ReadableRefusal | null>(null);
  /**
   * LAS FILAS QUE EL SERVIDOR NO PUDO DECIDIR.
   *
   * Dejó de tirarlas: el 200 las trae NOMBRADAS en `unreadable[]`, con su
   * código y su frase. Esta bandeja desestructuraba `{ proposals: list }` y las
   * descartaba, así que la fila seguía sin existir para la familia — y son los únicos
   * bytes que un cosignatario puede firmar. Estado propio, no `error`: `error` es «la
   * lectura ENTERA se rechazó» y lleva pegado el lector de membresía; esto es «la
   * lectura llegó, pero N filas no se pudieron decidir».
   */
  const [unreadableRows, setUnreadableRows] = useState<UnreadableRowsNotice | null>(null);
  const [sign, setSign] = useState<SignSession | null>(null);
  const [emittingId, setEmittingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /**
   * LO QUE EL WITHDRAW DIJO DEL ASIENTO.
   * la ruta devuelve `seat` con la gramática de la ceremonia (`seatReleaseAnswer`):
   * si el asiento de nonce del 0xFE se soltó y, si no, por qué (ventana viva con
   * sus segundos, firma reportada, lectura que falló). Esta bandeja lo ignoraba:
   * el proponente retiraba, veía recargar la lista y se encontraba
   * `NONCE_SEAT_TAKEN` en la siguiente salida sin saber que se lo habían dicho.
   */
  const [withdrawnSeat, setWithdrawnSeat] = useState<WithdrawnSeatView | null>(null);
  const [emitResult, setEmitResult] = useState<({ id: string } & ConfirmedSubmit) | null>(null);
  /**
   * G1 — una propuesta DIFUNDIDA cuyo hash no se pudo registrar. Es el estado
   * más peligroso del carril: la tx vive en el ledger y la fila no lo sabe.
   * Mientras esto exista, la bandeja lo grita y ofrece registrarlo.
   */
  // `code` = the backend refusal of the last report, when one was refused: it
  // decides whether registering can still work (councilEmitReport.unreportedPanel).
  const [unreported, setUnreported] = useState<{ id: string; hash: string; detail: string; code?: string } | null>(null);
  // Council-order aftermath: the backend starts the FDC relay server-side on
  // /submitted (hole closed); this state mirrors it in the tray and
  // the settlement machine owns the DONE verdict (rail 'council-order').
  const [orderRelay, setOrderRelay] = useState<{
    proposalId: string;
    hash: string;
    relay: 'started' | 'already-relaying' | 'relayer-disabled' | 'not-launched';
    stuck?: string;
  } | null>(null);
  const settlement = useSettlement();
  // Manual signature entry (the escape hatch for tx types Xaman's API refuses).
  const [paste, setPaste] = useState<{
    proposalId: string;
    memberAccount: string;
    blob: string;
    busy?: boolean;
    error?: string;
  } | null>(null);
  const [copiedTx, setCopiedTx] = useState<string | null>(null);
  /**
   * G1-cadena — the way OUT of an unresolved seat when the transaction DID
   * execute: the hash the family reads in the explorer. It is recorded as
   * theirs, not verified by us (we never watched this one land), and it is what
   * lets the account compose again without composing the payment twice.
   */
  const [registerHash, setRegisterHash] = useState<{
    proposalId: string;
    hash: string;
    busy?: boolean;
    error?: string;
  } | null>(null);
  const signRef = useRef<SignSession | null>(null);
  signRef.current = sign;
  /**
   * xaman-cancelar 4 — A PAYLOAD WE COULD NOT CONFIRM DEAD. Xaman locks a
   * payload to the first client that opens it, so "New QR" is a real cure; but
   * it minted a SECOND signable multisign payload for the same proposal and
   * left the first one alive, and both stay signable for 24 hours. N presses
   * left N signable requests for one seat. Now the previous one is killed
   * first — and when Xaman refuses, or never answers, that is said out loud
   * here instead of being swallowed.
   */
  const [strayPayload, setStrayPayload] = useState<XamanStrayState | null>(null);

  /** The open sign session has an answer we could not act on: the request may
   *  still be signable on that member's phone. */
  const signStray = strayStateOf(sign?.cancelUi ?? 'idle');
  /**
   * consejo-superficies 3 — a DELETE is in flight, so NO door may mint another
   * payload. «New QR» inside the box was already disabled; «Sign as …» (this
   * row's other seat, or another proposal's) was not, and pressing it took the
   * `prev.cancelUi !== 'cancelling'` branch in startSign: no second DELETE (right)
   * but also no wait for the first answer, which then belonged to nobody. One
   * flag, every door.
   */
  const cancelInFlight = sign?.cancelUi === 'cancelling';

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { proposals: list, unreadable } = await councilProposalsApi.list([account]);
      setProposals(list);
      // Una lectura COMPLETA es la única que puede apagar el aviso. Si el
      // 200 trae filas ilegibles, se dicen; si no trae ninguna, entonces sí se apaga.
      setUnreadableRows(describeUnreadableRows(unreadable, tRef.current));
    } catch (e) {
      // prosa-y-lectores — THE SLUG WAS THE WHOLE MESSAGE. This catch printed
      // `(e as Error).message`, which is the machine code `jget` puts there,
      // while `errText` — sitting in THIS FILE, written for exactly this — was
      // never called from it. With the round-4 permission floor the listing
      // now refuses whole inboxes with NOT_A_COUNCIL_MEMBER and a paragraph of
      // prose in `body.detail`; the family was reading the slug instead.
      setError(describeServerRefusal(e, tRef.current));
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Same guard chain as the QR path: verify HERE, then let the server verify
   *  again on arrival. A blob signed by the wrong member — or over drifted
   *  bytes — never counts toward the quorum, whatever tool produced it. */
  const submitPastedBlob = useCallback(
    async (p: CouncilProposalRecord, member: string) => {
      const hex = (paste?.blob ?? '').trim().replace(/\s+/g, '').toUpperCase();
      if (!hex) return;
      setPaste((cur) => (cur ? { ...cur, busy: true, error: undefined } : cur));
      try {
        verifySignerBlob(hex, member, p.txjson);
        await councilProposalsApi.sign(p.id, member, hex);
        setPaste(null);
        void reload();
      } catch (e) {
        const msg = e instanceof BlobVerificationError ? e.message : errText(e, tRef.current);
        setPaste((cur) => (cur ? { ...cur, busy: false, error: msg } : cur));
      }
    },
    [paste?.blob, reload],
  );

  // ── async member signing: one Xaman request for MY member address ──
  const startSign = useCallback(
    async (p: CouncilProposalRecord, memberAccount: string) => {
      setActionError(null);
      // The payload this one REPLACES dies first (xaman-cancelar 4). Without
      // this, "New QR" — and signing as a second member — left the previous
      // request signable in Xaman for the rest of its 24 hours, so one seat
      // could accumulate N live requests that all produce a valid signature.
      const prev = signRef.current;
      if (prev?.uuid && prev.status === 'waiting' && prev.cancelUi !== 'cancelling') {
        setSign({ ...prev, cancelUi: 'cancelling' });
        // The answer is unambiguously about `prev`, so it is never dropped:
        // we are deliberately superseding it, not racing it.
        const { cancelUi } = await cancelPayloadAndDecide(prev.uuid, () => prev.uuid);
        const stray = strayStateOf(cancelUi);
        // Only ever SET: a stray we could not kill stays named until the
        // person dismisses it. Starting a new request does not make the old
        // one dead — that is exactly the lie this round is closing.
        if (stray) setStrayPayload(stray);
      }
      setSign({ proposalId: p.id, memberAccount, status: 'creating' });
      try {
        const pl = await createMemberPayload(p.txjson, memberAccount);
        setSign({
          proposalId: p.id,
          memberAccount,
          uuid: pl.uuid,
          qrPng: pl.qrPng,
          deeplink: pl.deeplink,
          pushed: pl.pushed,
          status: 'waiting',
        });
      } catch (e) {
        setSign({ proposalId: p.id, memberAccount, status: 'error', error: (e as Error).message });
      }
    },
    [],
  );

  /**
   * xaman-cancelar 4 — Cancel asks Xaman to KILL the request before the box
   * goes. Same branch table as the signing modal (decideCloseStep): a live
   * payload never leaves the screen without a DELETE having been asked for,
   * and a second press is always a way out. When we cannot confirm the kill
   * the box STAYS, saying so — and its poll keeps running, so a member who
   * signs it anyway still has their blob collected.
   */
  const cancelSign = useCallback(async () => {
    const s = signRef.current;
    if (!s) return;
    const step = decideCloseStep({
      hasPrompt: !!s.uuid,
      status: 'pending',
      cancelUi: s.cancelUi ?? 'idle',
    });
    // Unreachable from the button (disabled while in flight, and the round trip
    // bounds itself at 8s) — but a double press must not fire a second DELETE.
    if (step === 'stop-waiting') return;
    if (step === 'close' || !s.uuid) {
      setSign(null);
      return;
    }
    const uuid = s.uuid;
    setSign({ ...s, cancelUi: 'cancelling' });
    // consejo-superficies 3 — ask about THIS payload (`() => uuid`), then decide
    // separately whether the answer still describes what is on screen. Reading
    // the live `signRef` here made the outcome itself disappear: the answer came
    // back 'ignore' and a Xaman that had refused the kill was never reported.
    const { action, cancelUi } = await cancelPayloadAndDecide(uuid, () => uuid);
    const sink = cancelAnswerSink(action, signRef.current?.uuid === uuid);
    if (sink === 'drop') return;
    if (sink === 'close-box') {
      setSign(null);
      return;
    }
    if (sink === 'in-box') {
      setSign((cur) => (cur && cur.uuid === uuid ? { ...cur, cancelUi } : cur));
      return;
    }
    // The box moved on while we waited. The warning outlives it: this request
    // may still be signable on that member's phone for the rest of its 24 h.
    const stray = strayStateOf(cancelUi);
    if (stray) setStrayPayload(stray);
  }, []);

  useEffect(() => {
    if (sign?.status !== 'waiting' || !sign.uuid) return;
    const proposal = proposals.find((p) => p.id === sign.proposalId);
    if (!proposal) return;
    const id = setInterval(() => {
      void (async () => {
        const s = signRef.current;
        if (!s?.uuid) return;
        const st = await pollStatus(s.uuid);
        if (st.signed && st.hex) {
          try {
            // Same guard as the ceremony flow: identity + fidelity BEFORE the
            // blob leaves this browser. The server verifies again on arrival.
            verifySignerBlob(st.hex, s.memberAccount, proposal.txjson);
            await councilProposalsApi.sign(s.proposalId, s.memberAccount, st.hex);
            setSign(null);
            void reload();
          } catch (e) {
            const msg = e instanceof BlobVerificationError ? e.message : errText(e, tRef.current);
            setSign({ ...s, status: 'error', error: msg });
          }
        } else if (st.cancelled || st.expired) {
          setSign({ ...s, status: 'error', error: t('rejected / expired') });
        }
      })();
    }, 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sign?.uuid, sign?.status, proposals]);

  // ── emit: combine the stored blobs and broadcast from THIS browser ──
  const emit = useCallback(
    async (p: CouncilProposalRecord) => {
      setActionError(null);
      setEmitResult(null);
      setEmittingId(p.id);
      try {
        const { proposal } = await councilProposalsApi.detail(p.id);
        const blobs = proposal.signatures.map((s) => s.blobHex).filter((b): b is string => !!b);
        if (blobs.length === 0) throw new Error(t('No signatures stored for this proposal.'));
        const combined = multisign(blobs);
        // Submit AND wait for the validated ledger — the preliminary tesSUCCESS
        // can still land as tec*. The DB report (relay launch) stays keyed off
        // the submit (the relay re-verifies on XRPL itself), but the green and
        // onSettled only follow the ledger's verdict.
        const sub = await broadcast(combined);
        if (sub.hash && broadcastMayLand(sub.engine)) {
          notifyHandoffSigned(flareInstructionMemoOf(proposal.txjson ?? p.txjson), sub.hash);
        }
        let res: ConfirmedSubmit;
        if (sub.engine !== 'tesSUCCESS' || !sub.hash) res = { ...sub, validated: false };
        else res = { ...sub, ...(await awaitValidation(sub.hash)) };
        setEmitResult({ id: p.id, ...res });
        // PRELIMINARY IS NOT PAID. `/submitted` is reported
        // ONLY for a validated tesSUCCESS (councilEmitReport). A validated tec*
        // is never reported: the row says it applied and failed and to withdraw
        // and compose again. No validated verdict → the hash is held in the
        // «unreported» panel, to be registered once the ledger answers.
        const decision = decideEmitReport(res);
        if (decision.kind === 'hold') {
          setUnreported({
            id: p.id,
            hash: decision.hash,
            detail: t('The ledger had not validated this transaction when we stopped waiting, so it is not registered yet. Check it in the explorer, then register it here.'),
          });
        }
        if (decision.kind === 'report') {
          // G1 (auditorí) — el reporte va en su PROPIO try. Antes
          // compartía el del broadcast, así que un fallo de red al registrar el
          // hash se leía como «falló la emisión» cuando la tx YA estaba en el
          // ledger: la fila se quedaba en `ready`, caducaba a los 7 días, la
          // bandeja decía «expired» de algo ejecutado, y la familia componía el
          // pago otra vez — con Sequence nuevo, válido: PAGABA DOS VECES.
          // Ahora el hash se retiene y se ofrece registrarlo; nada se pierde.
          try {
            const report = await councilProposalsApi.submitted(p.id, decision.hash);
            setUnreported(null);
            if (report.councilOrder?.isOrder) {
              setOrderRelay({ proposalId: p.id, hash: decision.hash, relay: report.councilOrder.relay });
              settlement.track(startPending('council-order', decision.hash));
            }
            // 'report' IS a validated tesSUCCESS (decideEmitReport).
            onSettled?.(decision.hash);
            void reload();
          } catch (reportErr) {
            // The backend's own detail and code: the panel decides from the code
            // whether «Register it now» can ever work.
            const refusal = describeServerRefusal(reportErr, tRef.current);
            setUnreported({ id: p.id, hash: decision.hash, detail: refusal.detail || refusal.text, code: refusal.code });
          }
        }
      } catch (e) {
        setActionError(errText(e, tRef.current));
      } finally {
        setEmittingId(null);
      }
    },
    [onSettled, reload, settlement, t],
  );

  /**
   * G1 — registrar a posteriori el hash de una propuesta que SÍ se difundió.
   * La ruta `/:id/submitted` ya existía; lo que faltaba era la puerta para
   * llamarla cuando el navegador falló en el primer intento.
   */
  const retryReport = useCallback(async () => {
    if (!unreported) return;
    setActionError(null);
    try {
      const report = await councilProposalsApi.submitted(unreported.id, unreported.hash);
      if (report.councilOrder?.isOrder) {
        setOrderRelay({ proposalId: unreported.id, hash: unreported.hash, relay: report.councilOrder.relay });
        settlement.track(startPending('council-order', unreported.hash));
      }
      setUnreported(null);
      void reload();
    } catch (e) {
      // The refusal stays IN the panel, with the backend's
      // detail and code — TX_FAILED_ON_LEDGER / TX_NOT_THIS_PROPOSAL retire the
      // «Register it now» that could only 409 again.
      const refusal = describeServerRefusal(e, tRef.current);
      const hash = unreported.hash;
      setUnreported((cur) =>
        cur && cur.hash === hash ? { ...cur, detail: refusal.detail || refusal.text, code: refusal.code } : cur,
      );
    }
  }, [unreported, reload, settlement]);

  const unreportedView = unreportedPanel(unreported?.code);

  // Enrichment poll while the order travels: relay stuck-state only — the
  // success verdict never comes from here (settlement machine reads the bridge).
  useEffect(() => {
    if (!orderRelay || orderRelay.relay === 'relayer-disabled' || orderRelay.relay === 'not-launched') return;
    if (settlement.state?.status === 'settled') return;
    const hash = orderRelay.hash;
    const id = setInterval(() => {
      void (async () => {
        try {
          const st = await xrplLegacy.councilOrderStatus(hash, account);
          setOrderRelay((cur) =>
            cur && cur.hash === hash
              ? { ...cur, ...(st.relay?.state === 'error' ? { stuck: st.relay.detail ?? '' } : { stuck: undefined }) }
              : cur,
          );
        } catch {
          /* transient — keep polling */
        }
      })();
    }, 10_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderRelay?.hash, orderRelay?.relay, settlement.state?.status]);

  /** Re-deliver the proof after a stuck relay — same signed tx, no new signature. */
  const retryRelay = useCallback(() => {
    if (!orderRelay) return;
    setOrderRelay({ ...orderRelay, relay: 'started', stuck: undefined });
    void xrplLegacy
      .councilOrderRelay({ xrplTxHash: orderRelay.hash })
      .catch((e) => setOrderRelay((cur) => (cur ? { ...cur, stuck: (e as Error).message } : cur)));
  }, [orderRelay]);

  const withdraw = useCallback(
    async (p: CouncilProposalRecord, acknowledgeLedgerCheck = false) => {
      setActionError(null);
      setWithdrawnSeat(null);
      try {
        // G1-cadena: past the deadline the server refuses to file a proposal
        // whose pinned seat the ledger says was USED — "withdrawn" would record
        // that it never happened. The flag is the proposer saying they looked.
        const res = await councilProposalsApi.withdraw(p.id, acknowledgeLedgerCheck ? { acknowledgeLedgerCheck: true } : undefined);
        // El campo `seat` viaja al lado de `proposal`
        // y no es un veredicto sobre la retirada — la propuesta está retirada
        // diga lo que diga, pero sí sobre la SIGUIENTE salida de esta cuenta.
        setWithdrawnSeat(describeWithdrawnSeat((res as { seat?: unknown }).seat, tRef.current));
        void reload();
      } catch (e) {
        setActionError(errText(e, tRef.current));
      }
    },
    [reload],
  );

  /**
   * G1-cadena — register the hash of a proposal whose seat the ledger says was
   * consumed, once the family has FOUND it in the explorer. Same door as the
   * post-broadcast report (`/submitted`), driven by a human instead of by this
   * browser. No green is painted from here: the row moves to "Emitted" with the
   * hash on it, and the settlement machine still owns the cage's verdict.
   */
  const registerSeatHash = useCallback(
    async (p: CouncilProposalRecord) => {
      const hash = (registerHash?.hash ?? '').trim();
      if (!TX_HASH_RE.test(hash)) {
        setRegisterHash((cur) => (cur ? { ...cur, error: t('A ledger hash is 64 hexadecimal characters — copy it from the explorer.') } : cur));
        return;
      }
      setRegisterHash((cur) => (cur ? { ...cur, busy: true, error: undefined } : cur));
      setActionError(null);
      try {
        const report = await councilProposalsApi.submitted(p.id, hash);
        if (report.councilOrder?.isOrder) {
          setOrderRelay({ proposalId: p.id, hash, relay: report.councilOrder.relay });
          settlement.track(startPending('council-order', hash));
        }
        setRegisterHash(null);
        void reload();
      } catch (e) {
        setRegisterHash((cur) => (cur ? { ...cur, busy: false, error: errText(e, tRef.current) } : cur));
      }
    },
    [registerHash?.hash, reload, settlement, t],
  );

  // ── grouping (the four trays) ──
  const signedBy = (p: CouncilProposalRecord) => new Set(p.signatures.map((s) => s.signerAccount));
  /**
   * MY missing signatures only — the addresses this account has linked through
   * Xaman, never anybody else's.
   */
  const pendingMembers = (p: CouncilProposalRecord) =>
    p.signerList.filter((s) => myAddrs.has(s.account) && !signedBy(p).has(s.account)).map((s) => s.account);

  // G1-cadena: one verdict-aware split (trayOf) instead of five status filters —
  // an unresolved seat can no longer be filed as live work anywhere.
  const trayFor = (p: CouncilProposalRecord) =>
    trayOf(p.status, p.ledgerCheck?.state ?? null, pendingMembers(p).length);
  const unresolved = proposals.filter((p) => trayFor(p) === 'unresolved');
  const toSign = proposals.filter((p) => trayFor(p) === 'toSign');
  const waitingOthers = proposals.filter((p) => trayFor(p) === 'waiting');
  const ready = proposals.filter((p) => trayFor(p) === 'ready');
  const emitted = proposals.filter((p) => trayFor(p) === 'emitted');
  const archived = proposals.filter((p) => trayFor(p) === 'archived');

  const collectedWeight = (p: CouncilProposalRecord) => p.signatures.reduce((s, x) => s + x.weight, 0);

  const renderProposal = (p: CouncilProposalRecord, tray: ProposalTray) => (
    <li key={p.id} className="rounded-lg border border-ink/10 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* The decision reads as a sentence; the ledger type stays as the
            small technical marker (a family signs "set XRP aside until a
            date", not "EscrowCreate"). */}
        <span className="text-sm text-ink/85">{p.title || xrplTxTypeLabel(p.txType, t)}</span>
        {/* A title that was WITHHELD is not a proposal
            with no title. Without this, a registered-only reader is shown the
            generic ledger label as if that were the name the family gave it. */}
        {readCouncilRedaction(p).titleHidden && !p.title && (
          <span className="text-[11px] text-ink/40">{t('(its title is not shown to you)')}</span>
        )}
        <Pill tone="neutral">{p.txType}</Pill>
        {/* G1-cadena: a quorum reached on a seat the ledger says is spent is
            not a success — the green pill was the first thing that said "this
            is ready to send" about a transaction that can never be sent. */}
        <Pill tone={p.status === 'ready' && tray !== 'unresolved' ? 'success' : 'warning'}>
          {t('signed')} {collectedWeight(p)}/{p.quorum}
        </Pill>
        {LIVE.includes(p.status) && tray !== 'unresolved' && (
          <span className="flex items-center gap-1 text-[11px] text-ink/40">
            <Clock size={11} /> {daysLeft(p.expiresAt)} {t('days left')}
          </span>
        )}
        {p.txHash && (
          <a href={`${XRPSCAN_TX}${p.txHash}`} target="_blank" rel="noreferrer" className="text-[12px] text-ink/55 underline hover:text-ink/85">
            {t('View on XRPScan')}
          </a>
        )}
      </div>

      {/* who has signed — the per-member state, always visible */}
      <div className="flex flex-wrap gap-1.5">
        {p.signerList.map((s) => {
          const done = signedBy(p).has(s.account);
          const mine = myAddrs.has(s.account);
          return (
            <span
              key={s.account}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
                done ? 'border-emerald-400/30 bg-emerald-400/10 text-tone-success' : 'border-ink/10 bg-ink/[0.03] text-ink/50'
              }`}
            >
              {done ? <Check size={10} /> : <Clock size={10} />}
              {shortAddr(s.account)}
              {mine && <span className="text-ink/35">· {t('you')}</span>}
            </span>
          );
        })}
      </div>

      {/* ── G1-cadena · THE LEDGER'S VERDICT, IN THE FAMILY'S EYES ──────────
          The server has been reading XRPL since round 1 and nothing on this
          screen said so: `grep ledgerCheck frontend/src` returned zero. The
          row that MAY have paid already looked exactly like the row that never
          left — same green pill, same button. Here it says what happened, links
          to the account so it can be checked with their own eyes, and offers
          only the two moves that can actually succeed. */}
      {tray === 'unresolved' && p.ledgerCheck && (
        <div className="space-y-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-2.5">
          <InlineNotice tone="warning">
            {p.ledgerCheck.state === 'consumed'
              ? t(
                  'The account already used this proposal’s seat, so this transaction MAY have executed. Nobody can broadcast it again — but do NOT compose it again until you have checked.',
                )
              : t(
                  'We could not read the XRP Ledger, so we do not know whether this proposal executed. That is a failure of ours, not a verdict — check it before composing anything again.',
                )}
          </InlineNotice>
          {/* The server's own words: they carry the pinned Sequence and where
              the account stands now — the evidence, not a summary of it. */}
          <p className="text-[12px] text-ink/60">{p.ledgerCheck.detail}</p>
          <a
            href={`${XRPSCAN_ACCOUNT}${p.account}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[12px] text-ink/55 underline underline-offset-2 hover:text-ink/85"
          >
            <ExternalLink size={12} /> {t('Open this account in the explorer')}
          </a>
          {/* prosa-y-lectores — the consejo-superficies 4 warning USED to sit
              here. It cannot be true here: the listing that put this row on
              screen applies the same predicate as the two doors below
              (`mayReadProposal` ≡ proposer ∨ `sessionIsCouncilMember`), so a
              visible row is a row whose doors are already open to this session
              — and `linkedAddrs` empties silently whenever the wallet read
              fails, which made it fire on people it was false about, right
              where the money may already have moved. It now speaks on the
              refusal that DOES reach its audience: see `inboxRefusalCause` and
              the listing error below. */}
          {/* Only a proposal that reached the quorum can have been broadcast,
              so only that one can have a hash to record. */}
          {unresolvedSeatMoves(p.status).registerHash &&
            (registerHash?.proposalId === p.id ? (
              <div className="space-y-2">
                <p className="text-[12px] text-ink/55">
                  {t('Paste the hash of the transaction you found. This records it here — we are not verifying it for you.')}
                </p>
                <input
                  value={registerHash.hash}
                  onChange={(e) => setRegisterHash({ ...registerHash, hash: e.target.value, error: undefined })}
                  placeholder={t('Transaction hash (64 hexadecimal characters)')}
                  spellCheck={false}
                  className="w-full rounded-lg border border-ink/10 bg-surface-1 px-3 py-2 font-mono text-[11px] text-ink outline-none focus:border-volt/40"
                />
                {registerHash.error && <InlineNotice tone="warning">{registerHash.error}</InlineNotice>}
                <div className="flex flex-wrap items-center gap-2">
                  <PrimaryButton onClick={() => void registerSeatHash(p)} disabled={registerHash.busy}>
                    {registerHash.busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    {t('Record this hash')}
                  </PrimaryButton>
                  <GhostButton onClick={() => setRegisterHash(null)}>{t('Cancel')}</GhostButton>
                </div>
              </div>
            ) : (
              <GhostButton onClick={() => setRegisterHash({ proposalId: p.id, hash: '' })}>
                <Check size={12} /> {t('It IS in the explorer — record its hash')}
              </GhostButton>
            ))}
          {/* Filing it says "this never happened", and only by stating they
              looked — we never infer it. Who may say it depends on whether the
              quorum was ever reached (see unresolvedSeatMoves): a proposal that
              never was cannot have been broadcast from here, so it does not
              hang on one absent person. */}
          {registerHash?.proposalId !== p.id && (
            <div className="space-y-1.5">
              {unresolvedSeatMoves(p.status).file === 'anyone' && (
                <p className="text-[11px] text-ink/45">
                  {t(
                    'This proposal never reached its quorum, so no complete transaction was ever assembled from it here. Any member can file it — after checking the account.',
                  )}
                </p>
              )}
              <GhostButton onClick={() => void withdraw(p, true)}>
                <Undo2 size={12} />{' '}
                {unresolvedSeatMoves(p.status).file === 'proposer'
                  ? t('It is NOT in the explorer — file it (proposer only)')
                  : t('It is NOT in the explorer — file it')}
              </GhostButton>
            </div>
          )}
        </div>
      )}

      {tray === 'toSign' &&
        pendingMembers(p).map((member) => (
          <div key={member} className="space-y-2">
            {sign?.proposalId === p.id && sign.memberAccount === member ? (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-ink/10 bg-ink/[0.03] p-2.5">
                {sign.status === 'creating' && <Loader2 size={14} className="animate-spin text-ink/40" />}
                {sign.status === 'waiting' && (
                  <>
                    {/* 96px was unscannable and, on the phone the family
                        actually signs from, the QR is the WRONG affordance:
                        you cannot scan your own screen. So the deeplink is a
                        real button (the action on mobile) and the QR grows to
                        a size a second device can read (E7 QA móvil). */}
                    {sign.qrPng && (
                      <img
                        src={sign.qrPng}
                        alt={t('Xaman QR')}
                        className="h-32 w-32 shrink-0 rounded bg-white p-1 sm:h-36 sm:w-36"
                      />
                    )}
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <Pill tone="warning">{t('waiting for signature')}</Pill>
                      {sign.deeplink && (
                        <a
                          href={sign.deeplink}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-volt/40 bg-volt/10 px-3 py-2 text-[12px] font-medium text-volt transition-colors hover:bg-volt/20"
                        >
                          <ExternalLink size={13} /> {t('Open in Xaman to sign')}
                        </a>
                      )}
                      {/* Say WHICH way the request travelled: a member who was
                          pushed can just open their phone; one who was not is
                          waiting for a notification that never left. */}
                      <span className="text-[11px] text-ink/45">
                        {sign.pushed
                          ? t('Sent to their Xaman as a notification — the QR still works.')
                          : t('No notification yet for this member: they sign the QR once, and from then on Xaman can notify them.')}
                      </span>
                    </div>
                    {/* Xaman locks a payload to the first client that opens it
                        ("payload handled by another client") — the cure is a
                        fresh payload for the SAME proposal tx. */}
                    <GhostButton
                      onClick={() => void startSign(p, member)}
                      disabled={sign.cancelUi === 'cancelling'}
                    >
                      <RefreshCw size={12} /> {t('New QR')}
                    </GhostButton>
                    {/* xaman-cancelar 4: this was `setSign(null)` — the box
                        vanished and the request stayed signable in Xaman for
                        the rest of its 24 hours. */}
                    <GhostButton
                      onClick={() => void cancelSign()}
                      disabled={sign.cancelUi === 'cancelling'}
                    >
                      {sign.cancelUi === 'cancelling' && <Loader2 size={12} className="animate-spin" />}
                      {signStray ? t('Close anyway') : t('Cancel')}
                    </GhostButton>
                    {signStray && (
                      <InlineNotice tone="warning">{payloadStrayNotice(signStray, t)}</InlineNotice>
                    )}
                  </>
                )}
                {sign.status === 'error' && (
                  <>
                    <InlineNotice tone="warning">{sign.error}</InlineNotice>
                    <GhostButton onClick={() => void startSign(p, member)} disabled={cancelInFlight}>
                      <RefreshCw size={12} /> {t('New QR')}
                    </GhostButton>
                    <GhostButton onClick={() => setSign(null)}>{t('Cancel')}</GhostButton>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {/* consejo-superficies 3: shut while the previous payload's
                    DELETE is still in flight — see `cancelInFlight`. */}
                <PrimaryButton onClick={() => void startSign(p, member)} disabled={cancelInFlight}>
                  <PenLine size={14} /> {t('Sign as')} {shortAddr(member)}
                </PrimaryButton>

                {/* ESCAPE HATCH: Xaman gates account-security
                    transaction types per app (error 1217 on SignerListSet), so
                    the QR rail can refuse a tx the council legitimately needs.
                    The pinned bytes are public material: a member can sign them
                    in ANY multisign tool and paste the blob here. It lands
                    through the same door as a QR signature — the server still
                    verifies identity + fidelity + signature before storing it,
                    so this widens the tools, never the trust. */}
                {paste?.proposalId === p.id && paste.memberAccount === member ? (
                  <div className="space-y-2 rounded-lg border border-ink/10 bg-ink/[0.03] p-2.5">
                    <p className="text-[12px] text-ink/55">
                      {t(
                        'Sign these EXACT bytes in your own multisign tool (xrpl.services, the Xaman Multisign xApp…) and paste the resulting signed blob. Change nothing: a single altered field is rejected.',
                      )}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <GhostButton
                        onClick={() => {
                          void navigator.clipboard.writeText(JSON.stringify(p.txjson, null, 2));
                          setCopiedTx(p.id);
                          setTimeout(() => setCopiedTx(null), 2_000);
                        }}
                      >
                        {copiedTx === p.id ? <Check size={12} /> : <Copy size={12} />}
                        {copiedTx === p.id ? t('Copied') : t('Copy the transaction to sign')}
                      </GhostButton>
                    </div>
                    <textarea
                      value={paste.blob}
                      onChange={(e) => setPaste({ ...paste, blob: e.target.value, error: undefined })}
                      placeholder={t('Paste the signed blob (hex)')}
                      spellCheck={false}
                      rows={3}
                      className="w-full rounded-lg border border-ink/10 bg-surface-1 px-3 py-2 font-mono text-[11px] text-ink outline-none focus:border-volt/40"
                    />
                    {paste.error && <InlineNotice tone="warning">{paste.error}</InlineNotice>}
                    <div className="flex flex-wrap items-center gap-2">
                      <PrimaryButton onClick={() => void submitPastedBlob(p, member)} disabled={paste.busy}>
                        {paste.busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                        {t('Add this signature')}
                      </PrimaryButton>
                      <GhostButton onClick={() => setPaste(null)}>{t('Cancel')}</GhostButton>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPaste({ proposalId: p.id, memberAccount: member, blob: '' })}
                    className="text-[12px] text-ink/40 hover:text-ink/70"
                  >
                    {t('Signed it elsewhere? Paste the signature')}
                  </button>
                )}
              </div>
            )}
          </div>
        ))}

      {/* Waiting with no seat of your own: say WHY there is no button, so the
          missing wallet reads as a connection to make, not a dead end. Without
          this the strict filter would leave a councillor staring at 1/3 and no
          way in — the very hole the change was reaching for. */}
      {tray === 'waiting' && !p.signerList.some((s) => myAddrs.has(s.account)) && (
        <p className="text-[11px] text-ink/40">
          {t(
            'No signature of yours is pending here: none of this council’s seats belongs to a wallet linked to this account. Each councillor signs from their own Astryum — if one of these addresses is yours, connect it in Xaman. To sign together in one sitting, use the live ceremony instead.',
          )}
        </p>
      )}

      {tray === 'ready' && (
        <PrimaryButton onClick={() => void emit(p)} disabled={emittingId === p.id}>
          {emittingId === p.id ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {t('Combine & broadcast')}
        </PrimaryButton>
      )}

      {/* The acta (§2.2): stance signed by each councillor, immutable, batch-
          anchored at emission. Not a chat. */}
      {/* G1-cadena round 3: the tray travels with it. Positions are refused by
          the server past the deadline, so an unresolved seat must not offer
          «Fix my position» — it was the third impossible action on this row,
          rendered outside every tray condition. */}
      <FormalPositions
        proposal={p}
        myAddrs={myAddrs}
        seatUnresolved={tray === 'unresolved'}
        onChanged={() => void reload()}
      />

      {emitResult?.id === p.id && emitResult.engine !== 'tesSUCCESS' && (
        <InlineNotice tone="warning">
          {emitResult.engine} — {emitResult.message}
        </InlineNotice>
      )}
      {/* A validated tec* APPLIED and FAILED: never reported,
          never «register it». The backend says the same (TX_FAILED_ON_LEDGER):
          withdraw, fix the cause, compose again. */}
      {emitResult?.id === p.id && decideEmitReport(emitResult).kind === 'failed-on-ledger' && (
        <InlineNotice tone="warning">
          <div className="space-y-2">
            <p>
              {t('The ledger validated it but it FAILED:')} {emitResult.finalResult}
            </p>
            <p className="text-[12px]">
              {t('It applied and failed: nothing moved, but the network fee was charged and the Sequence was spent, so these signatures can never be broadcast again. Do not register it — withdraw this proposal, fix the cause and compose it again, then collect fresh signatures.')}
            </p>
            <GhostButton onClick={() => void withdraw(p)}>
              <Undo2 size={12} /> {t('Withdraw (proposer only)')}
            </GhostButton>
          </div>
        </InlineNotice>
      )}
      {emitResult?.id === p.id && emitResult.engine === 'tesSUCCESS' && !emitResult.validated && (
        <InlineNotice tone="warning">
          {t('Broadcast accepted — still waiting for ledger validation. Check XRPScan in a moment; do not assume it applied.')}
        </InlineNotice>
      )}

      {/* Council order in flight: the XRPL broadcast is only leg 1 — the order
          exists when the BRIDGE consumes it on Flare. Honest states, no
          premature green (the settlement machine decides). */}
      {orderRelay?.proposalId === p.id &&
        (settlement.state?.status === 'settled' ? (
          <InlineNotice tone="success">{t('Executed in the cage — the bridge consumed this order.')}</InlineNotice>
        ) : orderRelay.stuck ? (
          <div className="flex flex-wrap items-center gap-2">
            <InlineNotice tone="warning">
              {t('The relay is stuck:')} {orderRelay.stuck}
            </InlineNotice>
            <GhostButton onClick={retryRelay}>
              <RefreshCw size={12} /> {t('Retry the relay')}
            </GhostButton>
          </div>
        ) : orderRelay.relay === 'relayer-disabled' || orderRelay.relay === 'not-launched' ? (
          <div className="flex flex-wrap items-center gap-2">
            <InlineNotice tone="warning">
              {t('The order is signed and valid, but the relay is off — the proof can be delivered by anyone later; no signature is lost.')}
            </InlineNotice>
            <GhostButton onClick={retryRelay}>
              <RefreshCw size={12} /> {t('Retry the relay')}
            </GhostButton>
          </div>
        ) : (
          <InlineNotice tone="warning">
            {t('Council order — the relay is carrying the FDC proof to the cage (~2–5 min). Done means the bridge consumed it, not this screen.')}
          </InlineNotice>
        ))}

      {/* G1-cadena: an unresolved seat has its OWN filing button above, the one
          that states the explorer was checked. A plain "Withdraw" here would be
          the same silent archiving the server now refuses. */}
      {LIVE.includes(p.status) && tray !== 'ready' && tray !== 'unresolved' && (
        <GhostButton onClick={() => void withdraw(p)}>
          <Undo2 size={12} /> {t('Withdraw (proposer only)')}
        </GhostButton>
      )}
    </li>
  );

  const tray = (title: string, items: CouncilProposalRecord[], kind: ProposalTray) =>
    items.length > 0 && (
      <section className="space-y-2" aria-label={`${title} · ${items.length}`}>
        <p className="text-[11px] font-medium uppercase tracking-widest text-ink/35">
          {title} <span className="ml-1 tracking-normal text-ink/30">· {items.length}</span>
        </p>
        <ul className="space-y-2">{items.map((p) => renderProposal(p, kind))}</ul>
      </section>
    );

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Inbox size={16} className="text-ink/50" />
        <SectionTitle>{t('Proposal inbox')}</SectionTitle>
        {toSign.length > 0 && (
          <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
            {toSign.length}
          </span>
        )}
        <div className="ml-auto">
          <GhostButton onClick={() => void reload()} disabled={loading}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {t('Refresh')}
          </GhostButton>
        </div>
      </div>

      <p className="text-[12px] text-ink/50">
        {t(
          'A quorum signs asynchronously: propose, and each member signs from THEIR OWN account with their own linked wallet, whenever they can. You only ever sign your own seat here. Once the quorum is met, anyone combines and broadcasts from the browser. Proposals expire after 7 days.',
        )}
      </p>

      {/* prosa-y-lectores — the listing's refusal, as prose, plus the one cause
          this screen can name. The 403 the permission floor answers is exactly
          the wall the consejo-superficies 4 warning was written for, and the
          only surface where that person can still be reached: the rows they
          would have read it on are the rows the server is withholding. The
          cause is only stated when the wallet list was really read
          (`inboxRefusalCause`) — a swallowed read names nothing. */}
      {error && (
        <InlineNotice tone="warning">
          <div className="space-y-1.5">
            <ServerRefusalBody refusal={error} t={t} />
            {(() => {
              // The cure is a SIGNATURE, not a registration —
              // and it is only spelled out here when the server did not already
              // spell it out itself.
              const cause = inboxRefusalCause(
                error.code,
                xrplConnected ? [xrplConnected] : [],
                linkedAddrs,
                myAddrs,
                walletsRead,
                refusalExplainsProof(error.detail),
              );
              if (cause === 'unlinked-wallet') {
                return (
                  <p>
                    {t(
                      'The wallet you have connected in Xaman is not one the server has on this account. If your seat on this council is that wallet, prove it is yours: sign in with it, or bind it from Wallets with a signature. Registering an address without signing is not proof — a council\'s signer addresses are public, so anyone could type one in.',
                    )}
                  </p>
                );
              }
              if (cause === 'prove-membership') {
                return (
                  <p>
                    {t(
                      'Membership is decided by an address you have PROVEN: the wallet you signed in with, or one you signed a binding challenge for. An address that was only registered is not a proof. If you do hold a seat on this council, sign in with that wallet — or bind it with a signature from Wallets — and this opens.',
                    )}
                  </p>
                );
              }
              return null;
            })()}
          </div>
        </InlineNotice>
      )}
      {/* LAS FILAS QUE NO SE PUDIERON LEER, DICHAS. No desaparecen del
          listado en silencio: se cuentan, se dice la frase del servidor y se ofrece
          el reintento cuando el servidor dijo que reintentar sirve. «No pude leer»
          no es permiso, ni castigo, ni un hecho sobre esta persona. */}
      {unreadableRows && (
        <InlineNotice tone="warning">
          <div className="space-y-1.5">
            <p>{unreadableRows.text}</p>
            {/* El lector calculaba los ids y no los pintaba nadie,
                mientras la prosa del servidor decía «open it on its own». Sin el
                id no hay nada que abrir ni que nombrar al escribirnos. */}
            {unreadableRows.ids.length > 0 && (
              <p className="font-mono text-[11px] text-ink/55">{unreadableRows.ids.join(' · ')}</p>
            )}
            {unreadableRows.retryable && (
              <GhostButton onClick={() => void reload()} disabled={loading}>
                {t('Try reading them again')}
              </GhostButton>
            )}
          </div>
        </InlineNotice>
      )}
      {actionError && <InlineNotice tone="warning">{actionError}</InlineNotice>}
      {/* Lo que el withdraw dijo del asiento de nonce. Verde
          solo cuando el servidor dijo «soltado»; lo demás es «sigue ocupado» o
          «no pude leer», que es justo lo que la siguiente salida va a contestar. */}
      {withdrawnSeat && (
        <InlineNotice tone={withdrawnSeat.kind === 'freed' ? 'success' : 'warning'}>{withdrawnSeat.text}</InlineNotice>
      )}

      {/* xaman-cancelar 4 — a request we asked Xaman to kill and could NOT
          confirm dead. It may still be signable on a member's phone for the
          rest of its 24 hours, so it is named here until someone reads it:
          "we could not confirm it" is not "it is gone". */}
      {strayPayload && (
        <InlineNotice tone="warning">
          <div className="space-y-2">
            <p>{payloadStrayNotice(strayPayload, t)}</p>
            <GhostButton onClick={() => setStrayPayload(null)}>{t('Close')}</GhostButton>
          </div>
        </InlineNotice>
      )}

      {/* G1 — el aviso que evita el pago duplicado. La transacción ESTÁ en el
          ledger; lo único que falló fue registrarla aquí. Si esto se callara,
          la fila caducaría, la bandeja diría «expired» de algo ejecutado, y la
          familia compondría el pago otra vez (Sequence nuevo, válido). */}
      {unreported && (
        <InlineNotice tone="warning">
          <div className="space-y-2">
            {/* The panel follows the backend's refusal: a
                FAILED transaction is withdrawn and composed again, never
                «registered»; a hash that is not this proposal's is not either. */}
            {unreportedView.voice === 'failed-on-ledger' ? (
              <>
                <p className="font-medium">{t('This transaction reached the ledger and FAILED — nothing moved.')}</p>
                <p className="text-[12px]">
                  {t('Do not register it and do not broadcast these signatures again: withdraw this proposal, fix the cause and compose it again, then collect fresh signatures.')}
                </p>
              </>
            ) : unreportedView.voice === 'not-this-proposal' ? (
              <>
                <p className="font-medium">{t('This hash is not the transaction of this proposal — it was not registered.')}</p>
                <p className="text-[12px]">{t('Check the account in the explorer before doing anything else.')}</p>
              </>
            ) : (
              <>
                <p className="font-medium">
                  {t('This proposal WAS broadcast — we could not register it here.')}
                </p>
                <p className="text-[12px]">
                  {t('The transaction is already on the XRP Ledger. Do NOT compose it again: register it here, or check it in the explorer first.')}
                </p>
              </>
            )}
            {unreported.detail ? <p className="text-[12px] text-ink/60">{unreported.detail}</p> : null}
            <p className="break-all font-mono text-[11px] text-ink/60">{unreported.hash}</p>
            <div className="flex flex-wrap items-center gap-2">
              {unreportedView.canRegister ? (
                <GhostButton onClick={() => void retryReport()}>
                  <RefreshCw size={12} /> {t('Register it now')}
                </GhostButton>
              ) : (
                <>
                  {unreportedView.voice === 'failed-on-ledger' &&
                    (() => {
                      const row = proposals.find((x) => x.id === unreported.id);
                      return row ? (
                        <GhostButton onClick={() => void withdraw(row)}>
                          <Undo2 size={12} /> {t('Withdraw (proposer only)')}
                        </GhostButton>
                      ) : null;
                    })()}
                  <GhostButton onClick={() => setUnreported(null)}>{t('Close')}</GhostButton>
                </>
              )}
              <a
                href={`https://livenet.xrpl.org/transactions/${unreported.hash}`}
                target="_blank"
                rel="noreferrer"
                className="text-[12px] text-ink/55 underline underline-offset-2 hover:text-ink/80"
              >
                {t('See it in the explorer')}
              </a>
            </div>
          </div>
        </InlineNotice>
      )}

      {proposals.length === 0 && !loading ? (
        <EmptyState
          bare
          icon={<Inbox size={20} />}
          title={t('No proposals yet')}
          hint={t('Actions on this account create proposals here for the council to sign.')}
        />
      ) : (
        <div className="space-y-4">
          {/* First, above everything: the rows where the money may already have
              moved. Composing over one of these is how a council pays twice. */}
          {tray(t('Check before composing again'), unresolved, 'unresolved')}
          {tray(t('Waiting for YOUR signature'), toSign, 'toSign')}
          {tray(t('Waiting for others'), waitingOthers, 'waiting')}
          {tray(t('Ready to emit'), ready, 'ready')}
          {tray(t('Emitted'), emitted, 'emitted')}
          {archived.length > 0 && (
            <p className="text-[11px] text-ink/35">
              {archived.length} {t('expired or withdrawn proposals not shown')}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
