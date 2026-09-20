'use client';

/**
 * CouncilOrderCard — "the council orders, the cage obeys" (roadmap Pieza 1).
 *
 * The full enforcement rail, in one card:
 *   compose (prepare-only) → quorum signs N QRs (the existing coordinator) →
 *   browser broadcasts on XRPL → the courtesy relayer carries the FDC proof →
 *   the XrplCouncilBridge executes EXACTLY the committed bytes on the vault.
 *
 * The tracker (F8 pattern) shows the three stages honestly: signed on XRPL ✓ →
 * FDC round (~2-5 min) → executed in the cage ✓. Settlement truth is read from
 * the bridge on-chain (consumedTxId), never from local state alone.
 *
 * Astryum composes and relays with ZERO discretion: the bridge only accepts
 * the bytes whose keccak256 the quorum signed. No order can extract principal —
 * the vault has no such function.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, ExternalLink, Landmark, Loader2, Send } from 'lucide-react';
import { Card, GhostButton, MicroLabel, Pill, PrimaryButton, SectionTitle } from '../ui/primitives';
import { useT } from '../../i18n/LanguageProvider';
import { getUserRegion } from '../../lib/region';
import { xrplLegacy, type CouncilOrderHandoff } from '../../services/v1Api';
import { startPending } from '../../lib/settlement/settlement';
import { useSettlement } from '../../lib/settlement/useSettlement';
import { CouncilSigningDoors } from './CouncilMultisigFlow';
import { DisclosureBlock } from './LegacyPanel';
import { InlineNotice } from './InlineNotice';
import { orderError } from './CouncilVaultEntry';
import { mayConfirmAnotherOrder, sameOrderMinutesAgo } from '../../lib/institutional/api';
import { composeKindOf } from '../../lib/xrpl/singleSignVerdict';
import {
  CouncilOrderInFlightConfirm,
  CouncilOrderServerWarnings,
  StaleOrderLockNote,
  useStaleOrderLock,
} from '../xrpl/XamanSingleSign';

const XRPSCAN_TX = 'https://xrpscan.com/tx/';
const FLARE_EXPLORER: Record<string, string> = {
  coston2: 'https://coston2-explorer.flare.network/tx/',
  flare: 'https://flare-explorer.flare.network/tx/',
};

// The FDC round latency the tracker promises up front, so the wait reads as
// normal and not as a failure with the family watching. PLACEHOLDER — confirm
// the real number with `rehearse-attestation.ts` and update.
const FDC_ROUND_ESTIMATE = '2–5 min';

/** What the quorum is really paying, read from the COMPOSED transaction.
 *  With the order fee on, the Payment is 1 drop + the fee (0.200001 XRP), not
 *  the "1 drop" the copy used to promise. Drops are always 6 decimals. */
function orderPaymentXrp(handoff: CouncilOrderHandoff): string {
  const raw = (handoff.xrplTx as { Amount?: unknown })?.Amount;
  const drops = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : NaN;
  if (!Number.isFinite(drops) || drops <= 0) return '—';
  if (drops === 1) return '1 drop';
  return `${(drops / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 6 })} XRP`;
}

/** The v1 action forms — field lists per action, rendered generically.
 *  'payees' is the one repeatable field: address + % rows (wire wants bps).
 *  'venueKind' is the vault's own enum, offered as a closed list (G12-venues). */
type FieldKind = 'venueId' | 'amount' | 'bps' | 'address' | 'date' | 'ref' | 'payees' | 'venueKind';
interface ActionForm {
  action: string;
  label: string;
  fields: Array<{ id: string; label: string; kind: FieldKind }>;
  /** What this order costs in TIME and what it does not do, said before the
   *  quorum composes it — not only inside the backend summary (G12-venues).
   *  Only the orders whose tempo is not obvious carry one. */
  notice?: string;
}

/**
 * LegacyVault.VenueKind, in the contract's declared order (enum VenueKind:
 * ERC4626 = 0, CompoundV2 = 1). A closed list because a free-typed ordinal is
 * the silent-failure shape: kind 7 encodes as a perfectly valid uint8,
 * composes, collects the quorum's signatures and the paid FDC round, and only
 * then panics on the vault when Solidity decodes the enum.
 */
const VENUE_KINDS: Array<{ value: string; label: string }> = [
  { value: '0', label: 'ERC-4626 vault' },
  { value: '1', label: 'Compound V2 market' },
];

