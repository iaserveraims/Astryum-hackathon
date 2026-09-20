'use client';

/**
 * ExchangeDesk — the operator side of the Demo Exchange, one authority: the
 * exchange's council XRPL account (Xaman). Every step reuses an EXISTING
 * prepare route and records a receipt; nothing here signs.
 *
 *  E0 the council + its pote · E1 anchor the constitution (DIDSet) ·
 *  E2 birth the pote (0xFE, one signature) · E3 clients: tag + KYC registry ·
 *  E4 the omnibus (watcher) · E5 put a client's XRP to work (0xFE from the
 *  omnibus, shares to the client) · E6 direct / recall by council order ·
 *  E7 the cage says no · E8 pay a client out to their own wallet.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, FileSignature, Landmark, Loader2, RefreshCw, ScanLine, ShieldAlert, UserPlus, Wallet, XCircle } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { CouncilSigningDoors } from '../legacy/CouncilMultisigFlow';
import { CouncilOrderInFlightConfirm, StaleOrderLockNote } from '../xrpl/XamanSingleSign';
// it. 19 (R5): el candado de la pantalla, compartido — dos copias del mismo
// candado dejaban media pantalla pausada después de «I checked».
import { useExchangeStaleLock } from './ExchangeStaleLockScope';
import { OmnibusSignDoor } from './OmnibusSignDoor';
import { DeskDepositQr } from './DepositXamanQr';
import { UnconfirmedSignatureNotice } from '../settlement/UnconfirmedSignatureNotice';
import { applySignFailure, type UnconfirmedSignature } from '../../lib/wallet/signOutcome';
import { ContractCodeCard } from '../institutional/ContractCodeCard';
import { CredentialCeremonyModal } from '../institutional/CredentialCeremonyModal';
import { useWalletPartner } from '../../lib/wallet/useWalletPartner';
import { useSettlement } from '../../lib/settlement/useSettlement';
import { startPending } from '../../lib/settlement/settlement';
import { notifyHandoffSigned } from '../../lib/wallet/handoffRelease';
import {
  getCageOf,
  listRegistryVenues,
  prepareCageCreate,
  prepareCageOrder,
  prepareCouncilAnchor,
  preparePoteCouncilOrder,
  relayCouncilOrder,
  // it. 23 (3.4): los MISMOS lectores que usan las seis puertas del consejo —
  // `DUPLICATE_CHECK_UNREADABLE` («no pudimos comprobarlo») lleva reintento
  // además de la escapatoria, y no es lo mismo que un duplicado que sí se vio.
  isDuplicateCheckUnreadable,
  mayConfirmAnotherOrder,
  sameOrderMinutesAgo,
  type CageBirthHandoff,
  type CageOrderPrepared,
  type CageSummary,
  type CouncilOrderPrepared,
  type RegistryVenue,
} from '../../lib/institutional/api';
import { fmtBase, parseAmountToBase } from '../../lib/institutional/policyCatalog';
import { venueIdentity } from '../../lib/institutional/venueIdentity';
import {
  councilOrderExitToken,
  councilOrderServerWarnings,
  demoApi,
  describeCouncilOrderRefusal,
  describeDeskRefusal,
  describeRefusal,
  dropsToXrp,
  isCageVerdict,
  prepareKycRegister,
  shortHash,
  spentTodayText,
  type AutopilotStatus,
  type DemoClient,
  type DeskPayment,
  type DeskPutToWorkHandoff,
  type Refusal,
  type RunCredentialRow,
} from '../../lib/demo-exchange/api';
import { msUntilRetry, releaseWaitFromRefusal, releaseWaitText, type ReleaseWait } from '../../lib/demo-exchange/releaseCountdown';
import type { DemoRunApi } from '../../lib/demo-exchange/useDemoRun';
import { useExchangeStage } from './stage/ExchangeStationContext';
import { DESK_PUT_TO_WORK_UI } from './stage/useExchangeScript';
import { AUTOPILOT_UI } from '../../lib/demo-exchange/autopilotVisibility';
import { DeskRequestQueue } from './console/DeskRequestQueue';

const XRPL_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
const EVM_RE = /^0x[a-fA-F0-9]{40}$/;
// XRPL-only (doctrina del fundador, 12-sep): la identidad vive SOLO en XRPL
// (XLS-70 en la raíz y en los clientes). La maquinaria del registro Flare
// (ExchangeKycRegistry, set-user-gate, publish on-chain) queda INERTE, no
// borrada: este interruptor la revive si algún día un tenant quiere la puerta
// escrita también en el contrato. Con un run que YA tenga registryAddress, los
// controles de gate/columna siguen apareciendo (respetan el dato existente).
const ONCHAIN_REGISTRY_UI = false;
const SHA256_RE = /^[0-9a-fA-F]{64}$/;
const XRP_RE = /^\d+(\.\d{1,6})?$/;
/** Releases refused while the desk was unmounting: shown on the next mount, never dropped. */
const RELEASE_FAILURES_KEY = 'astryum:deskReleaseFailures';

/**
 * A validated desk 0xFE whose record the exchange ledger refused (a node behind,
 * a transient read): its hash, kept in this tab so «Record again» survives a
 * reload. Keyed by reservation id.
 */
const RECORD_RETRY_KEY = 'astryum:deskRecordRetry';
interface RecordRetry { runId: string; deskPaymentId: string; clientId: string; drops: string; hash: string }

function readRecordRetries(): Record<string, RecordRetry> {
  try {
    const raw = JSON.parse(window.sessionStorage.getItem(RECORD_RETRY_KEY) || '{}') as unknown;
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, RecordRetry>) : {};
  } catch {
    return {};
  }
}

function writeRecordRetries(next: Record<string, RecordRetry>): void {
  try {
    window.sessionStorage.setItem(RECORD_RETRY_KEY, JSON.stringify(next));
  } catch {
    /* kept in memory only */
  }
}

/**
 * The waits the LEDGER owes, one per reservation (it. 16, R5 5.5).
 *
 * There was ONE `releaseWait` for the whole desk: a second 409
 * WAIT_FOR_LAST_LEDGER replaced the first, killing its countdown and its single
 * automatic retry — the first reservation went quiet for ~7 minutes with
 * nothing on screen. A desk pays several clients; the wait belongs to the
 * reservation, not to the screen. Persisted in this tab like the record
 * retries, so a tab change (or a reload) does not lose a countdown that is
 * still running on the ledger.
 */
const RELEASE_WAIT_KEY = 'astryum:deskReleaseWait';
type StoredWait = ReleaseWait & { runId: string };

