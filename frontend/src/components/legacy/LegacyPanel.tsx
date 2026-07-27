'use client';

/**
 * LegacyPanel — Astryum Legacy v0: XRPL governs, Flare produces.
 *
 * Three cards over one Legacy account (vías (a)+(b), doc
 * Astryum_Legacy_Investigacion_Verificada_2026-07-13):
 *
 *  1. EL CONSEJO — the account's signer list read from the ledger (members,
 *     weights, quorum, master key state). Setup is NOT done here (ADR-006: no
 *     generic SignerListSet builder — we are not a wallet): link-out to the
 *     Xaman Multisign xApp / xrpl.services, same pattern as the Escrow Releaser.
 *  2. TRANSFERENCIA PROGRAMADA — EscrowCreate(Destination=beneficiary,
 *     FinishAfter[, CancelAfter]) composed UNSIGNED. Honest semantics in the
 *     copy: with pure times the commitment is UNBREAKABLE until the unlock
 *     date (a feature — not even the council can back out), and recoverable
 *     after the expiry date if unclaimed. Protection of the account is BY THE
 *     COUNCIL (quorum) — never "the code prevents it" (that is only true of
 *     the Flare cage, not of XRPL).
 *  3. LA CONSTITUCIÓN — the governance document anchored as a DID (XLS-40):
 *     SHA-256 computed CLIENT-SIDE (the document never leaves the browser),
 *     anchored via DIDSet, verified against the ledger, with the quorum-signed
 *     amendment history.
 *
 * Signing: if the Legacy account IS the connected Xaman account (single-key
 * v0 / testing), hand-off signs directly. If it is a multisig council account,
 * Xaman cannot sign multisig natively — the panel hands out the UNSIGNED
 * txjson (copy) + links to the Multisign xApp. Astryum composes; the council
 * signs. Nothing here ever signs or submits on the user's behalf (#1).
 *
 * Forbidden copy (L5 — legal): testamento / herencia / fideicomiso / sucesión.
 * This is a programmed, conditioned, revocable transfer.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  FileCheck2,
  FileText,
  KeyRound,
  Landmark,
  Link2,
  ListChecks,
  Loader2,
  Lock,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  Undo2,
  Unlock,
  Users,
} from 'lucide-react';
import {
  Card,
  EmptyState,
  GhostButton,
  MicroLabel,
  PageHeader,
  Pill,
  PrimaryButton,
  SectionTitle,
} from '../ui/primitives';
import { PulseDot, RevealGroup, RevealItem } from '../ui/motion';
import {
  CouncilScene,
  LedgerScrollScene,
  MirrorOrbitsScene,
  MonumentScene,
  TimeVaultScene,
} from '../ui/scenes';
import { InlineNotice } from './InlineNotice';
import MyLegaciesList from './MyLegaciesList';
import ProposalInbox from './ProposalInbox';
import LegacyActivityFeed from './LegacyActivityFeed';
import ProposeToCouncil from './ProposeToCouncil';
import GovernedMoneyFlows from './GovernedMoneyFlows';
import GovernedMovements from './GovernedMovements';
import CouncilMultisigFlow from './CouncilMultisigFlow';
import CloseDoorSign from './CloseDoorSign';
import ConstitutionBuilder from './ConstitutionBuilder';
import LegacyDiscovery, { type LegacyJourney } from './LegacyDiscovery';
import LegacyIntentCompiler from './LegacyIntentCompiler';
import CouncilOrderCard from './CouncilOrderCard';
import WalletManager from '../wallet/WalletManager';
import { getConstitutionDraft, rememberLegacy, saveConstitutionDraft } from './legacyLocal';
import { useT } from '../../i18n/LanguageProvider';
import { useXrplWalletPartner } from '../../lib/wallet/useXrplWalletPartner';
import { useAuthorities } from '../../hooks/useAuthorities';
import { governedAuthorityId } from '../../lib/authority';
import { getUserRegion } from '../../lib/region';
import { computeCeremonyReserve } from '../../lib/legacy/ceremonyReserve';
import {
  xrplLegacy,
  xrplSavings,
  type ConstitutionAmendment,
  type ConstitutionAnchor,
  type RehearsalStatus,
  type LegacyHealth,
  type VaultCouncilInfo,
  type XrplCouncil,
  type XrplEscrowRow,
  type XrplSpendable,
  type XrplTxHandoff,
} from '../../services/v1Api';

const XRPSCAN_TX = 'https://xrpscan.com/tx/';
const XRPSCAN_ACCOUNT = 'https://xrpscan.com/account/';
/** Multisig setup + signing live in the user's wallet tools, not in Astryum (ADR-006).
 *  The xApp detect link is VERIFIED (2026-07-13: valid page, "create, distribute &
 *  collect multi sign signatures"). xrpl.services is an SPA whose tool query params
 *  are not verifiable from here — link the tools page plainly, no invented param. */
const XAMAN_MULTISIGN_XAPP = 'https://xumm.app/detect/xapp:xumm.multisign';
const XRPL_SERVICES_TOOLS = 'https://xrpl.services/tools';

const XRPL_ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/** The vault mirror was the honest drift-check while FDC enforcement did not
 *  exist. Retired from the frontend (founder 2026-07-19): the Council order rail
 *  IS the enforcement now. Kept in the repo, gated off — flip to re-enable. */
const SHOW_VAULT_MIRROR = false;

// Constitution templates (§4 — nobody writes one from a blank page) moved to
// ./constitutionTemplates.ts as a GALLERY with labelled fields: the form
// generates the text, the user never hunts [BRACKETS]. The old single hardcoded
// template lives on as the "Family patrimony" entry. Assembly + hashing stay in
// the browser; the document text never touches the backend (privacy invariant).

function toDrops(xrp: string): string | null {
  const n = Number(xrp);
  if (!isFinite(n) || n <= 0) return null;
  return String(Math.round(n * 1_000_000));
}