const ACTION_FORMS: ActionForm[] = [
  {
    action: 'direct-to',
    label: 'Direct principal to a venue',
    fields: [
      { id: 'venueId', label: 'Venue #', kind: 'venueId' },
      { id: 'amount', label: 'Amount (base units)', kind: 'amount' },
    ],
  },
  {
    action: 'recall',
    label: 'Recall principal from a venue',
    fields: [
      { id: 'venueId', label: 'Venue #', kind: 'venueId' },
      { id: 'amount', label: 'Amount (base units)', kind: 'amount' },
    ],
  },
  {
    action: 'evacuate',
    label: 'Evacuate a venue (emergency)',
    fields: [{ id: 'venueId', label: 'Venue #', kind: 'venueId' }],
  },
  {
    // G12-venues: `moveToVenue` was live on the vault and in the backend enum
    // and had no door — the council could rescue capital only by recalling it
    // to the vault first: two ceremonies and two FDC rounds instead of one.
    action: 'move',
    label: 'Move principal between venues (rescue)',
    notice:
      'A rescue is never capped and never delayed — but the destination must be a live venue that is already open to entries (a venue proposed today only opens 30 days later), or the vault reverts.',
    fields: [
      { id: 'fromId', label: 'From venue #', kind: 'venueId' },
      { id: 'toId', label: 'To venue #', kind: 'venueId' },
      { id: 'amount', label: 'Amount (base units)', kind: 'amount' },
    ],
  },
  {
    // G12-venues: without this door the cage's venue set was frozen at whatever
    // it was deployed with — the council could not add a venue at all.
    // VENUE_DELAY = 30 days on-chain (LegacyVault D1a): the wait IS the action,
    // so it is stated on this surface and not only in the backend summary.
    action: 'propose-venue',
    label: 'Propose a venue (entry opens in 30 days)',
    notice:
      'Adding a venue is the one power the vault delays: the council signs today and principal can only enter 30 days later. This order moves no money by itself.',
    fields: [
      { id: 'target', label: 'Venue contract (Flare 0x…)', kind: 'address' },
      { id: 'kind', label: 'Venue kind', kind: 'venueKind' },
    ],
  },
  {
    // G12-venues. `retireVenue` is IMMEDIATE on-chain (only proposeVenue is
    // delayed) and it never liquidates — both said out loud, because a council
    // that believes retiring pulls the money out would leave capital sitting
    // in a venue it thinks it already left.
    action: 'retire-venue',
    label: 'Retire a venue (closes new entries)',
    notice:
      'This takes effect immediately — there is no 30-day wait to retire. Retiring never liquidates: what is already inside stays harvestable and can still be recalled, moved or evacuated.',
    fields: [{ id: 'venueId', label: 'Venue #', kind: 'venueId' }],
  },
  {
    // G12-venues. The bounds in the label are the vault's own:
    // MIN_VENUE_CAP_BPS = 1000, BPS = 10000.
    action: 'set-max-venue-bps',
    label: 'Set the per-venue entry cap (bps)',
    notice:
      'The cap limits how much of the vault a single venue may hold on NEW entries. The rescue move ignores it on purpose, so an emergency is never blocked by its own guard.',
    fields: [{ id: 'bps', label: 'Bps (1000–10000)', kind: 'bps' }],
  },
  {
    action: 'set-linaje-fee-bps',
    label: 'Set the linaje cut (bps)',
    fields: [{ id: 'bps', label: 'Bps (1000–4000)', kind: 'bps' }],
  },
  {
    // The yield panel's "no payees set" notice pointed here for weeks while the
    // form did not exist (F5) — the backend rail (setPayees) was always live.
    action: 'set-payees',
    label: 'Set the payees (who receives the yield)',
    fields: [{ id: 'payees', label: 'Payees', kind: 'payees' }],
  },
  {
    action: 'cede',
    label: 'Grant direction (the cession)',
    fields: [
      { id: 'director', label: 'Director (Flare 0x…)', kind: 'address' },
      { id: 'untilISO', label: 'Until', kind: 'date' },
    ],
  },
  { action: 'end-cession', label: 'End the cession', fields: [] },
  {
    action: 'set-constitution-ref',
    label: 'Point at a new constitution version',
    fields: [{ id: 'newRefHex', label: 'New SHA-256 (0x + 64 hex)', kind: 'ref' }],
  },
];

