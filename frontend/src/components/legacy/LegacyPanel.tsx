'use client';

/**
 * LegacyPanel — Astryum Legacy v0: XRPL governs, Flare produces.
 *
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Check,
  ChevronDown,
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
  X,
} from 'lucide-react';
import {
  Card,
  GhostButton,
  MicroLabel,
  PageHeader,
  Pill,
  PrimaryButton,
  SectionTitle,
} from '../ui/primitives';
import { motion } from 'framer-motion';
import { useReducedMotion } from '../../stores/motionStore';
import { useEngraved } from '../../stores/themeStore';
import { ColonnadeMark, RegisterMark, SignetMark } from '../ui/skin/marks';
import { DUR, EASE_OUT, modalPop, RevealGroup, RevealItem } from '../ui/motion';
import { StationProgress, StationRailLayout } from '../ui/StationProgress';
import { StationDoneStrip, useResumeToast } from '../ui/StationDoneNotice';
import {
  CouncilScene,
  LedgerScrollScene,
  MirrorOrbitsScene,
  PantheonScene,
  SignalBeacon,
  SignatureScene,
  TimeVaultScene,
} from '../ui/scenes';
import { isValidClassicAddress } from 'xrpl';
import { InlineNotice } from './InlineNotice';
import LegacyBetaBanner from './LegacyBetaBanner';
import MyLegaciesList from './MyLegaciesList';
import ProposalInbox from './ProposalInbox';
import LegacyActivityFeed from './LegacyActivityFeed';
import LegacyYieldPanel from './LegacyYieldPanel';
import LegacyVaultCard from './LegacyVaultCard';
// GovernedMoneyFlows is no longer mounted here — the council's rules live in
// Earn → My strategies now, next to where personal rules already were.
import GovernedMovementsModal from './GovernedMovementsModal';
import { CouncilSigningDoors } from './CouncilMultisigFlow';
import CouncilInXaman, { CouncilPlanCheck, SignerListRows } from './CouncilInXaman';
import CloseDoorSign from './CloseDoorSign';
import { awaitValidation } from '../../lib/xrpl/councilSigning';
import { applyXrplSignFailure, confirmOnLedger } from '../../lib/xrpl/ledgerSignOutcome';
import type { UnconfirmedSignature } from '../../lib/wallet/signOutcome';
import { UnconfirmedSignatureNotice } from '../settlement/UnconfirmedSignatureNotice';
import ConstitutionBuilder from './ConstitutionBuilder';
// LegacyDiscovery (the embedded Guía card) is UNMOUNTED here: its
// left column ate a third of the ceremony. The global co-pilot IS the Guía in
// Legacy mode now — this panel only PUBLISHES the journey context to it.
import { type LegacyJourney } from './LegacyDiscovery';
import { setLegacyJourney } from '../../lib/legacy/guideContext';
import LegacyIntentCompiler from './LegacyIntentCompiler';
import CouncilOrderCard from './CouncilOrderCard';
import { getConstitutionDraft, getLegacyNickname, rememberLegacy, saveConstitutionDraft, setLegacyNickname } from './legacyLocal';
import { useT } from '../../i18n/LanguageProvider';
import { xrplTxTypeLabel } from '../../lib/xrpl/txTypeLabels';
import { useXrplWalletPartner } from '../../lib/wallet/useXrplWalletPartner';
import { useAuthorities } from '../../hooks/useAuthorities';
import { governedAuthorityId } from '../../lib/authority';
import { markPersonalQuorum } from '../../lib/authority/personalQuorum';
import { getUserRegion } from '../../lib/region';
import { computeCeremonyReserve } from '../../lib/legacy/ceremonyReserve';
import { formatPlanProblem, normalizeCouncilPlan, validateCouncilPlan } from '../../lib/legacy/councilPlan';
import { ModalOverlay } from '@/components/ui/ModalPortal';
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

/** Xaman reports "signed and submitted" — the verdict is the VALIDATED ledger
 *  (a preliminary success can still land as tec*). Throws in human words when
 *  the tx failed or is still unconfirmed, so no done-state paints early. */
async function assertLedgerApplied(txHash: string, t: (s: string) => string): Promise<void> {
  const v = await awaitValidation(txHash);
  if (!v.validated) {
    throw new Error(
      t('Broadcast accepted — still waiting for ledger validation. Check XRPScan in a moment; do not assume it applied.'),
    );
  }
  if (v.finalResult !== 'tesSUCCESS') {
    throw new Error(`${t('The ledger validated it but it FAILED:')} ${v.finalResult}`);
  }
}
const XRPSCAN_ACCOUNT = 'https://xrpscan.com/account/';
/** Multisig setup + signing live in the user's wallet tools, not in Astryum (ADR-006).
 *  The xApp detect link is VERIFIED (valid page, "create, distribute &
 *  collect multi sign signatures"). xrpl.services is an SPA whose tool query params
 *  are not verifiable from here — link the tools page plainly, no invented param. */
const XAMAN_MULTISIGN_XAPP = 'https://xumm.app/detect/xapp:xumm.multisign';
const XRPL_SERVICES_TOOLS = 'https://xrpl.services/tools';
/** The wallet itself — slide 0 sends the person here to CREATE the vessel
 *  account before anything else can happen. */
const XAMAN_APP = 'https://xaman.app';

const XRPL_ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/** The vault mirror was the honest drift-check while FDC enforcement did not
 *  exist. Retired from the frontend: the Council order rail
 *  IS the enforcement now. Kept in the repo, gated off — flip to re-enable. */
const SHOW_VAULT_MIRROR = false;

// Constitution templates (§4 — nobody writes one from a blank page) moved to
// ./constitutionTemplates.ts as a GALLERY with labelled fields: the form
// generates the text, the user never hunts [BRACKETS]. The old single hardcoded
// template lives on as the "Family patrimony" entry. Assembly + hashing stay in
// the browser; the document text never touches the backend (privacy invariant).

/** Aterrizaje sin destino en /app/legacy: redirige a Wallets (la lista My
 *  Legacies murió; las cuentas gobernadas viven en su estante de Wallets). */
function BackToWallets() {
  const router = useRouter();
  useEffect(() => {
    // SOLO un aterrizaje sin destino redirige. El primer render del panel
    // llega con view='list' (el efecto de params aún no corrió), y los
    // efectos de los HIJOS corren antes que los del padre — así que redirigir
    // a ciegas aquí ganaba siempre la carrera y devolvía a Wallets cualquier
    // entrada legítima. Si la URL trae una entrada, el panel está a punto de abrir el
    // taller: este componente no hace nada y desaparece en el re-render.
    const p = new URLSearchParams(window.location.search);
    if (
      p.get('govern') ||
      p.get('reinforce') ||
      p.get('constitute') ||
      p.get('walkthrough') ||
      p.get('tab')
    ) {
      return;
    }
    router.replace('/app/wallets');
  }, [router]);
  return null;
}

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
  if (msg.includes('LEGACY_ACCESS_REQUIRED')) {
    return t('This account is not on the Legacy access list on the server.');
  }
  // The server's own explanation beats its bare code: a 400 used to reach the
  // panel as the literal string INVALID_BODY / BUILD_FAILED while `detail`
  // (which says WHICH field and why) sat unread in the response body.
  const detail = (err as { body?: { detail?: unknown } })?.body?.detail;
  const detailText = Array.isArray(detail)
    ? detail.filter((d) => typeof d === 'string').join(' · ')
    : typeof detail === 'string'
      ? detail
      : '';
  if (detailText) return detailText;
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
    // Council ORDER facts — these reached the last screen before a quorum
    // signature as raw camelCase (`serviceFee`, `orderNonce`…). The review
    // screen has to read like a sentence, not like a payload.
    order: t('The order'),
    action: t('Operation'),
    orderNonce: t('Order number (sequential)'),
    orderHash: t('Order fingerprint'),
    serviceFee: t('Service fee'),
    vault: t('Vault (the cage)'),
    bridge: t('Bridge (executes on Flare)'),
    constitutionRef: t('Constitution in force'),
    settlementLatency: t('Time until it executes'),
    // Cage funding + yield facts.
    mintingFeeXrp: t('Minting fee (XRP)'),
    executorFeeXrp: t('Executor fee (XRP)'),
    principalAdded: t('Principal that lands'),
    asset: t('Asset'),
    principalIsWithdrawable: t('Principal can be withdrawn'),
    signedBy: t('Signed by'),
    astryumSigns: t('Astryum signs'),
    separateOrderNeededToDirect: t('Putting it to work needs a separate order'),
    venueId: t('Venue'),
    realizes: t('Realizes'),
    touchesPrincipal: t('Touches the principal'),
    permissionless: t('Anyone can send it'),
    yieldClaimed: t('Yield claimed'),
    arrivesAs: t('Arrives as'),
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
  manualOnly = false,
  busy,
  onSign,
  onDismiss,
  onSettled,
}: {
  handoff: XrplTxHandoff;
  canSignDirect: boolean;
  /** Only the copy-to-your-own-tool path. For transaction types Xaman refuses to
   *  serve any app (SignerListSet → 401 / 1217): offering its QR would send a
   *  family into a dead end at the most irreversible step of the ceremony. */
  manualOnly?: boolean;
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
  if (manualOnly) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <PrimaryButton onClick={copy}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? t('Copied') : t('Copy unsigned transaction')}
          </PrimaryButton>
          <a href={XRPL_SERVICES_TOOLS} target="_blank" rel="noreferrer">
            <GhostButton>
              <ExternalLink size={14} /> xrpl.services
            </GhostButton>
          </a>
          <GhostButton onClick={onDismiss}>{t('Back')}</GhostButton>
        </div>
        <p className="text-[11px] text-ink/40">
          {t('Your own tool fills in the Sequence and the Fee before signing. Change nothing else: the signers and the quorum are the transaction.')}
        </p>
        {/* The direct Xaman route is NOT removed — only demoted and labelled.
            It answers 1217 today, so it must never be the obvious button; but
            the permission is granted per app by Xaman's support, and the day it
            arrives this is the whole path, already built and wired. */}
        {canSignDirect && (
          <div className="flex flex-wrap items-center gap-2 border-t border-ink/[0.07] pt-2">
            <GhostButton onClick={onSign} disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
              {t('Try it in Xaman anyway')}
            </GhostButton>
            <span className="text-[11px] text-ink/35">
              {t('Expect “No permission to create this type of sign request” (1217) until Xaman authorises it for Astryum.')}
            </span>
          </div>
        )}
      </div>
    );
  }
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
          {/* consejo-superficies 2: the two tempos are ONE element with one
              rule — while the live ceremony holds the pinned seat, the async
              door beside it cannot compose the same transaction again (it says
              so instead of vanishing). */}
          <CouncilSigningDoors
            xrplTx={handoff.xrplTx}
            account={String(handoff.xrplTx.Account ?? '')}
            defaultTitle={xrplTxTypeLabel(String(handoff.xrplTx.TransactionType ?? ''), t)}
            onSettled={onSettled}
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