function readReleaseWaits(): Record<string, StoredWait> {
  try {
    const raw = JSON.parse(window.sessionStorage.getItem(RELEASE_WAIT_KEY) || '{}') as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, StoredWait> = {};
    for (const [id, w] of Object.entries(raw as Record<string, unknown>)) {
      const v = w as Partial<StoredWait>;
      if (typeof v?.runId === 'string' && typeof v.deskPaymentId === 'string' && typeof v.retryAtMs === 'number') {
        out[id] = { runId: v.runId, deskPaymentId: v.deskPaymentId, retryAtMs: v.retryAtMs, retried: v.retried === true, lastLedgerSequence: typeof v.lastLedgerSequence === 'number' ? v.lastLedgerSequence : null };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeReleaseWaits(next: Record<string, StoredWait>): void {
  try {
    window.sessionStorage.setItem(RELEASE_WAIT_KEY, JSON.stringify(next));
  } catch {
    /* kept in memory only */
  }
}

function rememberReleaseFailure(text: string): void {
  try {
    const prev = JSON.parse(window.sessionStorage.getItem(RELEASE_FAILURES_KEY) || '[]') as unknown;
    const next = (Array.isArray(prev) ? prev.filter((x): x is string => typeof x === 'string') : []).concat(text).slice(-5);
    window.sessionStorage.setItem(RELEASE_FAILURES_KEY, JSON.stringify(next));
  } catch {
    console.error(`[exchange-desk] ${text}`);
  }
}

function xrpToDrops(amountXrp: string): string {
  const [whole, frac = ''] = amountXrp.split('.');
  return (BigInt(whole) * BigInt(1_000_000) + BigInt((frac + '000000').slice(0, 6))).toString();
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Lo que la jaula deja DIRIGIR ahora: lo libre menos el colchón mínimo
 * (`bufferFloorBps` sobre el total del pote). Rellenar con TODO lo libre acababa
 * siempre en E7_DENIED · BUFFER_FLOOR_CROSSED (visto en staging, 14-sep).
 */
function directableBase(pote: { freeBalance: string; totalAssets: string; bufferFloorBps: number }): bigint {
  const free = BigInt(pote.freeBalance || '0');
  const floor = (BigInt(pote.totalAssets || '0') * BigInt(pote.bufferFloorBps || 0) + BigInt(9999)) / BigInt(10000);
  return free > floor ? free - floor : BigInt(0);
}

function Step({ n, title, icon: Icon, children, muted }: { n: string; title: string; icon: typeof Building2; children: React.ReactNode; muted?: boolean }) {
  // Dentro del ESCENARIO (/app/exchange, stage/): se enseña UNA estación a la
  // vez y las notas al pie se pliegan tras «Notes». Fuera de él (la consola de
  // admin) el contexto es null y nada cambia.
  const stage = useExchangeStage();
  if (stage?.station && stage.station !== n) return null;
  return (
    <section data-station={n} data-hints={stage && !stage.hints ? 'off' : undefined} className={`rounded-2xl border border-ink/10 bg-surface-1 p-4 space-y-3 ${muted ? 'opacity-70' : ''}`}>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] tracking-wider rounded-full border border-ink/10 px-2 py-0.5" style={{ color: 'var(--authority, #A76A15)' }}>{n}</span>
        <Icon className="w-4 h-4" style={{ color: 'var(--authority, #A76A15)' }} />
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function AutopilotPanel({ demo }: { demo: DemoRunApi }) {
  const { t } = useT();
  const run = demo.run!;
  const [status, setStatus] = useState<AutopilotStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function load() {
    const r = await demoApi.autopilot();
    if (r.ok) setStatus(r.data);
  }
  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 20_000);
    return () => window.clearInterval(id);
  }, []);

  async function toggle() {
    setErr('');
    setBusy(true);
    const r = await demoApi.patchRun(run.runId, { autopilot: !run.autopilot });
    setBusy(false);
    if (!r.ok) return setErr(r.refusal.detail ?? r.refusal.error);
    demo.setRun(r.data.run);
  }
  async function tickNow() {
    setErr('');
    setBusy(true);
    const r = await demoApi.autopilotTick();
    setBusy(false);
    if (!r.ok) return setErr(r.refusal.detail ?? r.refusal.error);
    setStatus(r.data.status);
    await demo.reload();
  }

  const requests = [...(run.requests ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 12);
  const keyMatches = status?.signerAddress && status.signerAddress === run.omnibusAddress;

  return (
    <div className="space-y-3 text-xs">
      <p className="text-ink/60">
        {t('This is the part a real exchange already has: a backend with its hot key that watches the omnibus, credits deposits by tag and executes what its clients ask. Here that key belongs to the SIMULATED exchange — never to Astryum, never to a client — and it refuses by construction: only the Core Vault or a registered client wallet as destination, only the account of one of ITS OWN clients as the receiver of the shares, a per-payment cap and a daily cap. KYC is the exchange own business, as in any exchange; if the pote carries an on-chain gate, that gate has the last word.')}
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-xl bg-surface-2 p-3">
          <div className="text-[10px] uppercase tracking-wider text-ink/50">{t('Exchange key')}</div>
          {status ? (
            <>
              <div className="font-mono break-all text-ink">{status.signerAddress ?? (status.seedPresent ? t('seed unusable') : t('no seed on this environment'))}</div>
              <div className="text-ink/60">{status.enabled ? (keyMatches ? <span className="text-tone-success">{t('opens this run\'s omnibus')}</span> : <span className="text-tone-warning">{t('does NOT open this run\'s omnibus')}</span>) : t('autosign disabled (DEMO_EXCHANGE_AUTOSIGN_ENABLED)')}</div>
              {status.signerError ? <div className="text-danger">{status.signerError}</div> : null}
            </>
          ) : <div className="text-ink/40">…</div>}
        </div>
        <div className="rounded-xl bg-surface-2 p-3">
          <div className="text-[10px] uppercase tracking-wider text-ink/50">{t('Caps (refuses above)')}</div>
          {status ? (
            <>
              <div className="font-mono text-ink">{status.maxTxXrp} XRP / {t('payment')}</div>
              {/* it. 23 (3.2): «no se pudo leer» se DICE. Un hueco al lado de
                  «/ 200 XRP today» se lee como cero, y es el número que acota
                  una llave que firma. */}
              <div className={typeof status.spentTodayXrp === 'number' ? 'font-mono text-ink' : 'text-tone-warning'}>
                {typeof status.spentTodayXrp === 'number' ? `${spentTodayText(status, t)} ${t('today')}` : spentTodayText(status, t)}
              </div>
              <div className="text-ink/60">{t('SourceTag')}: {status.attribution}</div>
            </>
          ) : null}
        </div>
        <div className="rounded-xl bg-surface-2 p-3">
          <div className="text-[10px] uppercase tracking-wider text-ink/50">{t('Loop')}</div>
          {status ? (
            <>
              <div className="text-ink">{status.running ? <span className="text-tone-success">{t('running')}</span> : <span className="text-ink/50">{t('stopped')}</span>} · {t('every')} {Math.round(status.intervalMs / 1000)} s</div>
              <div className="text-ink/60">{t('last tick')}: {status.lastTickAt ? new Date(status.lastTickAt).toLocaleTimeString() : '—'}</div>
              {status.lastError ? <div className="text-danger">{status.lastError}</div> : null}
            </>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={toggle} disabled={busy} className={`rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${run.autopilot ? 'bg-volt text-black' : 'border border-ink/10 text-ink/70 hover:border-volt hover:text-volt'}`}>
          {run.autopilot ? t('Autopilot ON for this run — turn off') : t('Turn autopilot ON for this run')}
        </button>
        <button onClick={tickNow} disabled={busy || !status?.enabled} className="rounded-full border border-ink/10 px-3 py-1.5 text-xs text-ink/70 hover:border-volt hover:text-volt disabled:opacity-50 inline-flex items-center gap-1.5">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} {t('Tick now')}
        </button>
        {err ? <span className="text-danger">{err}</span> : null}
      </div>
      {requests.length ? (
        <table className="w-full text-[11px]">
          <thead className="text-[10px] uppercase tracking-wider text-ink/50"><tr><th className="text-left py-1">{t('when')}</th><th className="text-left">{t('Client')}</th><th className="text-left">{t('kind')}</th><th className="text-right">XRP</th><th className="text-left">{t('status')}</th><th className="text-left">{t('hash / reason')}</th></tr></thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id} className="border-t border-ink/5 text-ink">
                <td className="py-1 font-mono">{r.createdAt.replace('T', ' ').slice(5, 16)}</td>
                <td>{run.clients.find((c) => c.id === r.clientId)?.label ?? r.clientId}</td>
                <td>{r.kind}</td>
                <td className="text-right font-mono">{dropsToXrp(r.drops)}</td>
                <td className={r.status === 'refused' ? 'text-danger' : r.status === 'done' ? 'text-tone-success' : r.status === 'signed' ? 'text-tone-warning' : ''}>{r.status}</td>
                <td className="font-mono text-ink/60">{r.txHash ? shortHash(r.txHash) : ''}{r.reason ? ` ${r.reason}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="text-ink/50">{t('No client requests yet.')}</p>}
      <p className="text-[11px] text-ink/50">{t('A signed 0xFE is never re-sent: it stays "signed" until the MasterAccountController reports it consumed (delayed = wait), then "done". Refusals are receipts with their reason.')}</p>
    </div>
  );
}

/**
 * @param onBlockedChange — told true while ANY signing door of the desk is in
 *   flight or unconfirmed (and false after). The stage uses it to keep the desk
 *   mounted and close its tabs/rooms: unmounting the desk lost the pending
 *   signature and «Compose» offered the same omnibus payment again.
 */
export function ExchangeDesk({ demo, onBlockedChange }: { demo: DemoRunApi; onBlockedChange?: (blocked: boolean) => void }) {
  const { t } = useT();
  const run = demo.run;
  const chain = demo.chain;
  const evm = useWalletPartner();
  const settlement = useSettlement();

  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  // E1
  const [constitutionText, setConstitutionText] = useState('');
  const [constitutionHash, setConstitutionHash] = useState('');
  const [anchorPending, setAnchorPending] = useState<{ xrplTx: Record<string, unknown>; account: string } | null>(null);
  // E2 — generación v2 (X4, 9-sep): el consejo del exchange gobierna una JAULA.
  // `cageInfo` es su jaula (null = aún sin nacer) y `cageKnown` evita decidir la
  // generación sin haber leído la cadena — «no pude leer» no es «no hay jaula».
  // El nacimiento son dos actos: la jaula (un 0xFE) y el pote (orden de consejo).
  // El nacimiento v1 de pote suelto vive en PoteBirthCard, no aquí.
  const [genesisXrp, setGenesisXrp] = useState('8');
  const [cageInfo, setCageInfo] = useState<CageSummary | null>(null);
  const [cageKnown, setCageKnown] = useState(false);
  // La lectura fallida se DICE al lado del botón (no solo dentro del handler,
  // que con el botón deshabilitado es inalcanzable) y se puede reintentar.
  const [cageReadFailed, setCageReadFailed] = useState(false);
  const [cageReadNonce, setCageReadNonce] = useState(0);
  const [registryVenues, setRegistryVenues] = useState<RegistryVenue[] | null>(null);
  const [cageBirthPending, setCageBirthPending] = useState<CageBirthHandoff | null>(null);
  const [govOrderPending, setGovOrderPending] = useState<{ prepared: CageOrderPrepared; kind: 'create-pote' | 'set-user-gate'; policy?: 'A' | 'B' } | null>(null);
  // E3
  const [newClientLabel, setNewClientLabel] = useState('');
  const [newClientXrpl, setNewClientXrpl] = useState('');
  const [newClientAccount, setNewClientAccount] = useState('');
  const [ceremonyOpen, setCeremonyOpen] = useState(false);
  // El KYC por casilla (diseño B, 14-sep): la ceremonia se abre YA rellena para un
  // cliente (raíz → omnibus, `KYC-<tag>`); sin cliente, en blanco como siempre.
  const [ceremonyInitial, setCeremonyInitial] = useState<{ issuer?: string; subject?: string; credentialType?: string } | undefined>(undefined);
  const [kycRows, setKycRows] = useState<Map<string, RunCredentialRow>>(new Map());
  const [kycNonce, setKycNonce] = useState(0);
  const kycRunId = demo.run?.runId;
  const kycClientCount = demo.run?.clients.length ?? 0;
  useEffect(() => {
    if (!kycRunId) return;
    let cancelled = false;
    void demoApi.runCredentials(kycRunId).then((r) => {
      // Una lectura fallida deja la última buena: la columna dice «—», nunca «sin KYC».
      if (!cancelled && r.ok) setKycRows(new Map(r.data.clients.map((c) => [c.clientId, c])));
    });
    return () => {
      cancelled = true;
    };
  }, [kycRunId, kycClientCount, kycNonce]);
  // El registro KYC se puede fijar DESPUÉS de crear el run (se despliega más
  // tarde que el perfil); sin él, set-user-gate y el tag on-chain no existen.
  const [registryInput, setRegistryInput] = useState('');
  // E5
  const [workClientId, setWorkClientId] = useState('');
  const [workXrp, setWorkXrp] = useState('');
  // `deskPaymentId`: the server-side reservation of this 0xFE (desk-payments);
  // `handoff`: the 0xFE the server composed for it (its memo lives on the reservation).
  const [workPending, setWorkPending] = useState<{ handoff: DeskPutToWorkHandoff; client: DemoClient; drops: string; deskPaymentId: string } | null>(null);
  // A release refused because the omnibus sent 0xFE payments nothing accounts for:
  // the operator records one, or marks it external with a reason.
  const [unaccounted, setUnaccounted] = useState<{ deskPaymentId: string; hashes: string[] } | null>(null);
  // Validated 0xFEs whose record was refused: «Record again» with the stored hash.
  const [recordRetries, setRecordRetries] = useState<Record<string, RecordRetry>>({});
  useEffect(() => { setRecordRetries(readRecordRetries()); }, []);
  // The releases the LEDGER owes (409 WAIT_FOR_LAST_LEDGER), ONE PER
  // RESERVATION (it. 16, R5 5.5): each keeps its own countdown and its own
  // single automatic retry, so a second WAIT never silences the first. Restored
  // from this tab on mount — a reload, or leaving and coming back to the desk,
  // does not lose a countdown the ledger is still running.
  /**
   * EL CANDADO DE LA ORDEN CADUCADA, también en la mesa (it. 16, R5 5.3).
   *
   * Las seis consolas institucionales lo tenían y las DOS pantallas del exchange
   * —las de la demo— no: firmar pasada la ventana dejaba componer otra orden
   * sobre el mismo capital sin un solo aviso. Se arma cuando una firma dice que
   * el asiento de Sequence ya se gastó, y solo lo abre la persona («I checked —
   * compose a new order»).
   *
   * PERO NUNCA PARA UNA SALIDA. `staleBlocks` es la única lectura del candado
   * aquí, y el «recall» (sacar el capital del venue al colchón) no la consulta:
   * una salida se AVISA, jamás se gatea — ni por un registro, ni por la BD, ni
   * por una pantalla nuestra (INVARIANTS, y it. 16 R3 3.1, que es esta misma
   * regresión en las consolas de agente D).
   */
  const staleLock = useExchangeStaleLock();
  const staleBlocks = staleLock.locked;
  const [releaseWaits, setReleaseWaits] = useState<Record<string, StoredWait>>({});
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const autoReleaseRef = useRef<(deskPaymentId: string) => void>(() => {});
  // Restore FIRST, mirror after. The mirroring effect skips its own first run:
  // on the mount commit the state is still the empty initial value, and writing
  // that would erase the countdowns this tab had stored a moment before.
  const waitsMirrorArmed = useRef(false);
  useEffect(() => { setReleaseWaits(readReleaseWaits()); }, []);
  useEffect(() => {
    if (!waitsMirrorArmed.current) { waitsMirrorArmed.current = true; return; }
    writeReleaseWaits(releaseWaits);
  }, [releaseWaits]);
  const anyWait = Object.keys(releaseWaits).length > 0;
  useEffect(() => {
    if (!anyWait) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [anyWait]);
  // One timer per wait. Rebuilding them all on every change is safe BECAUSE the
  // deadline is absolute (`retryAtMs`): a new wait re-arms the others with the
  // time they had left, never with a fresh countdown.
  const waitRunId = run?.runId;
  useEffect(() => {
    const timers: number[] = [];
    for (const w of Object.values(releaseWaits)) {
      if (w.runId !== waitRunId) continue; // another run's wait: kept, not fired
      const ms = msUntilRetry(w, Date.now());
      if (ms === null) continue;
      timers.push(window.setTimeout(() => autoReleaseRef.current(w.deskPaymentId), ms));
    }
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [releaseWaits, waitRunId]);
  /** Arm / re-arm / forget the wait of ONE reservation, never of the others. */
  const putWait = (deskPaymentId: string, wait: ReleaseWait | null, runId: string) =>
    setReleaseWaits((prev) => {
      if (!wait) {
        if (!(deskPaymentId in prev)) return prev;
        const next = { ...prev };
        delete next[deskPaymentId];
        return next;
      }
      return { ...prev, [deskPaymentId]: { ...wait, runId } };
    });
  const markWaitRetried = (deskPaymentId: string) =>
    setReleaseWaits((prev) => (prev[deskPaymentId] ? { ...prev, [deskPaymentId]: { ...prev[deskPaymentId], retried: true } } : prev));
  // E6 / E7
  const [venueId, setVenueId] = useState(0);
  const [orderAmount, setOrderAmount] = useState('');
  // v1 (pote suelto) o v2 (jaula): los dos shapes comparten los campos que se
  // usan aquí (xrplTx, account, order.summary, order.orderData).
  const [orderPending, setOrderPending] = useState<{ prepared: CouncilOrderPrepared | CageOrderPrepared; action: 'direct-to' | 'recall'; amountBase: string } | null>(null);
  const [denied, setDenied] = useState<{ error: string; detail?: string } | null>(null);
  // The same order went out minutes ago: NOT a cage verdict — an offer to compose
  // another one on purpose, never a receipt (it. 14, R2 2.4).
  const [duplicateOffer, setDuplicateOffer] = useState<{
    action: 'direct-to' | 'recall';
    text: string;
    /** it. 23 (3.4): el código del servidor — un duplicado que VIO, o una comprobación que no pudo correr. */
    code?: string;
    detail?: string;
    retryAfterSeconds?: number | null;
  } | null>(null);
  /**
   * it. 23 (3.4): lo mismo para las DOS puertas de gobierno de la mesa (abrir el
   * pote, apuntar la puerta KYC), que hasta ahora preguntaban con un
   * `window.confirm` de dos salidas y sin reintento.
   */
  const [govDuplicate, setGovDuplicate] = useState<{
    kind: 'create-pote' | 'set-user-gate';
    policy?: 'A' | 'B';
    code?: string;
    detail?: string;
    minutesAgo?: number | null;
    retryAfterSeconds?: number | null;
  } | null>(null);
  // E8
  const [payClientId, setPayClientId] = useState('');
  const [payXrp, setPayXrp] = useState('');
  // `deskPaymentId`: the hand-off /withdraw/prepare recorded server-side.
  const [payPending, setPayPending] = useState<{ xrplTx: Record<string, unknown>; client: DemoClient; deskPaymentId: string } | null>(null);
  // Un cliente creado sin r-address quedaba sin salida (el selector lo filtra):
  // aquí se le añade su wallet a posteriori y el payout se desbloquea.
  const [walletClientId, setWalletClientId] = useState('');
  const [walletInput, setWalletInput] = useState('');
  // A desk-created client is UNOWNED: its one-time claim code is shown here
  // once, and the operator hands it to the client out of band.
  const [claimShown, setClaimShown] = useState<{ label: string; tag: number; code: string } | null>(null);
  const [claimCopied, setClaimCopied] = useState(false);
  // An on-chain registry call we could not follow: amber, and no second click.
  const [kycUnconfirmed, setKycUnconfirmed] = useState<{ clientId: string; u: UnconfirmedSignature } | null>(null);
  // A signature in flight / unconfirmed closes the way back of its station:
  // Back → compose again → a fresh door was a second omnibus payment / 0xFE.
  // E1 too (productizer-it7): its DIDSet ceremony had an unconditional Back.
  const [anchorBlocked, setAnchorBlocked] = useState(false);
  const [birthBlocked, setBirthBlocked] = useState(false);
  const [workBlocked, setWorkBlocked] = useState(false);
  const [orderBlocked, setOrderBlocked] = useState(false);
  const [payBlocked, setPayBlocked] = useState(false);
  // 18-sep: la cola de peticiones por QR (sin autopilot) tiene su propia firma en vuelo.
  const [queueBlocked, setQueueBlocked] = useState(false);
  useEffect(() => { if (!anchorPending) setAnchorBlocked(false); }, [anchorPending]);
  useEffect(() => { if (!cageBirthPending && !govOrderPending) setBirthBlocked(false); }, [cageBirthPending, govOrderPending]);
  useEffect(() => { if (!workPending) setWorkBlocked(false); }, [workPending]);
  useEffect(() => { if (!orderPending) setOrderBlocked(false); }, [orderPending]);
  useEffect(() => { if (!payPending) setPayBlocked(false); }, [payPending]);

  // The parent (the stage) keeps the desk mounted and closes its tabs AND its
  // station rail while any door is blocked.
  const anyBlocked = anchorBlocked || birthBlocked || workBlocked || orderBlocked || payBlocked || queueBlocked;
  const onBlockedRef = useRef(onBlockedChange);
  onBlockedRef.current = onBlockedChange;
  useEffect(() => { onBlockedRef.current?.(anyBlocked); }, [anyBlocked]);

  // A reservation whose hand-off never left this screen is released when the
  // desk goes away (an admin section switch, a room change). One that was handed
  // off stays reserved server-side until the ledger decides — that is the point.
  const heldRef = useRef<{ runId?: string; work?: string; pay?: string; workBlocked: boolean; payBlocked: boolean }>({ workBlocked: false, payBlocked: false });
  heldRef.current = { runId: run?.runId, work: workPending?.deskPaymentId, pay: payPending?.deskPaymentId, workBlocked, payBlocked };
  const tRef = useRef(t);
  tRef.current = t;
  // A release refused while unmounting cannot be shown here: it is remembered and
  // shown on the next mount — a reservation never stays «In flight» silently.
  useEffect(() => () => {
    const h = heldRef.current;
    if (!h.runId) return;
    const runId = h.runId;
    const tr = tRef.current;
    const release = (id: string) =>
      demoApi
        .releaseDeskPayment(runId, id)
        .then((r) => {
          if (!r.ok) rememberReleaseFailure(tr('The reservation {id} could not be released when the desk closed and stays in flight: {reason}').replace('{id}', id).replace('{reason}', describeDeskRefusal(r.refusal, tr)));
        })
        .catch((e: unknown) => rememberReleaseFailure(tr('The reservation {id} could not be released when the desk closed and stays in flight: {reason}').replace('{id}', id).replace('{reason}', e instanceof Error ? e.message : String(e))));
    if (h.work && !h.workBlocked) void release(h.work);
    if (h.pay && !h.payBlocked) void release(h.pay);
  }, []);
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(RELEASE_FAILURES_KEY);
      if (!raw) return;
      window.sessionStorage.removeItem(RELEASE_FAILURES_KEY);
      const list = JSON.parse(raw) as unknown;
      if (Array.isArray(list) && list.length) setError(list.filter((x) => typeof x === 'string').join(' · '));
    } catch {
      /* nothing remembered */
    }
  }, []);

  // La generación del consejo, leída de la cadena (jaula v2), y la whitelist de
  // Astryum para abrir el pote. Una jaula ilegible deja `cageKnown` en false y
  // el botón de nacimiento espera — jamás se decide la generación a ciegas.
  useEffect(() => {
    setCageInfo(null);
    setCageKnown(false);
    setCageReadFailed(false);
    const council = run?.councilAddress;
    if (!council) return;
    let alive = true;
    getCageOf(council)
      .then((r) => {
        if (!alive) return;
        if (r.cage && 'unreadable' in r.cage) return void setCageReadFailed(true); // ilegible ahora: sin veredicto
        setCageInfo(r.cage ?? null);
        setCageKnown(true);
      })
      .catch(() => {
        // Sin veredicto de generación: el botón espera Y SE DICE (cageReadFailed).
        if (alive) setCageReadFailed(true);
      });
    listRegistryVenues()
      .then((r) => {
        if (alive) setRegistryVenues(r.venues);
      })
      .catch(() => {
        if (alive) setRegistryVenues(null);
      });
    return () => {
      alive = false;
    };
  }, [run?.councilAddress, cageReadNonce]);

  useEffect(() => {
    if (!constitutionText) return;
    void sha256Hex(constitutionText).then(setConstitutionHash);
  }, [constitutionText]);

  const pote = chain?.pote ?? null;
  const dec = pote?.asset?.decimals ?? 6;
  const clientFacts = useMemo(() => new Map((chain?.clients ?? []).map((c) => [c.clientId, c])), [chain]);

  if (!run) return <p className="text-xs text-ink/50">{t('Select or create a run first (Runs tab).')}</p>;

  function fail(e: unknown) {
    setError(e instanceof Error ? e.message : String(e));
  }

  /**
   * «The same order went out minutes ago» is not a refusal to work around: the
   * person is told what it means and decides.
   *
   * INERTE desde la it. 23 (3.4), no borrada: las dos puertas de gobierno de E2
   * preguntaban con este `window.confirm`, que solo tiene DOS salidas — así que
   * sobre un `DUPLICATE_CHECK_UNREADABLE` («no pudimos comprobarlo») afirmaba un
   * duplicado que nadie vio y tiraba el reintento y los segundos que el servidor
   * pidió esperar. Ahora usan `CouncilOrderInFlightConfirm`, el mismo panel de
   * tres botones que las seis puertas del consejo. Queda aquí como referencia de
   * la frase que se usaba (feedback del fundador: nunca borrar código construido).
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function confirmAnotherOrder(refusal: Refusal): boolean {
    return window.confirm(
      `${describeCouncilOrderRefusal(refusal, t)}\n\n${t('Compose another order anyway? Signing both would send the same instruction twice.')}`,
    );
  }

  /** Why a station's Back is gone while its signature is out. */
  const blockedBackLine = (
    <p className="text-[11px] text-tone-warning">{t('A signature of this step is in flight or unconfirmed — Back returns once the ledger settles it or refuses it.')}</p>
  );

  /** El registro KYC llega DESPUÉS del perfil (se despliega aparte): PATCH del run. */
  async function saveRegistry() {
    setError('');
    setBusy('registry');
    try {
      const addr = registryInput.trim();
      if (!EVM_RE.test(addr)) throw new Error(t('The registry must be a 0x address (deploy ExchangeKycRegistry first)'));
      const r = await demoApi.patchRun(run!.runId, { registryAddress: addr });
      if (!r.ok) throw new Error(`${r.refusal.error}${r.refusal.detail ? ` — ${r.refusal.detail}` : ''}`);
      setRegistryInput('');
      await demo.reload();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  /**
   * X5: la ceremonia deja su recibo E3_CREDENTIAL sola. El verificador ya sabía
   * leerlo (valida la tx XRPL y lee las credenciales del sujeto) — solo faltaba
   * que alguien lo escribiera. El cliente se resuelve por su r-address; si no
   * hay match, el recibo queda igualmente (expect.subject es el fallback).
   */
  async function recordCredentialReceipt(r: { subject: string; issuer: string; credentialType: string; txid: string | null }) {
    try {
      // El KYC por casilla cuelga del OMNIBUS con tipo `KYC-<tag>`: el cliente es el del tag.
      const tagOfType = r.subject === run!.omnibusAddress ? r.credentialType.split('-').pop() : undefined;
      const client = run!.clients.find((c) => c.xrplAddress === r.subject) ?? run!.clients.find((c) => tagOfType !== undefined && String(c.tag) === tagOfType);
      await demo.addReceipt({
        step: 'E3_CREDENTIAL',
        chain: 'xrpl',
        txHash: r.txid ?? undefined,
        clientId: client?.id,
        note: `${r.credentialType} · issuer ${r.issuer}`,
        expect: { subject: r.subject, issuer: r.issuer, credentialType: r.credentialType },
      });
    } catch {
      /* la ceremonia YA está en el ledger; el recibo se puede añadir a mano en Evidence */
    }
  }

  /** La r-address de un cliente existente: sin ella no hay payout (E8). */
  async function saveClientWallet() {
    setError('');
    setBusy('wallet');
    try {
      const addr = walletInput.trim();
      if (!walletClientId) throw new Error(t('Pick the client first'));
      if (!XRPL_RE.test(addr)) throw new Error(t('The wallet must be an XRPL r-address'));
      const r = await demoApi.patchClient(run!.runId, walletClientId, { xrplAddress: addr });
      if (!r.ok) throw new Error(`${r.refusal.error}${r.refusal.detail ? ` — ${r.refusal.detail}` : ''}`);
      setWalletClientId('');
      setWalletInput('');
      await demo.reload();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  /* ── E1 ─────────────────────────────────────────────────────────────── */
  async function composeAnchor() {
    setError('');
    setBusy('anchor');
    try {
      const h = constitutionHash.trim();
      if (!SHA256_RE.test(h)) throw new Error(t('The constitution hash must be 64 hex characters (a SHA-256)'));
      const res = await prepareCouncilAnchor({ account: run!.councilAddress, documentSha256Hex: h });
      if (!res.ok) throw new Error(`${res.refusal.error}${res.refusal.detail ? ` — ${res.refusal.detail}` : ''}`);
      setAnchorPending({ xrplTx: res.data.xrplTx as Record<string, unknown>, account: res.data.account });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  /* ── E2 (generación v2: jaula por 0xFE, pote por orden de consejo) ───── */
  async function composeBirth() {
    setError('');
    setBusy('birth');
    try {
      if (!XRP_RE.test(genesisXrp) || Number(genesisXrp) <= 0) throw new Error(t('Amount must be greater than 0'));
      if (!cageKnown) throw new Error(t('Still reading the council generation from the chain — try again in a second.'));
      if (!cageInfo) {
        // Acto 1: nace la JAULA — un 0xFE de la cuenta del consejo. Sin génesis:
        // la jaula no custodia nada; el carrier es gasolina, no capital.
        const res = await prepareCageCreate({ account: run!.councilAddress, amountXrp: genesisXrp, allowedTargets: [] });
        if (!res.ok) throw new Error(`${res.refusal.error}${res.refusal.detail ? ` — ${res.refusal.detail}` : ''}`);
        setCageBirthPending(res.data);
        return;
      }
      // Acto 2: la jaula abre el POTE — una orden de consejo (ancla → FDC →
      // bridge → cage.createPote). Los venues salen de la whitelist de Astryum
      // según la política del run; el pote nace con colchón 10% y corte ≤20%.
      await composePoteOpen();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  async function composePoteOpen(policyOverride?: 'A' | 'B', opts?: { confirmAnother?: boolean }) {
    const cage = cageInfo!;
    const policy = policyOverride ?? run!.policy;
    const wanted: Array<RegistryVenue['kind']> = policy === 'B' ? ['compoundv2', 'erc4626queued'] : ['compoundv2'];
    const initialVenues = (registryVenues ?? [])
      .filter((v) => v.status === 'active' && v.chainId === cage.chainId && wanted.includes(v.kind))
      .map((v) => ({ target: v.target, kind: v.kind }));
    if (initialVenues.length === 0) {
      throw new Error(t('The Astryum venue registry has no active venue for this policy on this chain — list it first in /app/admin/registry.'));
    }
    const params = {
      name: policy === 'B' ? 'Exchange pote B' : 'Exchange pote A',
      symbol: policy === 'B' ? 'exB-FXRP' : 'exA-FXRP',
      cooldownSeconds: policy === 'B' ? 259_200 : 0,
      bufferFloorBps: 1000,
      maxPayeeBps: 2000,
      maxDepositPerUser: '0',
      initialVenues,
    };
    const res = await prepareCageOrder({ council: run!.councilAddress, action: 'create-pote', params, ...(opts?.confirmAnother ? { confirmAnotherOrder: true } : {}) });
    if (!res.ok) {
      // it. 23 (3.4): un duplicado que el servidor VIO y una comprobación que no
      // pudo correr llegan por la misma puerta y necesitan frases opuestas —
      // y la segunda trae un REINTENTO (`retryable`) además de la escapatoria.
      if (mayConfirmAnotherOrder(res.refusal) && !opts?.confirmAnother) {
        setGovDuplicate({ kind: 'create-pote', policy, code: res.refusal.error, detail: res.refusal.detail, minutesAgo: sameOrderMinutesAgo(res.refusal), retryAfterSeconds: res.refusal.retryAfterSeconds ?? null });
        return;
      }
      throw new Error(describeCouncilOrderRefusal(res.refusal, t));
    }
    setGovOrderPending({ prepared: res.data, kind: 'create-pote', policy });
  }

  /**
   * Política A para la toma (13-sep): un pote con ventana de salida quema las
   * participaciones hoy y cobra a las 72 h, y el cliente passkey no tiene paso
   * de cobro. La jaula abre un SEGUNDO pote de salida inmediata y el run lo
   * adopta (resolveRunPote toma el último pote). La política del run cambia al
   * FIRMAR la orden, no al componerla. El pote B se queda, sin capital.
   */
  async function openPolicyAPote() {
    setError('');
    setBusy('birth');
    try {
      if (!cageInfo) throw new Error(t('Still reading the council generation from the chain — try again in a second.'));
      await composePoteOpen('A');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  async function onCageBirthSigned(hash: string) {
    const p = cageBirthPending;
    setCageBirthPending(null);
    if (!p) return;
    notifyHandoffSigned(p.memoHex, hash);
    settlement.track(startPending('xrpl-mint', hash), {
      onSettled: () => {
        void getCageOf(run!.councilAddress)
          .then((r) => {
            if (r.cage && !('unreadable' in r.cage)) {
              setCageInfo(r.cage);
              setCageKnown(true);
            }
          })
          .catch(() => undefined);
        void demoApi.resolvePote(run!.runId).then(() => demo.reload());
      },
    });
    await demo.addReceipt({
      step: 'E2_POTE',
      chain: 'xrpl',
      txHash: hash,
      note: t('Birth of the CAGE (v2) — the pote follows by council order.'),
      expect: { predictedCage: p.predicted.cage, predictedBridge: p.predicted.bridge, generation: 'v2', genesisXrp },
    });
    await demoApi.patchRun(run!.runId, { bridgeAddress: p.predicted.bridge });
    await demo.reload();
    setNotice(t('Signed. The cage is being proven and born on Flare (~2–5 min); then open the pote with a council order — same button.'));
  }

  async function onGovOrderSigned(hash: string) {
    const p = govOrderPending;
    setGovOrderPending(null);
    if (!p) return;
    const relay = await relayCouncilOrder(hash, p.prepared.order.orderData);
    await demo.addReceipt({
      step: 'E6_ORDER',
      chain: 'xrpl',
      txHash: hash,
      note: `${p.prepared.order.summary}${relay.ok ? '' : ` · relay: ${relay.detail ?? relay.status}`}`,
      expect: { action: p.kind, bridge: run!.bridgeAddress ?? '' },
    });
    if (!relay.ok) {
      setNotice(t('Signed, but the relay did not start') + (relay.detail ? ` — ${relay.detail}` : ''));
      return;
    }
    if (p.kind === 'create-pote') {
      // La política del run sigue a la orden FIRMADA (no a la compuesta).
      if (p.policy && p.policy !== run!.policy) await demoApi.patchRun(run!.runId, { policy: p.policy });
      // El pote aparece cuando el relay ejecute (~2-5 min): re-resolver solo, dos
      // veces por si la ronda FDC va lenta (resolveRunPote toma el ÚLTIMO pote).
      for (const ms of [150_000, 300_000]) {
        window.setTimeout(() => {
          void demoApi.resolvePote(run!.runId).then(() => demo.reload());
        }, ms);
      }
      setNotice(t('Council order signed. The relayer pays the FDC proof and the pote opens on Flare (~2–5 min); it will appear here on its own.'));
    } else {
      setNotice(t('Council order signed. The pote points at the KYC registry in ~2–5 min — the exit with the client tag has its on-chain source from then on.'));
      void demo.refreshChain();
    }
  }

  /** La puerta KYC del pote → el registro del run (orden de consejo). Es lo que
   *  le da fuente on-chain al tag de la vuelta (`redeemWithTag` lee `tagOf`). */
  async function composeGate(opts?: { confirmAnother?: boolean }) {
    setError('');
    setBusy('gate');
    try {
      if (!run!.poteAddress || !run!.registryAddress) throw new Error(t('The pote and the KYC registry must both exist first.'));
      const params = { pote: run!.poteAddress, gate: run!.registryAddress };
      const res = await prepareCageOrder({ council: run!.councilAddress, action: 'set-user-gate', params, ...(opts?.confirmAnother ? { confirmAnotherOrder: true } : {}) });
      if (!res.ok) {
        if (mayConfirmAnotherOrder(res.refusal) && !opts?.confirmAnother) {
          setGovDuplicate({ kind: 'set-user-gate', code: res.refusal.error, detail: res.refusal.detail, minutesAgo: sameOrderMinutesAgo(res.refusal), retryAfterSeconds: res.refusal.retryAfterSeconds ?? null });
          return;
        }
        throw new Error(describeCouncilOrderRefusal(res.refusal, t));
      }
      setGovOrderPending({ prepared: res.data, kind: 'set-user-gate' });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  /**
   * it. 23 (3.4) — EL REINTENTO DEL DUPLICADO NO COMPROBABLE, TAMBIÉN EN LA MESA.
   *
   * Las seis puertas del consejo llevan `CouncilOrderInFlightConfirm` desde la
   * it. 21: tres botones (no componer · Try again · componer otra igual) y los
   * segundos que el servidor pidió esperar. Las dos de la mesa se quedaron con
   * un `window.confirm` que solo ofrecía SÍ o NO — y que, sobre un
   * `DUPLICATE_CHECK_UNREADABLE`, afirmaba un duplicado que nadie vio y tiraba
   * `retryAfterSeconds` y `confirmAnotherOrder`. Mismo panel, mismas palabras.
   */
  async function resumeGovOrder(confirmAnother: boolean) {
    const pending = govDuplicate;
    if (!pending) return;
    setGovDuplicate(null);
    if (pending.kind === 'set-user-gate') {
      await composeGate({ confirmAnother });
      return;
    }
    setError('');
    setBusy('birth');
    try {
      await composePoteOpen(pending.policy, { confirmAnother });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  /* ── E3 ─────────────────────────────────────────────────────────────── */
  async function addClient() {
    setError('');
    setBusy('client');
    try {
      if (!newClientLabel.trim()) throw new Error(t('Give the client a name'));
      if (newClientXrpl.trim() && !XRPL_RE.test(newClientXrpl.trim())) throw new Error(t('The client XRPL address is not valid'));
      if (newClientAccount.trim() && !EVM_RE.test(newClientAccount.trim())) throw new Error(t('The client Flare account is not a valid 0x address'));
      const r = await demoApi.addClient(run!.runId, { label: newClientLabel.trim(), xrplAddress: newClientXrpl.trim() || undefined, passkeyAccount: newClientAccount.trim() || undefined });
      if (!r.ok) throw new Error(r.refusal.detail ?? r.refusal.error);
      demo.setRun(r.data.run);
      if (r.data.claimCode) {
        setClaimCopied(false);
        setClaimShown({ label: r.data.client.label, tag: r.data.client.tag, code: r.data.claimCode });
      }
      setNewClientLabel('');
      setNewClientXrpl('');
      setNewClientAccount('');
      setNotice(
        (ONCHAIN_REGISTRY_UI || run!.registryAddress
          ? t('Client created with tag {tag}. They set up Face ID in the User tab; then register them on-chain here.')
          : t('Client created with tag {tag}. They set up Face ID in the User tab; their identity lives on XRPL (XLS-70).')
        ).replace('{tag}', String(r.data.client.tag)),
      );
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  async function registerKyc(client: DemoClient) {
    if (kycUnconfirmed?.clientId === client.id) return;
    setError('');
    setBusy(`kyc:${client.id}`);
    // Set right before the call leaves for the wallet; `sentHash` once it answered.
    let handedToPartner = false;
    let sentHash: string | null = null;
    try {
      if (!run!.registryAddress) throw new Error(t('Set the KYC registry address on the run (Runs tab) first.'));
      if (!client.passkeyAccount) throw new Error(t('This client has no Flare account yet — they create it with Face ID in the User tab.'));
      if (!evm.isConnected) throw new Error(t('Connect the exchange admin EVM wallet (Flare) to sign the registry call.'));
      const res = await prepareKycRegister({ registry: run!.registryAddress, user: client.passkeyAccount, tag: client.tag });
      if (!res.ok) throw new Error(`${res.refusal.error}${res.refusal.detail ? ` — ${res.refusal.detail}` : ''}`);
      const c = res.data.call;
      handedToPartner = true;
      const { txHash, handle } = await evm.sendIntentCalls([{ to: c.to, data: c.data, value: c.value, chainId: c.chainId }]);
      sentHash = txHash;
      settlement.track(handle, { onSettled: () => void demo.refreshChain() });
      await demo.addReceipt({ step: 'E3_KYC', chain: 'flare', txHash, clientId: client.id, expect: { account: client.passkeyAccount, tag: client.tag, registry: run!.registryAddress } });
      await demoApi.patchClient(run!.runId, client.id, { kyc: client.kyc === 'credential' ? 'both' : 'registry' });
      await demo.reload();
      setNotice(t('Registry call sent. The chain will say approved + tag when it lands (Evidence → Read the chain).'));
    } catch (e) {
      if (sentHash) {
        // The wallet already answered with the hash: what failed is our
        // bookkeeping after it — never a signature to offer again.
        fail(e);
      } else {
        // Refused before the wallet, or cancelled in it → the button stays.
        // Anything else once the call left → amber, and no second click.
        applySignFailure(e, handedToPartner, t, {
          setError,
          setUnconfirmed: (u) => setKycUnconfirmed(u ? { clientId: client.id, u } : null),
          setPhase: () => {},
        });
      }
    } finally {
      setBusy(null);
    }
  }

  /** A fresh one-time claim code for an unowned client (legacy row, or a code the client lost). */
  async function issueClaimCode(client: DemoClient) {
    setError('');
    setBusy(`claim:${client.id}`);
    try {
      const r = await demoApi.patchClient(run!.runId, client.id, { issueClaimCode: true });
      if (!r.ok) throw new Error(r.refusal.detail ?? r.refusal.error);
      demo.setRun(r.data.run);
      if (r.data.claimCode) {
        setClaimCopied(false);
        setClaimShown({ label: client.label, tag: client.tag, code: r.data.claimCode });
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  async function copyClaimCode() {
    if (!claimShown) return;
    try {
      await navigator.clipboard.writeText(claimShown.code);
      setClaimCopied(true);
    } catch {
      /* the code stays selectable on screen */
    }
  }

  /* ── E5 ─────────────────────────────────────────────────────────────── */
  async function composeWork() {
    setError('');
    setBusy('work');
    try {
      const client = run!.clients.find((c) => c.id === workClientId);
      if (!client) throw new Error(t('Pick a client'));
      if (!client.passkeyAccount) throw new Error(t('This client has no Flare account yet — they create it with Face ID in the User tab.'));
      if (!run!.poteAddress) throw new Error(t('The pote is not born yet (E2).'));
      if (!XRP_RE.test(workXrp) || Number(workXrp) <= 0) throw new Error(t('Amount must be greater than 0'));
      const drops = xrpToDrops(workXrp);
      if (BigInt(drops) > BigInt(client.xrpOnExchangeDrops || '0')) {
        throw new Error(t('The exchange ledger holds {xrp} XRP for this client — it cannot put more to work than it holds.').replace('{xrp}', dropsToXrp(client.xrpOnExchangeDrops)));
      }
      // Reserve FIRST, server-side: a payment already in flight for this client
      // (an autopilot request, an earlier desk 0xFE this screen forgot) refuses
      // here, before any 0xFE is composed.
      const reserve = await demoApi.reserveDeskPayment(run!.runId, { clientId: client.id, kind: 'put-to-work', amountXrp: workXrp });
      if (!reserve.ok) throw new Error(describeRefusal(reserve.refusal, t));
      const deskPaymentId = reserve.data.deskPayment.id;
      demo.setRun(reserve.data.run);
      // Then the SERVER composes the 0xFE of THAT reservation and stores its memo
      // on it — the proof of the reservation matches only that memo.
      let res: Awaited<ReturnType<typeof demoApi.preparePutToWork>>;
      try {
        res = await demoApi.preparePutToWork(run!.runId, deskPaymentId);
      } catch (e) {
        const released = await releaseReservation(deskPaymentId);
        throw new Error([e instanceof Error ? e.message : String(e), released ? releaseFailedLine(released) : ''].filter(Boolean).join(' — '));
      }
      if (!res.ok) {
        const released = await releaseReservation(deskPaymentId);
        throw new Error([describeRefusal(res.refusal, t), released ? releaseFailedLine(released) : ''].filter(Boolean).join(' — '));
      }
      demo.setRun(res.data.run);
      setWorkPending({ handoff: res.data.handoff, client, drops, deskPaymentId });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  async function onWorkSigned(hash: string) {
    const p = workPending;
    setWorkPending(null);
    if (!p) return;
    notifyHandoffSigned(p.handoff.memoHex, hash);
    settlement.track(startPending('xrpl-mint', hash), { onSettled: () => void demo.refreshChain() });
    const r = await demoApi.recordPutToWork(run!.runId, { clientId: p.client.id, drops: p.drops, txHash: hash, deskPaymentId: p.deskPaymentId, note: t('Mode B: the exchange signs, the client signs nothing; the shares are minted to the client account.') });
    if (r.ok) demo.setRun(r.data.run);
    else {
      // The hash is kept: «Record again» next to the reservation (a lagging node answers 503 RECORD_NOT_YET_VISIBLE).
      rememberRecordRetry({ runId: run!.runId, deskPaymentId: p.deskPaymentId, clientId: p.client.id, drops: p.drops, hash });
      setError(t('The 0xFE is validated ({hash}) but the exchange ledger could not record it: {reason}. Its reservation stays in flight until it is recorded — use «Record again».').replace('{hash}', shortHash(hash)).replace('{reason}', describeDeskRefusal(r.refusal, t)));
    }
    setNotice(t('Signed by the omnibus. The executor mints XRP → FXRP and deposits into the pote with the client as receiver (~2–5 min). Their shares will show in User → position.'));
  }

  function rememberRecordRetry(entry: RecordRetry) {
    setRecordRetries((prev) => {
      const next = { ...prev, [entry.deskPaymentId]: entry };
      writeRecordRetries(next);
      return next;
    });
  }

  function forgetRecordRetry(deskPaymentId: string) {
    setRecordRetries((prev) => {
      if (!(deskPaymentId in prev)) return prev;
      const next = { ...prev };
      delete next[deskPaymentId];
      writeRecordRetries(next);
      return next;
    });
  }

  /** «Record again»: the same verified record, with the hash the door validated (or the one on the reservation). */
  async function recordAgain(p: DeskPayment, hash: string) {
    setError('');
    setBusy(`record:${p.id}`);
    try {
      const r = await demoApi.recordPutToWork(run!.runId, { clientId: p.clientId, drops: p.drops, txHash: hash, deskPaymentId: p.id, note: t('Mode B: the exchange signs, the client signs nothing; the shares are minted to the client account.') });
      if (!r.ok) {
        // A refusal that is not «not yet visible» will not change by retrying: stop offering it.
        if (!r.refusal.retryable) forgetRecordRetry(p.id);
        throw new Error(describeDeskRefusal(r.refusal, t));
      }
      forgetRecordRetry(p.id);
      demo.setRun(r.data.run);
      setNotice(t('Recorded: the 0xFE {hash} is verified on the ledger and the client was debited once.').replace('{hash}', shortHash(hash)));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  /** A refusal that names omnibus 0xFE payments nothing accounts for opens the «mark external» choice. */
  function noteUnaccounted(deskPaymentId: string, refusal: Refusal) {
    if (refusal.error === 'DESK_PAYMENT_UNACCOUNTED_ON_LEDGER' && refusal.hashes?.length) setUnaccounted({ deskPaymentId, hashes: refusal.hashes });
  }

  /** A release the ledger owes: start (or restart) THIS reservation's countdown, leaving the others running. */
  function noteWaitForLedger(deskPaymentId: string, refusal: Refusal): boolean {
    const wait = releaseWaitFromRefusal(deskPaymentId, refusal, Date.now());
    if (!wait) return false;
    putWait(deskPaymentId, wait, run!.runId);
    return true;
  }

  /** The single automatic retry, once the window the server named has passed. */
  async function autoRelease(deskPaymentId: string) {
    markWaitRetried(deskPaymentId);
    try {
      const r = await demoApi.releaseDeskPayment(run!.runId, deskPaymentId);
      if (r.ok) {
        demo.setRun(r.data.run);
        putWait(deskPaymentId, null, run!.runId);
        setNotice(t('The reservation was released by itself once its window closed: its 0xFE can never land, and the client\'s XRP is free again.'));
        return;
      }
      noteUnaccounted(deskPaymentId, r.refusal);
      const again = releaseWaitFromRefusal(deskPaymentId, r.refusal, Date.now());
      // Still waiting: the countdown stays, but the desk does not retry again on its own.
      if (again) putWait(deskPaymentId, { ...again, retried: true }, run!.runId);
      else {
        putWait(deskPaymentId, null, run!.runId);
        setError(releaseFailedLine(describeDeskRefusal(r.refusal, t)));
      }
      void demo.reload();
    } catch (e) {
      markWaitRetried(deskPaymentId);
      setError(releaseFailedLine(e instanceof Error ? e.message : String(e)));
    }
  }
  autoReleaseRef.current = (deskPaymentId: string) => void autoRelease(deskPaymentId);

  /**
   * Release a reservation this screen held (Back, or a failed compose). Answers
   * null when released, otherwise the refusal in words — the caller SHOWS it: the
   * reservation stays in flight and the operator must know why.
   */
  async function releaseReservation(deskPaymentId: string): Promise<string | null> {
    try {
      const r = await demoApi.releaseDeskPayment(run!.runId, deskPaymentId);
      if (r.ok) {
        demo.setRun(r.data.run);
        putWait(deskPaymentId, null, run!.runId);
        return null;
      }
      noteUnaccounted(deskPaymentId, r.refusal);
      noteWaitForLedger(deskPaymentId, r.refusal);
      void demo.reload();
      return describeDeskRefusal(r.refusal, t);
    } catch (e) {
      void demo.reload();
      return e instanceof Error ? e.message : String(e);
    }
  }

  function releaseFailedLine(reason: string): string {
    return t('The reservation could not be released and stays in flight: {reason}').replace('{reason}', reason);
  }

  async function backFromWork() {
    const p = workPending;
    setWorkPending(null);
    if (!p) return;
    setError('');
    const refused = await releaseReservation(p.deskPaymentId);
    if (refused) setError(releaseFailedLine(refused));
  }

  async function backFromPay() {
    const p = payPending;
    setPayPending(null);
    if (!p) return;
    setError('');
    const refused = await releaseReservation(p.deskPaymentId);
    if (refused) setError(releaseFailedLine(refused));
  }

  /** An omnibus 0xFE that is not a client movement: marked external with a reason (nothing is debited). */
  async function markExternal(hash: string) {
    const note = window.prompt(t('Why is this omnibus 0xFE not a client movement? The reason stays on the receipt book.'));
    if (!note || !note.trim()) return;
    setError('');
    setBusy('external');
    try {
      const r = await demoApi.markExternal0xfe(run!.runId, { txHash: hash, note: note.trim() });
      if (!r.ok) throw new Error(describeRefusal(r.refusal, t));
      demo.setRun(r.data.run);
      setUnaccounted((u) => (u ? { ...u, hashes: u.hashes.filter((h) => h !== hash) } : u));
      setNotice(t('Marked external — nothing was debited. Release the reservation again.'));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  /**
   * An orphan reservation (this screen lost it: a reload, another tab).
   *
   * ONE RULE, THREE SURFACES (it. 16, «Copy y SourceTag»): the seat frees when
   * the Xaman payload can no longer be SIGNED — not when the operator believes
   * the payload never left this screen. The old wording asked them to judge
   * exactly that, beside a countdown that told them to release it now; the
   * server never took their word for it anyway. It answers
   * WAIT_FOR_LAST_LEDGER while the payload is alive and proves the absence on
   * the omnibus history before freeing anything — which is what this says.
   */
  async function releaseOrphan(p: DeskPayment) {
    const warning = p.kind === 'withdraw'
      ? t('Ask the server to free this payout? It frees the seat only once its window (XRPL ledger {lls}) has passed and the omnibus history proves the payment never landed. Until then nothing is freed and your client\'s XRP stays reserved.').replace('{lls}', String(p.lastLedgerSequence ?? '—'))
      : t('Ask the server to free this put-to-work? It frees the seat only once its 0xFE can no longer be signed and the omnibus history proves it never left. One that was signed is recorded, never released.');
    if (!window.confirm(warning)) return;
    setError('');
    setBusy('release');
    try {
      const r = await demoApi.releaseDeskPayment(run!.runId, p.id);
      if (!r.ok) {
        noteUnaccounted(p.id, r.refusal);
        noteWaitForLedger(p.id, r.refusal);
        void demo.reload();
        throw new Error(releaseFailedLine(describeDeskRefusal(r.refusal, t)));
      }
      demo.setRun(r.data.run);
      putWait(p.id, null, run!.runId);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  /** The omnibus payments of one step still in flight, server-side — what refuses a second compose. */
  function renderInFlight(kind: DeskPayment['kind']) {
    const open = (run!.deskPayments ?? []).filter((p) => p.kind === kind && (p.status === 'prepared' || p.status === 'signed'));
    if (!open.length) return null;
    const held = new Set([workPending?.deskPaymentId, payPending?.deskPaymentId].filter(Boolean) as string[]);
    return (
      <div className="rounded-xl border border-tone-warning/30 bg-tone-warning/[0.04] p-2.5 space-y-1.5 text-[11px]">
        <div className="text-ink/70">{t('In flight — the same client cannot be paid again until each one settles or is released:')}</div>
        <ul className="space-y-1">
          {open.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 font-mono text-ink/70">
              <span>
                {run!.clients.find((c) => c.id === p.clientId)?.label ?? p.clientId} · {dropsToXrp(p.drops)} XRP · {p.status}
                {p.txHash ? ` · ${shortHash(p.txHash)}` : ''}{p.lastLedgerSequence ? ` · LLS ${p.lastLedgerSequence}` : ''}
              </span>
              {held.has(p.id) ? (
                <span className="font-sans text-ink/45">{t('(on this screen)')}</span>
              ) : p.status === 'signed' ? (
                <button onClick={() => void demo.scanOmnibus()} className="font-sans underline hover:text-ink">{t('validated — scan the omnibus to settle it')}</button>
              ) : (
                <button onClick={() => void releaseOrphan(p)} disabled={busy !== null} className="font-sans underline hover:text-ink disabled:opacity-40">{t('Free the seat (once its payload can no longer be signed)')}</button>
              )}
              {releaseWaits[p.id] && releaseWaits[p.id].runId === run!.runId ? (
                <span data-testid="release-countdown" className="w-full font-sans text-tone-warning">{releaseWaitText(releaseWaits[p.id], nowMs, t)}</span>
              ) : null}
              {(() => {
                // A validated 0xFE whose record was refused: record it again with the hash we hold.
                const retry = recordRetries[p.id];
                const hash = p.kind === 'put-to-work' ? (retry && retry.runId === run!.runId ? retry.hash : p.txHash) : undefined;
                if (!hash || held.has(p.id)) return null;
                return (
                  <button onClick={() => void recordAgain(p, hash)} disabled={busy !== null} className="font-sans underline text-volt hover:text-ink disabled:opacity-40">
                    {busy === `record:${p.id}` ? '…' : t('Record again ({hash})').replace('{hash}', shortHash(hash))}
                  </button>
                );
              })()}
            </li>
          ))}
        </ul>
        {kind === 'put-to-work' && unaccounted && unaccounted.hashes.length ? (
          <div className="space-y-1 border-t border-tone-warning/20 pt-1.5">
            <div className="text-ink/70">{t('The omnibus sent 0xFE payments that no record accounts for. If one is this client\'s, record it; if it is not a client movement, mark it external:')}</div>
            <ul className="space-y-1">
              {unaccounted.hashes.map((h) => (
                <li key={h} className="flex flex-wrap items-center gap-2 font-mono text-ink/70">
                  <span>{shortHash(h)}</span>
                  <button onClick={() => void markExternal(h)} disabled={busy !== null} className="font-sans underline hover:text-ink disabled:opacity-40">{t('Mark external (not a client movement)')}</button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    );
  }

  /* ── E6 / E7 ────────────────────────────────────────────────────────── */
  /**
   * Composes the order — and tells apart the TWO ways it can come back refused:
   *  · the CAGE's verdict (the venue is not listed, the buffer floor, the cap,
   *    a pote this cage does not govern): that is E7, the product itself, and it
   *    is recorded as proof;
   *  · the SERVER refusing to compose right now (the same order went out minutes
   *    ago, too many pending, it could not be recorded, the region, a chain read,
   *    the network): shown as what it is, and NEVER written as «the cage says no»
   *    (it. 14, R2 2.4 — a denial the cage never gave in the audit trail).
   * `confirmAnother` is only ever true after the person said so on screen.
   */
  async function composeOrder(action: 'direct-to' | 'recall', confirmAnother = false) {
    setError('');
    setDenied(null);
    if (!confirmAnother) setDuplicateOffer(null);
    setBusy(`order:${action}`);
    try {
      const amountBase = parseAmountToBase(orderAmount, dec);
      if (!amountBase) throw new Error(t('Amount must be greater than 0'));
      // Generación: un consejo v2 ordena a su JAULA (cage.directTo(pote, …));
      // componer aquí el camino v1 sería firmar una orden condenada — el
      // backend lo rechaza con COUNCIL_GOVERNS_A_CAGE, pero mejor ni componerla.
      const res = cageInfo
        ? await prepareCageOrder({
            council: run!.councilAddress,
            action,
            params: { pote: run!.poteAddress, venueId, amount: amountBase.toString() },
            ...(confirmAnother ? { confirmAnotherOrder: true } : {}),
          })
        : await preparePoteCouncilOrder({ council: run!.councilAddress, action, venueId, amount: amountBase.toString(), ...(confirmAnother ? { confirmAnotherOrder: true } : {}) });
      if (!res.ok) {
        if (mayConfirmAnotherOrder(res.refusal)) {
          // Not a verdict and not an error: an offer, with the consequence said.
          // it. 23 (3.4): `DUPLICATE_CHECK_UNREADABLE` entra por aquí también —
          // con su propio panel, porque decir «la misma orden salió hace un
          // momento» cuando nunca miramos es inventarse el hecho.
          setDuplicateOffer({
            action,
            text: describeCouncilOrderRefusal(res.refusal, t),
            code: res.refusal.error,
            detail: res.refusal.detail,
            retryAfterSeconds: res.refusal.retryAfterSeconds ?? null,
          });
          return;
        }
        if (!isCageVerdict(res.refusal)) {
          // The server could not compose it. Nothing was signed, nothing is proof.
          throw new Error(describeCouncilOrderRefusal(res.refusal, t));
        }
        // THE moment: the cage says no before anyone signs. Record it as proof.
        setDuplicateOffer(null);
        setDenied({ error: res.refusal.error, detail: res.refusal.detail });
        await demo.addReceipt({ step: 'E7_DENIED', chain: 'none', note: `${action} venue #${venueId} ${orderAmount} → ${res.refusal.error}${res.refusal.detail ? ` — ${res.refusal.detail}` : ''}`, expect: { code: res.refusal.error, action, venueId, amount: orderAmount } });
        return;
      }
      setDuplicateOffer(null);
      setOrderPending({ prepared: res.data, action, amountBase: amountBase.toString() });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  async function onOrderSigned(hash: string) {
    const p = orderPending;
    setOrderPending(null);
    if (!p) return;
    const relay = await relayCouncilOrder(hash, p.prepared.order.orderData);
    await demo.addReceipt({
      step: 'E6_ORDER',
      chain: 'xrpl',
      txHash: hash,
      note: `${p.prepared.order.summary}${relay.ok ? '' : ` · relay: ${relay.detail ?? relay.status}`}`,
      expect: { action: p.action, venueId, amountBase: p.amountBase, bridge: run!.bridgeAddress ?? '' },
    });
    setNotice(relay.ok
      ? t('Council order signed. The relayer pays the FDC proof and executes bridge.execute on Flare (~2–5 min). Evidence → Read the chain shows consumedTxId when it lands.')
      : t('Signed, but the relay did not start') + (relay.detail ? ` — ${relay.detail}` : ''));
    void demo.refreshChain();
  }

  /* ── E8 ─────────────────────────────────────────────────────────────── */
  async function composePayout() {
    setError('');
    setBusy('pay');
    try {
      const client = run!.clients.find((c) => c.id === payClientId);
      if (!client) throw new Error(t('Pick a client'));
      // The server refuses PAYMENT_IN_FLIGHT and records this hand-off: even if
      // this screen loses it, a second compose of the same balance is refused.
      const res = await demoApi.withdrawPrepare(run!.runId, client.id, payXrp);
      if (!res.ok) throw new Error(describeRefusal(res.refusal, t));
      setPayPending({ xrplTx: res.data.xrplTx, client, deskPaymentId: res.data.deskPayment.id });
      void demo.reload();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  async function onPayoutSigned(hash: string) {
    const p = payPending;
    setPayPending(null);
    setNotice(t('Payout signed by the omnibus ({hash}). The watcher debits the ledger when the payment validates — press "Scan the omnibus".').replace('{hash}', shortHash(hash)));
    if (p) {
      try {
        const r = await demoApi.reportDeskPaymentSigned(run!.runId, p.deskPaymentId, hash);
        if (r.ok) demo.setRun(r.data.run);
        else setError(t('The payout is validated, but its hash could not be kept on the desk record ({reason}) — it stays in flight until the ledger mirror settles it.').replace('{reason}', describeRefusal(r.refusal, t)));
      } catch {
        setError(t('The payout is validated, but its hash could not be kept on the desk record — it stays in flight until the ledger mirror settles it.'));
      }
    }
    window.setTimeout(() => void demo.scanOmnibus(), 6000);
  }

  const clientsWithAccount = run.clients.filter((c) => c.passkeyAccount);

  return (
    <div className="space-y-5">
      {notice ? <p className="rounded-xl border border-volt/30 bg-volt/5 p-3 text-xs text-ink/80">{notice}</p> : null}
      {error ? <p className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-xs text-danger">{error}</p> : null}
      {govDuplicate ? (
        <CouncilOrderInFlightConfirm
          detail={govDuplicate.detail}
          code={govDuplicate.code}
          minutesAgo={govDuplicate.minutesAgo}
          retryAfterSeconds={govDuplicate.retryAfterSeconds}
          busy={busy !== null}
          onConfirm={() => void resumeGovOrder(true)}
          onRetry={() => void resumeGovOrder(false)}
          onDismiss={() => setGovDuplicate(null)}
        />
      ) : null}
      {/* Se pinta DONDE SE ARMA (arriba de la mesa, siempre a la vista): un
          candado sin titular es una consola parada sin explicación (R5 5.5). */}
      <StaleOrderLockNote lock={staleLock.lock} onRelease={staleLock.release} />

      {/* E0 */}
      <Step n="E0" title={t('The exchange authority: one XRPL account')} icon={Building2}>
        <div className="grid gap-2 sm:grid-cols-2 text-xs">
          <div className="rounded-xl bg-surface-2 p-3">
            <div className="text-[10px] uppercase tracking-wider text-ink/50">{t('Council (signs every order in Xaman)')}</div>
            <div className="font-mono break-all text-ink">{run.councilAddress}</div>
            <div className="text-ink/60 mt-1">{t('constitution')}: {chain?.council.didAnchored ? <span className="text-tone-success">{t('anchored')}</span> : <span className="text-tone-warning">{t('not anchored yet')}</span>}</div>
          </div>
          <div className="rounded-xl bg-surface-2 p-3">
            <div className="text-[10px] uppercase tracking-wider text-ink/50">{t('Pote (the cage on Flare)')}</div>
            <div className="font-mono break-all text-ink">{run.poteAddress ?? t('not born yet')}</div>
            {pote ? (
              <div className="text-ink/60 mt-1">{fmtBase(pote.totalAssets, dec)} {pote.asset.symbol} · {pote.venues.length} {t('venues')} · {pote.cooldownSeconds ? `${Math.round(pote.cooldownSeconds / 3600)} h` : t('immediate exit')}</div>
            ) : null}
          </div>
        </div>
        <details className="text-xs">
          <summary className="cursor-pointer text-ink/60">{t('The contracts, and what each permits — and does NOT')}</summary>
          <div className="mt-2 space-y-2">
            <ContractCodeCard contractKey="vault" />
            <ContractCodeCard contractKey="bridge" />
            {ONCHAIN_REGISTRY_UI || run.registryAddress ? <ContractCodeCard contractKey="registry" /> : null}
            <ContractCodeCard contractKey="passkey" />
          </div>
        </details>
      </Step>

      {/* E1 */}
      <Step n="E1" title={t('Anchor the constitution (DIDSet)')} icon={FileSignature} muted={chain?.council.didAnchored === true}>
        {anchorPending ? (
          <div className="space-y-2">
            <CouncilSigningDoors xrplTx={anchorPending.xrplTx} account={anchorPending.account} defaultTitle={t('Anchor the constitution (DIDSet)')} onSettled={async (hash) => {
              setAnchorPending(null);
              await demo.addReceipt({ step: 'E1_ANCHOR', chain: 'xrpl', txHash: hash, expect: { constitutionSha256: constitutionHash } });
              void demo.refreshChain();
              setNotice(t('Constitution anchored. The council can now birth its pote (E2).'));
            }} onBlockedChange={setAnchorBlocked} onStaleFate={staleLock.report} />
            {anchorBlocked ? blockedBackLine : <button onClick={() => setAnchorPending(null)} className="text-xs text-ink/50 hover:text-ink">{t('Back')}</button>}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-ink/50">{t('Paste the governance text (it never travels — only its SHA-256 is anchored), or paste the hash directly.')}</p>
            <textarea value={constitutionText} onChange={(e) => setConstitutionText(e.target.value)} rows={3} placeholder={t('Constitution of the exchange council…')} className="w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-xs text-ink" />
            <input value={constitutionHash} onChange={(e) => setConstitutionHash(e.target.value)} placeholder="sha-256 (64 hex)" className="w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-xs text-ink font-mono" />
            <button onClick={composeAnchor} disabled={busy !== null || staleBlocks} className="rounded-full bg-volt px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50 inline-flex items-center gap-1.5">
              {busy === 'anchor' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSignature className="w-3.5 h-3.5" />} {t('Compose the anchor (DIDSet)')}
            </button>
          </div>
        )}
      </Step>

      {/* E2 */}
      <Step n="E2" title={t('Birth the pote — one council signature (0xFE)')} icon={Landmark} muted={Boolean(run.poteAddress)}>
        {cageBirthPending ? (
          <div className="space-y-2">
            <p className="text-xs text-ink/70">{t('Predicted cage')}: <span className="font-mono">{cageBirthPending.predicted.cage}</span></p>
            <CouncilSigningDoors xrplTx={cageBirthPending.xrplPayment as unknown as Record<string, unknown>} account={run.councilAddress} defaultTitle={t('Birth of the cage')} onSettled={(h) => void onCageBirthSigned(h)} onBlockedChange={setBirthBlocked} onStaleFate={staleLock.report} />
            {birthBlocked ? blockedBackLine : <button onClick={() => setCageBirthPending(null)} className="text-xs text-ink/50 hover:text-ink">{t('Back')}</button>}
          </div>
        ) : govOrderPending ? (
          <div className="space-y-2">
            <p className="text-xs text-ink/70">{govOrderPending.prepared.order.summary}</p>
            {councilOrderServerWarnings(govOrderPending.prepared).map((w) => (
              <p key={w} data-testid="order-recovery-warning" className="text-[11px] text-tone-warning">{w}</p>
            ))}
            <CouncilSigningDoors xrplTx={govOrderPending.prepared.xrplTx as unknown as Record<string, unknown>} account={govOrderPending.prepared.account} exitToken={councilOrderExitToken(govOrderPending.prepared)} defaultTitle={t('Sign the council order')} onSettled={(h) => void onGovOrderSigned(h)} onBlockedChange={setBirthBlocked} onStaleFate={staleLock.report} />
            {birthBlocked ? blockedBackLine : <button onClick={() => setGovOrderPending(null)} className="text-xs text-ink/50 hover:text-ink">{t('Back')}</button>}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-[11px] text-ink/50">
              {t('Generation v2: first the CAGE is born (one 0xFE signature), then the pote opens by council order — same button, two acts.')}
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs text-ink/60">
                {t('Genesis XRP (the operator\'s own capital; its shares stay with the council)')}
                <input value={genesisXrp} onChange={(e) => setGenesisXrp(e.target.value)} inputMode="decimal" className="mt-1 w-40 rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink" />
              </label>
              <button onClick={composeBirth} disabled={busy !== null || Boolean(run.poteAddress) || !cageKnown || staleBlocks} className="rounded-full bg-volt px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50 inline-flex items-center gap-1.5">
                {busy === 'birth' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Landmark className="w-3.5 h-3.5" />}{' '}
                {run.poteAddress ? t('Already born') : cageInfo ? t('Open the pote (council order)') : t('Birth the cage (one 0xFE signature)')}
              </button>
              {!run.poteAddress ? (
                <button onClick={() => void demoApi.resolvePote(run.runId).then(() => demo.reload())} className="text-[11px] text-ink/50 hover:text-ink inline-flex items-center gap-1">
                  <RefreshCw className="w-3 h-3" /> {t('Look for the pote on the factory')}
                </button>
              ) : null}
              {cageInfo && run.poteAddress && run.registryAddress ? (
                <button onClick={() => void composeGate()} disabled={busy !== null || staleBlocks} className="rounded-full border border-ink/10 px-3 py-1.5 text-xs text-ink/70 hover:border-volt hover:text-volt disabled:opacity-50 inline-flex items-center gap-1.5">
                  {busy === 'gate' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} {t('Point the pote at the KYC registry (council order)')}
                </button>
              ) : null}
              {cageInfo && run.poteAddress && run.policy === 'B' ? (
                <button onClick={() => void openPolicyAPote()} disabled={busy !== null || staleBlocks} className="rounded-full border border-volt/40 px-3 py-1.5 text-xs text-volt hover:bg-volt/10 disabled:opacity-50 inline-flex items-center gap-1.5">
                  {busy === 'birth' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Landmark className="w-3.5 h-3.5" />} {t('Open a policy A pote — immediate exit (council order)')}
                </button>
              ) : null}
            </div>
            {run.poteAddress && run.policy === 'B' ? (
              <p className="text-[11px] text-tone-warning">
                {t('This pote has a 72-hour exit window: a client exit burns the shares now and the XRP is claimed after the window — the client app has no claim step yet. For the take, open a policy A pote; this one stays, with no capital.')}
              </p>
            ) : null}
            {!cageKnown && !run.poteAddress ? (
              cageReadFailed ? (
                <p className="text-[11px] text-tone-warning">
                  {t('Could not read the council generation from the chain — the birth button waits, because "could not read" is never "no cage".')}{' '}
                  <button onClick={() => setCageReadNonce((n) => n + 1)} className="underline hover:text-ink inline-flex items-center gap-1">
                    <RefreshCw className="w-3 h-3" /> {t('Retry the read')}
                  </button>
                </p>
              ) : (
                <p className="text-[11px] text-ink/50 inline-flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" /> {t('Reading the council generation from the chain…')}
                </p>
              )
            ) : null}
          </div>
        )}
      </Step>

      {/* E3 */}
      <Step n="E3" title={t('Your clients — they sign up themselves; here you watch them')} icon={UserPlus}>
        {/* El alta la hace el USER (fundador 13-sep): entra en el sitio del
            cliente, crea su cuenta con Face ID y aparece aquí con su tag. Crear
            uno a mano queda como camino secundario (invitar / demo). */}
        <p className="text-[11px] text-ink/50">
          {t('A client opens your client site, creates their account with Face ID and appears here with their tag — nobody has to enrol them. KYC is the exchange own business, as in any exchange.')}
        </p>
        <details className="text-xs">
          <summary className="cursor-pointer text-ink/50 hover:text-ink">{t('Create one by hand (invite or demo)')}</summary>
          <div className="mt-2 space-y-2">
        <div className="grid gap-2 sm:grid-cols-3">
          <input value={newClientLabel} onChange={(e) => setNewClientLabel(e.target.value)} placeholder={t('Client name (demo)')} className="rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-xs text-ink" />
          <input value={newClientXrpl} onChange={(e) => setNewClientXrpl(e.target.value)} placeholder={t('Client XRPL wallet (optional, r…)')} className="rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-xs text-ink font-mono" />
          <input value={newClientAccount} onChange={(e) => setNewClientAccount(e.target.value)} placeholder={t('Client Flare account (optional, 0x… — or from User tab)')} className="rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-xs text-ink font-mono" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={addClient} disabled={busy !== null} className="rounded-full bg-volt px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50 inline-flex items-center gap-1.5">
            {busy === 'client' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />} {t('Create client (assigns a tag)')}
          </button>
          <button onClick={() => { setCeremonyInitial(undefined); setCeremonyOpen(true); }} className="rounded-full border border-ink/10 px-3 py-1.5 text-xs text-ink/70 hover:border-volt hover:text-volt">{t('Credential ceremony (XLS-70, optional)')}</button>
        </div>
          </div>
        </details>
        {claimShown ? (
          <div className="rounded-xl border border-volt/30 bg-volt/5 p-3 space-y-1.5 text-xs">
            <div className="text-ink/80">
              {t('Claim code for {label} (tag {tag}) — shown only once:').replace('{label}', claimShown.label).replace('{tag}', String(claimShown.tag))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-ink select-all break-all">{claimShown.code}</span>
              <button onClick={() => void copyClaimCode()} className="rounded-full border border-ink/10 px-2.5 py-0.5 text-[11px] text-ink/70 hover:border-volt hover:text-volt">{claimCopied ? t('Copied') : t('Copy')}</button>
            </div>
            <p className="text-[11px] text-ink/60">{t('Hand it to the client out of band — in person or by phone, never in a public channel. Whoever presents it first becomes the owner of this exchange account; it cannot be shown again.')}</p>
            <button onClick={() => setClaimShown(null)} className="text-[11px] text-ink/50 hover:text-ink">{t('I handed it over — hide it')}</button>
          </div>
        ) : null}
        {kycUnconfirmed ? (
          <UnconfirmedSignatureNotice
            rail="evm"
            chainId={14}
            unconfirmed={kycUnconfirmed.u}
            onClose={() => {
              setKycUnconfirmed(null);
              void demo.refreshChain();
            }}
          />
        ) : null}
        {run.clients.length ? (
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-ink/50">
              <tr><th className="text-left py-1">{t('Client')}</th><th className="text-left">{t('Tag')}</th><th className="text-left">{t('Flare account')}</th><th className="text-right">{t('XRP at the exchange')}</th><th className="text-right">{t('Shares')}</th><th className="text-left pl-3">{t('KYC')}</th>{ONCHAIN_REGISTRY_UI || run.registryAddress ? <th className="text-left">{t('Registry')}</th> : null}<th /></tr>
            </thead>
            <tbody>
              {run.clients.map((c) => {
                const f = clientFacts.get(c.id);
                return (
                  <tr key={c.id} className="border-t border-ink/5 text-ink">
                    <td className="py-1.5">{c.label}</td>
                    <td className="font-mono">{c.tag}</td>
                    <td className="font-mono">{c.passkeyAccount ? shortHash(c.passkeyAccount, 8, 4) : <span className="text-ink/40">{t('pending Face ID')}</span>}</td>
                    <td className="text-right font-mono">{dropsToXrp(c.xrpOnExchangeDrops)}</td>
                    <td className="text-right font-mono">{f?.sharesHuman ?? '—'}</td>
                    <td className="pl-3">
                      {(() => {
                        const k = kycRows.get(c.id);
                        if (!k) return <span className="text-ink/40">—</span>;
                        if (k.ok) return <span className="text-tone-success" title={k.credentialType}>{t('verified')}</span>;
                        const label =
                          k.code === 'CLIENT_CREDENTIAL_PENDING' ? t('issued, not accepted')
                            : k.code === 'CLIENT_CREDENTIAL_EXPIRED' ? t('expired')
                              : k.code === 'CREDENTIALS_UNREADABLE' ? t('could not read')
                                : t('no KYC');
                        return <span className={k.code === 'CREDENTIALS_UNREADABLE' ? 'text-tone-warning' : 'text-ink/50'} title={k.credentialType}>{label}</span>;
                      })()}
                    </td>
                    {ONCHAIN_REGISTRY_UI || run.registryAddress ? (
                      <td>{f?.registryApproved ? <span className="text-tone-success">{t('approved')} · {f.registryTag}</span> : <span className="text-ink/40">{t('not registered')}</span>}</td>
                    ) : null}
                    <td className="text-right space-x-1">
                      {kycRows.get(c.id)?.ok !== true ? (
                        <button
                          onClick={() => {
                            // Raíz → omnibus, tipo de la casilla: dos firmas, las dos del exchange.
                            setCeremonyInitial({ issuer: run.councilAddress, subject: run.omnibusAddress, credentialType: kycRows.get(c.id)?.credentialType ?? `KYC-${c.tag}` });
                            setCeremonyOpen(true);
                          }}
                          title={t('Registers this client KYC on the ledger: the root issues it on the omnibus and the omnibus accepts it')}
                          className="rounded-full border border-volt/40 px-2 py-0.5 text-[11px] text-volt hover:bg-volt/10"
                        >
                          {t('Issue KYC')}
                        </button>
                      ) : null}
                      {c.owned === false ? (
                        <button onClick={() => void issueClaimCode(c)} disabled={busy !== null} title={t('Nobody owns this client yet: issue a one-time claim code to hand to them')} className="rounded-full border border-ink/10 px-2 py-0.5 text-[11px] text-ink/70 hover:border-volt hover:text-volt disabled:opacity-40">
                          {busy === `claim:${c.id}` ? '…' : t('New claim code')}
                        </button>
                      ) : null}
                      {ONCHAIN_REGISTRY_UI || run.registryAddress ? (
                        <button onClick={() => registerKyc(c)} disabled={busy !== null || !c.passkeyAccount || f?.registryApproved === true || kycUnconfirmed?.clientId === c.id} className="rounded-full border border-ink/10 px-2 py-0.5 text-[11px] text-ink/70 hover:border-volt hover:text-volt disabled:opacity-40">
                          {busy === `kyc:${c.id}` ? '…' : t('Publish on-chain (optional)')}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <p className="text-xs text-ink/50">{t('No clients yet — the first one appears the moment somebody signs up on your client site.')}</p>}
        {/* El QR de depósito del cliente, también desde la mesa (fundador 14-sep). */}
        {run.clients.length ? <DeskDepositQr runId={run.runId} clients={run.clients} onSettled={() => void demo.scanOmnibus()} /> : null}
        {ONCHAIN_REGISTRY_UI && !run.registryAddress ? (
          <div className="space-y-1.5">
            <p className="text-[11px] text-tone-warning">{t('No on-chain registry on this run: entry is gated by the exchange itself, as in any exchange. Set a registry in Runs only if you want the gate written into the contract too.')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <input value={registryInput} onChange={(e) => setRegistryInput(e.target.value)} placeholder="0x… (ExchangeKycRegistry)" className="w-96 max-w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-xs text-ink font-mono" />
              <button onClick={saveRegistry} disabled={busy !== null || !EVM_RE.test(registryInput.trim())} className="rounded-full border border-ink/10 px-3 py-1.5 text-xs text-ink/70 hover:border-volt hover:text-volt disabled:opacity-50">
                {busy === 'registry' ? '…' : t('Save the registry on this run (unlocks the on-chain gate)')}
              </button>
            </div>
          </div>
        ) : null}
        {ceremonyOpen ? (
          <CredentialCeremonyModal
            initial={ceremonyInitial}
            onClose={() => {
              setCeremonyOpen(false);
              setKycNonce((n) => n + 1);
            }}
            onCompleted={(r) => {
              void recordCredentialReceipt(r);
              setKycNonce((n) => n + 1);
            }}
          />
        ) : null}
      </Step>

      {/* E4 */}
      <Step n="E4" title={t('The omnibus: deposits by tag (watcher, read-only)')} icon={ScanLine}>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="font-mono text-ink/70">{run.omnibusAddress}</span>
          <button onClick={() => void demo.scanOmnibus()} className="rounded-full border border-ink/10 px-3 py-1 text-xs text-ink/70 hover:border-volt hover:text-volt inline-flex items-center gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> {t('Scan the omnibus')}
          </button>
          {demo.omnibus?.ok ? <span className="text-ink/50">{t('scanned')} {new Date(demo.omnibus.data.scannedAt).toLocaleTimeString()} · {demo.omnibus.data.credited.length} {t('new movements credited')}</span> : null}
        </div>
        {demo.omnibus?.ok && demo.omnibus.data.txs.length ? (
          <div className="max-h-56 overflow-auto rounded-xl border border-ink/10">
            <table className="w-full text-[11px]">
              <thead className="text-[10px] uppercase tracking-wider text-ink/50 sticky top-0 bg-surface-1"><tr><th className="text-left p-1.5">{t('when')}</th><th className="text-left">{t('kind')}</th><th className="text-left">{t('tag')}</th><th className="text-right">XRP</th><th className="text-left">{t('from → to')}</th><th /></tr></thead>
              <tbody>
                {demo.omnibus.data.txs.slice(0, 30).map((x) => (
                  <tr key={x.hash} className="border-t border-ink/5 text-ink">
                    <td className="p-1.5 font-mono">{x.dateISO.replace('T', ' ').slice(5, 16)}</td>
                    <td>{x.kind === 'other' ? <span className="text-ink/40">{t('other')}</span> : <span className={x.kind === 'withdraw' ? 'text-tone-warning' : 'text-tone-success'}>{t(x.kind)}</span>}{x.memoHex?.startsWith('FE') ? <span className="ml-1 text-ink/40">0xFE</span> : null}</td>
                    <td className="font-mono">{x.destinationTag ?? '—'}</td>
                    <td className="text-right font-mono">{dropsToXrp(x.drops)}</td>
                    <td className="font-mono text-ink/60">{shortHash(x.account, 5, 3)} → {shortHash(x.destination, 5, 3)}</td>
                    <td className="text-right pr-1.5">{x.explorerUrl ? <a href={x.explorerUrl} target="_blank" rel="noreferrer" className="text-volt underline">{t('explorer')}</a> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Step>

      {/* Autopilot — the simulated exchange backend. 18-sep: fuera de la vista
          (AUTOPILOT_UI); la estación sirve las peticiones con el QR del omnibus,
          la MISMA cola que la consola. */}
      {AUTOPILOT_UI ? (
        <Step n="AUTO" title={t('Exchange backend (autopilot): the simulated exchange key fulfils client requests')} icon={ScanLine}>
          <AutopilotPanel demo={demo} />
        </Step>
      ) : (
        <Step n="AUTO" title={t('Client requests — the omnibus signs each one with a QR')} icon={ScanLine}>
          <DeskRequestQueue demo={demo} run={run} onBlockedChange={setQueueBlocked} />
        </Step>
      )}

      {/* E5 — apagado (DESK_PUT_TO_WORK_UI): el cliente lo pide y el autopilot lo
          ejecuta. Solo vuelve a pintarse si hay un put-to-work manual EN VUELO,
          para que su puerta de firma nunca se desmonte a medias. */}
      {DESK_PUT_TO_WORK_UI || workPending || workBlocked || (run.deskPayments ?? []).some((p) => p.kind === 'put-to-work' && (p.status === 'prepared' || p.status === 'signed')) ? (
      <Step n="E5" title={t('Put a client\'s XRP to work — the exchange signs, the shares are the client\'s')} icon={Wallet}>
        {workPending ? (
          <div className="space-y-2 text-xs">
            <p className="text-ink/70">{t('{xrp} XRP from the omnibus → FXRP → deposit into the pote with receiver = {account}. Fees: {fees}.')
              .replace('{xrp}', workXrp).replace('{account}', shortHash(workPending.client.passkeyAccount, 8, 4))
              .replace('{fees}', workPending.handoff.disclosure?.lines?.[0] ?? '—')}</p>
            <OmnibusSignDoor xrplTx={workPending.handoff.xrplPayment as unknown as Record<string, unknown>} account={run.omnibusAddress} title={t('Put the client capital to work')} onSettled={(h) => void onWorkSigned(h)} onBlockedChange={setWorkBlocked} alreadyHandedOff={workBlocked} payloadExpiryMin={workPending.handoff.payloadExpiryMin} />
            {workBlocked ? blockedBackLine : <button onClick={() => void backFromWork()} className="text-xs text-ink/50 hover:text-ink">{t('Back')}</button>}
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-ink/60">
              {t('Client')}
              <select value={workClientId} onChange={(e) => setWorkClientId(e.target.value)} className="mt-1 rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink">
                <option value="">—</option>
                {clientsWithAccount.map((c) => <option key={c.id} value={c.id}>{c.label} · tag {c.tag} · {dropsToXrp(c.xrpOnExchangeDrops)} XRP</option>)}
              </select>
            </label>
            <label className="text-xs text-ink/60">
              {t('XRP to put to work')}
              <input value={workXrp} onChange={(e) => setWorkXrp(e.target.value)} inputMode="decimal" placeholder="0.0" className="mt-1 w-32 rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink" />
            </label>
            <button onClick={composeWork} disabled={busy !== null || !run.poteAddress} className="rounded-full bg-volt px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50 inline-flex items-center gap-1.5">
              {busy === 'work' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wallet className="w-3.5 h-3.5" />} {t('Compose (omnibus signs in Xaman)')}
            </button>
          </div>
        )}
        {renderInFlight('put-to-work')}
        <p className="text-[11px] text-ink/50">{t('Mode B (custodial): the omnibus pays the Core Vault with a 42-byte 0xFE memo; the executor mints FXRP and deposits into the pote naming the client account as receiver. The client signs nothing and owns the shares from the first block.')}</p>
      </Step>
      ) : null}

      {/* E6 + E7 */}
      <Step n="E6" title={t('Direct the capital — by council order (XRPL → FDC → bridge)')} icon={Landmark}>
        {/* Qué hay, qué está libre y qué está EN CAMINO (fundador 14-sep: «no me
            aparece en ningún sitio lo que hay en el vault»). Con todo a 0 la
            estación no decía si el pote estaba vacío o si el dinero venía de
            camino — y un 0xFE firmado sin executor que lo acuñe parece dinero
            desaparecido. */}
        {pote ? (() => {
          const symbol = pote.asset?.symbol ?? 'FXRP';
          const inTransit = (run.requests ?? []).filter((q) => q.kind === 'put-to-work' && (q.status === 'signed' || q.status === 'submitting'));
          const transitDrops = inTransit.reduce((s, q) => s + BigInt(q.drops), BigInt(0));
          const stale = inTransit.some((q) => Date.parse(q.updatedAt) < Date.now() - 10 * 60_000);
          return (
            <div className="rounded-xl bg-surface-2 p-3 space-y-1.5 text-xs text-ink/70">
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <span>{t('Total in the pote')}: <span className="font-mono text-ink">{fmtBase(pote.totalAssets, dec)} {symbol}</span></span>
                <span>{t('Free to direct (buffer)')}: <span className="font-mono text-ink">{fmtBase(pote.freeBalance, dec)} {symbol}</span></span>
                <span>
                  {t('Directable now (keeps the {pct}% minimum buffer)').replace('{pct}', String((pote.bufferFloorBps || 0) / 100))}:{' '}
                  <span className="font-mono text-ink">{fmtBase(directableBase(pote).toString(), dec)} {symbol}</span>
                </span>
              </div>
              {transitDrops > BigInt(0) ? (
                <div className="space-y-1">
                  <p className="text-tone-warning">
                    {t('On its way to the pote: {xrp} XRP — the payment is signed and validated on XRPL; it becomes FXRP in the pote when an executor mints it.').replace('{xrp}', dropsToXrp(transitDrops.toString()))}
                    {inTransit.filter((q) => q.txHash).map((q) => (
                      <a key={q.id} href={`https://xrpscan.com/tx/${q.txHash}`} target="_blank" rel="noreferrer" className="ml-2 font-mono text-volt hover:underline">{shortHash(q.txHash!, 6, 4)}</a>
                    ))}
                  </p>
                  {stale ? <p className="text-tone-warning">{t('It has been waiting for more than 10 minutes: check that an executor is running for this environment.')}</p> : null}
                </div>
              ) : BigInt(pote.totalAssets || '0') === BigInt(0) ? (
                <p className="text-ink/55">{t('The pote is empty: capital arrives when a client puts XRP to work and an executor mints it. There is nothing to direct yet.')}</p>
              ) : null}
            </div>
          );
        })() : null}
        {pote ? (
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-ink/50"><tr><th className="text-left py-1">#</th><th className="text-left">{t('Venue')}</th><th className="text-right">{t('Working')}</th></tr></thead>
            <tbody>
              {pote.venues.map((v) => (
                <tr key={v.id} className="border-t border-ink/5 text-ink">
                  <td className="py-1">{v.id}</td>
                  <td>
                    {/* El nombre sale del mapa verificado (venueIdentity); si no está, solo la dirección — nunca un nombre inventado. */}
                    {(() => {
                      const id = venueIdentity(v.target);
                      return id.known ? (
                        <span>{id.name} <span className="text-ink/45">· {id.product}</span> <span className="font-mono text-ink/40">{shortHash(v.target, 6, 4)}</span></span>
                      ) : (
                        <span className="font-mono">{shortHash(v.target, 8, 4)} <span className="font-sans text-ink/45">· {v.kind}</span></span>
                      );
                    })()}
                  </td>
                  <td className="text-right font-mono">{fmtBase(v.value, dec)}</td>
                </tr>
              ))}
              <tr className="border-t border-ink/5 text-ink/60"><td className="py-1" /><td>{t('buffer (free)')}</td><td className="text-right font-mono">{fmtBase(pote.freeBalance, dec)}</td></tr>
            </tbody>
          </table>
        ) : <p className="text-xs text-ink/50">{t('The pote is not born yet (E2).')}</p>}
        {orderPending ? (
          <div className="space-y-2">
            <p className="text-xs text-ink/70">{orderPending.prepared.order.summary}</p>
            {/* What the server took on (or could not): delivery it cannot promise, the
                same order already out. Said next to it; signing stays possible. */}
            {councilOrderServerWarnings(orderPending.prepared).map((w) => (
              <p key={w} data-testid="order-recovery-warning" className="text-[11px] text-tone-warning">{w}</p>
            ))}
            {/* A recall is an EXIT: the token the server issued travels with it, so a
                bad read (or a region) can never close the way back (R3 3.1). */}
            <CouncilSigningDoors xrplTx={orderPending.prepared.xrplTx as unknown as Record<string, unknown>} account={orderPending.prepared.account} exitToken={councilOrderExitToken(orderPending.prepared)} defaultTitle={t('Sign the council order')} onSettled={(h) => void onOrderSigned(h)} onBlockedChange={setOrderBlocked} onStaleFate={staleLock.report} />
            {orderBlocked ? blockedBackLine : <button onClick={() => setOrderPending(null)} className="text-xs text-ink/50 hover:text-ink">{t('Back')}</button>}
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-ink/60">
              {t('Venue')}
              <input type="number" min={0} value={venueId} onChange={(e) => setVenueId(Number(e.target.value))} className="mt-1 w-20 rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink" />
            </label>
            <label className="text-xs text-ink/60">
              {t('Amount')} ({pote?.asset?.symbol ?? 'FXRP'})
              <input value={orderAmount} onChange={(e) => setOrderAmount(e.target.value)} inputMode="decimal" placeholder="0.0" className="mt-1 w-32 rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink" />
              {pote && directableBase(pote) > BigInt(0) ? (
                <button
                  type="button"
                  onClick={() => {
                    // El MÁXIMO dirigible (deja el colchón mínimo), en decimal exacto desde
                    // las unidades base — sin float ni separadores de locale.
                    const s = directableBase(pote).toString().padStart(dec + 1, '0');
                    setOrderAmount(`${s.slice(0, -dec)}.${s.slice(-dec)}`);
                  }}
                  className="ml-2 text-[11px] text-volt hover:underline"
                >
                  {t('Fill with the most you can direct')}
                </button>
              ) : null}
            </label>
            <button onClick={() => composeOrder('direct-to')} disabled={busy !== null || !pote || staleBlocks} className="rounded-full bg-volt px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50">{t('Direct to venue')}</button>
            {/* SIN `staleBlocks`: un recall es una SALIDA (venue → colchón) y
                una salida jamás la gatea una pantalla nuestra — se avisa. */}
            <button onClick={() => composeOrder('recall')} disabled={busy !== null || !pote} className="rounded-full border border-ink/10 px-3 py-1.5 text-xs text-ink/70 hover:border-volt hover:text-volt disabled:opacity-50">{t('Recall to buffer')}</button>
            {staleBlocks ? (
              <p className="w-full text-[11px] text-tone-warning">{t('A spent order is on hold above: new orders wait until you confirm you checked it. Recall to buffer does not wait — an exit is never held back.')}</p>
            ) : null}
          </div>
        )}
        {duplicateOffer && isDuplicateCheckUnreadable({ code: duplicateOffer.code }) ? (
          <CouncilOrderInFlightConfirm
            detail={duplicateOffer.detail}
            code={duplicateOffer.code}
            retryAfterSeconds={duplicateOffer.retryAfterSeconds}
            busy={busy !== null}
            onConfirm={() => void composeOrder(duplicateOffer.action, true)}
            onRetry={() => void composeOrder(duplicateOffer.action)}
            onDismiss={() => setDuplicateOffer(null)}
          />
        ) : duplicateOffer ? (
          <div data-testid="order-duplicate-offer" className="rounded-xl border border-tone-warning/40 bg-tone-warning/[0.06] p-3 space-y-1.5">
            <p className="text-xs text-ink/80">{duplicateOffer.text}</p>
            <p className="text-[11px] text-ink/55">{t('This is not the cage refusing: nothing was recorded and nothing was signed. Compose another one only if you mean the capital to move again.')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => void composeOrder(duplicateOffer.action, true)}
                /**
                 * it. 19 (R5) — ESTE BOTÓN ES LA CONFIRMACIÓN, NO ALGO QUE
                 * CONFIRMAR. El candado de la orden caducada existe para que
                 * nadie componga otra vez «sin mirar»; pulsar aquí, con el
                 * aviso delante y la frase de arriba diciendo que nada se firmó
                 * ni se registró, ES mirar. Gatearlo dejaba a la persona en un
                 * bucle: el aviso le ofrece componer, y el botón que lo ofrece
                 * está apagado por un candado que se abre en otra parte de la
                 * pantalla. `staleLockBlocks` ya contempla la confirmación
                 * explícita — se usa esa puerta, no `staleBlocks` a secas.
                 * (Un `recall` es una SALIDA: nunca se gateó y sigue sin serlo.)
                 */
                disabled={busy !== null || staleLock.blocks(duplicateOffer.action === 'recall' ? 'exit' : 'other', { confirmed: true })}
                className="rounded-full border border-tone-warning/50 px-3 py-1.5 text-xs text-tone-warning hover:bg-tone-warning/10 disabled:opacity-50"
              >
                {t('Compose another order anyway')}
              </button>
              <button onClick={() => setDuplicateOffer(null)} className="text-[11px] text-ink/50 hover:text-ink">{t('Leave it')}</button>
            </div>
          </div>
        ) : null}
        {denied ? (
          <div className="rounded-xl border border-danger/40 bg-danger/5 p-3 space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-danger"><ShieldAlert className="w-4 h-4" /> DENIED — {denied.error}</div>
            {denied.detail ? <p className="text-xs text-ink/70">{denied.detail}</p> : null}
            <p className="text-[11px] text-ink/50">{t('The mandate only moves capital between listed venues, above the buffer floor, under the cap. There is no other door — that is the product. Recorded in Evidence as proof.')}</p>
          </div>
        ) : null}
        <p className="text-[11px] text-ink/50 flex items-start gap-1"><XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {t('E7 · To show "the robbery is impossible": direct more than the cap, below the buffer floor, or to a venue that is not listed — the cage refuses before anyone signs, and it is recorded.')}</p>
      </Step>

      {/* E8 */}
      <Step n="E8" title={t('Pay a client out to their own wallet (exchange withdrawal)')} icon={Wallet}>
        {payPending ? (
          <div className="space-y-2">
            <OmnibusSignDoor xrplTx={payPending.xrplTx} account={run.omnibusAddress} title={t('Pay the client out')} onSettled={(h) => void onPayoutSigned(h)} onBlockedChange={setPayBlocked} alreadyHandedOff={payBlocked} />
            {payBlocked ? blockedBackLine : <button onClick={() => void backFromPay()} className="text-xs text-ink/50 hover:text-ink">{t('Back')}</button>}
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-ink/60">
              {t('Client')}
              <select value={payClientId} onChange={(e) => setPayClientId(e.target.value)} className="mt-1 rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink">
                <option value="">—</option>
                {run.clients.filter((c) => c.xrplAddress).map((c) => <option key={c.id} value={c.id}>{c.label} · {dropsToXrp(c.xrpOnExchangeDrops)} XRP</option>)}
              </select>
            </label>
            <label className="text-xs text-ink/60">
              XRP
              <input value={payXrp} onChange={(e) => setPayXrp(e.target.value)} inputMode="decimal" placeholder="0.0" className="mt-1 w-32 rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink" />
            </label>
            <button onClick={composePayout} disabled={busy !== null} className="rounded-full bg-volt px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50">{t('Compose the payout (omnibus signs)')}</button>
          </div>
        )}
        {run.clients.some((c) => !c.xrplAddress) ? (
          <div className="flex flex-wrap items-end gap-2 rounded-xl border border-ink/10 bg-surface-2/40 p-2.5">
            <label className="text-xs text-ink/60">
              {t('Client without an XRPL wallet')}
              <select value={walletClientId} onChange={(e) => setWalletClientId(e.target.value)} className="mt-1 block rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink">
                <option value="">—</option>
                {run.clients.filter((c) => !c.xrplAddress).map((c) => <option key={c.id} value={c.id}>{c.label} · tag {c.tag}</option>)}
              </select>
            </label>
            <label className="text-xs text-ink/60">
              {t('Their XRPL wallet (r…)')}
              <input value={walletInput} onChange={(e) => setWalletInput(e.target.value)} placeholder="r…" className="mt-1 w-72 max-w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink font-mono" />
            </label>
            <button onClick={saveClientWallet} disabled={busy !== null || !walletClientId || !XRPL_RE.test(walletInput.trim())} className="rounded-full border border-ink/10 px-3 py-1.5 text-xs text-ink/70 hover:border-volt hover:text-volt disabled:opacity-50">
              {busy === 'wallet' ? '…' : t('Save the wallet (unlocks the payout)')}
            </button>
          </div>
        ) : null}
        {renderInFlight('withdraw')}
        <p className="text-[11px] text-ink/50">{t('The exchange\'s normal withdrawal rail: a real XRPL payment from the omnibus to the client\'s own wallet, refused by the demo ledger if it cannot cover it.')}</p>
      </Step>
    </div>
  );
}