/**
 * G12-venues — what the backend cannot refuse for these four orders.
 *
 * The silence this closes: `move`, `propose-venue`, `retire-venue` and
 * `set-max-venue-bps` were built end to end (VAULT_COUNCIL_ABI + the zod enum
 * of POST /council-order/prepare + the vault callables) and ACTION_FORMS never
 * listed them, so the product had no door for them at all.
 *
 * The route's courtesy pre-flight covered direct-to, recall and set-payees ONLY
 * — nothing read the vault for a venue order, so a malformed target or a 500
 * bps cap was first heard as a revert on Flare AFTER the quorum signed and the
 * FDC round was paid (~20 FLR): unearned success. G12-move closed that half
 * server-side (CouncilProposalService.councilOrderPreflight, now shared by both
 * doors), and this guard stays for the two things the server cannot give:
 *
 *  - it answers BEFORE the round trip, on what was typed;
 *  - a same-venue move is the one refusal here that is NOT a revert mirror. The
 *    vault would happily execute it; it just spends a whole signing round and a
 *    paid FDC round moving principal to where it already is. Waste, not revert
 *    — which is why it lives on this side only.
 *
 * They never claim the order will land, only that it cannot land as typed.
 */
function venueOrderIssue(action: string, params: Record<string, unknown>): string | null {
  if (action === 'move' && Number(params.fromId) === Number(params.toId)) {
    return 'The origin and the destination are the same venue — that order would spend a whole signing round moving nothing.';
  }
  if (action === 'propose-venue') {
    if (!/^0x[a-fA-F0-9]{40}$/.test(String(params.target ?? ''))) {
      return 'The venue must be a Flare contract address (0x…).';
    }
    if (params.kind !== 0 && params.kind !== 1) {
      return 'Choose the venue kind — the vault only knows ERC-4626 vaults and Compound V2 markets.';
    }
  }
  if (action === 'set-max-venue-bps') {
    // LegacyVault.setMaxVenueBps reverts BpsOutOfBounds() outside 1000-10000.
    const bps = Number(params.bps);
    if (!Number.isInteger(bps) || bps < 1000 || bps > 10000) {
      return 'The per-venue entry cap must be between 1000 and 10000 bps — the vault refuses a cap that would brick its own entry.';
    }
  }
  return null;
}

type Stage = 'form' | 'review' | 'signing' | 'settling' | 'done' | 'error';