function fmtDateTime(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function shortAddr(a: string): string {
  return a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-5)}` : a;
}

/** SHA-256 of the exact text, hex — computed in the browser (WebCrypto). */
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

function gateMessage(err: unknown, t: (s: string) => string): string {
  const status = (err as { status?: number })?.status;
  const msg = (err as Error)?.message ?? '';
  if (status === 503 || msg.includes('XRPL_DEFI_DISABLED')) {
    return t('XRPL composition is not enabled on this deployment yet (feature flag off).');
  }
  if (status === 451 || msg.includes('GEOFENCE_BLOCKED')) {
    return t('DeFi execution is not available for your region. Set your region in Settings — monitoring stays available.');
  }
  if (status === 401) return t('Your session expired — sign in again to continue.');
  return msg || t('Something went wrong.');
}

/** Disclosure fact keys → readable labels (raw camelCase confuses the review —
 *  same fix the savings review needed; covers escrow + DID facts). */
function factLabel(key: string, t: (s: string) => string): string {
  const map: Record<string, string> = {
    amountXrp: t('Amount (XRP)'),
    amountDrops: t('Amount (drops)'),
    destination: t('Beneficiary'),
    selfEscrow: t('Back to your own account'),
    earnsYield: t('Generates yield'),
    ownerReserveXrp: t('Extra ledger reserve (XRP)'),
    finishAfterISO: t('Deliverable from'),
    cancelAfterISO: t('Recoverable after'),
    network: t('Network'),
    owner: t('Owner'),
    offerSequence: t('Escrow sequence'),
    fundsReturnToOwner: t('Funds return to the creator'),
    permissionlessAfterFinishAfter: t('Anyone can deliver after the date'),
    permissionlessAfterCancelAfter: t('Anyone can recover after expiry'),
    documentSha256: t('Document fingerprint (SHA-256)'),
    documentUri: t('Document URI'),
    enforcesByItself: t('Enforces by itself'),
    amendableByQuorum: t('Amendable by the quorum'),
  };
  return map[key] ?? key;
}

function factValue(key: string, value: string | number | boolean, t: (s: string) => string): string {
  if (typeof value === 'boolean') return value ? t('yes') : t('no');
  if (key === 'finishAfterISO' || key === 'cancelAfterISO') return fmtDateTime(String(value));
  return String(value);
}

/** Disclosure block — the full facts BEFORE any signature (#6). */
export function DisclosureBlock({ handoff }: { handoff: XrplTxHandoff }) {
  const { t } = useT();
  return (
    <div className="space-y-2 rounded-xl border border-ink/10 bg-ink/[0.03] p-4">
      <MicroLabel>{t('What you are about to sign')}</MicroLabel>
      <p className="text-sm text-ink/70">{handoff.disclosure.note}</p>
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {Object.entries(handoff.disclosure.facts).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 text-[12px]">
            <dt className="text-ink/45">{factLabel(k, t)}</dt>
            <dd className="text-right font-mono text-ink/75 break-all">{factValue(k, v, t)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** A read-only dry-run of the tx about to be signed directly (single-sig) — the
 *  same simulate preflight (#11) the multisig coordinator shows, for the direct path. */
function PreflightHint({ xrplTx }: { xrplTx: Record<string, unknown> }) {
  const { t } = useT();
  const [state, setState] = useState<{
    loading: boolean;
    available?: boolean;
    willSucceed?: boolean;
    engineResult?: string;
    message?: string;
  }>({ loading: true });
  useEffect(() => {
    let alive = true;
    xrplLegacy
      .simulate(xrplTx)
      .then((r) => {
        if (alive) setState({ loading: false, available: r.available, willSucceed: r.willSucceed, engineResult: r.engineResult, message: r.engineResultMessage });
      })
      .catch(() => {
        if (alive) setState({ loading: false, available: false });
      });
    return () => {
      alive = false;
    };
  }, [xrplTx]);
  if (state.loading) {
    return (
      <p className="text-[12px] text-ink/45">
        <Loader2 size={12} className="mr-1 inline animate-spin" /> {t('Ledger dry-run…')}
      </p>
    );
  }
  if (!state.available) return null; // node without simulate — stay silent, never block
  return state.willSucceed ? (
    <p className="flex items-center gap-2 text-[12px] text-tone-success">
      <Check size={12} /> {t('Ledger dry-run: this transaction would succeed')} ({state.engineResult}).
    </p>
  ) : (
    <p className="flex items-start gap-2 text-[12px] text-tone-warning">
      <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {t('Ledger dry-run says it would FAIL:')} {state.engineResult} — {state.message}
    </p>
  );
}

/** Sign-or-copy hand-off: Xaman when the signer is the connected account,
 *  the multisig coordinator when it is a council account. */
function HandoffActions({
  handoff,
  canSignDirect,
  busy,
  onSign,
  onDismiss,
  onSettled,
}: {
  handoff: XrplTxHandoff;
  canSignDirect: boolean;
  busy: boolean;
  onSign: () => void;
  onDismiss: () => void;
  onSettled?: (hash: string) => void;
}) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const copy = useCallback(() => {
    void navigator.clipboard.writeText(JSON.stringify(handoff.xrplTx, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    });
  }, [handoff]);
  return (
    <div className="space-y-3">
      {canSignDirect ? (
        <div className="space-y-2">
          <PreflightHint xrplTx={handoff.xrplTx} />
          <div className="flex flex-wrap items-center gap-2">
            <PrimaryButton onClick={onSign} disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {t('Sign in Xaman')}
            </PrimaryButton>
            <GhostButton onClick={onDismiss} disabled={busy}>
              {t('Back')}
            </GhostButton>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[12px] text-ink/55">
            {t(
              'This account is governed by a council (multisig). Astryum composes the transaction; your council signs it here, each member from their own device. Astryum never signs or broadcasts on your behalf.',
            )}
          </p>
          {/* Same composed tx, two tempos (§2.4): the live ceremony (everyone
              present, N QRs now) or the async proposal (each member signs from
              their own device over days — the inbox). */}
          <CouncilMultisigFlow
            xrplTx={handoff.xrplTx}
            account={String(handoff.xrplTx.Account ?? '')}
            onSettled={onSettled}
          />
          <ProposeToCouncil
            xrplTx={handoff.xrplTx}
            account={String(handoff.xrplTx.Account ?? '')}
            defaultTitle={String(handoff.xrplTx.TransactionType ?? '')}
          />
          {/* Fallback for those who prefer their own tools (ADR-008 keeps link-out). */}
          <button
            type="button"
            onClick={() => setShowManual((v) => !v)}
            className="text-[12px] text-ink/40 hover:text-ink/70"
          >
            {showManual ? t('Hide manual signing') : t('Prefer your own multisign tool?')}
          </button>
          {showManual && (
            <div className="flex flex-wrap items-center gap-2">
              <PrimaryButton onClick={copy}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? t('Copied') : t('Copy unsigned transaction')}
              </PrimaryButton>
              <a href={XAMAN_MULTISIGN_XAPP} target="_blank" rel="noreferrer">
                <GhostButton>
                  <ExternalLink size={14} /> {t('Multisign xApp (Xaman)')}
                </GhostButton>
              </a>
              <a href={XRPL_SERVICES_TOOLS} target="_blank" rel="noreferrer">
                <GhostButton>
                  <ExternalLink size={14} /> xrpl.services
                </GhostButton>
              </a>
            </div>
          )}
          <GhostButton onClick={onDismiss}>{t('Back')}</GhostButton>
        </div>
      )}
    </div>
  );
}

export default function LegacyPanel() {
  const { t } = useT();
  const { address, isConnected, sendIntent } = useXrplWalletPartner();
  const { activeGoverned, setActive } = useAuthorities();

  // ── shell (Interface B): the "My Legacies" list vs one Legacy's workspace ──
  const [view, setView] = useState<'list' | 'workspace'>('list');

  // ── the Legacy account under inspection (chosen from the list, or new) ──
  const [accountInput, setAccountInput] = useState('');
  const [account, setAccount] = useState<string | null>(null);

  const accountValid = XRPL_ADDRESS_RE.test(accountInput.trim());

  // ── council + rehearsal (the master-key gate, §1/§2) ──
  const [council, setCouncil] = useState<XrplCouncil | null>(null);
  const [councilLoaded, setCouncilLoaded] = useState(false);
  const [rehearsal, setRehearsal] = useState<RehearsalStatus | null>(null);
  // The health verdict (ADR-008 §2) — computed in the backend, it GOVERNS which
  // dangerous actions the panel offers. The panel renders it; it never re-derives it.
  const [health, setHealth] = useState<LegacyHealth | null>(null);

  // A council account can ONLY be multi-signed. Never offer single-sig direct
  // signing for it: the ledger would reject it, or worse, it would validate via
  // a still-active master key and NOT count toward the rehearsal (the footgun).
  const canSignDirect = isConnected && !!account && account === address && !council;

  // ── the two surfaces (ADR-008 / prompt Fable): constitute (linear, born once)
  //    vs govern (recurring control). `surface` is null until the user picks;
  //    the effective surface auto-follows the ledger — a constituted Legacy
  //    (door closed + rehearsal verified) opens in Govern, everything else in
  //    Constitute. Re-inspecting a different account resets the pick.
  const [surface, setSurface] = useState<'constitute' | 'govern' | null>(null);
  const constituted = council?.masterKeyDisabled === true && rehearsal?.rehearsalComplete === true;
  const effectiveSurface: 'constitute' | 'govern' = surface ?? (constituted ? 'govern' : 'constitute');
  // The surface is now chosen at the DOOR — a Legacy card's Constitution /
  // Governance buttons (founder refactor 2026-07-19) — and carried here through
  // this ref; on account change we apply it, or fall back to null = auto-follow
  // the ledger. The old in-workspace toggle is gone.
  const surfaceIntent = useRef<'constitute' | 'govern' | null>(null);
  useEffect(() => {
    setSurface(surfaceIntent.current);
    surfaceIntent.current = null;
  }, [account]);

  // ── Govern is split into sections so one long page never overwhelms:
  //    Information · Proposals · Activity · MoneyFlows · Movements. ──
  const [govTab, setGovTab] = useState<'info' | 'proposals' | 'activity' | 'moneyflows' | 'movements' | 'wallets'>('info');
  useEffect(() => {
    setGovTab('info');
  }, [account]);

  // The authority switcher drives this panel. Two doors in:
  //   ?constitute=1 (the switcher's "+ Constitute a governed account") opens
  //   the constitute surface; otherwise, an active governed authority opens
  //   ITS workspace directly — and switching authority while here follows.
  // The list stays one click away in both cases.
  const constituteIntent = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('constitute') === '1') {
      constituteIntent.current = true;
      surfaceIntent.current = 'constitute';
      setAccountInput('');
      setAccount(null);
      setSurface('constitute');
      setView('workspace');
      // Consume the param so refresh / internal navigation doesn't re-trigger.
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);
  useEffect(() => {
    if (!activeGoverned) return;
    if (constituteIntent.current) {
      constituteIntent.current = false;
      return;
    }
    // Self-navigation from a card door already set account + surface — don't
    // clobber it. Only an EXTERNAL switch (the authority switcher) lands here
    // with a different address; that one auto-follows the ledger.
    if (activeGoverned.address === account) return;
    surfaceIntent.current = null;
    setAccountInput(activeGoverned.address);
    setAccount(activeGoverned.address);
    setView('workspace');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGoverned?.address]);
  const [closeDoorOpen, setCloseDoorOpen] = useState(false); // inline confirm (no Dialog)
  // Closing the door = AccountSet(asfDisableMaster). XRPL requires the account's
  // OWN master key to sign it (a multisig is rejected: tecNEED_MASTER_KEY), so
  // Astryum composes it unsigned and the connected account signs it DIRECTLY
  // (single-sig) — no coordinator. The rehearsal gate (canCloseDoor) still governs.
  const [closeDoorHandoff, setCloseDoorHandoff] = useState<XrplTxHandoff | null>(null);
  const [closeDoorBusy, setCloseDoorBusy] = useState(false);
  const [closeDoorError, setCloseDoorError] = useState<string | null>(null);
  const [closeDoorDone, setCloseDoorDone] = useState<string | null>(null);
  // Re-inspecting a different account clears any half-open close-door flow.
  useEffect(() => {
    setCloseDoorOpen(false);
    setCloseDoorHandoff(null);
    setCloseDoorError(null);
    setCloseDoorDone(null);
  }, [account]);

  // ── EVM mirror (§3 — built when the vault exists; read-only compare) ──
  const [vaultAddr, setVaultAddr] = useState('');
  const [vaultInfo, setVaultInfo] = useState<VaultCouncilInfo | null>(null);
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [vaultBusy, setVaultBusy] = useState(false);

  // ── escrows + spendable balance of the Legacy account ──
  const [escrows, setEscrows] = useState<XrplEscrowRow[]>([]);
  const [spendable, setSpendable] = useState<XrplSpendable | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Ledger validation takes a few seconds after a submit — one immediate
  // re-read misses the new object and the page looks unchanged (scary with
  // real XRP). Same cadence as MovementsPanel: now, +6s, +14s.
  const [settling, setSettling] = useState(false);
  const settleTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => settleTimers.current.forEach(clearTimeout), []);

  // ── constitution ──
  const [anchor, setAnchor] = useState<ConstitutionAnchor | null>(null);
  const [history, setHistory] = useState<ConstitutionAmendment[]>([]);

  const refresh = useCallback(async () => {
    if (!account) return;
    setLoading(true);
    setListError(null);
    try {
      const [councilRes, escrowsRes, constitutionRes, rehearsalRes] = await Promise.all([
        xrplLegacy.council(account).catch(() => null),
        xrplSavings.escrows(account).catch(() => null),
        xrplLegacy.constitution(account).catch(() => null),
        xrplLegacy.rehearsalStatus(account).catch(() => null),
      ]);
      setCouncil(councilRes?.council ?? null);
      setCouncilLoaded(true);
      setRehearsal(rehearsalRes?.status ?? null);
      setHealth(rehearsalRes?.health ?? null);
      if (escrowsRes) {
        setEscrows(escrowsRes.escrows);
        if (escrowsRes.account) setSpendable(escrowsRes.account);
      }
      setAnchor(constitutionRes?.anchor ?? null);
      setHistory(constitutionRes?.history ?? []);
    } catch (err) {
      setListError(gateMessage(err, t));
    } finally {
      setLoading(false);
    }
  }, [account, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const refreshAfterSettlement = useCallback(() => {
    setSettling(true);
    void refresh();
    settleTimers.current.push(setTimeout(() => void refresh(), 6_000));
    settleTimers.current.push(
      setTimeout(() => {
        void refresh();
        setSettling(false);
      }, 14_000),
    );
  }, [refresh]);

  // ── programmed transfer: form → review → hand-off ──
  const [destination, setDestination] = useState('');
  const [amountXrp, setAmountXrp] = useState('');
  const [unlockDate, setUnlockDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [handoff, setHandoff] = useState<XrplTxHandoff | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [doneHash, setDoneHash] = useState<string | null>(null);

  const minDate = useMemo(() => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), []);

  /**
   * Recovery date DEFAULTS to delivery + 1 year (auditoría P5/P10): a commitment
   * without CancelAfter can NEVER be undone — if the beneficiary loses their key,
   * the XRP is unrecoverable forever. The user can clear it, but sees a hard
   * warning. Long delivery dates get a duration warning: locked XRP produces
   * NOTHING, so the vía (a) is for short commitments and ceremonies.
   */
  const onUnlockDateChange = useCallback(
    (value: string) => {
      setUnlockDate(value);
      if (value && !expiryDate) {
        const d = new Date(`${value}T00:00:00Z`);
        d.setUTCFullYear(d.getUTCFullYear() + 1);
        setExpiryDate(d.toISOString().slice(0, 10));
      }
    },
    [expiryDate],
  );

  const monthsLocked = useMemo(() => {
    if (!unlockDate) return 0;
    return (Date.parse(`${unlockDate}T00:00:00Z`) - Date.now()) / (30.44 * 86_400_000);
  }, [unlockDate]);

  const prepareTransfer = useCallback(async () => {
    if (!account) return;
    setFormError(null);
    setDoneHash(null);
    const drops = toDrops(amountXrp);
    if (!drops) return void setFormError(t('Enter a positive XRP amount.'));
    if (!XRPL_ADDRESS_RE.test(destination.trim())) {
      return void setFormError(t('Enter a valid XRPL destination address (the beneficiary).'));
    }
    if (!unlockDate) return void setFormError(t('Pick the delivery date (when the beneficiary can receive).'));
    if (expiryDate && expiryDate <= unlockDate) {
      return void setFormError(t('The recovery date must come after the delivery date (ledger rule).'));
    }
    // Reserve-aware balance check BEFORE preparing (otherwise the ledger
    // rejects with a cryptic tec code at signing time). Same rule as
    // MovementsPanel: spendable minus the extra per-escrow owner reserve.
    if (spendable) {
      const maxXrp = spendable.spendableXrp - spendable.nextObjectReserveXrp;
      if (Number(amountXrp) > maxXrp) {
        return void setFormError(
          `${t('Not enough spendable XRP on the Legacy account.')} ${t('Available after ledger reserves:')} ${Math.max(0, maxXrp).toLocaleString(undefined, { maximumFractionDigits: 6 })} XRP`,
        );
      }
    }
    setBusy(true);
    try {
      const h = await xrplSavings.prepareCreate({
        account,
        amountDrops: drops,
        finishAfterISO: new Date(`${unlockDate}T00:00:00Z`).toISOString(),
        ...(expiryDate ? { cancelAfterISO: new Date(`${expiryDate}T00:00:00Z`).toISOString() } : {}),
        destination: destination.trim(),
        region: getUserRegion() ?? undefined,
      });
      setHandoff(h);
    } catch (err) {
      setFormError(gateMessage(err, t));
    } finally {
      setBusy(false);
    }
  }, [account, amountXrp, destination, unlockDate, expiryDate, spendable, t]);

  const signTransfer = useCallback(async () => {
    if (!handoff) return;
    setBusy(true);
    setFormError(null);
    try {
      const { txHash } = await sendIntent({ tx: handoff.xrplTx as never });
      setDoneHash(txHash);
      setHandoff(null);
      setAmountXrp('');
      setDestination('');
      setUnlockDate('');
      setExpiryDate('');
      refreshAfterSettlement();
    } catch (err) {
      setFormError((err as Error)?.message ?? t('Signing was cancelled.'));
    } finally {
      setBusy(false);
    }
  }, [handoff, sendIntent, refreshAfterSettlement, t]);

  // ── escrow actions (permissionless — sent by the CONNECTED account) ──
  const [actingId, setActingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionHash, setActionHash] = useState<string | null>(null);

  const canRelease = (row: XrplEscrowRow): boolean => {
    if (!row.finishAfterISO || row.hasCondition) return false;
    if (Date.parse(row.finishAfterISO) > Date.now()) return false;
    return !row.cancelAfterISO || Date.parse(row.cancelAfterISO) > Date.now();
  };
  const canCancel = (row: XrplEscrowRow): boolean =>
    !!row.cancelAfterISO && Date.parse(row.cancelAfterISO) <= Date.now();

  const act = useCallback(
    async (row: XrplEscrowRow, kind: 'finish' | 'cancel') => {
      if (!address || !row.owner || !row.previousTxnID) return;
      setActingId(row.previousTxnID);
      setActionError(null);
      setActionHash(null);
      try {
        const preparer = kind === 'finish' ? xrplSavings.prepareFinish : xrplSavings.prepareCancel;
        const h = await preparer({
          account: address,
          owner: row.owner,
          previousTxnID: row.previousTxnID,
          region: getUserRegion() ?? undefined,
        });
        const { txHash } = await sendIntent({ tx: h.xrplTx as never });
        setActionHash(txHash);
        refreshAfterSettlement();
      } catch (err) {
        // Both actions are permissionless: someone else (the keeper, a third
        // party) may have got there first — the escrow no longer exists and the
        // submit fails. The XRP is NOT lost either way; the ledger fixed where
        // it went. Say so, or the failure reads as money vanishing.
        setActionError(
          `${gateMessage(err, t)} — ${
            kind === 'finish'
              ? t('it may already have been delivered (anyone can, after the date); the XRP always ends at the beneficiary.')
              : t('it may already have been recovered (anyone can, after expiry); the XRP always returns to the creator.')
          }`,
        );
        void refresh();
      } finally {
        setActingId(null);
      }
    },
    [address, sendIntent, refresh, refreshAfterSettlement, t],
  );

  // ── constitution: verify + anchor ──
  const [docText, setDocText] = useState('');
  const [docUri, setDocUri] = useState('');
  const [builderOpen, setBuilderOpen] = useState(false); // the template gallery/form
  const [verifyResult, setVerifyResult] = useState<'match' | 'mismatch' | null>(null);
  const [anchorHandoff, setAnchorHandoff] = useState<XrplTxHandoff | null>(null);
  const [anchorBusy, setAnchorBusy] = useState(false);
  const [anchorError, setAnchorError] = useState<string | null>(null);
  const [anchorDone, setAnchorDone] = useState<string | null>(null);

  // The document text is typed work — it must survive a refresh/deploy.
  // LOCAL ONLY (localStorage), same privacy line as the builder: the text
  // never leaves the browser; only its SHA-256 is anchored.
  useEffect(() => {
    if (!account) return;
    const draft = getConstitutionDraft(account);
    if (!draft) return;
    if (draft.docText) setDocText((cur) => cur || draft.docText!);
    if (draft.docUri) setDocUri((cur) => cur || draft.docUri!);
  }, [account]);
  useEffect(() => {
    if (!account || (!docText && !docUri)) return;
    saveConstitutionDraft(account, { docText, docUri });
  }, [account, docText, docUri]);

  const verifyDocument = useCallback(async () => {
    if (!docText || !anchor?.dataHex) return;
    const hash = await sha256Hex(docText);
    setVerifyResult(hash === anchor.dataHex.toUpperCase() ? 'match' : 'mismatch');
  }, [docText, anchor]);

  const prepareAnchor = useCallback(async () => {
    if (!account || !docText.trim()) {
      return void setAnchorError(t('Paste the exact text of the governance document first.'));
    }
    setAnchorBusy(true);
    setAnchorError(null);
    setAnchorDone(null);
    try {
      const documentSha256Hex = await sha256Hex(docText);
      const h = await xrplLegacy.prepareAnchor({
        account,
        documentSha256Hex,
        ...(docUri.trim() ? { documentUri: docUri.trim() } : {}),
        region: getUserRegion() ?? undefined,
      });
      setAnchorHandoff(h);
    } catch (err) {
      setAnchorError(gateMessage(err, t));
    } finally {
      setAnchorBusy(false);
    }
  }, [account, docText, docUri, t]);

  const signAnchor = useCallback(async () => {
    if (!anchorHandoff) return;
    setAnchorBusy(true);
    setAnchorError(null);
    try {
      const { txHash } = await sendIntent({ tx: anchorHandoff.xrplTx as never });
      setAnchorDone(txHash);
      setAnchorHandoff(null);
      refreshAfterSettlement();
    } catch (err) {
      setAnchorError((err as Error)?.message ?? t('Signing was cancelled.'));
    } finally {
      setAnchorBusy(false);
    }
  }, [anchorHandoff, sendIntent, refreshAfterSettlement, t]);

  // ── §1 — constitute the council (SignerListSet). With no council yet, this is
  //    signed by the account's OWN master key (direct path), not the coordinator. ──
  const [councilSigners, setCouncilSigners] = useState<Array<{ account: string; weight: string }>>([
    { account: '', weight: '1' },
    { account: '', weight: '1' },
    { account: '', weight: '1' },
  ]);
  const [councilQuorum, setCouncilQuorum] = useState('2');
  const [councilHandoff, setCouncilHandoff] = useState<XrplTxHandoff | null>(null);
  const [councilBusy, setCouncilBusy] = useState(false);
  const [councilError, setCouncilError] = useState<string | null>(null);
  const [councilDone, setCouncilDone] = useState<string | null>(null);

  const prepareCouncil = useCallback(async () => {
    if (!account) return;
    setCouncilBusy(true);
    setCouncilError(null);
    setCouncilDone(null);
    try {
      const signers = councilSigners
        .map((s) => ({ account: s.account.trim(), weight: Number(s.weight) }))
        .filter((s) => s.account.length > 0);
      const h = await xrplLegacy.signerListSetPrepare({
        account,
        quorum: Number(councilQuorum),
        signers,
        region: getUserRegion() ?? undefined,
      });
      setCouncilHandoff(h);
    } catch (err) {
      setCouncilError(gateMessage(err, t));
    } finally {
      setCouncilBusy(false);
    }
  }, [account, councilSigners, councilQuorum, t]);

  const signCouncil = useCallback(async () => {
    if (!councilHandoff) return;
    setCouncilBusy(true);
    setCouncilError(null);
    try {
      const { txHash } = await sendIntent({ tx: councilHandoff.xrplTx as never });
      setCouncilDone(txHash);
      setCouncilHandoff(null);
      refreshAfterSettlement();
    } catch (err) {
      setCouncilError((err as Error)?.message ?? t('Signing was cancelled.'));
    } finally {
      setCouncilBusy(false);
    }
  }, [councilHandoff, sendIntent, refreshAfterSettlement, t]);

  // ── §2 — the rehearsal: 1 XRP, self, deliver tomorrow, recover in a week ──
  const [rehearsalHandoff, setRehearsalHandoff] = useState<XrplTxHandoff | null>(null);
  const [rehearsalBusy, setRehearsalBusy] = useState(false);
  const [rehearsalError, setRehearsalError] = useState<string | null>(null);

  const prepareRehearsal = useCallback(async () => {
    if (!account) return;
    setRehearsalBusy(true);
    setRehearsalError(null);
    try {
      const h = await xrplSavings.prepareCreate({
        account,
        amountDrops: '1000000', // 1 XRP — the rehearsal is about signatures, not money
        finishAfterISO: new Date(Date.now() + 86_400_000).toISOString(),
        cancelAfterISO: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        destination: account, // to itself: zero risk, fully recoverable
        region: getUserRegion() ?? undefined,
      });
      setRehearsalHandoff(h);
    } catch (err) {
      setRehearsalError(gateMessage(err, t));
    } finally {
      setRehearsalBusy(false);
    }
  }, [account, t]);

  // ── §1 — close the door: compose the AccountSet(asfDisableMaster) unsigned,
  //    then present its QR directly (CloseDoorSign). XRPL forces the master key
  //    to sign its own disable (a multisig → tecNEED_MASTER_KEY), so this is a
  //    single signature by the Legacy account itself — no coordinator, and no
  //    dependency on which wallet is "connected". ──
  const prepareCloseDoor = useCallback(async () => {
    if (!account) return;
    setCloseDoorBusy(true);
    setCloseDoorError(null);
    setCloseDoorDone(null);
    try {
      const h = await xrplLegacy.disableMasterPrepare({ account, region: getUserRegion() ?? undefined });
      setCloseDoorHandoff(h);
    } catch (err) {
      setCloseDoorError(gateMessage(err, t));
    } finally {
      setCloseDoorBusy(false);
    }
  }, [account, t]);

  // ── §3 — the EVM mirror check ──
  const checkVault = useCallback(async () => {
    if (!EVM_ADDRESS_RE.test(vaultAddr.trim())) {
      return void setVaultError(t('Enter a valid Flare address (0x…).'));
    }
    setVaultBusy(true);
    setVaultError(null);
    setVaultInfo(null);
    try {
      setVaultInfo(await xrplLegacy.vaultCouncil(vaultAddr.trim()));
    } catch (err) {
      setVaultError(gateMessage(err, t));
    } finally {
      setVaultBusy(false);
    }
  }, [vaultAddr, t]);

  // ── "Guía": the abstract journey state for the assistant — public ledger
  //    facts only (flags + counters). No addresses, no names, no amounts. ──
  const journey = useMemo<LegacyJourney | undefined>(() => {
    if (!account || !councilLoaded) return undefined;
    return {
      hasCouncil: !!council,
      memberCount: council?.signers.length,
      quorum: council?.quorum,
      quorumMargin: rehearsal?.quorumMargin,
      rehearsalComplete: rehearsal?.rehearsalComplete,
      signedCount: rehearsal?.signedCount,
      masterKeyDisabled: council?.masterKeyDisabled,
      constitutionAnchored: !!anchor?.dataHex,
      escrowCount: escrows.length,
    };
  }, [account, councilLoaded, council, rehearsal, anchor, escrows]);

  // ── Constitute = a slide deck (founder redesign 2026-07-16): ONE step per
  //    slide, the guide agent pinned left, a clickable stations feed on top.
  //    wizStep auto-follows the ledger (first incomplete step) after each
  //    refresh; the stations let the user jump freely. ──
  const [wizStep, setWizStep] = useState(0);
  useEffect(() => {
    if (effectiveSurface !== 'constitute') return;
    if (!account) return void setWizStep(0);
    if (!councilLoaded) return;
    setWizStep(
      !council
        ? 1
        : rehearsal?.rehearsalComplete !== true
          ? 2
          : council.masterKeyDisabled !== true
            ? 3
            : !anchor?.dataHex
              ? 4
              : 5,
    );
  }, [effectiveSurface, account, councilLoaded, council, rehearsal?.rehearsalComplete, anchor?.dataHex]);

  // ── §6 — the wizard: real ledger state, never a local database (L1) ──
  const steps = useMemo(() => {
    const hasCouncil = !!council;
    const rehearsed = rehearsal?.rehearsalComplete === true;
    const doorClosed = council?.masterKeyDisabled === true;
    const anchored = !!anchor?.dataHex;
    const funded = escrows.length > 0 || (spendable !== null && spendable.balanceXrp >= 15);
    return [
      { label: t('Council'), done: hasCouncil },
      { label: t('Rehearsal'), done: rehearsed },
      { label: t('Door closed'), done: doorClosed },
      { label: t('Constitution'), done: anchored },
      { label: t('Capital'), done: funded && anchored },
    ];
  }, [council, rehearsal, anchor, escrows, spendable, t]);

  // ── Reserve preflight (2026-07-22): the constitution ceremony is a SEQUENCE
  //    of reserve-consuming txns (council + rehearsal escrow + constitution DID);
  //    XRPL's per-tx simulate only checks the next one. On the test council SIX
  //    ceremony txns failed for tecINSUFFICIENT_RESERVE — each failed signature
  //    still burning a fee. Project the whole-ceremony cost ONCE, before the
  //    user starts, from the reserve figures the panel already reads. ──
  const reservePlan = useMemo(
    () => (spendable ? computeCeremonyReserve(spendable) : null),
    [spendable],
  );

  const inputCls =
    'mt-1 w-full rounded-lg border border-ink/10 bg-ink/5 px-3 py-2 text-sm outline-none focus:border-ink/25';

  // ── Interface B: the list is the entry point; a workspace opens one Legacy ──
  if (view === 'list') {
    return (
      <MyLegaciesList
        onSelect={(a, chosen) => {
          // The door chosen on the card IS the surface — carried both directly
          // (same-account reopen) and via the ref (the account-change effect).
          surfaceIntent.current = chosen;
          setSurface(chosen);
          setAccountInput(a);
          setAccount(a);
          setView('workspace');
          // Opening a Legacy IS starting to govern it: make it the active
          // authority so the whole app (bar, theme, scope) follows. A row that
          // is not a council yet resolves to no governed authority — harmless.
          setActive(governedAuthorityId(a));
        }}
        onConstituteNew={() => {
          surfaceIntent.current = 'constitute';
          setAccountInput('');
          setAccount(null);
          setSurface('constitute');
          setView('workspace');
        }}
      />
    );
  }

  return (
    // A ceremonial, single-column surface: constrained to a document-like
    // measure so ultra-wide screens don't stretch the cards into empty space.
    <div className="max-w-5xl space-y-5">
      {/* Chrome (refactor 2026-07-19): back to the list on the left; the
          Constitution/Governance choice now lives on the Legacy card, so the
          in-workspace toggle is gone. Only the emergency flag rides here. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <GhostButton onClick={() => setView('list')}>
          ← {t('My Legacies')}
        </GhostButton>
        {account && health?.mustReplaceSigner && (
          <div className="flex flex-col items-start gap-1">
            <Pill tone="danger">{t('Emergency')}</Pill>
            <span className="text-sm text-tone-danger">{t('Replace the fallen signer before anything else.')}</span>
          </div>
        )}
      </div>
      <PageHeader
        title={t('Legacy')}
        subtitle={t(
          'Capital under rules that outlive their author: the rules and the authority live on XRPL; the capital produces on Flare inside a cage of code. A programmed, conditioned, revocable transfer — not a promise.',
        )}
      />

      {/* ── Govern's four sections (founder refactor 2026-07-19). Information
          holds the Guía; the tabs distribute the rest so nothing overwhelms. ── */}
      {/* The tab bar is only as wide as its four tabs (founder 2026-07-20): a
          full-width bar left a long empty gutter. w-fit hugs the content;
          max-w-full + flex-wrap still lets it wrap on a narrow viewport. */}
      {effectiveSurface === 'govern' && account && (
        <div className="inline-flex w-fit max-w-full flex-wrap gap-1 rounded-xl border border-ink/10 bg-ink/[0.02] p-1">
          {([
            ['info', t('Information')],
            ['wallets', t('Wallets')],
            ['proposals', t('Proposals')],
            ['activity', t('Activity')],
            ['moneyflows', t('MoneyFlows')],
            ['movements', t('Movements')],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setGovTab(id)}
              className={`rounded-lg px-3 py-1.5 text-[13px] transition ${
                govTab === id ? 'bg-ink/10 text-ink' : 'text-ink/50 hover:text-ink/80'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}


      {/* ── The stations feed (Constitute): where you are, and the navigation —
          each station is a slide; done stations glow; click to jump. ── */}
      {effectiveSurface === 'constitute' && (
        <div className="-mx-1 overflow-x-auto px-1">
          <div className="flex items-start">
            {[{ label: t('Account'), done: !!account }, ...steps].map((s, i) => {
              const current = i === wizStep;
              return (
                <div key={s.label} className="flex shrink-0 items-start">
                  <button
                    type="button"
                    onClick={() => setWizStep(i)}
                    className="flex w-[84px] flex-col items-center gap-2 text-center"
                  >
                    <span
                      className={`grid h-8 w-8 place-items-center rounded-full border transition-colors ${
                        current
                          ? 'border-volt/50 bg-volt/[0.1]'
                          : s.done
                            ? 'border-emerald-500/40 bg-emerald-500/[0.12] text-tone-success'
                            : 'border-ink/15 bg-ink/[0.04] text-ink/45'
                      }`}
                    >
                      {current ? (
                        <PulseDot className="bg-volt" size={7} />
                      ) : s.done ? (
                        <Check size={14} />
                      ) : (
                        <span className="font-mono text-[11px]">{i + 1}</span>
                      )}
                    </span>
                    <span
                      className={`font-mono text-[10px] uppercase leading-tight tracking-[0.12em] ${
                        current ? 'text-volt/90' : s.done ? 'text-tone-success/80' : 'text-ink/40'
                      }`}
                    >
                      {s.label}
                    </span>
                  </button>
                  {i < steps.length && (
                    <span className={`mt-4 h-px w-5 shrink-0 sm:w-9 ${s.done ? 'bg-emerald-500/35' : 'bg-ink/10'}`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Constitute: grid [guide | slide]. Govern: the classic stacked cards. */}
      <div className={effectiveSurface === 'constitute' ? 'grid items-start gap-4 lg:grid-cols-[minmax(280px,340px)_1fr]' : ''}>
        {effectiveSurface === 'constitute' && (
          <div className="lg:sticky lg:top-4">
            <LegacyDiscovery journey={journey} />
          </div>
        )}

      <RevealGroup className="space-y-5">
        {/* ── Information: Legacy account → AI Agent (Guía) → the Council.
            The account is settled context here — a slim identity strip
            (accounts change from "My Legacies", not here). ── */}
        {effectiveSurface === 'govern' && account && govTab === 'info' && (
          <RevealItem>
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-ink/[0.07] bg-ink/[0.02] px-4 py-2.5">
              <MicroLabel>{t('Legacy account')}</MicroLabel>
              <span className="font-mono text-sm text-ink/80">{shortAddr(account)}</span>
              <a
                className="text-ink/40 hover:text-ink/70"
                href={`${XRPSCAN_ACCOUNT}${account}`}
                target="_blank"
                rel="noreferrer"
                aria-label="XRPScan"
              >
                <ExternalLink size={13} />
              </a>
              <span className="ml-auto">
                <GhostButton onClick={() => void refresh()} disabled={loading}>
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                </GhostButton>
              </span>
            </div>
            {listError && (
              <div className="mt-2">
                <InlineNotice tone="warning">{listError}</InlineNotice>
              </div>
            )}
          </RevealItem>
        )}
        {/* AI Agent (the Guía) — second in Information, above the Council. */}
        {effectiveSurface === 'govern' && account && govTab === 'info' && journey && (
          <RevealItem>
            <LegacyDiscovery journey={journey} />
          </RevealItem>
        )}
        {(effectiveSurface === 'constitute' ? wizStep === 0 : !account) && (
        <RevealItem>
          <Card spotlight padded={false} className="group isolate relative overflow-hidden p-5 md:p-6 lg:pr-56 space-y-4">
            {/* permanence — the account enthroned under its north star. The
                content reserves the right zone (lg:pr-56) so the scene owns it. */}
            <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 hidden lg:block opacity-[0.32] group-hover:opacity-60 transition-opacity duration-700" style={{ zIndex: -1 }} aria-hidden>
              <MonumentScene size={160} />
            </div>
            <SectionTitle>{t('Legacy account')}</SectionTitle>
            <div className="flex flex-wrap items-end gap-2">
              <label className="grow">
                <span className="text-xs font-medium text-ink/60">{t('XRPL account')}</span>
                <input
                  value={accountInput}
                  onChange={(e) => setAccountInput(e.target.value)}
                  placeholder="r…"
                  spellCheck={false}
                  className={inputCls}
                />
                <span className="mt-1 block text-xs text-ink/40">{t('The council-governed account.')}</span>
              </label>
              <PrimaryButton
                onClick={() => {
                  if (!accountValid) return;
                  const a = accountInput.trim();
                  rememberLegacy(a); // it lands in "Mis Legacies" — observing IS opening
                  setAccount(a);
                }}
                disabled={!accountValid}
              >
                {t('Inspect')}
              </PrimaryButton>
              {account && (
                <GhostButton onClick={() => void refresh()} disabled={loading}>
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                </GhostButton>
              )}
            </div>
            {listError && <InlineNotice tone="warning">{listError}</InlineNotice>}

            {/* The stations rail moved UP to the slide-deck feed (2026-07-16).
                Here instead: "observe" merged into constitution — opening an
                address remembers it in "Mis Legacies". */}
            {effectiveSurface === 'constitute' && (
              <p className="text-[11px] text-ink/40">
                {t(
                  'Already govern a Legacy? Open its address here — it is remembered in My Legacies. Observing is just opening.',
                )}
              </p>
            )}
          </Card>
        </RevealItem>
        )}

        {/* Reserve preflight — before the ceremony starts, say how much XRP the
            WHOLE ceremony needs so no signature fails for insufficient reserve
            (a failed signature still burns its fee). Only while there is a real
            shortfall and before the door closes. */}
        {effectiveSurface === 'constitute' && wizStep <= 2 && reservePlan && !reservePlan.funded && spendable && (
          <RevealItem>
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] p-3 text-[13px] text-tone-warning">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>
                <strong className="font-semibold">{t('Fund the account before you start.')}</strong>{' '}
                {t('The full ceremony — council, rehearsal escrow, constitution — needs about')}{' '}
                {reservePlan.requiredBalanceXrp} XRP {t('held in the account; it currently holds')}{' '}
                {spendable.balanceXrp.toFixed(2)} XRP. {t('Add at least')} {reservePlan.shortfallXrp} XRP{' '}
                {t('first — a signature that fails for insufficient reserve still costs its fee.')}
              </span>
            </div>
          </RevealItem>
        )}

        {/* §2 — persistent banner: no verified rehearsal, no real capital (Constitute) */}
        {effectiveSurface === 'constitute' && wizStep === 2 && council && rehearsal && !rehearsal.rehearsalComplete && (
          <RevealItem>
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] p-3 text-[13px] text-tone-warning">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>
                {t(
                  'The signing rehearsal is not verified yet — do NOT put real capital in. Until every council member has signed on-chain, a disabled master key would lock this account forever.',
                )}
              </span>
            </div>
          </RevealItem>
        )}

        {/* ── 1. The council (slides 1 and 3 — the door lives on slide 3) ── */}
        {((effectiveSurface === 'govern' && govTab === 'info') || wizStep === 1 || wizStep === 3) && (
        <RevealItem>
          <Card spotlight padded={false} className="group isolate relative overflow-hidden p-5 md:p-6 lg:pr-56 space-y-4">
            {/* signer-stars standing guard over the account-sun; hovering draws
                the quorum arc through the required members */}
            <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 hidden lg:block opacity-[0.32] group-hover:opacity-60 transition-opacity duration-700" style={{ zIndex: -1 }} aria-hidden>
              <CouncilScene width={200} height={160} />
            </div>
            <div className="flex items-center gap-2">
              <Users size={16} className="text-ink/50" />
              <SectionTitle>{t('The council')}</SectionTitle>
            </div>
            {!account || !councilLoaded ? (
              <p className="text-sm text-ink/45">{t('Inspect an account to read its council from the ledger.')}</p>
            ) : council ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone="info">
                    {t('quorum')} {council.quorum} / {council.signers.reduce((s, x) => s + x.weight, 0)}
                  </Pill>
                  {/* §5 — the quorum margin, over DECLARED signers */}
                  {rehearsal && (
                    <Pill tone={rehearsal.quorumMargin === 0 ? 'danger' : rehearsal.quorumMargin === 1 ? 'warning' : 'success'}>
                      {t('margin')} {rehearsal.quorumMargin}
                    </Pill>
                  )}
                  {/* §1 — the master pill changes meaning with the rehearsal state */}
                  {council.masterKeyDisabled ? (
                    <Pill tone="success">{t('master key disabled')}</Pill>
                  ) : rehearsal?.rehearsalComplete ? (
                    <Pill tone="warning">{t('master key active')}</Pill>
                  ) : (
                    <Pill tone="info">{t('master key active')}</Pill>
                  )}
                </div>
                <p className="text-sm text-ink/60">
                  {council.masterKeyDisabled
                    ? t('Quorum-only governance.')
                    : rehearsal?.rehearsalComplete
                      ? t('The rehearsal passed — time to close the door.')
                      : t('Correct for now: it is your safety net until the rehearsal passes.')}
                </p>
                {rehearsal && rehearsal.quorumMargin === 0 && (
                  <p className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/[0.07] p-2.5 text-[13px] text-tone-danger">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                    {t(
                      'You are at the EXACT quorum. One more lost key and this account is locked forever. Replace the missing signer BEFORE any other operation.',
                    )}
                  </p>
                )}
                <ul className="divide-y divide-ink/5">
                  {council.signers.map((s) => (
                    <li key={s.account} className="flex items-center gap-3 py-2 text-sm">
                      <span className="font-mono text-ink/75">{shortAddr(s.account)}</span>
                      <span className="text-ink/40">{t('weight')} {s.weight}</span>
                      <a
                        className="ml-auto text-ink/40 hover:text-ink/70"
                        href={`${XRPSCAN_ACCOUNT}${s.account}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ExternalLink size={13} />
                      </a>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-ink/40">
                  {t(
                    'The account is protected BY ITS COUNCIL: every transaction needs the quorum. This is governance protection — on XRPL, no code physically prevents a quorum decision.',
                  )}{' '}
                  {t(
                    'Astryum sees how many signers exist, not how many can still sign — the yearly re-rehearsal is the only way to know that.',
                  )}
                </p>

                {/* §1 — closing the door: gated behind the verified rehearsal.
                    In the slide deck it is ITS OWN slide (3). */}
                {!council.masterKeyDisabled && (effectiveSurface === 'govern' || wizStep === 3) && (
                  <div className="rounded-xl border border-ink/10 bg-ink/[0.03] p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <KeyRound size={14} className="text-ink/50" />
                      <MicroLabel>{t('Closing the door (disable the master key)')}</MicroLabel>
                    </div>
                    {!health?.canCloseDoor ? (
                      <p className="text-sm leading-relaxed text-ink/55">
                        {rehearsal?.rehearsalComplete
                          ? t(
                              'Locked while the quorum margin is at zero: replace the missing signer first. Closing the door now would risk locking this account forever.',
                            )
                          : t(
                              'Locked until the rehearsal is verified on-chain. Disabling the master key before every member has proven they can sign would risk locking this account forever — nobody could rescue it.',
                            )}
                      </p>
                    ) : !closeDoorOpen ? (
                      <div className="space-y-2">
                        <p className="text-[12px] text-ink/55">
                          {t('The rehearsal passed. From here on, closing the door is the recommended next step.')}
                        </p>
                        <GhostButton onClick={() => setCloseDoorOpen(true)}>
                          <ShieldCheck size={14} /> {t('I want to close the door')}
                        </GhostButton>
                      </div>
                    ) : !closeDoorHandoff ? (
                      <div className="space-y-2">
                        <p className="text-[13px] text-tone-warning">
                          {t(
                            'From now on this account only obeys the council. If the quorum cannot sign, the capital is inaccessible forever. Have ALL of you completed the rehearsal, each from their own device?',
                          )}
                        </p>
                        <p className="text-[12px] text-ink/55">
                          {t(
                            'Astryum composes this AccountSet unsigned; you sign it with the account’s OWN master key (single signature). XRPL requires the master key itself — the council quorum cannot do this one. Astryum never signs or broadcasts on your behalf.',
                          )}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <PrimaryButton onClick={() => void prepareCloseDoor()} disabled={closeDoorBusy || !account}>
                            {closeDoorBusy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
                            {t('Prepare closing the door')}
                          </PrimaryButton>
                          <GhostButton onClick={() => setCloseDoorOpen(false)}>{t('Back')}</GhostButton>
                        </div>
                        {closeDoorError && <InlineNotice tone="warning">{closeDoorError}</InlineNotice>}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <DisclosureBlock handoff={closeDoorHandoff} />
                        {/* DIRECT single-sig by the Legacy account itself: XRPL
                            forces the MASTER KEY to sign its own disable (a
                            multisig → tecNEED_MASTER_KEY). CloseDoorSign shows the
                            QR for THIS exact tx — no wallet to connect. */}
                        <CloseDoorSign
                          xrplTx={closeDoorHandoff.xrplTx}
                          onSettled={(hash) => {
                            setCloseDoorDone(hash);
                            setCloseDoorHandoff(null);
                            setCloseDoorOpen(false);
                            refreshAfterSettlement();
                          }}
                          onCancel={() => {
                            setCloseDoorHandoff(null);
                            setCloseDoorOpen(false);
                          }}
                        />
                        {closeDoorError && <InlineNotice tone="warning">{closeDoorError}</InlineNotice>}
                      </div>
                    )}
                    {closeDoorDone && (
                      <InlineNotice tone="success" icon={null}>
                        {t('Master key disabled — the door is closed. The account now obeys only the council.')}{' '}
                        <a href={`${XRPSCAN_TX}${closeDoorDone}`} target="_blank" rel="noreferrer" className="underline">
                          {t('View on XRPScan')}
                        </a>
                      </InlineNotice>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <EmptyState
                  bare
                  icon={<Users size={20} />}
                  title={t('No council on this account yet')}
                  hint={t(
                    'Constitute it below: 1–32 signers with weights and a quorum (5 signers, quorum 3 is the recommended family setup). Astryum composes the SignerListSet; you sign it with THIS account’s key. Astryum never holds a key.',
                  )}
                />
                {!councilHandoff ? (
                  <div className="space-y-2">
                    {councilSigners.map((s, i) => (
                      <div key={i} className="flex flex-wrap items-end gap-2">
                        <label className="grow">
                          <MicroLabel>{t('Signer address')}</MicroLabel>
                          <input
                            value={s.account}
                            onChange={(e) =>
                              setCouncilSigners((prev) => prev.map((x, j) => (j === i ? { ...x, account: e.target.value } : x)))
                            }
                            placeholder="r…"
                            spellCheck={false}
                            className={inputCls}
                          />
                        </label>
                        <label className="w-20">
                          <MicroLabel>{t('Weight')}</MicroLabel>
                          <input
                            value={s.weight}
                            onChange={(e) =>
                              setCouncilSigners((prev) => prev.map((x, j) => (j === i ? { ...x, weight: e.target.value } : x)))
                            }
                            inputMode="numeric"
                            className={inputCls}
                          />
                        </label>
                        {councilSigners.length > 1 && (
                          <GhostButton onClick={() => setCouncilSigners((prev) => prev.filter((_, j) => j !== i))}>
                            ×
                          </GhostButton>
                        )}
                      </div>
                    ))}
                    <div className="flex flex-wrap items-end gap-2">
                      <GhostButton
                        onClick={() => setCouncilSigners((prev) => [...prev, { account: '', weight: '1' }])}
                        disabled={councilSigners.length >= 32}
                      >
                        + {t('Add signer')}
                      </GhostButton>
                      <label className="block">
                        <MicroLabel>{t('Quorum')}</MicroLabel>
                        <input
                          value={councilQuorum}
                          onChange={(e) => setCouncilQuorum(e.target.value)}
                          inputMode="numeric"
                          className={`${inputCls} w-20`}
                        />
                      </label>
                    </div>
                    <PrimaryButton onClick={() => void prepareCouncil()} disabled={councilBusy || !account}>
                      {councilBusy ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />}
                      {t('Prepare the council')}
                    </PrimaryButton>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <DisclosureBlock handoff={councilHandoff} />
                    <HandoffActions
                      handoff={councilHandoff}
                      canSignDirect={canSignDirect}
                      busy={councilBusy}
                      onSign={() => void signCouncil()}
                      onDismiss={() => setCouncilHandoff(null)}
                      onSettled={() => refreshAfterSettlement()}
                    />
                  </div>
                )}
                {councilError && <InlineNotice tone="warning">{councilError}</InlineNotice>}
                {councilDone && (
                  <InlineNotice tone="success" icon={null}>
                    {t('Council created — refresh to read it from the ledger.')}{' '}
                    <a href={`${XRPSCAN_TX}${councilDone}`} target="_blank" rel="noreferrer" className="underline">
                      {t('View on XRPScan')}
                    </a>
                  </InlineNotice>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  <span className="text-[11px] text-ink/35">{t('Prefer your own tools?')}</span>
                  <a href={XAMAN_MULTISIGN_XAPP} target="_blank" rel="noreferrer" className="text-[11px] text-ink/40 hover:text-ink/70">
                    {t('Multisign xApp (Xaman)')}
                  </a>
                  <a href={XRPL_SERVICES_TOOLS} target="_blank" rel="noreferrer" className="text-[11px] text-ink/40 hover:text-ink/70">
                    xrpl.services
                  </a>
                </div>
              </div>
            )}
          </Card>
        </RevealItem>
        )}

        {/* ── §2. The signing rehearsal (slide 2) ── */}
        {effectiveSurface === 'constitute' && wizStep === 2 && council && rehearsal && (
          <RevealItem>
            <Card spotlight padded={false} className="p-5 md:p-6 space-y-4">
              <div className="flex items-center gap-2">
                <ListChecks size={16} className="text-ink/50" />
                <SectionTitle>{t('The signing rehearsal')}</SectionTitle>
                {rehearsal.rehearsalComplete ? (
                  <Pill tone="success">{t('verified on-chain')}</Pill>
                ) : (
                  <Pill tone="warning">
                    {rehearsal.signedCount}/{rehearsal.memberCount} {t('signed')}
                  </Pill>
                )}
              </div>
              <p className="text-[12px] text-ink/55">
                {t(
                  'One commitment of 1 XRP, from this account to itself, delivered tomorrow, recoverable in a week. Each member must sign it THEMSELVES, from their own device — if you help them, you have proven nothing except that YOU can sign. Include EVERY signature, not just the quorum (a 3-of-5 transaction only proves three), or repeat until everyone has signed once.',
                )}
              </p>

              {/* Per-member evidence — read from validated Signers arrays */}
              <ul className="divide-y divide-ink/5">
                {rehearsal.members.map((m) => (
                  <li key={m.account} className="flex items-center gap-3 py-2 text-sm">
                    {m.signedOnChain ? (
                      <Check size={14} className="text-tone-success" />
                    ) : (
                      <span className="inline-block h-3.5 w-3.5 rounded-full border border-ink/25" />
                    )}
                    <span className="font-mono text-ink/75">{shortAddr(m.account)}</span>
                    <span className="ml-auto text-[11px] text-ink/40">
                      {m.signedOnChain ? t('has signed on-chain') : t('never signed yet')}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-ink/40">
                {t(
                  'What the ledger proves: which accounts signed a validated transaction. What it cannot prove: that each person did it personally — that discipline is yours.',
                )}
              </p>

              {!rehearsalHandoff ? (
                <PrimaryButton onClick={() => void prepareRehearsal()} disabled={rehearsalBusy || !account}>
                  {rehearsalBusy ? <Loader2 size={14} className="animate-spin" /> : <ListChecks size={14} />}
                  {t('Prepare the rehearsal (1 XRP)')}
                </PrimaryButton>
              ) : (
                <div className="space-y-3">
                  <DisclosureBlock handoff={rehearsalHandoff} />
                  <HandoffActions
                    handoff={rehearsalHandoff}
                    canSignDirect={false} /* the rehearsal is ALWAYS multisig — that is its point */
                    busy={rehearsalBusy}
                    onSign={() => undefined}
                    onDismiss={() => setRehearsalHandoff(null)}
                    onSettled={() => refreshAfterSettlement()}
                  />
                  <p className="text-[11px] text-ink/40">
                    {t('Once submitted, refresh: the verification reads the validated transaction from the ledger.')}
                  </p>
                </div>
              )}
              {rehearsalError && <InlineNotice tone="warning">{rehearsalError}</InlineNotice>}
            </Card>
          </RevealItem>
        )}

        {/* Governed MoneyFlows (§2.3) — Council MoneyFlows + create a governed
            rule. Its own section so the rules surface never crowds the rest. */}
        {effectiveSurface === 'govern' && account && govTab === 'moneyflows' && (
          <RevealItem>
            <GovernedMoneyFlows account={account} />
          </RevealItem>
        )}

        {/* Movements — the SAME rails as Astryum Personal (send / set aside /
            DEX buy-sell) but bound to the GOVERNED account: each move is composed
            unsigned and proposed to the council inbox — the quorum signs it in
            Proposals. The verb changes with the authority (actionCatalog). */}
        {effectiveSurface === 'govern' && account && govTab === 'movements' && (
          <RevealItem>
            <GovernedMovements account={account} onGoToProposals={() => setGovTab('proposals')} />
          </RevealItem>
        )}

        {/* ── Wallets: the SAME wallet manager as Astryum Personal (cards +
            per-wallet functionality), scoped to THIS Legacy — its council
            account and the Flare Smart Account it controls. A Legacy's wallets
            live here, not in Personal (founder 2026-07-21). Read-only handoff:
            Astryum never signs for either leg. ── */}
        {effectiveSurface === 'govern' && account && govTab === 'wallets' && (
          <RevealItem>
            <WalletManager scope={{ legacyCouncil: account }} variant="embedded" />
          </RevealItem>
        )}

        {/* ── Activity: the interactive feed — everything signed on XRPL/Flare
            and everything still running, each entry openable to its on-chain
            proof and the actions it still allows (renew a rule near its 90 days,
            withdraw or go sign a live proposal, read a council order's FDC leg). */}
        {effectiveSurface === 'govern' && account && govTab === 'activity' && (
          <RevealItem>
            <LegacyActivityFeed account={account} onGoToProposals={() => setGovTab('proposals')} />
          </RevealItem>
        )}

        {/* ── Proposals: Programmed transfer → Council order → Proposal inbox ── */}
        {effectiveSurface === 'govern' && govTab === 'proposals' && (
        <RevealItem>
          <Card spotlight padded={false} className="group isolate relative overflow-hidden p-5 md:p-6 lg:pr-56 space-y-4">
            {/* a sealed vault on a timeline: the pulse travels toward the
                delivery star; the dotted recovery arc curves home */}
            <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 hidden lg:block opacity-[0.32] group-hover:opacity-60 transition-opacity duration-700" style={{ zIndex: -1 }} aria-hidden>
              <TimeVaultScene width={200} height={150} />
            </div>
            <div className="flex items-center gap-2">
              <Landmark size={16} className="text-ink/50" />
              <SectionTitle>{t('Programmed transfer')}</SectionTitle>
            </div>
            <p className="text-sm leading-relaxed text-ink/55">
              {t(
                'Commit XRP to a beneficiary with a delivery date. Until that date the commitment is UNBREAKABLE — not even the council can take it back (that is the point). If you set a recovery date and nobody claims the transfer, after it the XRP returns to this account. The locked XRP earns nothing while locked.',
              )}
            </p>
            {!handoff ? (
              <div className="space-y-3">
                {/* "Operar" — NL → intent → prefill. The AI compiles; the user
                    reviews every field and signs (invariant #8). Addresses are
                    scrubbed client-side before the sentence leaves the browser. */}
                {account && (
                  <LegacyIntentCompiler
                    account={account}
                    onFill={(v) => {
                      if (v.destination) setDestination(v.destination);
                      if (v.amountXrp) setAmountXrp(v.amountXrp);
                      if (v.unlockDate) onUnlockDateChange(v.unlockDate);
                      if (v.expiryDate) setExpiryDate(v.expiryDate);
                    }}
                  />
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <MicroLabel>{t('Beneficiary (XRPL address)')}</MicroLabel>
                    <input
                      value={destination}
                      onChange={(e) => setDestination(e.target.value)}
                      placeholder="r…"
                      spellCheck={false}
                      className={inputCls}
                    />
                  </label>
                  <label className="block">
                    <MicroLabel>{t('Amount (XRP)')}</MicroLabel>
                    <input
                      value={amountXrp}
                      onChange={(e) => setAmountXrp(e.target.value)}
                      inputMode="decimal"
                      placeholder="100"
                      className={inputCls}
                    />
                    {spendable && (
                      <span className="mt-1 block text-[11px] text-ink/40">
                        {t('Available after ledger reserves:')}{' '}
                        {Math.max(0, spendable.spendableXrp - spendable.nextObjectReserveXrp).toLocaleString(
                          undefined,
                          { maximumFractionDigits: 6 },
                        )}{' '}
                        XRP
                      </span>
                    )}
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-ink/60">{t('Delivery date')}</span>
                    <input
                      type="date"
                      value={unlockDate}
                      min={minDate}
                      onChange={(e) => onUnlockDateChange(e.target.value)}
                      className={inputCls}
                    />
                    <span className="mt-1 block text-xs text-ink/40">{t('Unbreakable until then.')}</span>
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-ink/60">{t('Recovery date')}</span>
                    <input
                      type="date"
                      value={expiryDate}
                      min={unlockDate || minDate}
                      onChange={(e) => setExpiryDate(e.target.value)}
                      className={inputCls}
                    />
                    <span className="mt-1 block text-xs text-ink/40">
                      {t('Default: delivery + 1 year — unclaimed funds return.')}
                    </span>
                  </label>
                </div>
                {unlockDate && !expiryDate && (
                  <p className="flex items-start gap-2 text-sm leading-relaxed text-tone-warning">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    {t(
                      'No recovery date: this commitment can NEVER be undone. If the beneficiary loses their key, the XRP is unrecoverable forever. Strongly consider keeping one.',
                    )}
                  </p>
                )}
                {monthsLocked > 12 && (
                  <p className="flex items-start gap-2 text-sm leading-relaxed text-tone-warning">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    {t(
                      'This XRP will produce NOTHING for the whole lock. Programmed transfers suit short commitments and ceremonies — to sustain someone over time, prefer shorter, renewable commitments.',
                    )}
                  </p>
                )}
                {/* §2 — a council Legacy must not commit real capital before the
                    rehearsal is verified (and never while the margin is at zero). */}
                {council && health && !health.canCommitCapital && (
                  <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2.5 text-[13px] text-tone-warning">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                    {health.mustReplaceSigner
                      ? t('This Legacy is at the exact quorum — resolve the emergency before committing any capital.')
                      : t('Commit real capital only after the signing rehearsal is verified on-chain.')}
                  </p>
                )}
                <PrimaryButton
                  onClick={() => void prepareTransfer()}
                  disabled={busy || !account || (!!council && !!health && !health.canCommitCapital)}
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
                  {t('Review the commitment')}
                </PrimaryButton>
              </div>
            ) : (
              <div className="space-y-3">
                <DisclosureBlock handoff={handoff} />
                <HandoffActions
                  handoff={handoff}
                  canSignDirect={canSignDirect}
                  busy={busy}
                  onSign={() => void signTransfer()}
                  onDismiss={() => setHandoff(null)}
                  onSettled={() => refreshAfterSettlement()}
                />
              </div>
            )}
            {formError && <InlineNotice tone="warning">{formError}</InlineNotice>}
            {doneHash && (
              <InlineNotice tone="success" icon={null}>
                {t('Commitment signed and submitted.')}{' '}
                <a href={`${XRPSCAN_TX}${doneHash}`} target="_blank" rel="noreferrer" className="underline">
                  {t('View on XRPScan')}
                </a>
                {settling && (
                  <span className="ml-2 text-ink/45">
                    {t('The ledger takes a few seconds — the list refreshes itself.')}
                  </span>
                )}
              </InlineNotice>
            )}

            {/* ── existing commitments of the Legacy account ── */}
            {escrows.length > 0 && (
              <ul className="divide-y divide-ink/5">
                {escrows.map((row, i) => (
                  <li key={row.previousTxnID ?? i} className="flex flex-wrap items-center gap-3 py-2.5">
                    <Lock size={14} className="text-ink/40" />
                    <span className="text-sm font-medium">
                      {row.amount} {row.currency}
                    </span>
                    <span className="text-sm text-ink/50">
                      → {row.destination ? shortAddr(row.destination) : '—'} · {t('deliverable')}{' '}
                      {fmtDateTime(row.finishAfterISO)}
                    </span>
                    {row.hasCondition && <Pill tone="warning">{t('conditional')}</Pill>}
                    <span className="ml-auto">
                      {canRelease(row) ? (
                        <PrimaryButton
                          onClick={() => void act(row, 'finish')}
                          disabled={actingId !== null || !isConnected}
                        >
                          {actingId === row.previousTxnID ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Unlock size={14} />
                          )}
                          {t('Deliver')}
                        </PrimaryButton>
                      ) : canCancel(row) ? (
                        <PrimaryButton
                          onClick={() => void act(row, 'cancel')}
                          disabled={actingId !== null || !isConnected}
                        >
                          {actingId === row.previousTxnID ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Undo2 size={14} />
                          )}
                          {t('Recover')}
                        </PrimaryButton>
                      ) : (
                        <Pill tone="neutral">{t('committed')}</Pill>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {actionError && <InlineNotice tone="warning">{actionError}</InlineNotice>}
            {actionHash && (
              <InlineNotice tone="success" icon={null}>
                {t('Submitted.')}{' '}
                <a href={`${XRPSCAN_TX}${actionHash}`} target="_blank" rel="noreferrer" className="underline">
                  {t('View on XRPScan')}
                </a>
                {settling && (
                  <span className="ml-2 text-ink/45">
                    {t('The ledger takes a few seconds — the list refreshes itself.')}
                  </span>
                )}
              </InlineNotice>
            )}
            <p className="text-[11px] text-ink/40">
              {t(
                'Delivery and recovery are permissionless: once the window opens, anyone (you, Astryum’s keeper, any third party) can trigger them — the ledger fixes where the XRP goes. Delivery always pays the beneficiary; recovery always returns to the creator.',
              )}
            </p>
          </Card>
        </RevealItem>
        )}

        {/* ── 3. The constitution (slide 4) — Constitute only now (founder
            refactor 2026-07-19): this artifact lives in the Constitution
            surface; Governance no longer renders it. ── */}
        {effectiveSurface === 'constitute' && wizStep === 4 && (
        <RevealItem>
          <Card spotlight padded={false} className="group isolate relative overflow-hidden p-5 md:p-6 lg:pr-56 space-y-4">
            {/* the ruled document with its SHA seal; hovering draws the
                amendment chain through its anchor-stars */}
            <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 hidden lg:block opacity-[0.32] group-hover:opacity-60 transition-opacity duration-700" style={{ zIndex: -1 }} aria-hidden>
              <LedgerScrollScene width={190} height={150} />
            </div>
            <div className="flex items-center gap-2">
              <ScrollText size={16} className="text-ink/50" />
              <SectionTitle>{t('The constitution')}</SectionTitle>
            </div>
            <p className="text-[12px] text-ink/55">
              {t(
                'The governance document, anchored on the ledger by its SHA-256 fingerprint (the document itself never leaves your browser). Every amendment is a new anchor signed by the council’s quorum — the version history IS the council’s consensus history. The anchor registers the rules; the council enforces them.',
              )}
            </p>

            {anchor ? (
              <div className="space-y-1 rounded-xl border border-ink/10 bg-ink/[0.03] p-3">
                <MicroLabel>{t('Anchored today')}</MicroLabel>
                {anchor.dataHex ? (
                  <p className="break-all font-mono text-[12px] text-ink/75">{anchor.dataHex}</p>
                ) : (
                  <p className="text-[12px] text-ink/55">
                    {t(
                      'This account has a DID, but it does not anchor a document fingerprint (no Data field) — anchoring a constitution will replace it.',
                    )}
                  </p>
                )}
                {anchor.uri && (
                  <p className="text-[12px] text-ink/55">
                    {t('Document at:')} <span className="font-mono">{anchor.uri}</span>
                  </p>
                )}
              </div>
            ) : (
              account &&
              !loading && (
                <p className="text-sm text-ink/45">{t('No constitution anchored on this account yet.')}</p>
              )
            )}

            {/* §4 — nobody writes a constitution from a blank page: the gallery.
                Pick a situation → fill labelled fields → live preview → insert.
                All client-side; only the fingerprint ever leaves the browser. */}
            {!builderOpen ? (
              <GhostButton onClick={() => setBuilderOpen(true)}>
                <FileText size={14} /> {t('Choose a template (a starting point, not an imposition)')}
              </GhostButton>
            ) : (
              <ConstitutionBuilder
                account={account}
                onUse={(text) => {
                  setDocText(text);
                  setVerifyResult(null);
                  setBuilderOpen(false);
                }}
                onClose={() => setBuilderOpen(false)}
              />
            )}
            <label className="block">
              <span className="text-xs font-medium text-ink/60">
                {anchor ? t('Verify or amend') : t('Anchor v1')}
              </span>
              <textarea
                value={docText}
                onChange={(e) => {
                  setDocText(e.target.value);
                  setVerifyResult(null);
                }}
                rows={5}
                spellCheck={false}
                className={`${inputCls} font-mono text-[12px]`}
                placeholder={t('The rules of the patrimony, exactly as written…')}
              />
              <span className="mt-1 block text-xs text-ink/40">{t('Paste the exact document text.')}</span>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-ink/60">{t('Document URI')}</span>
              <input
                value={docUri}
                onChange={(e) => setDocUri(e.target.value)}
                placeholder="ipfs://…"
                spellCheck={false}
                className={inputCls}
              />
              <span className="mt-1 block text-xs text-ink/40">{t('Optional — IPFS/HTTPS where it lives.')}</span>
            </label>

            <p className="text-[11px] text-ink/40">
              {t(
                'Verification hashes the EXACT bytes: a changed space or line break is a different document.',
              )}{' '}
              {t(
                'This template does not replace a lawyer. In many countries forced-heirship rules exist: a court can override parts of what you write. Get advice before constituting with real wealth.',
              )}
            </p>

            {!anchorHandoff ? (
              <div className="flex flex-wrap items-center gap-2">
                {anchor?.dataHex && (
                  <GhostButton onClick={() => void verifyDocument()} disabled={!docText}>
                    <FileCheck2 size={14} /> {t('Verify against the ledger')}
                  </GhostButton>
                )}
                <PrimaryButton onClick={() => void prepareAnchor()} disabled={anchorBusy || !account || !docText.trim()}>
                  {anchorBusy ? <Loader2 size={14} className="animate-spin" /> : <ScrollText size={14} />}
                  {anchor ? t('Prepare amendment') : t('Prepare anchor')}
                </PrimaryButton>
              </div>
            ) : (
              <div className="space-y-3">
                <DisclosureBlock handoff={anchorHandoff} />
                <HandoffActions
                  handoff={anchorHandoff}
                  canSignDirect={canSignDirect}
                  busy={anchorBusy}
                  onSign={() => void signAnchor()}
                  onDismiss={() => setAnchorHandoff(null)}
                  onSettled={() => refreshAfterSettlement()}
                />
              </div>
            )}

            {verifyResult === 'match' && (
              <InlineNotice tone="success">
                {t('The document matches the anchored fingerprint — this is the governing version.')}
              </InlineNotice>
            )}
            {verifyResult === 'mismatch' && (
              <InlineNotice tone="warning">
                {t('The document does NOT match the anchor — different text, or a newer version was anchored.')}
              </InlineNotice>
            )}
            {anchorError && <InlineNotice tone="warning">{anchorError}</InlineNotice>}
            {anchorDone && (
              <InlineNotice tone="success" icon={null}>
                {t('Anchor signed and submitted.')}{' '}
                <a href={`${XRPSCAN_TX}${anchorDone}`} target="_blank" rel="noreferrer" className="underline">
                  {t('View on XRPScan')}
                </a>
              </InlineNotice>
            )}

            {history.length > 0 && (
              <div className="space-y-1">
                <MicroLabel>{t('Amendment history (each version signed by the quorum of its day)')}</MicroLabel>
                <ul className="divide-y divide-ink/5">
                  {history.map((h) => (
                    <li key={h.txHash} className="flex flex-wrap items-center gap-3 py-2 text-[12px]">
                      <span className="text-ink/50">{fmtDateTime(h.dateISO)}</span>
                      <span className="break-all font-mono text-ink/70">{h.dataHex?.slice(0, 16)}…</span>
                      {h.signedByQuorum ? (
                        <Pill tone="success">{t('quorum-signed')}</Pill>
                      ) : (
                        <Pill tone="neutral">{t('single signature')}</Pill>
                      )}
                      <a
                        className="ml-auto text-ink/40 hover:text-ink/70"
                        href={`${XRPSCAN_TX}${h.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ExternalLink size={13} />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        </RevealItem>
        )}

        {/* ── Slide 5: the capital — the vessel is ready; capital enters and
            produces on Flare inside the cage, governed from XRPL. ── */}
        {effectiveSurface === 'constitute' && wizStep === 5 && (
          <RevealItem>
            <Card className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Landmark size={16} className="text-ink/50" />
                <SectionTitle>{t('The capital')}</SectionTitle>
                {constituted && <Pill tone="success">{t('constituted')}</Pill>}
              </div>
              <p className="text-[12px] text-ink/55">
                {t(
                  'Your Legacy is constituted: the council governs, the rehearsal is proven, the door is closed and the constitution is anchored. From here the capital works in two layers: XRP on this account (the native reserve, protected by the quorum), and productive capital on Flare inside the cage of code — governed from XRPL through council orders.',
                )}
              </p>
              <ul className="space-y-1.5 text-[12px] text-ink/60">
                <li>• {t('Fund the account: a normal XRP payment to this address (the quorum is not needed to receive).')}</li>
                <li>• {t('Programmed transfers, council orders to the Flare cage, and the vault mirror live in Govern.')}</li>
              </ul>
              <PrimaryButton onClick={() => setSurface('govern')}>
                {t('Go to Govern')} →
              </PrimaryButton>
            </Card>
          </RevealItem>
        )}

        {/* ── Slide navigation (Constitute) ── */}
        {effectiveSurface === 'constitute' && (
          <RevealItem>
            <div className="flex items-center justify-between">
              <GhostButton onClick={() => setWizStep((s) => Math.max(0, s - 1))} disabled={wizStep === 0}>
                ← {t('Previous')}
              </GhostButton>
              <GhostButton onClick={() => setWizStep((s) => Math.min(5, s + 1))} disabled={wizStep === 5}>
                {t('Next')} →
              </GhostButton>
            </div>
          </RevealItem>
        )}

        {/* ── Council order — the FDC enforcement rail (roadmap Pieza 1): the
            quorum signs ONE XRPL tx; the bridge executes it on the vault. ── */}
        {effectiveSurface === 'govern' && account && govTab === 'proposals' && (
          <RevealItem>
            <CouncilOrderCard account={account} />
          </RevealItem>
        )}

        {/* ── Proposal inbox — the async quorum (yours / others / ready /
            emitted). Last in Proposals: create above, sign here. ── */}
        {effectiveSurface === 'govern' && account && govTab === 'proposals' && (
          <RevealItem>
            <ProposalInbox account={account} onSettled={() => refreshAfterSettlement()} />
          </RevealItem>
        )}

        {/* ── The EVM/vault mirror (auditoría P1): a manual drift-check that
            existed only WHILE FDC enforcement did not. Retired from the frontend
            (founder 2026-07-19: enforcement is the rail now) — kept in the repo,
            gated off, never deleted. ── */}
        {SHOW_VAULT_MIRROR && effectiveSurface === 'govern' && (
        <RevealItem>
          <Card spotlight padded={false} className="group isolate relative overflow-hidden p-5 md:p-6 lg:pr-60 space-y-4">
            {/* two orbits face to face — XRPL gold, Flare rose — a sync pulse
                crossing the beam between them: the two councils, mirrored */}
            <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 hidden lg:block opacity-[0.32] group-hover:opacity-60 transition-opacity duration-700" style={{ zIndex: -1 }} aria-hidden>
              <MirrorOrbitsScene width={210} height={140} />
            </div>
            <div className="flex items-center gap-2">
              <Link2 size={16} className="text-ink/50" />
              <SectionTitle>{t('The vault mirror (Flare)')}</SectionTitle>
            </div>
            <p className="text-[12px] text-ink/55">
              {t(
                'When the productive capital lives in the LegacyVault on Flare, its council is a SECOND multisig with the same humans — and the two sides do not sync themselves. Until the FDC enforcement exists, the vault is governed by its EVM council: this check tells you if the two have drifted apart.',
              )}
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="grow">
                <MicroLabel>{t('LegacyVault address (Flare)')}</MicroLabel>
                <input
                  value={vaultAddr}
                  onChange={(e) => setVaultAddr(e.target.value)}
                  placeholder="0x…"
                  spellCheck={false}
                  className={inputCls}
                />
              </label>
              <PrimaryButton onClick={() => void checkVault()} disabled={vaultBusy || !vaultAddr.trim()}>
                {vaultBusy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                {t('Compare')}
              </PrimaryButton>
            </div>
            {vaultError && <InlineNotice tone="warning">{vaultError}</InlineNotice>}
            {vaultInfo && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone="neutral">
                    {t('vault council')}: {shortAddr(vaultInfo.council)}
                  </Pill>
                  {vaultInfo.kind === 'safe' ? (
                    <Pill tone="info">
                      {vaultInfo.ownerCount} {t('owners')} · {t('threshold')} {vaultInfo.threshold}
                    </Pill>
                  ) : vaultInfo.kind === 'eoa' ? (
                    <Pill tone="warning">{t('single key (EOA) — testing phase, not a council')}</Pill>
                  ) : (
                    <Pill tone="neutral">{t('contract (owners not readable)')}</Pill>
                  )}
                </div>
                {council && vaultInfo.kind === 'safe' && (
                  <>
                    {vaultInfo.ownerCount === council.signers.length && vaultInfo.threshold === council.quorum ? (
                      <InlineNotice tone="success">
                        {t('Counts match: same number of members and same threshold on both sides.')}
                      </InlineNotice>
                    ) : (
                      <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2.5 text-[13px] text-tone-warning">
                        <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                        {t('The two councils have DRIFTED:')} XRPL {council.signers.length} ({t('quorum')}{' '}
                        {council.quorum}) · Flare {vaultInfo.ownerCount} ({t('threshold')} {vaultInfo.threshold}).{' '}
                        {t('The productive capital is governed by the Flare side. Replicate the change today (PROTOCOLO_CONSEJO §5).')}
                      </p>
                    )}
                  </>
                )}
                <p className="text-[11px] text-ink/40">
                  {t(
                    'XRPL addresses (r…) and Flare addresses (0x…) are not comparable — only counts and thresholds are. Keeping the same humans behind both lists is the council’s discipline, not something any code can verify.',
                  )}
                </p>
              </div>
            )}
          </Card>
        </RevealItem>
        )}

        {/* ── Per-page footer: ONE honest sentence for the surface/section you
            are on (founder refactor 2026-07-19). ── */}
        <RevealItem>
          <Card padded={false} className="p-4">
            <p className="text-[11px] leading-relaxed text-ink/40">
              {effectiveSurface === 'constitute'
                ? t('A programmed, conditioned, revocable transfer constituted in life — it creates no legal regime, and nothing transfers at death.')
                : govTab === 'info'
                  ? t('On XRPL nobody holds a key: this account is protected by its council (quorum), never by Astryum.')
                  : govTab === 'proposals'
                    ? t('Astryum composes unsigned; the quorum signs each proposal — the same bytes, once, in order.')
                    : govTab === 'activity'
                      ? t('A standing record of everything signed on XRPL and Flare, and everything still running — each entry with its on-chain proof.')
                      : govTab === 'movements'
                        ? t('Every movement is composed unsigned and bound to the council account; the quorum signs it in Proposals. Astryum never signs, never holds a key.')
                        : govTab === 'wallets'
                          ? t('The accounts this Legacy controls — its council on XRPL and the Smart Account it operates on Flare. Read-only here; the quorum moves funds from Movements.')
                          : t('The rule holds no authority: it watches and composes; only the quorum’s signature moves funds.')}
            </p>
          </Card>
        </RevealItem>
      </RevealGroup>
      </div>
    </div>
  );
}