/** The per-station brief: each
 *  slide opens by saying WHAT YOU PHYSICALLY DO here, in numbered steps. The
 *  ceremony was legible to whoever built it and to nobody else — the founder
 *  had to ask a colleague that the vessel account must exist before slide 0. */
function StationBrief({ title, items }: { title: string; items: ReactNode[] }) {
  // Format v2: separated rows
  // with a numbered chip and real air between them — a rhythm, not a wall.
  return (
    <div className="space-y-3 rounded-xl border border-ink/[0.07] bg-ink/[0.02] p-4">
      <MicroLabel>{title}</MicroLabel>
      <ol className="space-y-2.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span
              aria-hidden
              className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full border border-ink/15 bg-ink/[0.04] font-mono text-[10px] text-ink/50"
            >
              {i + 1}
            </span>
            <span className="text-[12.5px] leading-relaxed text-ink/65">{item}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** One breath per navigation INSIDE the panel (the immersion
 *  pass): station changes slide in from the direction of travel; surface and
 *  tab changes settle with a short rise. Reduced motion collapses to a fade.
 *  Short and on the house curve — the long cinematic stays AuthorityCrossing. */
function SurfaceMotion({ dir, children }: { dir: 1 | -1 | 0; children: ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, x: 22 * dir, y: dir === 0 ? 10 : 0 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{ duration: DUR.base, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Embedded entry: the /app/legacy PAGE died — governance now
 * opens as a large dialog over /app/wallets (GovernanceModal). The dialog
 * passes the entry that used to travel in the URL; `onExit` replaces both the
 * «← My Legacies» chrome and the reinforce ceremony's exit navigation. The
 * URL-reading path stays intact for the (forwarded) standalone mount.
 */
/** Las salas de Govern. `proposals` = la BANDEJA donde se firma (conserva el
 *  id porque es el destino de todos los enlaces «firma en la bandeja»). */
export type GovTab = 'capital' | 'council' | 'orders' | 'proposals' | 'activity';
/** El orden en que se pintan y se recorren con las flechas. */
const GOV_TABS: GovTab[] = ['capital', 'council', 'orders', 'proposals', 'activity'];

export type LegacyPanelEntry =
  | { kind: 'constitute' }
  | { kind: 'walkthrough' }
  | { kind: 'reinforce'; account: string }
  | { kind: 'govern'; account: string; movements?: boolean; tab?: 'proposals' }
  | { kind: 'proposals' };

export interface LegacyPanelEmbed {
  entry: LegacyPanelEntry;
  onExit: () => void;
  /**
   * 'operation': hosted inside the house operation
   * surface (ConstituteOperation — short popup / dockable right panel). The
   * host paints the header and the close/pin chrome, so the panel renders
   * ONLY the ceremony: no back row, no surface switcher, no PageHeader —
   * and the surface stays pinned to Constitute (the op is the ceremony).
   */
  variant?: 'operation';
}

export default function LegacyPanel({ embed }: { embed?: LegacyPanelEmbed } = {}) {
  const { t } = useT();
  // LOS GRABADOS DEL LEGACY (tema Institucional): el templo es el
  // pórtico, el consejo y el faro son el sello con sus firmas, el libro es el
  // registro. La rúbrica que se escribe sola se queda: en bronce es una firma.
  const engraved = useEngraved();
  const router = useRouter();
  const { address, isConnected, sendIntent } = useXrplWalletPartner();
  const { activeGoverned, legacies, setActive } = useAuthorities();

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
  /** WALKTHROUGH mode (?walkthrough=1) — declared here because the surface pin
   *  below needs it; the full story lives on the param effect further down. */
  const [walkthrough, setWalkthrough] = useState(false);
  /** REINFORCE mode (?reinforce=r…) — the same ceremony entered from a wallet
   *  card, for an account that stays PERSONAL. Declared here because the
   *  surface pin below needs it; the full story lives on the param effect. */
  const [reinforce, setReinforce] = useState(false);
  const constituted = council?.masterKeyDisabled === true && rehearsal?.rehearsalComplete === true;
  // Walkthrough pins the surface to Constitute: a constituted account would
  // otherwise auto-derive to Govern the moment its address is pasted — the
  // exact "it resumes at the end" the mode exists to prevent.
  /** Hosted as an operation: the popup/dock IS one surface and stays pinned
   *  to it — Constitute for the ceremony (walkthrough logic: a constituted
   *  account would otherwise auto-derive to Govern on paste and eject), and
   *  Govern for the governance operation. */
  const opEmbed = embed?.variant === 'operation';
  const opSurface: 'constitute' | 'govern' | null = opEmbed
    ? embed!.entry.kind === 'govern' || embed!.entry.kind === 'proposals'
      ? 'govern'
      : 'constitute'
    : null;
  const effectiveSurface: 'constitute' | 'govern' = walkthrough
    ? 'constitute'
    : opSurface ?? surface ?? (constituted ? 'govern' : 'constitute');
  // The surface is now chosen at the DOOR — a Legacy card's Constitution /
  // Governance buttons — and carried here through
  // this ref; on account change we apply it, or fall back to null = auto-follow
  // the ledger. The old in-workspace toggle is gone.
  /** The 60-second "never created a Xaman account" fold on station 0 —
   *  first-run comfort for the person who has never held a wallet. */
  const [vesselHelpOpen, setVesselHelpOpen] = useState(false);
  const surfaceIntent = useRef<'constitute' | 'govern' | null>(null);
  useEffect(() => {
    setSurface(surfaceIntent.current);
    surfaceIntent.current = null;
  }, [account]);

  // ── Govern is the HUB OF GOVERNANCE and nothing else: Information (the council, its constitution, its health) ·
  //    Wallets (what this Legacy controls) · Proposals (where the family
  //    signs). Everything that a personal wallet already does moved to the
  //    SHARED surfaces the toggle swaps — Activity to Portfolio, MoneyFlows to
  //    Earn → My Strategies, capital to Summary/Earn. A council is a personal
  //    wallet that signs by quorum; it deserves the same pages, not a second
  //    copy of them. Movements is a MODAL now, reachable in exactly two places
  //    (the Legacy card's third door, and per wallet in the Wallets tab). ──
  // ── GOBERNAR, EN CINCO SALAS. «Info» cargaba CINCO bloques pesados de
  //    golpe — identidad, capital, rendimiento, actividad y el consejo entero
  //    con sus emergencias y enmiendas — y «Propuestas» otros tres. Ahora cada
  //    pestaña responde UNA pregunta y trae uno o dos bloques:
  const [govTab, setGovTab] = useState<GovTab>('capital');
  /** The Movements modal, scoped to this council account. La pieza vive en
   *  GovernedMovementsModal (extraída) — con su disciplina de foco
   *  dentro — porque /app/wallets ahora la abre EN SITIO, sin navegar aquí. */
  const [movementsOpen, setMovementsOpen] = useState(false);
  /** A card door may open the Legacy STRAIGHT into its Movements; the intent
   *  travels through a ref because the account-change effect below resets the
   *  section (same mechanism the surface choice uses). */
  const govTabIntent = useRef<'movements' | 'proposals' | null>(null);
  useEffect(() => {
    if (govTabIntent.current === 'movements') {
      govTabIntent.current = null;
      setGovTab('capital');
      setMovementsOpen(true);
      return;
    }
    if (govTabIntent.current === 'proposals') {
      govTabIntent.current = null;
      setGovTab('proposals');
      setMovementsOpen(false);
      return;
    }
    setGovTab('capital');
    setMovementsOpen(false);
  }, [account]);

  // The authority switcher drives this panel. Two doors in:
  //   ?constitute=1 (the switcher's "+ Constitute a governed account") opens
  //   the constitute surface; otherwise, an active governed authority opens
  //   ITS workspace directly — and switching authority while here follows.
  // The list stays one click away in both cases.
  /** WALKTHROUGH mode (?walkthrough=1 — founder, for recording the
   *  ceremony with an already-constituted account): the wizard does not
   *  auto-jump, the rail shows no checks, the surface stays pinned to
   *  Constitute, and station 1 renders the creation tutorial even when a
   *  council exists. NOTHING about the LEDGER is faked: every verify button
   *  still reads mainnet live — "read the council from the ledger" validates
   *  green only because the council truly exists. The flag is session-only
   *  (never persisted) and off for every normal entry. State declared above,
   *  next to the surface pin it drives. */
  const constituteIntent = useRef(false);
  useEffect(() => {
    // EMBEDDED (the governance dialog): the entry arrives as a prop — each
    // branch mirrors its URL twin below, minus the URL bookkeeping (the modal
    // host owns the URL). The dialog remounts per open, so running once is
    // exactly right.
    if (embed) {
      const e = embed.entry;
      if (e.kind === 'walkthrough' || e.kind === 'constitute') {
        if (e.kind === 'walkthrough') setWalkthrough(true);
        constituteIntent.current = true;
        surfaceIntent.current = 'constitute';
        setAccountInput('');
        setAccount(null);
        setSurface('constitute');
        setView('workspace');
      } else if (e.kind === 'reinforce') {
        constituteIntent.current = true;
        surfaceIntent.current = 'constitute';
        setReinforce(true);
        setAccountInput(e.account);
        setAccount(e.account);
        setSurface('constitute');
        setView('workspace');
      } else if (e.kind === 'govern') {
        constituteIntent.current = true;
        surfaceIntent.current = 'govern';
        setReinforce(true);
        setAccountInput(e.account);
        setAccount(e.account);
        setSurface('govern');
        if (e.movements) govTabIntent.current = 'movements';
        else if (e.tab === 'proposals') govTabIntent.current = 'proposals';
        setGovTab('capital');
        setView('workspace');
      } else if (e.kind === 'proposals') {
        surfaceIntent.current = 'govern';
        setSurface('govern');
        setGovTab('proposals');
        setView('workspace');
      }
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get('walkthrough') === '1') {
      setWalkthrough(true);
      constituteIntent.current = true;
      surfaceIntent.current = 'constitute';
      setAccountInput('');
      setAccount(null);
      setSurface('constitute');
      setView('workspace');
      // Deliberately NOT stripped from the URL (unlike ?constitute=1): a hard
      // reload mid-recording must re-enter the mode, not silently fall back
      // to the normal wizard — that fallback read as "the fix did nothing".
      // Leaving the page drops the mode naturally.
      return;
    }
    if (params.get('constitute') === '1') {
      constituteIntent.current = true;
      surfaceIntent.current = 'constitute';
      setAccountInput('');
      setAccount(null);
      setSurface('constitute');
      setView('workspace');
      // Consume the param so refresh / internal navigation doesn't re-trigger.
      window.history.replaceState(null, '', window.location.pathname);
      return;
    }
    /** REINFORCE mode (`?reinforce=r…`, founder) — the door from a
     *  wallet card: "reinforce this account". It is the SAME constitution
     *  ceremony, pinned to an account the user already holds, and it never
     *  ends in a cage: a reinforced account is a PERSONAL wallet whose keys
     *  are a quorum (2-of-3 of your own devices is the floor, more is yours to
     *  choose). Everything is signed in Xaman, exactly like the Legacy flow.
     *
     *  Station 0 (Account) is skipped by construction: the account arrives with
     *  the link, so the wizard's own ledger-derived step lands on Council.
     *  The personal-quorum mark is NOT set here — it is set when the ledger
     *  CONFIRMS the SignerList (effect below), because before that there is
     *  nothing to classify and a stale mark would be a claim we cannot back. */
    const reinforceParam = (params.get('reinforce') ?? '').trim();
    if (XRPL_ADDRESS_RE.test(reinforceParam)) {
      constituteIntent.current = true;
      surfaceIntent.current = 'constitute';
      setReinforce(true);
      setAccountInput(reinforceParam);
      setAccount(reinforceParam);
      setSurface('constitute');
      setView('workspace');
      // Deliberately NOT stripped (the walkthrough's lesson): a
      // reload in the middle of the ceremony must re-enter the mode, not fall
      // back to the generic wizard — a header that suddenly reads "Legacy" over
      // a personal account is the exact misdescription this mode exists to
      // prevent. Leaving the page drops it naturally.
      return;
    }
    /** GOVERN a reinforced personal account (`?govern=r…`, founder).
     *  Once the ceremony is done the card's door stops being "reinforce it" and
     *  becomes "govern it" — and it cannot ride `?tab=proposals`, because that
     *  one takes its account from `activeGoverned`, and a personal quorum is
     *  deliberately NOT in the governed list (`staysPersonal` keeps it with the
     *  wallets). So the address travels in the link, like reinforce does.
     *
     *  `reinforce` stays true here: it is not about the ceremony, it is about
     *  WHAT this account is — a personal wallet held by a quorum — and it is
     *  what keeps the header from calling it a Legacy. */
    const governParam = (params.get('govern') ?? '').trim();
    if (XRPL_ADDRESS_RE.test(governParam)) {
      constituteIntent.current = true; // don't let activeGoverned clobber the pick
      surfaceIntent.current = 'govern';
      setReinforce(true);
      setAccountInput(governParam);
      setAccount(governParam);
      setSurface('govern');
      // `&movements=1` — la puerta «Movimientos» de la tarjeta de esta cuenta
      // en /app/wallets. El intent viaja por el ref porque el
      // efecto de `account` de abajo resetea la sección; es el mismo mecanismo
      // que ya usaba la tercera puerta de la tarjeta del Legacy.
      if (params.get('movements') === '1') govTabIntent.current = 'movements';
      setGovTab('capital');
      setView('workspace');
      // Same reasoning as reinforce above: a reload must not silently turn a
      // personal account's governance into a Legacy's.
      return;
    }
    // G5 (auditorí) — `?tab=proposals`: el push del consejo dice «firma
    // en la bandeja» y necesita ABRIRLA. Sin este lector el enlace aterrizaba
    // en la pestaña «info» y la propuesta seguía escondida (y caducaba a los 7
    // días). La bandeja vive en la superficie Govern, así que el deep-link fija
    // ambas cosas; la cuenta la pone el efecto de `activeGoverned` de abajo.
    if (params.get('tab') === 'proposals') {
      surfaceIntent.current = 'govern';
      setSurface('govern');
      setGovTab('proposals');
      setView('workspace');
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);
  /** REINFORCE: the account keeps living with the WALLETS, not with the
   *  Legacies — and the ledger cannot tell the two apart, so the owner does.
   *  The mark lands only once the SignerList is CONFIRMED on-chain, which is
   *  also the exact moment it starts mattering: before the council exists the
   *  account never reaches the Legacy list anyway, and marking earlier would
   *  persist a claim the ledger does not back (there is no un-mark door yet). */
  useEffect(() => {
    if (reinforce && account && council) markPersonalQuorum(account);
  }, [reinforce, account, council]);
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
    // Deliberately NOT setView('workspace'): entering
    // Legacy always lands on "My Legacies". Having an active governed
    // authority pre-selects WHICH Legacy is loaded, but opening it stays one
    // explicit click — otherwise the family Legacy swallowed the entrance and
    // the list of the others was unreachable.
    //
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
  // The escrow read FAILED: an empty list would hide «Recover» of an
  // expired commitment without a word. Rows are kept only for the account they
  // were read for.
  const [escrowsUnreadable, setEscrowsUnreadable] = useState(false);
  const escrowsAccountRef = useRef<string | null>(null);
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
        escrowsAccountRef.current = account;
        setEscrowsUnreadable(false);
      } else {
        // «Could not read» is not «no commitments»: say it, offer Retry. Rows of a
        // DIFFERENT account never stand in for this one's.
        if (escrowsAccountRef.current !== account) setEscrows([]);
        setEscrowsUnreadable(true);
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

  // A commitment signature we could not follow: the amber notice replaces the
  // form and the review. Once it validates the commitment is UNBREAKABLE, so a
  // second signature is a second locked transfer.
  const [transferUnconfirmed, setTransferUnconfirmed] = useState<UnconfirmedSignature | null>(null);

  const signTransfer = useCallback(async () => {
    if (!handoff || transferUnconfirmed) return;
    setBusy(true);
    setFormError(null);
    let handedToPartner = false;
    try {
      handedToPartner = true;
      const { txHash } = await sendIntent({ tx: handoff.xrplTx as never });
      await confirmOnLedger(txHash);
      setDoneHash(txHash);
      setHandoff(null);
      setAmountXrp('');
      setDestination('');
      setUnlockDate('');
      setExpiryDate('');
      refreshAfterSettlement();
    } catch (err) {
      // Cancelled → the review stays. Validated with a failure → prepare again.
      // Not validated / unreadable after the hand-off → amber, no sign button.
      applyXrplSignFailure(err, handedToPartner, t, {
        setError: (m) => setFormError(m || null),
        setUnconfirmed: setTransferUnconfirmed,
        setPhase: () => {},
        clearPrepared: () => setHandoff(null),
      });
    } finally {
      setBusy(false);
    }
  }, [handoff, transferUnconfirmed, sendIntent, refreshAfterSettlement, t]);

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
        await assertLedgerApplied(txHash, t);
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
  const [anchorUnconfirmed, setAnchorUnconfirmed] = useState<UnconfirmedSignature | null>(null);

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
    if (!anchorHandoff || anchorUnconfirmed) return;
    setAnchorBusy(true);
    setAnchorError(null);
    let handedToPartner = false;
    try {
      handedToPartner = true;
      const { txHash } = await sendIntent({ tx: anchorHandoff.xrplTx as never });
      await confirmOnLedger(txHash);
      setAnchorDone(txHash);
      setAnchorHandoff(null);
      refreshAfterSettlement();
    } catch (err) {
      applyXrplSignFailure(err, handedToPartner, t, {
        setError: (m) => setAnchorError(m || null),
        setUnconfirmed: setAnchorUnconfirmed,
        setPhase: () => {},
        clearPrepared: () => setAnchorHandoff(null),
      });
    } finally {
      setAnchorBusy(false);
    }
  }, [anchorHandoff, anchorUnconfirmed, sendIntent, refreshAfterSettlement, t]);

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
  // A SignerListSet we could not follow: no second composition or signature of
  // the council until the ledger has been checked.
  const [councilUnconfirmed, setCouncilUnconfirmed] = useState<UnconfirmedSignature | null>(null);
  // §1.2: rotation. The UI used to DEMAND replacing a fallen
  // signer while only rendering the SignerListSet form when no council existed
  // — the emergency had no path. Amending = the SAME form, seeded from the
  // CURRENT council, signed by the CURRENT quorum (HandoffActions already
  // routes to the multisig flow because canSignDirect is false with a council).
  const [amendOpen, setAmendOpen] = useState(false);

  const openAmend = useCallback(() => {
    if (council) {
      setCouncilSigners(council.signers.map((s) => ({ account: s.account, weight: String(s.weight) })));
      setCouncilQuorum(String(council.quorum));
    }
    setCouncilError(null);
    setCouncilDone(null);
    setCouncilHandoff(null);
    setAmendOpen(true);
  }, [council]);

  const prepareCouncil = useCallback(async () => {
    if (!account || councilUnconfirmed) return;
    setCouncilError(null);
    setCouncilDone(null);
    // F10 and friends: validate BEFORE composing. A quorum above the total votes
    // is a SignerList no combination of keys can ever satisfy — with the master
    // key later disabled, that is an account locked forever. The rules live in
    // lib/legacy/councilPlan so the live form in CouncilInXaman and this
    // composer cannot drift apart.
    const problem = validateCouncilPlan(account, councilSigners, councilQuorum, isValidClassicAddress);
    if (problem) return setCouncilError(formatPlanProblem(problem, t));
    const { signers } = normalizeCouncilPlan(councilSigners, councilQuorum);
    setCouncilBusy(true);
    try {
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
  }, [account, councilSigners, councilQuorum, councilUnconfirmed, t]);

  const signCouncil = useCallback(async () => {
    if (!councilHandoff || councilUnconfirmed) return;
    setCouncilBusy(true);
    setCouncilError(null);
    let handedToPartner = false;
    try {
      handedToPartner = true;
      const { txHash } = await sendIntent({ tx: councilHandoff.xrplTx as never });
      // «Council created» is said only over a validated tesSUCCESS.
      await confirmOnLedger(txHash);
      setCouncilDone(txHash);
      setCouncilHandoff(null);
      refreshAfterSettlement();
    } catch (err) {
      applyXrplSignFailure(err, handedToPartner, t, {
        setError: (m) => setCouncilError(m || null),
        setUnconfirmed: setCouncilUnconfirmed,
        setPhase: () => {},
        clearPrepared: () => setCouncilHandoff(null),
      });
    } finally {
      setCouncilBusy(false);
    }
  }, [councilHandoff, councilUnconfirmed, sendIntent, refreshAfterSettlement, t]);

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

  // Feed the co-pilot — the Guía lives there now. Abstract
  // ledger flags only; cleared when the panel unmounts.
  useEffect(() => {
    setLegacyJourney(journey ?? null);
    return () => setLegacyJourney(null);
  }, [journey]);

  // ── Constitute = a slide deck: ONE step per
  //    slide, the guide agent pinned left, a clickable stations feed on top.
  //    wizStep auto-follows the ledger (first incomplete step) after each
  //    refresh; the stations let the user jump freely. ──
  const [wizStep, setWizStep] = useState(0);
  /** A deliberate jump into ONE station (e.g. "view the constitution" from the
   *  Govern identity strip) — parked in a ref so the auto-follow effect below
   *  honours it once instead of clobbering it with the first incomplete step.
   *  Same parked-intent idiom as surfaceIntent / govTabIntent. */
  const wizJump = useRef<number | null>(null);
  /** Dónde aterrizó la lectura del ledger (para el aviso de «retomado»). */
  const [landedAt, setLandedAt] = useState<number | null>(null);
  useEffect(() => {
    if (effectiveSurface !== 'constitute') return;
    if (wizJump.current !== null) {
      setWizStep(wizJump.current);
      wizJump.current = null;
      return;
    }
    // Walkthrough: the person drives the deck by hand — never auto-jump.
    if (walkthrough) return;
    if (!account) return void setWizStep(0);
    if (!councilLoaded) return;
    const target =
      !council
        ? 1
        : rehearsal?.rehearsalComplete !== true
          ? 2
          : council.masterKeyDisabled !== true
            ? 3
            : !anchor?.dataHex && !reinforce
              ? 4
              : 5;
    setWizStep(target);
    // La primera lectura real decide el aterrizaje; el aviso de «retomado»
    // (useResumeToast) sale una vez por cuenta con ese dato.
    setLandedAt(target);
    // reinforce salta la constitución: puerta cerrada = Hecho (la estación de
    // reglas sigue en el raíl como opcional, por si quiere anclarlas).
  }, [effectiveSurface, walkthrough, account, councilLoaded, council, rehearsal?.rehearsalComplete, anchor?.dataHex, reinforce]);

  // ── §6 — the wizard: real ledger state, never a local database (L1) ──
  const steps = useMemo(() => {
    const hasCouncil = !!council;
    const rehearsed = rehearsal?.rehearsalComplete === true;
    const doorClosed = council?.masterKeyDisabled === true;
    const anchored = !!anchor?.dataHex;
    const funded = escrows.length > 0 || (spendable !== null && spendable.balanceXrp >= 15);
    // REINFORCE:
    // la cuenta reforzada no necesita constitución — el quórum ya la protege.
    // La estación queda como OPCIONAL (se puede entrar desde el raíl) y el
    // final es «Hecho» en cuanto la puerta se cierra, no «Capital»: aquí no
    // se fondea ninguna vasija, la cuenta ya tenía su dinero.
    if (reinforce) {
      return [
        { label: t('Your keys'), done: hasCouncil },
        { label: t('Rehearsal'), done: rehearsed },
        { label: t('Door closed'), done: doorClosed },
        { label: t('Rules (optional)'), done: anchored || doorClosed },
        { label: t('Done'), done: doorClosed },
      ];
    }
    return [
      { label: t('Council'), done: hasCouncil },
      { label: t('Rehearsal'), done: rehearsed },
      { label: t('Door closed'), done: doorClosed },
      { label: t('Constitution'), done: anchored },
      { label: t('Capital'), done: funded && anchored },
    ];
  }, [council, rehearsal, anchor, escrows, spendable, reinforce, t]);

  // The Account station prepended — ONE array feeds the rail, the Prev/Next
  // labels and the aria positions, so the three can never disagree.
  const stations = useMemo(() => {
    const base = [{ label: t('Account'), done: !!account }, ...steps];
    // Walkthrough: the rail plays a first run — no checks beyond the pasted
    // account, whatever the ledger already holds.
    return walkthrough ? base.map((s, i) => (i === 0 ? s : { ...s, done: false })) : base;
  }, [account, steps, t, walkthrough]);
  // «¿Por qué está hecha?»: qué se leyó del ledger para cada estación
  // — sale al ENTRAR en una hecha (una vez), y el pie la reabre.
  const stationHow = useMemo(
    () => [
      t('the account you pasted or connected'),
      t('the SignerList of the account, read from the ledger'),
      t('the rehearsal signatures recorded for this account'),
      t('the master key flag of the account, read from the ledger'),
      t('the DID object of the account, read from the ledger'),
      t('the balance of the account, read from the ledger'),
    ],
    [t],
  );
  // «¿Por qué está hecha?» vive en la franja de la estación (StationDoneStrip);
  // el aterrizaje más allá de la primera estación se avisa UNA vez por cuenta,
  // en una notificación temporal. En el
  // walkthrough no hay aterrizaje del ledger, así que no hay aviso.
  useResumeToast({ landed: walkthrough ? null : landedAt, stations, key: account });
  const nextPendingIdx = stations.findIndex((s) => !s.done);

  // One line of orientation per station (immersion pass): what this
  // station is FOR and what it costs, always visible above the slide. Honest
  // effort estimates — time and devices, never money or outcomes.
  // REINFORCE runs the same six stations with a different cast: every key is
  // the SAME person's device, so "the members' addresses" and "their phones"
  // would be a plain lie about who is being asked for what.
  const stationMeta = useMemo(
    () =>
      reinforce
        ? [
            { purpose: t('The account you are reinforcing — it stays yours throughout.'), effort: t('~1 min') },
            { purpose: t('Your own keys, and how many must agree — created in Xaman.'), effort: t('~15 min · your devices') },
            { purpose: t('Each of your keys proves it can sign — before the door closes.'), effort: t('~5 min per device') },
            { purpose: t('The master key retires; only your quorum remains.'), effort: t('~2 min · your phone') },
            { purpose: t('Optional — anchor written rules on the ledger, or go straight to done.'), effort: t('~10 min · only if you want it') },
            { purpose: t('Nothing left to do — the account is reinforced.'), effort: t('~1 min') },
          ]
        : [
            { purpose: t('A fresh Xaman account becomes the vessel of the Legacy.'), effort: t('~10 min · your phone') },
            { purpose: t('Who signs, and how many must agree — created in Xaman.'), effort: t('~15 min · the members’ addresses') },
            { purpose: t('Every member proves they can sign — before any real capital.'), effort: t('~5 min per member · their phones') },
            { purpose: t('The master key retires; only the council remains.'), effort: t('~2 min · your phone') },
            { purpose: t('The rules, written in plain language and anchored on the ledger.'), effort: t('~10 min · here') },
            { purpose: t('Fund the vessel — the ceremony is complete.'), effort: t('~1 min') },
          ],
    [t, reinforce],
  );

  // Cada sala de Govern con su nombre y la PREGUNTA que responde. La frase se
  // pinta bajo las pestañas igual que el encabezado de estación en Constituir:
  // saber a qué has entrado es la mitad de no perderse.
  const govMeta: Record<GovTab, { label: string; purpose: string }> = useMemo(
    () => ({
      capital: { label: t('Capital'), purpose: t('What is inside and what it produces') },
      council: { label: t('Council'), purpose: t('Who commands, with which quorum') },
      orders: { label: t('Orders'), purpose: t('Compose what the quorum will sign') },
      proposals: { label: t('Inbox'), purpose: t('Sign what is already composed') },
      activity: { label: t('Activity'), purpose: t('What has happened, with its on-chain proof') },
    }),
    [t],
  );

  // The workspace is titled after the Legacy it holds (registry label, or the
  // local pointer's nickname): "which one am I in" beats the product name,
  // which the sidebar already shows.
  const legacyName = useMemo(() => {
    if (!account) return null;
    return legacies.find((l) => l.address === account)?.label || getLegacyNickname(account) || null;
  }, [account, legacies]);

  // Creating vs reading the council are DIFFERENT screens: creation is a stack of tutorial cards (CouncilInXaman owns
  // its own frames now); the single council Card below only reads the ledger.
  const councilCreation = !!account && councilLoaded && !council;
  // Walkthrough swaps the council station's creation/read split: station 1
  // always plays the creation tutorial (the read card keeps serving Govern
  // and the door slide). Ledger reads underneath stay untouched.
  const councilTriggers =
    (effectiveSurface === 'govern' && govTab === 'council') || wizStep === 1 || wizStep === 3;
  const showCouncilCreation = walkthrough
    ? effectiveSurface === 'constitute' && wizStep === 1 && !!account && councilLoaded
    : councilCreation && councilTriggers;
  const showCouncilCard = walkthrough
    ? councilTriggers && !(effectiveSurface === 'constitute' && wizStep === 1)
    : !councilCreation && councilTriggers;

  // The in-panel navigation key: one entry per station (Constitute) or tab
  // (Govern). SurfaceMotion keys on it, so every move is a small keyed scene
  // change — stations slide toward the direction of travel.
  const contentKey = effectiveSurface === 'constitute' ? `constitute-${wizStep}` : `govern-${govTab}`;
  const prevNavRef = useRef({ key: contentKey, step: wizStep });
  const slideDir: 1 | -1 | 0 =
    effectiveSurface === 'constitute' &&
    prevNavRef.current.key.startsWith('constitute-') &&
    wizStep !== prevNavRef.current.step
      ? wizStep > prevNavRef.current.step
        ? 1
        : -1
      : 0;
  useEffect(() => {
    prevNavRef.current = { key: contentKey, step: wizStep };
  });

  // ── Reserve preflight: the constitution ceremony is a SEQUENCE
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
    'mt-1 w-full rounded-lg border border-ink/10 bg-ink/5 px-3 py-2 text-sm text-ink caret-ink placeholder:text-ink/30 outline-none focus:border-ink/25';
  // Raw <button> segments (surface switcher, tabs, stations) get the same
  // visible focus ring the primitives already carry — keyboard users were
  // navigating them blind.
  const focusRing =
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0';

  // ── Interface B: the list is the entry point; a workspace opens one Legacy ──
  // LA LISTA MURIÓ COMO PANTALLA … Y RESUCITA COMO LA
  // CASA DEL LEGACY. Aterrizar en
  // /app/legacy sin destino ya no devuelve a Wallets: pinta MyLegaciesList —
  // los Legacies constituidos como tarjetas, «Constituir un nuevo Legacy», y
  // el estado vacío que lleva al asistente. Los deep-links con params siguen
  // abriendo el taller directamente, como siempre; BackToWallets queda sin
  // montar por si la decisión vuelve a girar.
  if (view === 'list') {
    return (
      // The door gets the sign, not a blocking dialog:
      // arriving here locks up nothing, and an acknowledgement spent at the
      // moment of zero risk is one nobody reads at the moment of real risk.
      // The blocking one fires where capital turns one-way — see
      // CageDisclosureModal.
      <div className="space-y-4">
        <LegacyBetaBanner />
        <MyLegaciesList
          onSelect={(a, chosen, tab) => {
            // The door chosen on the card IS the surface — carried both directly
            // (same-account reopen) and via the ref (the account-change effect).
            surfaceIntent.current = chosen;
            setSurface(chosen);
            setAccountInput(a);
            // A card can open straight into one section (the Movements door).
            // Two paths, because the reset effect below keys on `account`: a
            // DIFFERENT Legacy fires it, so the intent rides the ref; the SAME
            // Legacy reopened does not fire it at all (going back to the list
            // leaves `account` set), so apply it here or the door does nothing.
            if (a === account) {
              setGovTab('capital');
              setMovementsOpen(tab === 'movements');
            } else {
              govTabIntent.current = tab ?? null;
            }
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
      </div>
    );
  }

  // EL RAÍL DE ESTACIONES («pon la del Legacy igual a las demás»): la
  // MISMA pieza que el alta del gestor y la del exchange — raíl lateral si la
  // caja es ancha (la página), tira encima si es estrecha (la ventana).
  const constituteRail =
    effectiveSurface === 'constitute' ? (
      <StationProgress
        stations={stations.map((s) => ({ label: s.label, done: s.done }))}
        current={wizStep}
        onSelect={setWizStep}
        ariaLabel={t('Constitution stations')}
        doneWord={t('done')}
        onBack={() => setWizStep((s) => Math.max(0, s - 1))}
        onNext={() => setWizStep((s) => Math.min(stations.length - 1, s + 1))}
      />
    ) : null;

  return (
    // A ceremonial, single-column surface: constrained to a document-like
    // measure so ultra-wide screens don't stretch the cards into empty space.
    // As an OPERATION (opEmbed) the host owns width, header and chrome — the
    // panel is only the ceremony, tightened one notch.
    <div className={opEmbed ? 'space-y-4' : 'max-w-5xl space-y-5'}>
      {/* Operation mode keeps just the one thing the chrome carried that the
          host cannot know: the emergency flag. */}
      {opEmbed && account && health?.mustReplaceSigner && (
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="danger">{t('Emergency')}</Pill>
          <span className="text-sm text-tone-danger">{t('Replace the fallen signer before anything else.')}</span>
        </div>
      )}
      {/* Chrome: back to the list on the left; the surface switcher on the
          right (returned — the card doors still choose the surface
          on entry, but changing your mind no longer means walking back to the
          list). The emergency flag outranks everything else on the row. */}
      {!opEmbed && (
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Volver deja el taller y vuelve a la casa del Legacy (la lista),
            sin params en la URL para que una recarga no reabra el taller. */}
        <GhostButton
          onClick={() => {
            if (embed) return embed.onExit();
            router.replace('/app/legacy');
            setView('list');
          }}
        >
          ← {t('Legacy')}
        </GhostButton>
        <div className="flex flex-wrap items-center gap-3">
          {account && health?.mustReplaceSigner && (
            <div className="flex flex-col items-start gap-1">
              <Pill tone="danger">{t('Emergency')}</Pill>
              <span className="text-sm text-tone-danger">{t('Replace the fallen signer before anything else.')}</span>
            </div>
          )}
          <div
            role="group"
            aria-label={t('Legacy surface')}
            className="inline-flex rounded-xl border border-ink/10 bg-ink/[0.02] p-1"
          >
            <span className="sr-only" aria-live="polite">
              {effectiveSurface === 'govern' ? t('Govern') : t('Constitute')}
            </span>
            <button
              type="button"
              onClick={() => setSurface('constitute')}
              aria-pressed={effectiveSurface === 'constitute'}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] transition ${focusRing} ${
                effectiveSurface === 'constitute' ? 'bg-ink/10 text-ink' : 'text-ink/50 hover:text-ink/80'
              }`}
            >
              <ScrollText size={13} /> {t('Constitute')}
            </button>
            <button
              type="button"
              onClick={() => setSurface('govern')}
              disabled={!account}
              aria-pressed={effectiveSurface === 'govern'}
              title={!account ? t('Open or constitute a Legacy first') : undefined}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] transition disabled:cursor-not-allowed disabled:opacity-40 ${focusRing} ${
                effectiveSurface === 'govern' ? 'bg-ink/10 text-ink' : 'text-ink/50 hover:text-ink/80'
              }`}
            >
              <Landmark size={13} /> {t('Govern')}
            </button>
          </div>
        </div>
      </div>
      )}
      {!opEmbed && <LegacyBetaBanner account={account ?? undefined} />}
      {/* REINFORCE says its own name: the ceremony is shared, the thing being
          born is not. A reinforced account stays a PERSONAL wallet — no
          council of other people, no cage on Flare — so the Legacy headline
          would be a plain misdescription of what the person is signing. */}
      {!opEmbed && (
      <PageHeader
        title={
          reinforce
            ? (legacyName ?? t('Reinforce this account'))
            : (legacyName ?? (account ? t('Legacy') : t('New Legacy')))
        }
        subtitle={
          reinforce
            ? t(
                'Your own XRPL account, governed by a quorum of your own keys: no single key — lost, stolen or coerced — moves anything on its own. It stays a personal wallet, nothing is caged, and every signature is yours in Xaman.',
              )
            : t(
                'Capital under rules that outlive their author: the rules and the authority live on XRPL; the capital produces on Flare inside a cage of code. A programmed, conditioned, revocable transfer — not a promise.',
              )
        }
      />
      )}

      {/* ── Govern's four sections. Information
          holds the Guía; the tabs distribute the rest so nothing overwhelms. ── */}
      {/* The tab bar is only as wide as its four tabs: a
          full-width bar left a long empty gutter. w-fit hugs the content;
          max-w-full + flex-wrap still lets it wrap on a narrow viewport. */}
      {effectiveSurface === 'govern' && account && (
        <div
          role="tablist"
          aria-label={t('Govern sections')}
          className="inline-flex w-fit max-w-full flex-wrap gap-1 rounded-xl border border-ink/10 bg-ink/[0.02] p-1"
          onKeyDown={(e) => {
            const order = GOV_TABS;
            const i = order.indexOf(govTab);
            const next =
              e.key === 'ArrowRight'
                ? order[(i + 1) % order.length]
                : e.key === 'ArrowLeft'
                  ? order[(i + order.length - 1) % order.length]
                  : e.key === 'Home'
                    ? order[0]
                    : e.key === 'End'
                      ? order[order.length - 1]
                      : null;
            if (!next) return;
            e.preventDefault();
            setGovTab(next);
            document.getElementById(`legacy-tab-${next}`)?.focus();
          }}
        >
          {GOV_TABS.map((id) => (
            <button
              key={id}
              id={`legacy-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={govTab === id}
              tabIndex={govTab === id ? 0 : -1}
              onClick={() => setGovTab(id)}
              className={`rounded-lg px-3 py-1.5 text-[13px] transition ${focusRing} ${
                govTab === id ? 'bg-ink/10 text-ink' : 'text-ink/50 hover:text-ink/80'
              }`}
            >
              {govMeta[id].label}
            </button>
          ))}
        </div>
      )}


      {/* The Guía's embedded column is GONE: the ceremony
          owns the full width, and the co-pilot carries the Guía. Keyed by the
          in-panel navigation so each station/tab change breathes in. */}
      <StationRailLayout rail={constituteRail}>
      <SurfaceMotion key={contentKey} dir={slideDir}>
      {/* The station header — where you are, what for, what it costs. One
          fixed line the whole ceremony can be navigated by. */}
      {effectiveSurface === 'constitute' && (
        <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[15px] font-semibold tracking-tight text-ink">{stations[wizStep]?.label}</span>
          <span className="text-[12px] text-ink/45">{stationMeta[wizStep]?.purpose}</span>
          <span className="ml-auto rounded-full border border-ink/10 bg-ink/[0.03] px-2 py-0.5 text-[10px] text-ink/40">
            {stationMeta[wizStep]?.effort}
          </span>
        </div>
      )}
      {/* La franja de la estación: hecha (y por qué cuenta) o pendiente (qué
          se mira). En el walkthrough no hay ledger que leer. */}
      {effectiveSurface === 'constitute' && !walkthrough && (
        <div className="mb-4">
          <StationDoneStrip
            done={Boolean(stations[wizStep]?.done)}
            how={stationHow[wizStep] ?? ''}
            nextPendingLabel={nextPendingIdx >= 0 && nextPendingIdx !== wizStep ? stations[nextPendingIdx].label : undefined}
            onNextPending={nextPendingIdx >= 0 && nextPendingIdx !== wizStep ? () => setWizStep(nextPendingIdx) : undefined}
          />
        </div>
      )}
      {/* La cabecera de la sala: dónde estás y qué se responde aquí — el
          gemelo del encabezado de estación de Constituir. */}
      {effectiveSurface === 'govern' && account && (
        <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[15px] font-semibold tracking-tight text-ink">{govMeta[govTab].label}</span>
          <span className="text-[12px] text-ink/45">{govMeta[govTab].purpose}</span>
        </div>
      )}
      {/* El truco de CSS `order` MURIÓ con el reparto en cinco salas: dentro de cada pestaña quedan uno o dos
          bloques y el orden del DOM ya es el correcto — la identidad primero,
          después su contenido. Menos maquinaria y el mismo resultado. */}
      <RevealGroup className="space-y-5">
        {/* ── La tira de identidad: qué cuenta estás gobernando. Va en TODAS
            las salas — es la orientación, no contenido de una pestaña (las
            cuentas se cambian desde «Mis Legacies», no aquí). ── */}
        {effectiveSurface === 'govern' && account && (
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
              {/* The one ledger fact Govern had no surface for: the anchored
                  constitution. State at a glance; the link jumps straight to
                  its station (the text + hash live there). */}
              {councilLoaded &&
                (anchor?.dataHex ? (
                  <Pill tone="success">{t('constitution anchored')}</Pill>
                ) : (
                  <Pill tone="neutral">{t('no constitution anchored yet')}</Pill>
                ))}
              <button
                type="button"
                onClick={() => {
                  wizJump.current = 4;
                  setSurface('constitute');
                }}
                aria-label={t('View the constitution')}
                className={`flex items-center gap-1 rounded-md text-[12px] text-ink/45 underline-offset-2 transition hover:text-ink/80 hover:underline ${focusRing}`}
              >
                <ScrollText size={12} /> {t('Constitution')} →
              </button>
              <span className="ml-auto">
                <GhostButton onClick={() => void refresh()} disabled={loading} aria-label={t('Refresh')}>
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
        {/* First contact with the ceremony (immersion pass): before
            any form, say what this IS, that it is resumable, and that nothing
            irreversible happens until the gated door step. Comfort first. */}
        {effectiveSurface === 'constitute' && wizStep === 0 && !account && (
          <RevealItem>
            <Card className="p-5 space-y-2">
              <div className="flex items-center gap-2">
                <ListChecks size={16} className="text-ink/50" />
                <SectionTitle>{t('The ceremony')}</SectionTitle>
              </div>
              <p className="text-[13px] leading-relaxed text-ink/65">
                {t(
                  'Six stations, one irreversible moment — closing the door — and even that one is gated behind a rehearsal. You can leave at any station and come back: everything lives on the ledger, so the ceremony resumes exactly where reality is.',
                )}
              </p>
              <p className="text-[12px] leading-relaxed text-ink/50">
                {t(
                  'What you need: your phone with Xaman, the members’ addresses (r…), and about 15 XRP on the new account. The guide in the sidebar knows every station — ask it anything.',
                )}
              </p>
            </Card>
          </RevealItem>
        )}

        {(effectiveSurface === 'constitute' ? wizStep === 0 : !account) && (
        <RevealItem>
          <Card spotlight padded={false} className="group isolate relative overflow-hidden p-5 md:p-6 lg:pr-56 space-y-4">
            {/* permanence — the account enthroned under its north star. The
                content reserves the right zone (lg:pr-56) so the scene owns it. */}
            {/* El panteón del producto, dibujándose.
            { */}
            <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 hidden lg:block opacity-[0.55] group-hover:opacity-90 transition-opacity duration-700" style={{ zIndex: -1 }} aria-hidden>
              {/* REINFORCE viste otra cara: aquí no nace
                  un Legacy — la cuenta sigue siendo tuya. El faro personal en
                  lugar del templo, para que no parezca lo mismo. */}
              {engraved
                ? reinforce ? <SignetMark size={160} /> : <ColonnadeMark size={170} />
                : reinforce ? <SignalBeacon width={200} height={160} /> : <PantheonScene size={170} />}
            </div>
            <SectionTitle>{reinforce ? t('Your account') : t('Legacy account')}</SectionTitle>
            {/* The missing first truth: the vessel must EXIST before this
                input. Create it in Xaman (a NEW account — its master key dies
                at the end of the ceremony), fund it, paste it. */}
            {effectiveSurface === 'constitute' && (
              <StationBrief
                title={t('Before you start')}
                items={[
                  <>
                    {t(
                      'Create a NEW account in the Xaman wallet on your phone — new, with no history: the ceremony ends with this account’s master key disabled, so never use your everyday account.',
                    )}{' '}
                    <a
                      href={XAMAN_APP}
                      target="_blank"
                      rel="noreferrer"
                      className="text-ink/70 underline underline-offset-2 hover:text-ink"
                    >
                      xaman.app
                    </a>
                  </>,
                  t(
                    'Fund it with a little XRP — about 15 XRP covers the ledger reserves and the ceremony fees. The exact figure is checked here once the account is open.',
                  ),
                  t(
                    'Paste its r… address below: that account becomes the Legacy — the main account the council will govern. Astryum reads it from the ledger and never touches its keys.',
                  ),
                ]}
              />
            )}
            {/* First-wallet comfort (immersion pass): the person who
                has never held a wallet gets the 60-second version, folded so it
                never burdens the person who has. */}
            {effectiveSurface === 'constitute' && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setVesselHelpOpen((v) => !v)}
                  aria-expanded={vesselHelpOpen}
                  className={`flex items-center gap-1.5 rounded-md text-[12px] text-ink/40 transition-colors hover:text-ink/70 ${focusRing}`}
                >
                  <ChevronDown size={13} className={vesselHelpOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
                  {t('Never created a Xaman account? The 60-second version')}
                </button>
                {vesselHelpOpen && (
                  <ol className="space-y-1.5 rounded-xl border border-ink/10 bg-ink/[0.02] p-3 text-[12px] leading-relaxed text-ink/60">
                    <li>1 · {t('Install Xaman from the App Store or Play Store and open it.')}</li>
                    <li>2 · {t('Add account → create a NEW account. Xaman shows you the secret numbers — write them on paper, in order. They ARE the account; whoever holds them holds it.')}</li>
                    <li>3 · {t('Confirm the numbers when Xaman asks. The new r… address appears at the top of the home screen — that is the vessel.')}</li>
                    <li>4 · {t('Tap the address to copy it, send it to yourself, and paste it below.')}</li>
                  </ol>
                )}
              </div>
            )}
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
                  // A NEW Legacy is born already named — an example, never left as
                  // an address. A nickname the user already set is untouched.
                  if (!getLegacyNickname(a)) setLegacyNickname(a, t('My Legacy'));
                  // Pasting an address INSIDE the constitute surface means
                  // staying in it (fix): without this intent, the
                  // account-change effect reset the surface to auto-follow and
                  // a constituted account expelled the user straight to Govern
                  // — "it resumes at the end".
                  surfaceIntent.current = 'constitute';
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

            {/* The stations rail moved UP to the slide-deck feed.
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

        {/* Step 2's payoff, and it must not be missable: the council was created
            in the Xaman xApp, so the only honest confirmation is the ledger
            compared against the plan the family wrote here — and creating it
            auto-advances the deck off the Council slide. So it rides above the
            slide, wherever the wizard lands, until the person confirms it. A
            council off by one signer or one quorum unit looks perfectly healthy
            on screen; the mismatch surfaces years later, to whoever needed it. */}
        {effectiveSurface === 'constitute' && account && council && (walkthrough ? wizStep >= 2 : true) && (
          <RevealItem>
            <CouncilPlanCheck account={account} council={council} />
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

        {/* ── 1a. Creating the council — its own stack of cards: the illustrated Xaman tutorial is the protagonist,
            each block in its own frame, the plan form optional and folded. ── */}
        {showCouncilCreation && (
            <RevealItem>
              <CouncilInXaman
                account={account}
                signers={councilSigners}
                setSigners={setCouncilSigners}
                quorum={councilQuorum}
                setQuorum={setCouncilQuorum}
                reservePlan={reservePlan}
                balanceXrp={spendable?.balanceXrp ?? null}
                loading={loading}
                onRefresh={() => void refresh()}
                onPrepareUnsigned={() => void prepareCouncil()}
                unsignedBusy={councilBusy}
                unsignedError={councilError}
                unsignedSlot={
                  councilUnconfirmed ? (
                    <UnconfirmedSignatureNotice
                      rail="xrpl"
                      xrplKind="transaction"
                      unconfirmed={councilUnconfirmed}
                      onClose={() => {
                        setCouncilUnconfirmed(null);
                        setCouncilHandoff(null);
                        refreshAfterSettlement();
                      }}
                    />
                  ) : councilHandoff ? (
                    <div className="space-y-3">
                      <DisclosureBlock handoff={councilHandoff} />
                      <HandoffActions
                        handoff={councilHandoff}
                        /* The Xaman route stays wired but demoted: it answers
                           1217 today, so it must not be the obvious button —
                           and it must not disappear either, because the
                           permission is granted per app and may arrive. */
                        canSignDirect={canSignDirect}
                        manualOnly
                        busy={councilBusy}
                        onSign={() => void signCouncil()}
                        onDismiss={() => setCouncilHandoff(null)}
                      />
                    </div>
                  ) : councilDone ? (
                    <InlineNotice tone="success" icon={null}>
                      {t('Council created — refresh to read it from the ledger.')}{' '}
                      <a href={`${XRPSCAN_TX}${councilDone}`} target="_blank" rel="noreferrer" className="underline">
                        {t('View on XRPScan')}
                      </a>
                    </InlineNotice>
                  ) : null
                }
              />
            </RevealItem>
          )}

        {/* ── 1b. The council read from the ledger (slides 1 and 3 — the door
            lives on slide 3); creation moved to its own stack above. ── */}
        {showCouncilCard && (
        <RevealItem>
          <Card spotlight padded={false} className="group isolate relative overflow-hidden p-5 md:p-6 lg:pr-56 space-y-4">
            {/* signer-stars standing guard over the account-sun; hovering draws
                the quorum arc through the required members */}
            <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 hidden lg:block opacity-[0.32] group-hover:opacity-60 transition-opacity duration-700" style={{ zIndex: -1 }} aria-hidden>
              {/* En reinforce no hay consejo de miembros: son TUS firmas —
                  la escena de la rúbrica en vez de las estrellas del consejo. */}
              {reinforce
                ? <SignatureScene width={200} height={140} />
                : engraved ? <SignetMark size={160} /> : <CouncilScene width={200} height={160} />}
            </div>
            <div className="flex items-center gap-2">
              <Users size={16} className="text-ink/50" />
              <SectionTitle>{t('The council')}</SectionTitle>
            </div>
            {/* The council-creation brief left with the creation state (card
                stack 1a) — its intro card carries the three moves now. */}
            {effectiveSurface === 'constitute' && wizStep === 3 && (
              <StationBrief
                title={t('What you do here')}
                items={[
                  t(
                    'Wait for the rehearsal: closing the door before every member has proven they can sign risks locking this account forever.',
                  ),
                  t(
                    'The account’s OWN master key signs this one — the ledger refuses the quorum for it. Scan the QR with the Xaman that holds the Legacy account.',
                  ),
                  t(
                    'After it validates there is no shortcut left: only the council governs this account. That is the point.',
                  ),
                ]}
              />
            )}
            {!account || !councilLoaded ? (
              <p className="text-sm text-ink/45">{t('Inspect an account to read its council from the ledger.')}</p>
            ) : council && !amendOpen ? (
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
                  {/* §1 — the master pill changes meaning with the rehearsal state.
                      Walkthrough narrates the pre-door beat, so it holds the
                      "active" reading; the ledger truth is one refresh away. */}
                  {council.masterKeyDisabled && !walkthrough ? (
                    <Pill tone="success">{t('master key disabled')}</Pill>
                  ) : rehearsal?.rehearsalComplete ? (
                    <Pill tone="warning">{t('master key active')}</Pill>
                  ) : (
                    <Pill tone="info">{t('master key active')}</Pill>
                  )}
                </div>
                <p className="text-sm text-ink/60">
                  {council.masterKeyDisabled && !walkthrough
                    ? t('Quorum-only governance.')
                    : rehearsal?.rehearsalComplete
                      ? t('The rehearsal passed — time to close the door.')
                      : t('Correct for now: it is your safety net until the rehearsal passes.')}
                </p>
                {/* The other half of step 2 (the Constitute copy of this banner
                    rides above the slide deck instead — see below — because
                    creating the council auto-advances the wizard off this
                    slide, and the confirmation is the payoff of the step). */}
                {effectiveSurface === 'govern' && account && (
                  <CouncilPlanCheck account={account} council={council} />
                )}
                {rehearsal && rehearsal.quorumMargin === 0 && (
                  <div className="space-y-2 rounded-lg border border-red-500/30 bg-red-500/[0.07] p-2.5">
                    <p className="flex items-start gap-2 text-[13px] text-tone-danger">
                      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                      {t(
                        'You are at the EXACT quorum. One more lost key and this account is locked forever. Replace the missing signer BEFORE any other operation.',
                      )}
                    </p>
                    {/* §1.2: the emergency now HAS a path — the same amendment
                        form, seeded with the current council. */}
                    <GhostButton onClick={openAmend}>
                      <Users size={14} /> {t('Replace a signer')}
                    </GhostButton>
                  </div>
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

                {/* The ceremony carries you forward (immersion):
                    every completed station offers the next one where the
                    success lands — the rail stays for jumping around. */}
                {effectiveSurface === 'constitute' && wizStep === 1 && (
                  <div className="pt-1">
                    <PrimaryButton onClick={() => setWizStep(2)}>
                      {t('Continue: the rehearsal')} →
                    </PrimaryButton>
                  </div>
                )}

                {/* §1.2: rotation — the amendment path, always
                    offered. One SignerListSet with the full NEW list, signed by
                    the CURRENT quorum via the same coordinator as every order. */}
                {effectiveSurface === 'govern' && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <GhostButton onClick={openAmend}>
                      <Users size={14} /> {t('Replace a signer / amend the council')}
                    </GhostButton>
                    <span className="text-[11px] text-ink/40">
                      {t('One SignerListSet with the full NEW list, signed by the CURRENT quorum.')}
                    </span>
                  </div>
                )}

                {/* §1 — closing the door: gated behind the verified rehearsal.
                    In the slide deck it is ITS OWN slide (3). */}
                {(!council.masterKeyDisabled || walkthrough) && (effectiveSurface === 'govern' || wizStep === 3) && (
                  <div className="rounded-xl border border-ink/10 bg-ink/[0.03] p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <KeyRound size={14} className="text-ink/50" />
                      <MicroLabel>{t('Closing the door (disable the master key)')}</MicroLabel>
                    </div>
                    {!(health?.canCloseDoor || walkthrough) ? (
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
            ) : !council ? null /* creation renders as its own card stack (1a) */ : (
              /* ── Amending an existing council: the CURRENT quorum signs the
                   new list, through the same coordinator as every order. ── */
              <div className="space-y-3">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <MicroLabel>{t('Amend the council (replace a signer)')}</MicroLabel>
                    <GhostButton
                      onClick={() => {
                        setAmendOpen(false);
                        setCouncilHandoff(null);
                        setCouncilError(null);
                      }}
                    >
                      {t('Cancel')}
                    </GhostButton>
                  </div>
                  <p className="text-[12px] text-ink/55">
                    {t(
                      'The form starts from the CURRENT council. Edit only what changes — the new list REPLACES the old one entirely, and the CURRENT quorum signs the amendment. The new council governs from the next transaction on.',
                    )}
                  </p>
                  {/* The same Xaman gate as step 2, said out loud where it bites:
                      a rotation is a SignerListSet too, so the QR rail here will
                      be refused (1217) until Xaman grants the permission. The
                      capability is NOT lost — the xApp is the path, and it is
                      the one this council already used in July. */}
                  <InlineNotice tone="warning">
                    {t(
                      'Xaman refuses to show a QR for this transaction type when an app composes it (error 1217), so the signature rail below may not work today. What does work: the members sign it in the Xaman Multisign xApp, or paste their signed blob into the proposal inbox. The council can always be amended — the route through this screen is what is blocked.',
                    )}
                  </InlineNotice>
                </div>
                {councilUnconfirmed ? (
                  <UnconfirmedSignatureNotice
                    rail="xrpl"
                    xrplKind="transaction"
                    unconfirmed={councilUnconfirmed}
                    onClose={() => {
                      setCouncilUnconfirmed(null);
                      setCouncilHandoff(null);
                      refreshAfterSettlement();
                    }}
                  />
                ) : !councilHandoff ? (
                  <div className="space-y-2">
                    <SignerListRows
                      signers={councilSigners}
                      setSigners={setCouncilSigners}
                      quorum={councilQuorum}
                      setQuorum={setCouncilQuorum}
                    />
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
                      onSettled={() => {
                        setAmendOpen(false);
                        refreshAfterSettlement();
                      }}
                    />
                    <p className="text-[11px] text-ink/40">
                      {t(
                        'After it validates, anchor a new constitution version (DIDSet) so the amendment is written in the family record too.',
                      )}
                    </p>
                  </div>
                )}
                {councilError && <InlineNotice tone="warning">{councilError}</InlineNotice>}
                {councilDone && (
                  <InlineNotice tone="success" icon={null}>
                    {t('Council amended — the new signer list replaces the old one on the ledger.')}{' '}
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

        {/* The embedded Guía card left this spot too: the
            co-pilot in the sidebar IS the Guía now, fed by setLegacyJourney. */}

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
              <StationBrief
                title={t('What you do here')}
                items={[
                  t('Prepare the rehearsal below: 1 XRP, from this account to itself, delivered tomorrow, recoverable in a week.'),
                  t('Every member signs it ALONE, from their own phone — helping someone proves that YOU can sign, not that they can.'),
                  t('Astryum verifies each signature on the ledger in the list below. No real capital enters before this is green.'),
                ]}
              />
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

              {rehearsal.rehearsalComplete && (
                <div>
                  <PrimaryButton onClick={() => setWizStep(3)}>
                    {t('Continue: close the door')} →
                  </PrimaryButton>
                </div>
              )}

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

        {/* MoneyFlows and Movements no longer have tabs here. MoneyFlows moved to Earn → My strategies, where the
            personal rules already lived; Movements became a modal reachable
            from the Legacy card and from each wallet in the Wallets tab. Both
            components are untouched and still the only rail for a council —
            they are simply reached from where a person looks for them. */}

        {/* ── Wallets: the SAME wallet manager as Astryum Personal (cards +
            per-wallet functionality), scoped to THIS Legacy — its council
            account and the Flare Smart Account it controls. A Legacy's wallets
            live here, not in Personal. Read-only handoff:
            Astryum never signs for either leg. ── */}
        {/* La jaula, PRIMERO — es donde vive el grueso del capital del consejo.
            Vivía solo en la cadena: la familia fondeó y la app no lo enseñaba
            en ningún inventario. Va junto a las wallets
            porque es patrimonio, pero con su naturaleza dicha: de aquí no se
            saca. */}
        {/* La pestaña Wallets MURIÓ: las cuentas de este
            Legacy viven en /app/wallets como todas las demás — el WalletManager
            embebido que vivía aquí era la segunda copia que confundía. */}

        {/* ── Activity: the interactive feed — everything signed on XRPL/Flare
            and everything still running, each entry openable to its on-chain
            proof and the actions it still allows (renew a rule near its 90 days,
            withdraw or go sign a live proposal, read a council order's FDC leg).
            It lost its own tab and sits in the hub instead: this is
            GOVERNANCE history — FDC legs, council orders, proposals — which is a
            different record from Portfolio's generic per-wallet activity, so it
            is redistributed rather than dropped. */}
        {/* ── Yield — the ONLY value that ever leaves the cage. harvest() and
            claim() have been live on-chain all along with no surface at all:
            nobody could see what they were owed and an heir had no way to ask
            for it. The principal is not on this panel and cannot be. ── */}
        {/* ── SALA «CAPITAL»: qué hay dentro y qué produce. Dos bloques, y el
            capital es el primero — era el dato que no estaba en ninguna
            pantalla de la app pese a existir en la cadena. ── */}
        {/* EL XRP DE LA PROPIA CUENTA. La jaula de
            Flare es solo la mitad del patrimonio: la otra vive en la cuenta
            XRPL y hasta hoy no se veía en ninguna pantalla de Govern. Se lee de
            `spendable`, que el panel ya carga para los escrows; si esa lectura
            falló se dice, nunca se pinta un cero que no se sabe. */}
        {effectiveSurface === 'govern' && account && govTab === 'capital' && (
          <RevealItem>
            <Card className="p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="flex items-center gap-1.5 text-[15px] font-semibold text-ink">
                  <Landmark size={15} className="text-[var(--authority-solid)]" />
                  {t('On the account (XRPL)')}
                </p>
                {spendable ? (
                  <span className="font-mono text-[15px] tabular-nums text-ink">
                    {spendable.balanceXrp.toLocaleString(undefined, { maximumFractionDigits: 6 })} XRP
                  </span>
                ) : null}
              </div>
              {spendable ? (
                <p className="mt-1.5 max-w-[62ch] text-[12.5px] leading-relaxed text-ink/55">
                  {`${t('Spendable after the ledger reserves:')} ${Math.max(0, spendable.spendableXrp).toLocaleString(undefined, { maximumFractionDigits: 6 })} XRP. ${t('Moving it takes an order and the quorum.')}`}
                </p>
              ) : (
                <p className="mt-1.5 max-w-[62ch] text-[12.5px] leading-relaxed text-tone-warning/80">
                  {t('The account balance could not be read right now — that is not the same as it being zero.')}
                </p>
              )}
            </Card>
          </RevealItem>
        )}

        {effectiveSurface === 'govern' && account && govTab === 'capital' && (
          <RevealItem>
            <LegacyVaultCard account={account} />
          </RevealItem>
        )}

        {effectiveSurface === 'govern' && account && govTab === 'capital' && (
          <RevealItem>
            <LegacyYieldPanel account={account} onGoToProposals={() => setGovTab('proposals')} />
          </RevealItem>
        )}

        {/* ── SALA «ACTIVIDAD»: qué ha pasado, cada entrada abrible a su
            prueba on-chain. Sola en su pestaña — es un registro largo. ── */}
        {effectiveSurface === 'govern' && account && govTab === 'activity' && (
          <RevealItem>
            <LegacyActivityFeed account={account} onGoToProposals={() => setGovTab('proposals')} />
          </RevealItem>
        )}

        {/* ── SALA «ÓRDENES»: COMPONER — transferencia programada y orden de
            consejo a la jaula. Firmar es la sala siguiente. ── */}
        {effectiveSurface === 'govern' && govTab === 'orders' && (
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
            {transferUnconfirmed ? (
              <UnconfirmedSignatureNotice
                rail="xrpl"
                xrplKind="transaction"
                unconfirmed={transferUnconfirmed}
                onClose={() => {
                  setTransferUnconfirmed(null);
                  setHandoff(null);
                  refreshAfterSettlement();
                }}
              />
            ) : !handoff ? (
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
            {escrowsUnreadable && (
              <div className="flex flex-wrap items-center gap-2">
                <InlineNotice tone="warning">
                  {t('Could not read this account’s commitments right now — the list may be missing some, including any you can Recover. That is not the same as having none.')}
                </InlineNotice>
                <GhostButton onClick={() => void refresh()} disabled={loading}>
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  {t('Retry')}
                </GhostButton>
              </div>
            )}
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

        {/* ── 3. The constitution (slide 4) — Constitute only now: this artifact lives in the Constitution
            surface; Governance no longer renders it. ── */}
        {effectiveSurface === 'constitute' && wizStep === 4 && (
        <RevealItem>
          <Card spotlight padded={false} className="group isolate relative overflow-hidden p-5 md:p-6 lg:pr-56 space-y-4">
            {/* the ruled document with its SHA seal; hovering draws the
                amendment chain through its anchor-stars */}
            <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 hidden lg:block opacity-[0.32] group-hover:opacity-60 transition-opacity duration-700" style={{ zIndex: -1 }} aria-hidden>
              {engraved ? <RegisterMark size={150} /> : <LedgerScrollScene width={190} height={150} />}
            </div>
            <div className="flex items-center gap-2">
              <ScrollText size={16} className="text-ink/50" />
              <SectionTitle>{reinforce ? t('Rules (optional)') : t('The constitution')}</SectionTitle>
            </div>
            {reinforce && (
              <InlineNotice tone="success" icon={null}>
                {t('Optional for a reinforced account — your quorum already protects it. Anchor rules only if you want them written on the ledger.')}
              </InlineNotice>
            )}
            {effectiveSurface === 'constitute' && (
              <StationBrief
                title={t('What you do here')}
                items={[
                  t('Write the constitution from a template — plain human language, filled with your names and rules. The text never leaves your browser.'),
                  t('Anchor its SHA-256 on the ledger: the council signs a DIDSet on the account’s own DID. Anyone can verify the text against the fingerprint.'),
                  t('Keep the document itself with the family — the ledger holds the fingerprint, you hold the text. Amendments are new anchors signed by the quorum.'),
                ]}
              />
            )}
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

            {!!anchor?.dataHex && (
              <div>
                <PrimaryButton onClick={() => setWizStep(5)}>
                  {t('Continue: the capital')} →
                </PrimaryButton>
              </div>
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

            {anchorUnconfirmed ? (
              <UnconfirmedSignatureNotice
                rail="xrpl"
                xrplKind="transaction"
                unconfirmed={anchorUnconfirmed}
                onClose={() => {
                  setAnchorUnconfirmed(null);
                  setAnchorHandoff(null);
                  refreshAfterSettlement();
                }}
              />
            ) : !anchorHandoff ? (
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
                <SectionTitle>{reinforce ? t('Done') : t('The capital')}</SectionTitle>
                {constituted && <Pill tone="success">{reinforce ? t('reinforced') : t('constituted')}</Pill>}
              </div>
              {/* A reinforced account has no second layer and no cage: saying
                  it does here would promise a machine that does not exist for
                  this account. It ends where it began — a personal wallet. */}
              <p className="text-[12px] text-ink/55">
                {reinforce
                  ? t(
                      'This account is reinforced: your quorum governs it, every key has proved it can sign, and the master key is retired. Nothing was locked away and nothing moved — you go on using it exactly as before, except that no single key can move anything alone.',
                    )
                  : t(
                      'Your Legacy is constituted: the council governs, the rehearsal is proven, the door is closed and the constitution is anchored. From here the capital works in two layers: XRP on this account (the native reserve, protected by the quorum), and productive capital on Flare inside the cage of code — governed from XRPL through council orders.',
                    )}
              </p>
              {reinforce ? (
                <StationBrief
                  title={t('What to keep in mind')}
                  items={[
                    t('Every payment now needs your quorum — signed in Xaman, from the devices you registered.'),
                    t('If you lose a device, replace it before anything else: at exact quorum, one more loss locks the account for ever.'),
                  ]}
                />
              ) : (
                <StationBrief
                  title={t('What you do here')}
                  items={[
                    t('Fund the account: a normal XRP payment to this address (the quorum is not needed to receive).'),
                    t('Programmed transfers, council orders to the Flare cage, and the vault mirror live in Govern.'),
                  ]}
                />
              )}
              <PrimaryButton
                onClick={() => {
                  if (reinforce) {
                    if (embed) embed.onExit();
                    else router.push('/app/wallets');
                  } else if (opEmbed && embed) {
                    // Operación cumplida: el popup se cierra y Govern se abre
                    // donde vive — la página del taller, no un panel estrecho.
                    embed.onExit();
                    router.push(account ? `/app/legacy?govern=${encodeURIComponent(account)}` : '/app/legacy');
                  } else {
                    setSurface('govern');
                  }
                }}
              >
                {reinforce ? t('Back to my wallets') : t('Go to Govern')} →
              </PrimaryButton>
            </Card>
          </RevealItem>
        )}

        {/* ── Slide navigation (Constitute) — the same stations the rail
            shows, named: "← Council · 3/6 · Rehearsal →" reads as one system,
            where a bare Previous/Next read as a second one. ── */}
        {/* ── Council order — the FDC enforcement rail (roadmap Pieza 1): the
            quorum signs ONE XRPL tx; the bridge executes it on the vault.
            Vive en «Órdenes»: también es COMPONER. ── */}
        {effectiveSurface === 'govern' && account && govTab === 'orders' && (
          <RevealItem>
            <CouncilOrderCard account={account} />
          </RevealItem>
        )}

        {/* ── SALA «BANDEJA»: el quórum asíncrono (tuyas / de otros / listas /
            emitidas). SOLA en su pestaña — componer arriba era el ruido que
            escondía lo único que hay que hacer aquí: firmar. ── */}
        {effectiveSurface === 'govern' && account && govTab === 'proposals' && (
          <RevealItem>
            <ProposalInbox account={account} onSettled={() => refreshAfterSettlement()} />
          </RevealItem>
        )}

        {/* ── The EVM/vault mirror (auditoría P1): a manual drift-check that
            existed only WHILE FDC enforcement did not. Retired from the frontend
            — kept in the repo,
            gated off, never deleted. ── */}
        {SHOW_VAULT_MIRROR && effectiveSurface === 'govern' && govTab === 'council' && (
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
            are on. ── */}
        <RevealItem>
          <Card padded={false} className="p-4">
            <p className="text-[11px] leading-relaxed text-ink/40">
              {/* Una frase honesta por SALA — la de cada pestaña dice lo que
                  de verdad manda ahí, no el eslogan del producto. */}
              {effectiveSurface === 'constitute'
                ? t('A programmed, conditioned, revocable transfer constituted in life — it creates no legal regime, and nothing transfers at death.')
                : govTab === 'proposals'
                  ? t('Astryum composes unsigned; the quorum signs each proposal — the same bytes, once, in order.')
                  : govTab === 'orders'
                    ? t('Composing an order signs nothing: it lands in the inbox and waits there for the quorum.')
                    : govTab === 'capital'
                      ? t('Read straight from the chain. Moving any of it takes an order and the quorum — never Astryum.')
                      : govTab === 'activity'
                        ? t('Every entry here happened on-chain and can be opened at its proof.')
                        : t('On XRPL nobody holds a key: this account is protected by its council (quorum), never by Astryum.')}
            </p>
          </Card>
        </RevealItem>
      </RevealGroup>
      </SurfaceMotion>
      </StationRailLayout>

      {/* ── Movements, as a modal — the same
          overlay shape a personal wallet card opens, so the gesture is
          identical on both sides of the toggle. It is reachable from exactly
          two places: this Legacy's card in "My Legacies", and each wallet in
          the Wallets tab. The rail underneath is unchanged: every move is
          composed UNSIGNED, bound to the council account, and dropped in the
          inbox for the quorum — Astryum never signs (#1). ── */}
      {movementsOpen && account && (
        <GovernedMovementsModal
          account={account}
          onClose={() => setMovementsOpen(false)}
          onGoToProposals={() => {
            setMovementsOpen(false);
            setGovTab('proposals');
          }}
        />
      )}
    </div>
  );
}