export default function CouncilOrderCard({ account }: { account: string }) {
  const { t } = useT();
  const [form, setForm] = useState<ActionForm>(ACTION_FORMS[0]);
  const [values, setValues] = useState<Record<string, string>>({});
  // set-payees rows — the person types a Flare address and a % share; the wire
  // gets bps. Empty rows are dropped before validation.
  const [payeeRows, setPayeeRows] = useState<Array<{ account: string; pct: string }>>([
    { account: '', pct: '' },
  ]);
  // The endowment decision made IN the product (E6): payees=[] is legal on the
  // vault and is the only way BACK to pure capitalization. Without this switch
  // the form demanded at least one payee and the family could never undo a split.
  const [capitalizeAll, setCapitalizeAll] = useState(false);
  const [stage, setStage] = useState<Stage>('form');
  const [handoff, setHandoff] = useState<CouncilOrderHandoff | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 409 SAME_ORDER_RECENTLY_LAUNCHED (it.14; COUNCIL_ORDER_IN_FLIGHT in it.13):
  // composing the same order again is an explicit confirm, never a silent retry.
  const [inFlight, setInFlight] = useState<{ detail?: string; code?: string; minutesAgo?: number | null; retryAfterSeconds?: number | null } | null>(null);
  /**
   * it.14 (R2 2.3): the ceremony's broadcast came back over a spent Sequence and
   * the order's fate says a sibling already went out (or could not be checked).
   * «Compose the order» stays shut until the council says it checked.
   */
  const staleLock = useStaleOrderLock();
  /**
   * it.16 (R3 3.1): the lock asks WHAT is being composed. A recall and an
   * evacuate take capital out of a venue, and an exit is warned, never stopped.
   * Everything else of this card is paused while the lock holds.
   */
  const staleLocked = staleLock.blocks(composeKindOf(form.action));
  const [xrplHash, setXrplHash] = useState<string | null>(null);
  const [flareHash, setFlareHash] = useState<string | null>(null);
  const [stuckReason, setStuckReason] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // The settlement machine owns the DONE verdict (and the F5 persistence).
  const settlement = useSettlement();
  useEffect(() => () => {
    if (pollTimer.current) clearInterval(pollTimer.current);
  }, []);

  const prepare = useCallback(async (opts?: { confirmAnotherOrder?: boolean }) => {
    // it.14 (R2 2.3): a stale order of this council whose sibling already went
    // out — composing again here is the same capital, moved twice. An EXIT is
    // exempt (it.16, R3 3.1), and so is the person's explicit «compose it again
    // anyway», which used to hit this return and do nothing (it.16, R5 5.5).
    if (staleLock.blocks(composeKindOf(form.action), { confirmed: opts?.confirmAnotherOrder })) return;
    setError(null);
    setInFlight(null);
    setStage('review');
    setHandoff(null);
    try {
      // Params go up as-typed; the backend validates + encodes deterministically.
      const params: Record<string, unknown> = {};
      for (const f of form.fields) {
        if (f.kind === 'payees') {
          // Endowment: an explicit EMPTY list — every future harvest
          // capitalizes into the principal. Yield already owed stays claimable.
          if (capitalizeAll) {
            params.payees = [];
            continue;
          }
          const rows = payeeRows
            .map((r) => ({ account: r.account.trim(), pct: Number(String(r.pct).replace(',', '.')) }))
            .filter((r) => r.account.length > 0 || Number.isFinite(r.pct));
          if (rows.length === 0) throw new Error(t('Add at least one payee.'));
          if (rows.some((r) => !/^0x[a-fA-F0-9]{40}$/.test(r.account))) {
            throw new Error(t('Every payee must be a Flare address (0x…).'));
          }
          if (rows.some((r) => !(r.pct > 0))) throw new Error(t('Every payee needs a share greater than 0%.'));
          if (new Set(rows.map((r) => r.account.toLowerCase())).size !== rows.length) {
            throw new Error(t('The same address appears twice in the payees.'));
          }
          // The vault demands EXACTLY 10000 bps on a non-empty list. `> 100`
          // used to be the only check here, so a 90% split composed, got the
          // quorum's signatures, paid an FDC round — and reverted
          // PayeeBpsSumInvalid() on Flare (E6 gap #1).
          const totalBps = rows.reduce((a, r) => a + Math.round(r.pct * 100), 0);
          if (totalBps !== 10_000) {
            throw new Error(`${t('The shares must add up to exactly 100%')} (${(totalBps / 100).toLocaleString()}%).`);
          }
          params.payees = rows.map((r) => ({ account: r.account, bps: Math.round(r.pct * 100) }));
          continue;
        }
        const v = values[f.id]?.trim();
        if (!v) {
          // G12-move: `venueKind` is the ONE field whose empty value must NOT be
          // coerced and must NOT be answered generically. Number('') is 0 —
          // ERC-4626 — so a kind nobody chose would compose in silence; and the
          // generic sentence below used to fire first, which made the kind
          // branch of venueOrderIssue unreachable dead code. Leaving the param
          // ABSENT hands the refusal to that branch, which names what to do.
          if (f.kind === 'venueKind') continue;
          throw new Error(t('Fill every field of the order first.'));
        }
        // G12-final: every coercion below this line is SILENT, and the silence
        // does not stop at the browser. `Number('x')` is NaN, JSON.stringify
        // writes NaN as null, and the server's `Number(null)` is 0 — so a
        // mistyped "Venue #" composed an order against venue #0: the venue that
        // exists and holds the principal, which is why the server pre-flight
        // (reading a real venue) approved it and the ceremony was paid for an
        // order nobody typed. Refuse the RAW text before it is coerced — what
        // is not a whole number must never be allowed to become one.
        if ((f.kind === 'venueId' || f.kind === 'bps' || f.kind === 'venueKind') && !/^\d+$/.test(v)) {
          throw new Error(
            `${t('This field only takes a whole number — a value the vault cannot read as an integer arrives as 0, which composes an order nobody typed.')} (${t(f.label)}: ${v})`,
          );
        }
        params[f.id] =
          f.kind === 'venueId' || f.kind === 'bps' || f.kind === 'venueKind'
            ? Number(v)
            : f.kind === 'date'
              ? new Date(`${v}T00:00:00Z`).toISOString()
              : v;
      }
      // G12-final: the shared server pre-flight (councilOrderPreflight) now
      // judges these four as well, so this guard is no longer the only reader.
      // It stays for the two refusals the server cannot give: an answer BEFORE
      // the round trip, and the same-venue move — waste, not a revert, so no
      // revert mirror on the server side would ever catch it.
      const venueIssue = venueOrderIssue(form.action, params);
      if (venueIssue) throw new Error(t(venueIssue));
      const h = await xrplLegacy.councilOrderPrepare({
        account,
        action: form.action,
        params,
        region: getUserRegion() ?? undefined,
        ...(opts?.confirmAnotherOrder ? { confirmAnotherOrder: true } : {}),
      });
      setHandoff(h);
    } catch (e) {
      const body = (e as { body?: { error?: string; detail?: string; minutesAgo?: number; launchedAt?: string; retryAfterSeconds?: number } })?.body;
      // it. 21 (§2.7): and DUPLICATE_CHECK_UNREADABLE — «we could not check» — which
      // had no reader at all, so the door simply closed for ~60 s with no button.
      if (mayConfirmAnotherOrder(body) && !opts?.confirmAnotherOrder) {
        // The same order went out for this council a moment ago: an explicit
        // confirm, never a silent retry. Both guard names are read (it.13/it.14).
        setInFlight({ detail: body?.detail, code: body?.error, minutesAgo: sameOrderMinutesAgo(body), retryAfterSeconds: body?.retryAfterSeconds ?? null });
        setStage('form');
        return;
      }
      // One error vocabulary with CouncilVaultEntry: the pre-flight's honest
      // sentence (ORDER_WOULD_REVERT → detail) instead of a raw code (§3.3).
      setError(orderError(e, t));
      setStage('form');
    }
  }, [account, form, values, payeeRows, capitalizeAll, staleLock, t]);

  /** Fire (or re-fire) the courtesy relay for a signed XRPL tx. Idempotent on the
   *  backend (executed → 'already-executed'); persistence-backed so a redeploy
   *  won't re-pay. A failure surfaces as the VISIBLE stuck state, never a spinner. */
  const triggerRelay = useCallback(
    (hash: string) => {
      setStuckReason(null);
      void xrplLegacy
        .councilOrderRelay({ xrplTxHash: hash, orderData: handoff?.order.orderData })
        .catch((e) => setStuckReason((e as Error).message));
    },
    [handoff],
  );

  /** After the quorum signed + the browser broadcast: start the FDC leg.
   *  NOTE the broadcast's tesSUCCESS is PRELIMINARY — it only moves the card to
   *  'settling'. The DONE state comes exclusively from the settlement machine
   *  (rail 'council-order' → LegacyBridge.consumedTxId on Flare), which also
   *  persists the op: an F5 mid-FDC-round resumes in the floating settlements
   *  surface instead of losing the ceremony (escaneo #6). */
  const onSettled = useCallback(
    (hash: string) => {
      setXrplHash(hash);
      setStage('settling');
      triggerRelay(hash);
      settlement.track(startPending('council-order', hash), {
        onSettled: () => {
          setStuckReason(null);
          setStage('done');
          if (pollTimer.current) clearInterval(pollTimer.current);
        },
      });
      // Council-specific ENRICHMENT poll (relay stuck-state + the Flare tx
      // hash): read-only detail; the success verdict never comes from here.
      pollTimer.current = setInterval(async () => {
        try {
          const st = await xrplLegacy.councilOrderStatus(hash, account);
          if (st.relay?.state === 'error') setStuckReason(st.relay.detail ?? t('the relay could not deliver the proof'));
          else if (st.relay?.state === 'relaying') setStuckReason(null);
          if (st.relay?.flareTxHash) setFlareHash(st.relay.flareTxHash);
        } catch {
          /* transient — keep polling */
        }
      }, 10_000);
    },
    [triggerRelay, settlement, t],
  );

  /** The diagnostic instrument of the ceremony: re-deliver the proof after a
   *  stuck relay, without re-signing (same XRPL tx, same committed bytes). */
  const retryRelay = useCallback(() => {
    if (xrplHash) triggerRelay(xrplHash);
  }, [xrplHash, triggerRelay]);

  const reset = useCallback(() => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    settlement.reset();
    setStage('form');
    setHandoff(null);
    setXrplHash(null);
    setFlareHash(null);
    setStuckReason(null);
    setError(null);
    setInFlight(null);
    setValues({});
  }, [settlement]);

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║ MODO DEMO TEMPORAL — BORRAR TRAS LA CEREMONIA (runbook §7)           ║
  // ║ Deja VER el estado "atascada" + Reintentar sin quórum, para no       ║
  // ║ estrenarlo con la familia delante. NUNCA en producción: el bundle de ║
  // ║ prod tiene NODE_ENV==='production' y este bloque queda muerto, así   ║
  // ║ que no puede activarse con una wallet real ni pasando ?demoStuck=1.  ║
  // ║ Para quitarlo: borra ESTE bloque y su uso en el JSX (busca DEMO_STUCK).║
  // ╚══════════════════════════════════════════════════════════════════════╝
  const demoStuckAvailable =
    process.env.NODE_ENV !== 'production' &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('demoStuck') === '1';
  const forceDemoStuck = useCallback(() => {
    setXrplHash('DEMO'.padEnd(64, '0'));
    setStage('settling');
    setStuckReason(
      'DATOS FALSOS (modo demo) — bridge.execute would revert: NonceMismatch(expected 0, actual 3)',
    );
  }, []);
  // ╚═══════════════════ fin del MODO DEMO TEMPORAL ══════════════════════╝

  const inputCls =
    'mt-1 w-full rounded-lg border border-ink/10 bg-ink/5 px-3 py-2 text-sm text-ink caret-ink placeholder:text-ink/30 outline-none focus:border-ink/25';

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Landmark size={16} className="text-ink/50" />
        <SectionTitle>{t('Council order (the cage on Flare)')}</SectionTitle>
      </div>
      <p className="text-[12px] text-ink/55">
        {t(
          'Govern the productive capital from XRPL, literally: the quorum signs ONE transaction committing the exact order; the Flare Data Connector proves it; the bridge executes only those bytes against the vault. No order can extract the principal — that function does not exist.',
        )}
      </p>

      {/* it.16 (R5 5.5): the lock ARMS in the review stage (the ceremony's
          broadcast is what comes back stale) and its note used to live inside
          the FORM branch below, which that stage does not render — the card
          paused with no headline and no way to say «I checked». It lives above
          every stage now, so wherever it arms, it is seen. */}
      <StaleOrderLockNote lock={staleLock.lock} onRelease={staleLock.release} pausing={staleLocked} />

      {(stage === 'form' || (stage === 'review' && !handoff)) && (
        <div className="space-y-3">
          <label className="block">
            <MicroLabel>{t('Order')}</MicroLabel>
            <select
              value={form.action}
              onChange={(e) => {
                const next = ACTION_FORMS.find((a) => a.action === e.target.value)!;
                setForm(next);
                setValues({});
                setPayeeRows([{ account: '', pct: '' }]);
                setCapitalizeAll(false);
              }}
              className={inputCls}
            >
              {ACTION_FORMS.map((a) => (
                <option key={a.action} value={a.action} className="bg-surface-2">
                  {t(a.label)}
                </option>
              ))}
            </select>
          </label>
          {/* G12-venues: the tempo of the order (30 days, or none) is money and
              time — it belongs here, before composing, not only in the summary. */}
          {form.notice && <InlineNotice tone="warning">{t(form.notice)}</InlineNotice>}
          {form.fields.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {form.fields.map((f) =>
                f.kind === 'payees' ? (
                  <div key={f.id} className="sm:col-span-2 space-y-2">
                    {/* The endowment door (E6): payees=[] is the contract's
                        default and the only way BACK from a split. */}
                    <label className="flex items-center gap-2 text-[12px] text-ink/70">
                      <input
                        type="checkbox"
                        checked={capitalizeAll}
                        onChange={(e) => setCapitalizeAll(e.target.checked)}
                        className="h-3.5 w-3.5 accent-current"
                      />
                      {t('No payees — every harvest capitalizes into the principal (endowment)')}
                    </label>
                    {capitalizeAll ? (
                      <p className="text-[11px] text-ink/45">
                        {t('This order clears the payee list. Yield already owed to someone stays claimable by them; everything harvested from now on grows the principal.')}
                      </p>
                    ) : (
                      <>
                        {payeeRows.map((r, i) => (
                          <div key={i} className="flex flex-wrap items-end gap-2">
                            <label className="grow">
                              <MicroLabel>{t('Payee (Flare 0x…)')}</MicroLabel>
                              <input
                                value={r.account}
                                onChange={(e) =>
                                  setPayeeRows((prev) => prev.map((x, j) => (j === i ? { ...x, account: e.target.value } : x)))
                                }
                                spellCheck={false}
                                className={inputCls}
                              />
                            </label>
                            <label className="w-24">
                              <MicroLabel>{t('Share (%)')}</MicroLabel>
                              <input
                                value={r.pct}
                                onChange={(e) =>
                                  setPayeeRows((prev) => prev.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))
                                }
                                inputMode="decimal"
                                className={inputCls}
                              />
                            </label>
                            {payeeRows.length > 1 && (
                              <GhostButton onClick={() => setPayeeRows((prev) => prev.filter((_, j) => j !== i))}>
                                ×
                              </GhostButton>
                            )}
                          </div>
                        ))}
                        <GhostButton onClick={() => setPayeeRows((prev) => [...prev, { account: '', pct: '' }])}>
                          + {t('Add payee')}
                        </GhostButton>
                        {/* The running total, said in words BEFORE composing:
                            the vault only accepts exactly 100.00% (E6 gap #1). */}
                        {(() => {
                          const totalBps = payeeRows.reduce((a, r) => {
                            const pct = Number(String(r.pct).replace(',', '.'));
                            return a + (Number.isFinite(pct) && pct > 0 ? Math.round(pct * 100) : 0);
                          }, 0);
                          const exact = totalBps === 10_000;
                          return (
                            <p className="text-[11px] text-ink/60">
                              {t('The shares now add up to')}{' '}
                              <span className="font-mono">{(totalBps / 100).toLocaleString()}%</span>
                              {' · '}
                              {exact ? t('exactly 100% — ready to compose') : t('the vault only accepts exactly 100%')}
                            </p>
                          );
                        })()}
                        <p className="text-[11px] text-ink/45">
                          {t('The yield is shared out in these proportions, and the whole of it must be assigned. To keep capitalizing instead, use the no-payees option above.')}
                        </p>
                      </>
                    )}
                  </div>
                ) : f.kind === 'venueKind' ? (
                  <label key={f.id} className="block">
                    <MicroLabel>{t(f.label)}</MicroLabel>
                    <select
                      value={values[f.id] ?? ''}
                      onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                      className={inputCls}
                    >
                      {/* No default: the vault panics on an ordinal it does not
                          know, so the kind is chosen, never assumed. */}
                      <option value="" className="bg-surface-2">
                        {t('Choose the venue kind…')}
                      </option>
                      {VENUE_KINDS.map((k) => (
                        <option key={k.value} value={k.value} className="bg-surface-2">
                          {t(k.label)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label key={f.id} className="block">
                    <MicroLabel>{t(f.label)}</MicroLabel>
                    <input
                      type={f.kind === 'date' ? 'date' : 'text'}
                      inputMode={f.kind === 'venueId' || f.kind === 'bps' || f.kind === 'amount' ? 'numeric' : undefined}
                      value={values[f.id] ?? ''}
                      onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                      spellCheck={false}
                      className={inputCls}
                    />
                  </label>
                ),
              )}
            </div>
          )}
          {inFlight ? (
            <CouncilOrderInFlightConfirm
              detail={inFlight.detail}
              code={inFlight.code}
              minutesAgo={inFlight.minutesAgo}
              retryAfterSeconds={inFlight.retryAfterSeconds}
              onConfirm={() => void prepare({ confirmAnotherOrder: true })}
              onRetry={() => void prepare()}
              onDismiss={() => setInFlight(null)}
            />
          ) : null}
          <PrimaryButton onClick={() => void prepare()} disabled={stage === 'review' || !!inFlight || staleLocked}>
            {stage === 'review' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {t('Compose the order')}
          </PrimaryButton>
          {/* DEMO_STUCK — bloque temporal, borrar tras la ceremonia (runbook §7) */}
          {demoStuckAvailable && (
            <GhostButton onClick={forceDemoStuck}>
              <AlertTriangle size={13} /> MODO DEMO: forzar estado atascado (datos falsos)
            </GhostButton>
          )}
        </div>
      )}

      {stage === 'review' && handoff && (
        <div className="space-y-3">
          <DisclosureBlock handoff={handoff} />
          <CouncilOrderServerWarnings
            recoveryWarning={handoff.recoveryWarning}
            inFlightWarning={handoff.inFlightWarning}
            duplicateWarning={handoff.duplicateWarning}
          />
          <p className="text-[12px] text-ink/55">
            {/* The amount is READ from the composed tx, never described from
                memory: this line used to promise a single drop while the order
                fee made it 200,001 drops — a screen that contradicts what the
                quorum is about to sign (F4 family, 2026-08-03). */}
            {t('Your council signs this Payment of')} {orderPaymentXrp(handoff)}{' '}
            {t(
              'here, each member from their own device. The signature authorizes ONLY the order above — same bytes, once, in order.',
            )}
          </p>
          {/* The async tempo (§2.4): file it in the inbox and let each member
              sign from their own device over days. */}
          {/* The proposal's TITLE is the order's own summary ("Put 0.1 FXRP of
              the principal to work in Kinetic"), not the generic "Council
              order": the capital movement lives in the order bytes, so without
              this the inbox — and the sidebar tray — could only say "Payment"
              about a decision the family has to weigh (2026-08-03). */}
          {/* consejo-superficies 2: the two tempos are ONE element with one
              rule — while the live ceremony holds the pinned seat, the async
              door beside it cannot compose the same transaction again (it says
              so instead of vanishing). */}
          <CouncilSigningDoors
            xrplTx={handoff.xrplTx}
            account={account}
            defaultTitle={handoff.order.summary || t('Council order')}
            onSettled={onSettled}
            exitToken={handoff.exitToken}
            onStaleFate={staleLock.report}
          />
          <GhostButton onClick={reset}>{t('Back')}</GhostButton>
        </div>
      )}

      {(stage === 'settling' || stage === 'done') && (
        <div className="space-y-2">
          {/* The F8 tracker: three honest stages — plus an honest STUCK state,
              never a perpetual spinner (the day's diagnostic instrument). */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill tone="success">
              <Check size={12} /> {t('signed on XRPL')}
            </Pill>
            <span className="text-ink/25">→</span>
            {stage === 'done' ? (
              <Pill tone="success">
                <Check size={12} /> {t('FDC round')}
              </Pill>
            ) : stuckReason ? (
              <Pill tone="warning">
                <AlertTriangle size={12} /> {t('stuck')}
              </Pill>
            ) : (
              <Pill tone="warning">
                <Loader2 size={12} className="animate-spin" /> {t('FDC round')}
              </Pill>
            )}
            <span className="text-ink/25">→</span>
            {stage === 'done' ? (
              <Pill tone="success">
                <Check size={12} /> {t('executed in the cage')}
              </Pill>
            ) : (
              <Pill tone="neutral">{t('executed in the cage')}</Pill>
            )}
          </div>

          {/* The expected wait, promised up front so the silence reads as normal
              and not as a failure with the family watching. */}
          {stage === 'settling' && !stuckReason && (
            <p className="text-[12px] text-ink/55">
              {t('The FDC round takes about')} {FDC_ROUND_ESTIMATE}. {t('The quorum can step away — the wait is normal, not a failure.')}
            </p>
          )}

          {stage === 'done' && (
            <InlineNotice tone="success">
              {t('The order the quorum signed on XRPL was executed on Flare. Nobody held a key in between.')}
            </InlineNotice>
          )}
          <div className="flex flex-wrap gap-3 text-[12px]">
            {xrplHash && (
              <a href={`${XRPSCAN_TX}${xrplHash}`} target="_blank" rel="noreferrer" className="text-ink/55 underline hover:text-ink/80">
                <ExternalLink size={12} className="mr-1 inline" /> XRPL tx
              </a>
            )}
            {flareHash && handoff && (
              <a
                href={`${FLARE_EXPLORER[handoff.order.chain] ?? FLARE_EXPLORER.coston2}${flareHash}`}
                target="_blank"
                rel="noreferrer"
                className="text-ink/55 underline hover:text-ink/80"
              >
                <ExternalLink size={12} className="mr-1 inline" /> Flare tx
              </a>
            )}
          </div>

          {/* Stuck: say WHY, and offer to re-deliver the proof — no re-signing,
              same committed bytes. Idempotent + persistence-backed on the backend. */}
          {stuckReason && stage !== 'done' && (
            <InlineNotice tone="warning">
              <div className="space-y-2">
                <div>
                  <span className="font-medium">{t('The relay is stuck:')}</span> {stuckReason}
                </div>
                <div className="text-ink/60">
                  {t('The order stays valid — the same signed transaction can be re-delivered by anyone (permissionless), no new signature needed.')}
                </div>
                <GhostButton onClick={retryRelay}>
                  <Send size={13} /> {t('Retry the relay')}
                </GhostButton>
              </div>
            </InlineNotice>
          )}

          {stage === 'done' && <GhostButton onClick={reset}>{t('New order')}</GhostButton>}
        </div>
      )}

      {error && <InlineNotice tone="warning">{error}</InlineNotice>}
    </Card>
  );
}
