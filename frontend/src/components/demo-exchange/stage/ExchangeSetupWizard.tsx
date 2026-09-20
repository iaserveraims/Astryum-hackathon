'use client';

/**
 *
 *   0 Raíz          una cuenta XRPL nueva y virgen en tu Xaman (K1)
 *   1 Credenciales  CASP (tu licencia) + KYB (el registro del vehículo), paste-link→URI
 *   2 Constitución  SHA-256 anclado por DIDSet
 *   3 Jaula         un 0xFE de la raíz — nace sin capital
 *   4 Pote          orden de consejo create-pote, venues de la whitelist
 *   5 Designación   la raíz nombra a su omnibus (OMNIBUS, 2 firmas) — jerarquía en el ledger
 *   6 La mesa       el perfil del run (omnibus, política) → Operar; tus users se dan de alta
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, BookOpen, Check, ExternalLink, KeyRound, Loader2, PenLine, Smartphone, Wallet, X } from 'lucide-react';
import Link from 'next/link';
import { Card, GhostButton, MicroLabel, PrimaryButton } from '../../ui/primitives';
import { StationProgress, StationRailLayout } from '../../ui/StationProgress';
import { StationDoneStrip, useResumeToast } from '../../ui/StationDoneNotice';
import { ModalOverlay } from '../../ui/ModalPortal';
import { HelpDot } from '../../ui/HelpDot';
import { useT } from '../../../i18n/LanguageProvider';
import { useWalletStore } from '../../../stores/walletStore';
import { useXrplWalletPartner } from '../../../lib/wallet/useXrplWalletPartner';
import { WalletSelect, type WalletFaceRecord } from '../../wallet/WalletSelect';
import { useLinkedRecordOf } from '../../../hooks/useLinkedRecordOf';
import { walletDisplayName } from '../../../lib/walletIdentity';
import { shortAddr } from '../../../lib/institutional/format';
import { CageBirthStation, ConstitutionStation } from '../../managed/ManagerSetupWizard';
import { buildExchangeConstitution } from '../../../lib/institutional/exchangeConstitutionTemplate';
import { ManagerPublicProfile } from '../../managed/ManagerPublicProfile';
import { CredentialTray } from '../../institutional/CredentialTray';
import { CredentialCeremonyModal } from '../../institutional/CredentialCeremonyModal';
import { CouncilOrderInFlightConfirm, StaleOrderLockNote, XamanSignBlockedNote, XamanSingleSign } from '../../xrpl/XamanSingleSign';
// UN candado por pantalla. Dos consolas con su propio
// `useStaleOrderLock` acababan con dos copias del mismo candado, y «I checked»
// liberaba solo la de su componente — la otra seguía pausada hasta remontar.
import { ExchangeStaleLockScope, useExchangeStaleLock } from '../ExchangeStaleLockScope';
import {
  readCredentialTray,
  readManagerCredentialStatus,
  type CredentialsTray,
  type ManagerCredentialStatus } from '../../../lib/xrpl/credentialsApi';
import {
  getCageOf,
  listRegistryVenues,
  prepareCageOrder,
  readCouncilAnchor,
  relayCouncilOrder,
  // Los MISMOS lectores de las seis puertas del consejo.
  mayConfirmAnotherOrder,
  sameOrderMinutesAgo,
  type CageOrderPrepared,
  type CageSummary,
  type RegistryVenue,
} from '../../../lib/institutional/api';
import {
  // El paso que resuelve la puerta de operador en la estación 7.
  adminDoorStep,
  councilOrderServerWarnings,
  demoApi,
  describeCouncilOrderRefusal,
  describeRefusal,
  // El paso que resuelve OMNIBUS_OWNER_UNKNOWN (null en todo lo demás).
  omnibusOwnerUnknownStep,
  refusalIsRetryable,
  type DemoPolicy,
  type RunSummary,
} from '../../../lib/demo-exchange/api';
import type { DemoRunApi } from '../../../lib/demo-exchange/useDemoRun';
import { isForeignHistory, type SetupWitness } from '../../../lib/demo-exchange/foreignHistory';

const XRPL_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
const EVM_RE = /^0x[a-fA-F0-9]{40}$/;

/** Lo que el ledger aún no cuenta por sí mismo, guardado por raíz: el registro
 *  antes de que exista el run, la política elegida, y la orden de puerta
 *  enviada (con su hash — un hecho, no un check inventado). */
interface LocalSetup extends SetupWitness {
  /** La SEGUNDA cuenta: el omnibus del raíl, donde los clientes depositan por tag. */
  omnibus?: string;
  registry?: string;
  policy?: DemoPolicy;
  gateSent?: { pote: string; hash: string; at: string };
}
const LOCAL_KEY = (account: string) => `astryum:exchange:setup:${account}`;
function readLocal(account: string): LocalSetup {
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY(account));
    return raw ? (JSON.parse(raw) as LocalSetup) : {};
  } catch {
    return {};
  }
}
function writeLocal(account: string, patch: Partial<LocalSetup>): LocalSetup {
  const next = { ...readLocal(account), ...patch };
  try {
    window.localStorage.setItem(LOCAL_KEY(account), JSON.stringify(next));
  } catch {
    /* sin memoria no pasa nada */
  }
  return next;
}

/* ── Estación 5: la DESIGNACIÓN — la raíz nombra a su caja ──────── */
function AppointmentStation({ root, omnibus, appointed, onChanged }: { root: string; omnibus: string; appointed: boolean; onChanged: () => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <Card className="p-6">
      <MicroLabel>{t('The appointment — the root names its omnibus')}</MicroLabel>
      <p className="mt-2 max-w-[64ch] text-[13px] leading-relaxed text-ink/55">
        {t('The hierarchy goes on the ledger: the root issues an OMNIBUS credential to the omnibus account, and the omnibus ACCEPTS — two signatures, both in your Xaman. With a short expiry, renewing IS the periodic act of responsibility over the cash desk; revoking it (or letting it lapse) beheads the desk without ever touching a client exit.')}
      </p>
      {!omnibus ? (
        <p className="mt-3 text-[12px] text-tone-warning">{t('Save the omnibus account first (station 1).')}</p>
      ) : (
        <>
          <p className="mt-3 text-[12px] text-ink/50">
            {t('Issuer (the root)')}: <span className="font-mono">{shortAddr(root)}</span> · {t('Subject (the omnibus)')}: <span className="font-mono">{shortAddr(omnibus)}</span>
          </p>
          {appointed ? (
            <p className="mt-2 flex items-center gap-2 text-[12px] text-tone-success">
              <Check className="h-3.5 w-3.5" /> {t('Appointed: the omnibus holds a live OMNIBUS credential issued by this root.')}
            </p>
          ) : (
            <PrimaryButton className="mt-3" onClick={() => setOpen(true)}>{t('Name the omnibus (2 signatures)')}</PrimaryButton>
          )}
        </>
      )}
      {open ? (
        <CredentialCeremonyModal
          initial={{ issuer: root, subject: omnibus, credentialType: 'OMNIBUS' }}
          onClose={() => { setOpen(false); onChanged(); }}
          onCompleted={() => onChanged()}
        />
      ) : null}
    </Card>
  );
}

/* ── Estación 0: las DOS cuentas nuevas, en Xaman ────────────────────────── */
function ExchangeRootInXaman() {
  const { t } = useT();
  const steps = [
    { icon: Smartphone, title: t('In Xaman: add TWO new accounts'), body: t('Account switcher → “Add account” → “Create new account”, twice: one is the root (council), the other the omnibus for your users. The keys are born on your phone and never leave it — Astryum never sees them.') },
    { icon: PenLine, title: t('Write both secrets down, on paper'), body: t('Xaman shows each family seed once. Paper, offline: whoever holds the root holds the exchange authority; whoever holds the omnibus holds the clients\' XRP.') },
    { icon: Wallet, title: t('Activate them: 15–30 XRP the root, ~2 XRP the omnibus'), body: t('On the root, 1 XRP stays as base reserve, ~0.6 covers the credential and DID objects, the rest is the carrier of the cage birth (it comes back as FXRP) and margin. The omnibus only needs its reserve; the clients fill it.') },
    { icon: KeyRound, title: t('Connect them here'), body: t('Back in Astryum, connect both from Wallets and pick them above. Every station reads the ledger of the ROOT; the omnibus is what your desk and your backend will watch.') },
  ];
  return (
    <Card className="p-6">
      <MicroLabel>{t('Two fresh accounts, both dedicated')}</MicroLabel>
      <p className="mt-2 max-w-[64ch] text-[13px] leading-relaxed text-ink/55">
        {t('The same account system that already works in the non-custodial Astryum, replicated for the custodial case: governance lives in XRPL accounts, where the XRP is; the asset, when it works, lives on Flare. One root governs one cage, for ever — never reuse an account with a history.')}
      </p>
      <details className="mt-3 text-[12px]">
        <summary className="cursor-pointer text-ink/50 transition-colors hover:text-ink">{t('Why two accounts, and why both new')}</summary>
        <ul className="mt-2 space-y-1.5 text-ink/50">
          <li>· {t('One 0xFE in flight per account: ceremonial governance and frequent cash would step on each other\'s nonce.')}</li>
          <li>· {t('The credential never lives on an automated hot key: a backend compromise would take the cash AND the identity of the vehicle. Tomorrow the root is the SignerList of the board — it cannot be a hot wallet.')}</li>
          <li>· {t('Each XRPL account has ONE Personal Account on Flare: sharing would mix the book of governance acts with the cash operations.')}</li>
          <li>· {t('New, because one council = one cage for ever (a clean history as the record of the vehicle), and because the rail omnibus needs its own tag space, caps and evidence — the legacy omnibus keeps its life; capital migrates as clients come in.')}</li>
        </ul>
      </details>
      <ol className="mt-4 space-y-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex items-start gap-3">
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-ink/15 font-mono text-[10px] text-ink/45">{i + 1}</span>
            <s.icon className="mt-0.5 h-4 w-4 shrink-0 text-ink/35" strokeWidth={1.7} />
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-ink/80">{s.title}</p>
              <p className="mt-0.5 max-w-[58ch] text-[12px] leading-relaxed text-ink/50">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <Link href="/app/wallets?add=1" className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-volt/40 bg-volt/[0.08] px-3 py-1.5 text-[12px] font-medium text-volt">
        {t('Connect them from Wallets')} <ArrowUpRight className="h-3.5 w-3.5" />
      </Link>
    </Card>
  );
}

/* ── La SEGUNDA cuenta: el omnibus del raíl ──────────────────────────────── */
function OmnibusStation({ root, omnibus, onSaved }: { root: string; omnibus: string; onSaved: (addr: string) => void }) {
  const { t } = useT();
  const allWallets = useWalletStore((s) => s.wallets);
  // El apodo del DUEÑO, no la etiqueta de sesión.
  const linkedOf = useLinkedRecordOf();
  const others = useMemo(() => allWallets.filter((w) => w.isConnected && w.walletType === 'xaman' && w.address !== root), [allWallets, root]);
  const [input, setInput] = useState(omnibus);
  const [picked, setPicked] = useState(others.find((w) => w.address === omnibus)?.id ?? '');
  const valid = XRPL_RE.test(input.trim()) && input.trim() !== root;
  return (
    <Card className="p-6">
      <MicroLabel>{t('The second account — the omnibus for your users')}</MicroLabel>
      <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-ink/55">
        {t('Where your clients deposit, each with their tag — their slice of this account. NEW and dedicated to the rail; its seed lives in YOUR backend, never in Astryum. Pick another connected Xaman, or paste its r-address.')}
      </p>
      {omnibus ? (
        <p className="mt-3 flex items-center gap-2 text-[13px] font-medium text-tone-success"><Check className="h-4 w-4" /> {t('Omnibus on file')} — <span className="font-mono text-[12px]">{shortAddr(omnibus)}</span></p>
      ) : null}
      {others.length > 0 ? (
        <div className="mt-3 max-w-sm">
          <WalletSelect
            options={others.map((w) => {
              const linked = linkedOf(w.address);
              return {
                key: w.id,
                record: (linked ?? { address: w.address, walletType: w.walletType, ecosystem: 'xrpl' }) as WalletFaceRecord,
                name: linked ? walletDisplayName(linked, t) : (w.nickname || 'Xaman'),
                detail: shortAddr(w.address),
              };
            })}
            value={picked}
            onChange={(key) => { setPicked(key); const w = others.find((x) => x.id === key); if (w) setInput(w.address); }}
          />
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 text-[11px] text-ink/50">
          {t('Omnibus XRPL account (r…)')}
          <input value={input} onChange={(e) => { setInput(e.target.value); setPicked(''); }} placeholder="r…" className="mt-1 w-full rounded-lg border border-ink/10 bg-surface-2 px-3 py-2 font-mono text-[12px] text-ink" />
        </label>
        <PrimaryButton onClick={() => onSaved(input.trim())} disabled={!valid || input.trim() === omnibus} disabledReason={input.trim() === root ? t('The omnibus must be a different account from the root.') : !XRPL_RE.test(input.trim()) ? t('An XRPL r-address.') : t('Already on file.')}>
          {t('Save the omnibus')}
        </PrimaryButton>
      </div>
    </Card>
  );
}

/* ── Estación 1: las credenciales de la raíz ────────────────────────────── */
type LegState = 'in-force' | 'pending' | 'missing';
function legOf(group: string, tray: CredentialsTray | null): LegState {
  if (!tray) return 'missing';
  const types = group.split('|').map((s) => s.trim().toUpperCase());
  const mine = tray.credentials.filter((c) => types.includes(c.credentialType.toUpperCase()) && c.issuerAccepted);
  if (mine.some((c) => c.state === 'valid' || c.state === 'expiring-soon')) return 'in-force';
  if (mine.some((c) => c.state === 'pending-acceptance')) return 'pending';
  return 'missing';
}

function CredentialsStation({ account, status, statusFailed, onChanged }: { account: string; status: ManagerCredentialStatus | null; statusFailed: boolean; onChanged: () => void }) {
  const { t } = useT();
  const [tray, setTray] = useState<CredentialsTray | null>(null);
  const [trayFailed, setTrayFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const seq = useRef(0);

  const reloadTray = useCallback(() => {
    const mine = ++seq.current;
    setTrayFailed(false);
    readCredentialTray(account)
      .then((tr) => { if (mine === seq.current) setTray(tr); })
      .catch(() => { if (mine === seq.current) { setTray(null); setTrayFailed(true); } });
  }, [account]);
  useEffect(() => { reloadTray(); }, [reloadTray, tick]);
  const bump = () => { setTick((n) => n + 1); onChanged(); };

  const gateOff = status?.gate === 'disabled';
  const groups = status?.credentialTypes?.length ? status.credentialTypes : ['AIFM|CASP', 'KYC|KYB'];
  const legs = groups.map((g) => ({ group: g, state: legOf(g, tray) }));
  const legMeta = (group: string) => {
    const up = group.toUpperCase();
    if (up.includes('CASP') || up.includes('AIFM')) return { title: t('CASP — the licence of your sector'), how: t('Issued by an accredited issuer as an XLS-70 credential with an expiry. In the demo the reference issuer signs it; in production, a regulated third party.') };
    // KYB: la raíz de un exchange es una SOCIEDAD — su identidad es el
    // asiento del registro mercantil, no un KYC personal. El copy KYC queda
    // solo para entornos cuyo gate aún exija KYC a secas.
    if (up.includes('KYB')) return { title: t('KYB — the registration of your legal vehicle'), how: t('The entry of your company in the public register, as an XLS-70 credential with the register link as its evidence. It travels with the account, never with a document.') };
    return { title: t('KYC — who answers for the exchange'), how: t('The identity of the compliance officer behind the root, as an XLS-70 credential. It travels with the account, never with a document.') };
  };

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <MicroLabel>{t('Credentials of the root')}</MicroLabel>
            <p className="mt-1 max-w-[64ch] text-[12.5px] leading-relaxed text-ink/55">
              {t('The ledger gate reads the licence of YOUR sector plus the identity of who answers. Without both in force, the cage refuses to be born — the gate bites at the birth itself.')}
            </p>
          </div>
          <span className="rounded-full border border-ink/10 bg-ink/[0.03] px-2.5 py-1 font-mono text-[11px] text-ink/60">
            {legs.filter((l) => l.state === 'in-force').length} / {legs.length} · {t('in force')}
          </span>
        </div>
        {gateOff ? <p className="mt-2 text-[11px] text-ink/40">{t('The ledger gate is off in this environment — nothing is required yet, but everything here already works.')}</p> : null}
        {statusFailed || trayFailed ? (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-tone-warning">
            {t('The gate or the ledger could not be read right now, so nothing here is marked in force — that says nothing about your credentials.')}
            <button type="button" onClick={bump} className="underline underline-offset-2">{t('Retry')}</button>
          </p>
        ) : null}
        <ul className="mt-4 divide-y divide-ink/5">
          {legs.map((l) => {
            const m = legMeta(l.group);
            return (
              <li key={l.group} className="flex items-start gap-3 py-3">
                <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${l.state === 'in-force' ? 'bg-tone-success/15 text-tone-success' : l.state === 'pending' ? 'bg-volt/15 text-volt' : 'border border-ink/15 text-ink/30'}`}>
                  {l.state === 'in-force' ? <Check className="h-3 w-3" strokeWidth={2.5} /> : l.state === 'pending' ? <PenLine className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-ink/85">{m.title}</p>
                  <p className="mt-0.5 max-w-[60ch] text-[12px] leading-relaxed text-ink/50">{m.how}</p>
                </div>
                <span className="shrink-0 text-[11px] text-ink/45">
                  {l.state === 'in-force' ? t('In force') : l.state === 'pending' ? t('Waiting for your signature') : t('Not held yet')}
                </span>
              </li>
            );
          })}
        </ul>
        {/* LA EMISIÓN DE DEMO SE FUE DE AQUÍ. Los dos paste-link y los dos botones «sin link»
            llamaban al notario de rodaje, y esta pantalla no tiene puerta de
            fundadores. Viven ahora en /app/admin, tras `requireAdmin`. Aquí
            queda el camino de verdad: tu emisor acreditado emite, y tú aceptas
            abajo con tu firma. */}
        <p className="mt-3 text-[11px] leading-relaxed text-ink/45">
          {t('Your issuer grants the credentials to this account; when one arrives, it appears below to accept.')}
        </p>
        {notice ? <p className="mt-2 rounded-lg border border-ink/10 bg-ink/[0.02] p-2.5 text-[11px] text-ink/60">{notice}</p> : null}
        {error ? <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2.5 text-[11px] text-tone-warning">{error}</p> : null}
      </Card>
      {/* La bandeja: lo pendiente arriba, aceptar en Xaman — la firma es el consentimiento. */}
      {/* Con la bandeja YA leída aquí se le pasa (una lectura, no dos); si la
          lectura falló, se le deja leer por su cuenta y decir «no pude leer». */}
      {/* El botón «ceremonia como emisor» salió de esta estación: aquí la emisión la hace el notario de referencia — la
          ceremonia genérica sigue viva en el desk (E3) y en la designación. */}
      <CredentialTray account={account} tray={trayFailed ? undefined : tray} onReload={bump} refreshKey={tick} onAccepted={bump} gateIssuers={status?.acceptedIssuers} />
    </div>
  );
}

/* ── Estación 3: el registro KYC ─────────────────────────────────────────── */
/** DESCARTADA del flujo — CONSERVADA inerte, no
 *  borrada: si algún tenant quiere la puerta escrita en el contrato, vuelve. */
export function RegistryStation({ registry, runRegistry, onSaved }: { registry: string; runRegistry: string | null; onSaved: (addr: string) => void }) {
  const { t } = useT();
  const [input, setInput] = useState(registry);
  const [help, setHelp] = useState(false);
  const current = runRegistry ?? (registry || null);
  const forgeCmd = 'cd contracts\nKYC_ADMIN=<your EVM admin wallet> DEPLOYER_KEY=<deployer> \\\n  forge script script/DeployExchangeKycRegistry.s.sol \\\n  --rpc-url https://flare-api.flare.network/ext/C/rpc --broadcast\n# verify: cast call <registry> "admin()" → your EVM admin wallet';
  return (
    <Card className="p-6">
      <MicroLabel>{t('Your KYC registry on Flare')}</MicroLabel>
      <p className="mt-2 max-w-[64ch] text-[13px] leading-relaxed text-ink/55">
        {t('Each exchange has its own ExchangeKycRegistry: YOUR list of approved clients and their tag, the on-chain source of the return tag. Its admin is your compliance wallet on Flare (MetaMask) — Astryum is admin of none.')}
      </p>
      {current ? (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-[13px] font-medium text-tone-success">
          <Check className="h-4 w-4" /> {t('Registry on file')} — <span className="font-mono text-[12px]">{shortAddr(current)}</span>
          <span className="text-[11px] font-normal text-ink/40">· {runRegistry ? t('saved on the desk profile') : t('kept here until the desk profile exists')}</span>
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 text-[11px] text-ink/50">
          {t('Registry address (0x…)')}
          <input value={input} onChange={(e) => setInput(e.target.value.trim())} placeholder="0x…" className="mt-1 w-full rounded-lg border border-ink/10 bg-surface-2 px-3 py-2 font-mono text-[12px] text-ink" />
        </label>
        <PrimaryButton onClick={() => onSaved(input)} disabled={!EVM_RE.test(input) || input === current} disabledReason={!EVM_RE.test(input) ? t('A 0x address of 40 hex characters.') : t('Already on file.')}>
          {t('Save the registry')}
        </PrimaryButton>
        <GhostButton onClick={() => setHelp(true)}><BookOpen className="mr-1.5 inline h-3.5 w-3.5" /> {t('How to deploy it')}</GhostButton>
      </div>
      <p className="mt-2 text-[11px] text-ink/40">{t('Optional but recommended: without it, entry is gated by the exchange alone and the exit tag has no on-chain source.')}</p>
      {help ? (
        <ModalOverlay onEscape={() => setHelp(false)} lockScroll className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm">
          <div className="my-auto flex max-h-[min(90dvh,44rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-ink/10 bg-surface-1 shadow-2xl">
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-ink/5 px-6 py-5">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold tracking-tight text-ink">{t('Deploy your KYC registry')}</h2>
                <p className="mt-1 text-[12px] text-ink/45">{t('One forge script, one address to paste back here.')}</p>
              </div>
              <button type="button" onClick={() => setHelp(false)} aria-label={t('Close')} className="mt-1 shrink-0 text-ink/40 transition-colors hover:text-ink"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto scrollbar-thin px-6 py-5 text-[13px] leading-relaxed text-ink/60">
              <ol className="space-y-3">
                <li className="flex gap-3"><span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-ink/15 font-mono text-[10px] text-ink/45">1</span><span>{t('Decide the admin: the EVM wallet of your compliance officer (MetaMask on Flare). It will sign every setApprovedWithTag.')}</span></li>
                <li className="flex gap-3"><span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-ink/15 font-mono text-[10px] text-ink/45">2</span><span>{t('Run the deploy script from the contracts folder of the repo:')}<pre className="mt-2 overflow-x-auto rounded-lg border border-ink/10 bg-ink/[0.04] p-3 font-mono text-[11px] leading-relaxed text-ink/75">{forgeCmd}</pre></span></li>
                <li className="flex gap-3"><span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-ink/15 font-mono text-[10px] text-ink/45">3</span><span>{t('Paste the deployed address in this station. Station 7 points the pote at it by council order; from then on the contract — not Astryum, not the exchange — refuses deposits from accounts that are not approved.')}</span></li>
              </ol>
              <p className="text-[12px] text-ink/45">{t('The ledger carries the YES, never the NO: an AML rejection is never written on-chain.')}</p>
            </div>
          </div>
        </ModalOverlay>
      ) : null}
    </Card>
  );
}

/* ── Estación 5: abrir el pote ───────────────────────────────────────────── */
function PoteStation({ account, cage, policy, onPolicy, onOpened, onBlockedChange }: { account: string; cage: CageSummary | null; policy: DemoPolicy; onPolicy: (p: DemoPolicy) => void; onOpened: (hash: string) => void; /** The create-pote signature can no longer be dropped: the rail must not leave this station. `false` on unmount. */ onBlockedChange?: (blocked: boolean) => void }) {
  const { t } = useT();
  const [venues, setVenues] = useState<RegistryVenue[] | null>(null);
  const [venuesFailed, setVenuesFailed] = useState(false);
  const [order, setOrder] = useState<CageOrderPrepared | null>(null);
  /**
   * EL CANDADO DE LA ORDEN CADUCADA (R5 5.3). Las seis consolas
   * institucionales lo tenían y las dos pantallas del exchange no: firmar
   * pasada la ventana dejaba componer una SEGUNDA apertura sobre el mismo
   * capital sin un aviso. `create-pote` es una ENTRADA, así que se para y solo
   * lo abre la persona; ninguna salida se compone desde esta estación.
   */
  const staleLock = useExchangeStaleLock();
  const staleBlocks = staleLock.locked;
  // The create-pote request is live in Xaman (or signed): Cancel steps aside.
  const [orderBlocked, setOrderBlocked] = useState(false);
  // …and so does the station rail: leaving the station
  // unmounts the signature and drops it blind.
  useEffect(() => { onBlockedChange?.(orderBlocked); }, [orderBlocked, onBlockedChange]);
  useEffect(() => () => onBlockedChange?.(false), [onBlockedChange]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  /**
   * La negativa que la persona puede contestar — un duplicado que
   * el servidor VIO, o una comprobación que no pudo correr (`retryAfterSeconds`
   * y `confirmAnotherOrder` incluidos, que el `window.confirm` anterior tiraba).
   */
  const [duplicate, setDuplicate] = useState<{ code?: string; detail?: string; minutesAgo?: number | null; retryAfterSeconds?: number | null } | null>(null);

  useEffect(() => {
    let alive = true;
    setVenuesFailed(false);
    listRegistryVenues().then((r) => { if (alive) setVenues(r.venues); }).catch(() => { if (alive) { setVenues(null); setVenuesFailed(true); } });
    return () => { alive = false; };
  }, []);

  const wanted: Array<RegistryVenue['kind']> = policy === 'B' ? ['compoundv2', 'erc4626queued'] : ['compoundv2'];
  const chosen = (venues ?? []).filter((v) => v.status === 'active' && (!cage || v.chainId === cage.chainId) && wanted.includes(v.kind));
  const pote = cage?.potes[0] ?? null;

  async function compose(opts?: { confirmAnother?: boolean }) {
    setError(''); setBusy(true); setDuplicate(null);
    try {
      if (!cage) throw new Error(t('The cage is not born yet (station 5).'));
      if (chosen.length === 0) throw new Error(t('The Astryum venue registry has no active venue for this policy on this chain — list it first in /app/admin/registry.'));
      const params = {
        name: policy === 'B' ? 'Exchange pote B' : 'Exchange pote A',
        symbol: policy === 'B' ? 'exB-FXRP' : 'exA-FXRP',
        cooldownSeconds: policy === 'B' ? 259_200 : 0,
        bufferFloorBps: 1000,
        maxPayeeBps: 2000,
        maxDepositPerUser: '0',
        initialVenues: chosen.map((v) => ({ target: v.target, kind: v.kind })),
      };
      const res = await prepareCageOrder({ council: account, action: 'create-pote', params, ...(opts?.confirmAnother ? { confirmAnotherOrder: true } : {}) });
      // The same order went out minutes ago: said in words, and composed again
      // only if the person says so — never a raw code on screen (R5 1.1).
      //
      // Y «NO PUDIMOS COMPROBARLO» NO ES «SALIÓ HACE UN MOMENTO».
      // Esto era un `window.confirm` de dos salidas, así que sobre un
      // `DUPLICATE_CHECK_UNREADABLE` afirmaba un duplicado que nadie vio y tiraba
      // el reintento (`retryable`) y los segundos que el servidor pidió esperar.
      // Es el mismo panel de tres botones (no componer · Try again · componer
      // otra igual) que llevan las seis puertas del consejo desde la.
      if (!res.ok) {
        if (mayConfirmAnotherOrder(res.refusal) && !opts?.confirmAnother) {
          setDuplicate({ code: res.refusal.error, detail: res.refusal.detail, minutesAgo: sameOrderMinutesAgo(res.refusal), retryAfterSeconds: res.refusal.retryAfterSeconds ?? null });
          return;
        }
        throw new Error(describeCouncilOrderRefusal(res.refusal, t));
      }
      setOrder(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function onSigned(hash: string) {
    if (!order) return;
    const { orderData } = order.order;
    setOrder(null);
    setNotice(t('Signed. Relaying the proof to Flare…'));
    void relayCouncilOrder(hash, orderData).then(
      (r) => {
        if (!r.ok) { setError(`${t('Signed, but the relay refused')} — HTTP ${r.status}${r.detail ? ` — ${r.detail}` : ''}`); setNotice(''); return; }
        setNotice(t('Relayed. The relayer pays the FDC proof and the cage opens the pote (~2–5 min); this station turns green on its own.'));
        onOpened(hash);
      },
      (e: unknown) => { setError(`${t('Signed, but the relay did not start')} — ${e instanceof Error ? e.message : String(e)}`); setNotice(''); },
    );
  }

  if (pote) {
    return (
      <Card className="p-6">
        <p className="flex items-center gap-2 text-[13px] font-medium text-tone-success"><Check className="h-4 w-4" /> {t('Your pote is open inside the cage')} — <span className="font-mono text-[12px]">{shortAddr(pote)}</span></p>
        <p className="mt-1 max-w-[62ch] text-[12px] leading-relaxed text-ink/50">{t('The ERC-4626 vault where your clients\' shares will live. Next: point it at your KYC registry, then set up the desk.')}</p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <MicroLabel>{t('Open the pote — a council order')}</MicroLabel>
      <p className="mt-2 max-w-[64ch] text-[13px] leading-relaxed text-ink/55">
        {t('The cage opens the pote by order of its root: an XRPL payment with a memo → FDC proof → the bridge executes createPote. The venues come from Astryum\'s allowlist for the policy you pick; the pote is born with a 10% buffer floor and a 20% cut.')}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {([['A', t('A — conservative, immediate exit')], ['B', t('B — yield, 72h cooldown')]] as Array<[DemoPolicy, string]>).map(([k, label]) => (
          <button key={k} type="button" onClick={() => onPolicy(k)} className={`rounded-full border px-3 py-1.5 text-[12px] transition-colors ${policy === k ? 'border-volt/50 bg-volt/[0.06] text-volt' : 'border-ink/10 text-ink/60 hover:border-ink/25'}`}>{label}</button>
        ))}
      </div>
      <div className="mt-3 rounded-xl border border-ink/10 bg-ink/[0.02] p-3 text-[12px]">
        <p className="text-[10px] uppercase tracking-wider text-ink/45">{t('Venues from the allowlist')}</p>
        {venues === null && !venuesFailed ? <p className="mt-1 flex items-center gap-1.5 text-ink/45"><Loader2 className="h-3 w-3 animate-spin" /> {t('Reading the registry…')}</p> : null}
        {venuesFailed ? <p className="mt-1 text-tone-warning">{t('The venue registry could not be read right now.')}</p> : null}
        {venues && chosen.length === 0 ? <p className="mt-1 text-tone-warning">{t('No active venue for this policy on this chain.')}</p> : null}
        {chosen.map((v) => <p key={v.target} className="mt-1 font-mono text-ink/70">{v.kind} · {shortAddr(v.target)}</p>)}
      </div>
      {order ? (
        <div className="mt-3 space-y-2">
          <p className="text-[12px] text-ink/70">{order.order.summary}</p>
          {/* What the server took on, or could not: delivery it cannot promise, the
              same order already out. Signing stays possible (residual). */}
          {councilOrderServerWarnings(order).map((w) => (
            <p key={w} data-testid="order-server-warning" className="text-[11px] text-tone-warning">{w}</p>
          ))}
          <XamanSingleSign
            txjson={order.xrplTx}
            title={t('Open the pote — the root signs')}
            onSettled={onSigned}
            onBlockedChange={setOrderBlocked}
            onCancelled={() => setOrder(null)}
            onStaleFate={staleLock.report}
          />
          {orderBlocked ? (
            <XamanSignBlockedNote />
          ) : (
            <button type="button" onClick={() => setOrder(null)} className="text-[11px] text-ink/50">{t('Cancel')}</button>
          )}
        </div>
      ) : (
        <PrimaryButton onClick={() => void compose()} disabled={busy || !cage || chosen.length === 0 || staleBlocks} disabledReason={!cage ? t('The cage is not born yet (station 5).') : chosen.length === 0 ? t('No active venue for this policy on this chain.') : staleBlocks ? t('An order whose window is spent is on hold — confirm you checked it first.') : undefined} className="mt-4">
          {busy ? <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" /> : null}{t('Compose the opening (1 signature)')}
        </PrimaryButton>
      )}
      <StaleOrderLockNote className="mt-3" lock={staleLock.lock} onRelease={staleLock.release} />
      {notice ? <p className="mt-2 rounded-lg border border-ink/10 bg-ink/[0.02] p-2.5 text-[11px] text-ink/60">{notice}</p> : null}
      {duplicate ? (
        <CouncilOrderInFlightConfirm
          className="mt-3"
          detail={duplicate.detail}
          code={duplicate.code}
          minutesAgo={duplicate.minutesAgo}
          retryAfterSeconds={duplicate.retryAfterSeconds}
          busy={busy}
          onConfirm={() => void compose({ confirmAnother: true })}
          onRetry={() => void compose()}
          onDismiss={() => setDuplicate(null)}
        />
      ) : null}
      {error ? <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2.5 text-[11px] text-tone-warning">{error}</p> : null}
    </Card>
  );
}

/* ── Estación 6: la puerta ───────────────────────────────────────────────── */
/** DESCARTADA del flujo — CONSERVADA inerte. */
export function GateStation({ account, pote, registry, sent, onSent }: { account: string; pote: string | null; registry: string | null; sent: LocalSetup['gateSent']; onSent: (hash: string) => void }) {
  const { t } = useT();
  const [order, setOrder] = useState<CageOrderPrepared | null>(null);
  // Misma regla que la estación del pote: `set-user-gate` es una orden de
  // ENTRADA (apunta la puerta), nunca una salida — se para con el candado.
  const staleLock = useExchangeStaleLock();
  const staleBlocks = staleLock.locked;
  // The gate order is live in Xaman (or signed): Cancel steps aside.
  const [orderBlocked, setOrderBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  /**
   * La negativa que la persona puede contestar — un duplicado que
   * el servidor VIO, o una comprobación que no pudo correr (`retryAfterSeconds`
   * y `confirmAnotherOrder` incluidos, que el `window.confirm` anterior tiraba).
   */
  const [duplicate, setDuplicate] = useState<{ code?: string; detail?: string; minutesAgo?: number | null; retryAfterSeconds?: number | null } | null>(null);

  async function compose(opts?: { confirmAnother?: boolean }) {
    setError(''); setBusy(true); setDuplicate(null);
    try {
      if (!pote || !registry) throw new Error(t('The pote and the KYC registry must both exist first.'));
      const params = { pote, gate: registry };
      const res = await prepareCageOrder({ council: account, action: 'set-user-gate', params, ...(opts?.confirmAnother ? { confirmAnotherOrder: true } : {}) });
      // El mismo panel de tres botones que la puerta de arriba —
      // «no pudimos comprobarlo» lleva reintento, y jamás afirma un duplicado.
      if (!res.ok) {
        if (mayConfirmAnotherOrder(res.refusal) && !opts?.confirmAnother) {
          setDuplicate({ code: res.refusal.error, detail: res.refusal.detail, minutesAgo: sameOrderMinutesAgo(res.refusal), retryAfterSeconds: res.refusal.retryAfterSeconds ?? null });
          return;
        }
        throw new Error(describeCouncilOrderRefusal(res.refusal, t));
      }
      setOrder(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  function onSigned(hash: string) {
    if (!order) return;
    const { orderData } = order.order;
    setOrder(null);
    void relayCouncilOrder(hash, orderData).then(
      (r) => {
        if (!r.ok) { setError(`${t('Signed, but the relay refused')} — HTTP ${r.status}${r.detail ? ` — ${r.detail}` : ''}`); return; }
        setNotice(t('Relayed. The pote points at your registry once the proof lands (~2–5 min).'));
        onSent(hash);
      },
      (e: unknown) => setError(`${t('Signed, but the relay did not start')} — ${e instanceof Error ? e.message : String(e)}`),
    );
  }

  return (
    <Card className="p-6">
      <MicroLabel>{t('The gate — point the pote at your registry')}</MicroLabel>
      <p className="mt-2 max-w-[64ch] text-[13px] leading-relaxed text-ink/55">
        {t('From here the CONTRACT rejects deposits from accounts that are not approved in your registry, and every exit with tag has its on-chain source (tagOf). Exits are never gated.')}
      </p>
      {sent && sent.pote === pote ? (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-[13px] font-medium text-tone-success">
          <Check className="h-4 w-4" /> {t('Order sent')} <span className="font-mono text-[12px] text-ink/60">{shortAddr(sent.hash)}</span>
          <a href={`https://livenet.xrpl.org/transactions/${sent.hash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-volt underline">{t('explorer')} <ExternalLink className="h-3 w-3" /></a>
          <span className="text-[11px] font-normal text-ink/40">· {new Date(sent.at).toLocaleString()}</span>
        </p>
      ) : null}
      {order ? (
        <div className="mt-3 space-y-2">
          <p className="text-[12px] text-ink/70">{order.order.summary}</p>
          {/* What the server took on, or could not: delivery it cannot promise, the
              same order already out. Signing stays possible (residual). */}
          {councilOrderServerWarnings(order).map((w) => (
            <p key={w} data-testid="order-server-warning" className="text-[11px] text-tone-warning">{w}</p>
          ))}
          <XamanSingleSign
            txjson={order.xrplTx}
            title={t('Point the gate — the root signs')}
            onSettled={onSigned}
            onBlockedChange={setOrderBlocked}
            onCancelled={() => setOrder(null)}
            onStaleFate={staleLock.report}
          />
          {orderBlocked ? (
            <XamanSignBlockedNote />
          ) : (
            <button type="button" onClick={() => setOrder(null)} className="text-[11px] text-ink/50">{t('Cancel')}</button>
          )}
        </div>
      ) : (
        <PrimaryButton onClick={() => void compose()} disabled={busy || !pote || !registry || staleBlocks} disabledReason={!pote ? t('The pote is not open yet (station 6).') : !registry ? t('No KYC registry on file (station 4).') : staleBlocks ? t('An order whose window is spent is on hold — confirm you checked it first.') : undefined} className="mt-4">
          {busy ? <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" /> : null}{sent && sent.pote === pote ? t('Send the order again') : t('Compose the gate order (1 signature)')}
        </PrimaryButton>
      )}
      <StaleOrderLockNote className="mt-3" lock={staleLock.lock} onRelease={staleLock.release} />
      {notice ? <p className="mt-2 rounded-lg border border-ink/10 bg-ink/[0.02] p-2.5 text-[11px] text-ink/60">{notice}</p> : null}
      {duplicate ? (
        <CouncilOrderInFlightConfirm
          className="mt-3"
          detail={duplicate.detail}
          code={duplicate.code}
          minutesAgo={duplicate.minutesAgo}
          retryAfterSeconds={duplicate.retryAfterSeconds}
          busy={busy}
          onConfirm={() => void compose({ confirmAnother: true })}
          onRetry={() => void compose()}
          onDismiss={() => setDuplicate(null)}
        />
      ) : null}
      {error ? <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2.5 text-[11px] text-tone-warning">{error}</p> : null}
    </Card>
  );
}

/* ── Estación 7: la mesa (el perfil del run) ─────────────────────────────── */
function DeskStation({ account, demo, existing, registry, policy, pote, omnibusDefault, onOperate }: { account: string; demo: DemoRunApi; existing: RunSummary | undefined; registry: string | null; policy: DemoPolicy; pote: string | null; omnibusDefault: string; onOperate: () => void }) {
  const { t } = useT();
  const [label, setLabel] = useState('');
  const [omnibus, setOmnibus] = useState(omnibusDefault);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Un 503 «no pude leerlo» no creó nada — se puede repetir.
  const [errorRetryable, setErrorRetryable] = useState(false);
  /**
   * Y una negativa que NO se arregla repitiendo, pero sí tiene un
   * paso — `OMNIBUS_OWNER_UNKNOWN`, que tapiaba al fundador que había entrado
   * por la puerta de admin. Se dice el paso; el botón de crear sigue ahí para
   * cuando lo haya dado.
   */
  const [errorStep, setErrorStep] = useState<string | null>(null);

  async function create() {
    setError('');
    setErrorRetryable(false);
    setErrorStep(null);
    if (!label.trim()) return setError(t('Give the exchange a name'));
    if (!XRPL_RE.test(omnibus.trim())) return setError(t('The omnibus XRPL address is not valid'));
    setBusy(true);
    const r = await demoApi.createRun({ label: label.trim(), councilAddress: account, omnibusAddress: omnibus.trim(), policy, registryAddress: registry ?? undefined, poteAddress: pote ?? undefined });
    setBusy(false);
    // La frase es NUESTRA. Aquí se pintaba el `detail` del servidor tal cual (y,
    // a falta de él, el código): la última estación del alta enseñaba
    // «OMNIBUS_IS_A_CLIENT_WALLET» a un operador (R5 copy).
    if (!r.ok) {
      setErrorRetryable(refusalIsRetryable(r.refusal));
      setErrorStep(omnibusOwnerUnknownStep(r.refusal, t) ?? adminDoorStep(r.refusal, t));
      return setError(describeRefusal(r.refusal, t));
    }
    await demo.refreshRuns();
    await demo.loadRun(r.data.run.runId);
    void demo.refreshChain();
    if (!r.data.run.poteAddress) void demoApi.resolvePote(r.data.run.runId).then(() => demo.reload());
  }

  if (existing) {
    return (
      <Card className="p-6">
        <p className="flex items-center gap-2 text-[13px] font-medium text-tone-success"><Check className="h-4 w-4" /> {t('The desk profile exists for this root')} — {existing.label}</p>
        <dl className="mt-3 grid gap-2 text-[12px] sm:grid-cols-2">
          <div className="rounded-xl bg-surface-2 p-3"><dt className="text-[10px] uppercase tracking-wider text-ink/45">{t('Omnibus')}</dt><dd className="break-all font-mono text-ink">{existing.omnibusAddress}</dd></div>
          <div className="rounded-xl bg-surface-2 p-3"><dt className="text-[10px] uppercase tracking-wider text-ink/45">{t('Policy')}</dt><dd className="font-mono text-ink">{existing.policy}</dd></div>
          <div className="rounded-xl bg-surface-2 p-3"><dt className="text-[10px] uppercase tracking-wider text-ink/45">{t('Pote')}</dt><dd className="break-all font-mono text-ink">{existing.poteAddress ?? t('not born yet')}</dd></div>
          <div className="rounded-xl bg-surface-2 p-3"><dt className="text-[10px] uppercase tracking-wider text-ink/45">{t('KYC registry')}</dt><dd className="break-all font-mono text-ink">{existing.registryAddress ?? t('none')}</dd></div>
        </dl>
        <PrimaryButton onClick={onOperate} className="mt-4">{t('Open the desk')} →</PrimaryButton>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <MicroLabel>{t('The desk profile')}</MicroLabel>
      <p className="mt-2 max-w-[64ch] text-[13px] leading-relaxed text-ink/55">
        {t('What Operate runs on: the omnibus where your clients deposit with a tag, the policy of your pote and your registry. The root is this account.')}
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <label className="text-[11px] text-ink/50">{t('Exchange name')}<input value={label} onChange={(e) => setLabel(e.target.value)} className="mt-1 w-full rounded-lg border border-ink/10 bg-surface-2 px-3 py-2 text-[13px] text-ink" /></label>
        <label className="text-[11px] text-ink/50">{t('Omnibus XRPL account (clients deposit here, with a tag)')}<input value={omnibus} onChange={(e) => setOmnibus(e.target.value)} placeholder="r…" className="mt-1 w-full rounded-lg border border-ink/10 bg-surface-2 px-3 py-2 font-mono text-[13px] text-ink" /></label>
        <div className="rounded-xl bg-surface-2 p-3 text-[12px]"><p className="text-[10px] uppercase tracking-wider text-ink/45">{t('Root (council)')}</p><p className="break-all font-mono text-ink">{account}</p></div>
        <div className="rounded-xl bg-surface-2 p-3 text-[12px]"><p className="text-[10px] uppercase tracking-wider text-ink/45">{t('Policy · registry · pote')}</p><p className="font-mono text-ink">{policy} · {registry ? shortAddr(registry) : t('none')} · {pote ? shortAddr(pote) : t('not born yet')}</p></div>
      </div>
      {/* LO QUE DECLARAR EL OMNIBUS SIGNIFICA (R5 5.1). Antes esta
          pantalla pedía la cuenta y el servidor la rechazaba si un administrador
          de sistemas no la había puesto antes en una variable de entorno: el
          alta moría aquí. Ahora la declaración ES la autorización, y se dice en
          términos de operador — no de despliegue. */}
      <p className="mt-3 max-w-[64ch] text-[11px] leading-relaxed text-ink/45">
        {t('Naming your omnibus here declares it as this exchange\'s cash desk: from then on only this desk prepares transactions against it, and a stranger\'s request on that account is refused. Its key stays where it always was — Astryum never holds it and never signs.')}
      </p>
      {error ? (
        <div className="mt-2 space-y-1">
          <p data-testid="desk-station-error" className="text-[11px] text-tone-warning">{error}</p>
          {errorStep ? (
            <p data-testid="desk-station-error-step" className="text-[11px] text-ink/60">{errorStep}</p>
          ) : null}
          {errorRetryable ? (
            <button type="button" onClick={() => void create()} disabled={busy} className="text-[11px] text-volt underline disabled:opacity-50">
              {t('Try again')}
            </button>
          ) : null}
        </div>
      ) : null}
      <PrimaryButton onClick={() => void create()} disabled={busy} className="mt-4">{busy ? <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" /> : null}{t('Create the desk profile')}</PrimaryButton>
    </Card>
  );
}

/* ── El wizard ───────────────────────────────────────────────────────────── */
export function ExchangeSetupWizard({ demo, onOperate }: { demo: DemoRunApi; onOperate: () => void }) {
  const { t } = useT();
  const { address: account } = useXrplWalletPartner();
  const allWallets = useWalletStore((s) => s.wallets);
  const setActiveWallet = useWalletStore((s) => s.setActiveWallet);
  const xrplWallets = useMemo(() => allWallets.filter((w) => w.isConnected && w.walletType === 'xaman'), [allWallets]);
  // El apodo del DUEÑO en el selector de la raíz, no la etiqueta de sesión
  // «Xaman 1 (…)».
  const linkedOf = useLinkedRecordOf();

  const [step, setStep] = useState(0);
  const landed = useRef(false);
  /** Dónde aterrizó la primera lectura real (para el aviso de «retomado»). */
  const [landedAt, setLandedAt] = useState<number | null>(null);
  // The active station has a Xaman signature that can no longer be dropped
  // (live QR, confirming, unconfirmed, validated failure). Leaving the station
  // unmounts it, and XamanSingleSign's unmount cancel is blind: a signature made
  // in that gap is followed by nobody and the station re-offers it.
  // The rail stays put until it resolves.
  const [stationBlocked, setStationBlocked] = useState(false);
  const go = (i: number) => { if (stationBlocked) return; landed.current = true; setStep(i); };

  // Lo detectado del ledger — «no pude leer» deja lo anterior, jamás pinta un check.
  const [cred, setCred] = useState<ManagerCredentialStatus | null>(null);
  const [credFailed, setCredFailed] = useState(false);
  // La bandeja de la raíz, leída aquí para el CHECK de la estación: con la
  // puerta apagada el gate contesta ok:true sin credencial alguna, y eso pintaba
  // la estación en verde sin mérito. Verde = las dos patas
  // vigentes en el ledger, diga lo que diga la puerta.
  const [tray, setTray] = useState<CredentialsTray | null>(null);
  const [anchor, setAnchor] = useState<{ anchored: boolean; sha256?: string }>({ anchored: false });
  const [cage, setCage] = useState<CageSummary | null>(null);
  // La designación del omnibus, leída del ledger (issuer == la raíz).
  const [appointed, setAppointed] = useState(false);
  const [local, setLocal] = useState<LocalSetup>({});
  useEffect(() => { setLocal(account ? readLocal(account) : {}); }, [account]);

  const existing = useMemo(
    () => demo.runs.find((r) => r.councilAddress === account && r.status === 'open') ?? demo.runs.find((r) => r.councilAddress === account),
    [demo.runs, account],
  );
  // RAÍZ CON HISTORIA. Una jaula sin mesa de este exchange es una vida
  // anterior — de gestor, o de otro producto. El flujo exige una raíz NUEVA
  // (un consejo = una jaula, para siempre; el hazard multi-registro): aquí se
  // dice, la estación 1 queda pendiente y no se avanza sobre esa cuenta. Pero
  // la jaula de ESTA alta también es «jaula sin mesa» hasta la estación 7:
  // la regla entera y sus pruebas viven en lib/demo-exchange/foreignHistory.
  const foreignHistory = isForeignHistory({ cage: Boolean(cage), existing: Boolean(existing), local, appointed });
  const registry = existing?.registryAddress ?? local.registry ?? null;
  // Con mesa creada, su omnibus manda (y la estación 0 se da por hecha).
  useEffect(() => {
    if (account && existing?.omnibusAddress && local.omnibus !== existing.omnibusAddress) setLocal(writeLocal(account, { omnibus: existing.omnibusAddress }));
  }, [account, existing?.omnibusAddress, local.omnibus]);
  const policy: DemoPolicy = existing?.policy ?? local.policy ?? 'A';
  const pote = cage?.potes[0] ?? existing?.poteAddress ?? null;

  const refreshRuns = demo.refreshRuns;
  const detect = useCallback(async () => {
    if (!account) return null;
    const [c, a, cg, tr] = await Promise.allSettled([readManagerCredentialStatus(account), readCouncilAnchor(account), getCageOf(account), readCredentialTray(account)]);
    void refreshRuns();
    const out = { credOk: false, gateOn: false, legsOk: false, anchored: false, cage: false, potes: 0, appointed: false };
    // La DESIGNACIÓN: ¿el omnibus sostiene una `OMNIBUS` vigente
    // EMITIDA POR esta raíz? Relacional — el emisor ES el vínculo, no hay
    // allowlist que valga aquí. Ilegible = sin veredicto (queda lo anterior).
    const omnibusAddr = readLocal(account).omnibus ?? '';
    if (omnibusAddr) {
      const ap = await readCredentialTray(omnibusAddr).catch(() => null);
      if (ap) {
        out.appointed = ap.credentials.some(
          (k) => k.issuer === account && k.credentialType.toUpperCase() === 'OMNIBUS' && (k.state === 'valid' || k.state === 'expiring-soon'),
        );
        setAppointed(out.appointed);
      }
    }
    if (c.status === 'fulfilled') { setCred(c.value); setCredFailed(false); out.credOk = !!c.value.ok; out.gateOn = c.value.gate === 'enabled'; } else setCredFailed(true);
    if (tr.status === 'fulfilled') {
      setTray(tr.value);
      const groups = c.status === 'fulfilled' && c.value.credentialTypes?.length ? c.value.credentialTypes : ['CASP', 'KYC'];
      out.legsOk = groups.every((g) => legOf(g, tr.value) === 'in-force');
    }
    if (a.status === 'fulfilled') { setAnchor(a.value); out.anchored = a.value.anchored; }
    if (cg.status === 'fulfilled') {
      const summary = cg.value.cage && !('unreadable' in cg.value.cage) ? cg.value.cage : null;
      // Ilegible = sin veredicto (se conserva lo anterior); null real = sin jaula.
      if (summary || !cg.value.cage) setCage(summary);
      out.cage = !!summary; out.potes = summary?.potes.length ?? 0;
      // Un «sin jaula» REAL (no ilegible) es la prueba de que la jaula que venga
      // después nace en esta alta — se recuerda por raíz.
      if (!cg.value.cage && !readLocal(account).virginSeen) setLocal(writeLocal(account, { virginSeen: true }));
    }
    return out;
  }, [account, refreshRuns]);

  useEffect(() => {
    void detect().then((r) => {
      if (!r || landed.current) return;
      landed.current = true;
      // XRPL-only: las estaciones de registro Flare y puerta
      // quedaron DESCARTADAS del flujo (los componentes se conservan abajo,
      // inertes). En su lugar: la DESIGNACIÓN del omnibus.
      const pending = [
        { i: 1, done: r.legsOk, required: r.gateOn },
        { i: 2, done: r.anchored, required: true },
        { i: 3, done: r.cage, required: true },
        { i: 4, done: r.potes > 0, required: true },
        { i: 5, done: r.appointed, required: false },
        { i: 6, done: !!existing, required: true },
      ];
      // La estación 0 solo está hecha con las DOS cuentas NUEVAS: sin omnibus, o con
      // una raíz que ya tiene jaula de otra vida, se aterriza en ella.
      const foreign = !!account && isForeignHistory({ cage: r.cage, existing: Boolean(existing), local: readLocal(account), appointed: r.appointed });
      if (!account || !readLocal(account).omnibus || foreign) { setStep(0); setLandedAt(0); return; }
      const first = pending.find((p) => p.required && !p.done) ?? pending.find((p) => !p.done);
      const target = first ? first.i : 6;
      setStep(target);
      setLandedAt(target);
    });
    // Aterrizaje: una vez por cuenta, con la primera lectura real.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detect]);

  // Sondeo tras firmar, vivo solo mientras el wizard esté montado.
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const settleThenDetect = useCallback((done: (r: NonNullable<Awaited<ReturnType<typeof detect>>>) => boolean, capMs = 90_000) => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    const startedAt = Date.now();
    const tick = async () => {
      const r = await detect();
      if (!mounted.current) return;
      if ((r && done(r)) || Date.now() - startedAt > capMs) return;
      pollTimer.current = setTimeout(() => void tick(), 6_000);
    };
    void tick();
  }, [detect]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (pollTimer.current) clearTimeout(pollTimer.current); };
  }, []);

  const gateOn = cred?.gate === 'enabled';
  const credOk = !!cred?.ok;
  const credGroups = cred?.credentialTypes?.length ? cred.credentialTypes : ['CASP', 'KYC'];
  const legsOk = credGroups.every((g) => legOf(g, tray) === 'in-force');
  const stations = [
    { label: t('Two new accounts'), purpose: t('The root that governs (council) and the omnibus where your users deposit by tag — both NEW, in your Xaman'), effort: t('~5 min · Xaman'), done: !!account && !!local.omnibus && !foreignHistory, required: true, how: foreignHistory ? t('this root already governs a cage from another life — the exchange root must be a NEW account') : t('root = the connected Xaman · omnibus = saved on this device') },
    { label: t('Credentials'), purpose: t('CASP (your licence) and KYB (your legal vehicle), issued to THIS account and accepted in Xaman'), effort: t('~10 min · issuer + your signatures'), done: legsOk, required: gateOn, how: t('both legs in force in the ledger (XLS-70)') },
    { label: t('The constitution'), purpose: t('Template or your own document; the fingerprint computes itself and anchors with 1 signature'), effort: t('~5 min · 1 signature'), done: anchor.anchored, required: true, how: t('DID object of the root, read from XRPL') },
    // XRPL-only: registro Flare y puerta DESCARTADOS del
    // flujo (componentes conservados, inertes). La identidad vive en XLS-70 y
    // la jerarquía se hace ledger con la DESIGNACIÓN del omnibus.
    { label: t('The cage'), purpose: t('Born with one 0xFE signature, obeying this account for ever — it locks no capital'), effort: t('~3 min · 1 signature + toll'), done: !!cage, required: true, how: t('cageOf(root) on the factory, read from Flare') },
    { label: t('The pote'), purpose: t('A council order opens the vault inside the cage, with the venues of your policy'), effort: t('~5 min · 1 signature + FDC'), done: (cage?.potes.length ?? 0) > 0, required: true, how: t('potes of the cage, read from Flare') },
    { label: t('The appointment'), purpose: t('The root names its omnibus on the ledger: an OMNIBUS credential from the root, accepted by the omnibus — revoke it and the cash desk stops; exits never do'), effort: t('~3 min · 2 signatures'), done: appointed, required: false, how: t('the omnibus holds a live OMNIBUS credential issued by this root, read from XRPL') },
    { label: t('The desk'), purpose: t('The exchange profile: omnibus and policy — what Operate runs on, and where your users sign up'), effort: t('~2 min'), done: !!existing, required: true, how: t('a desk profile whose council is this root') },
  ];
  const doneCount = stations.filter((s) => s.done).length;
  const firstRun = doneCount <= 1;
  // «¿Por qué está hecha?» vive en la franja de la estación (StationDoneStrip);
  // el aterrizaje más allá de la primera estación se avisa UNA vez, en una
  // notificación temporal (sin popups).
  useResumeToast({ landed: landedAt, stations, key: account });
  const nextPendingIdx = stations.findIndex((st) => !st.done);

  // EL RAÍL LATERAL: la barra al lado del contenido, pegada arriba
  // mientras se hace scroll, con los nombres a la vista, Atrás/Siguiente y el
  // «¿Por qué hecha?» — la misma pieza que el alta del gestor.
  const rail = (
    <StationProgress
      stations={stations.map((st) => ({ label: st.label, done: st.done }))}
      current={step}
      onSelect={go}
      ariaLabel={t('Setup stations')}
      doneWord={t('done')}
      // While the active station's signature blocks, Back/Next are not offered
      // (and `go` refuses a segment click): leaving would unmount the signature.
      onBack={stationBlocked ? undefined : () => go(Math.max(0, step - 1))}
      onNext={stationBlocked ? undefined : () => go(Math.min(stations.length - 1, step + 1))}
    />
  );

  return (
    <ExchangeStaleLockScope>
    <StationRailLayout rail={rail}>
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[15px] font-semibold tracking-tight text-ink">{stations[step].label}</span>
        <span className="text-[12px] text-ink/45">{stations[step].purpose}</span>
        <span className="ml-auto flex items-center gap-1.5">
          <span className={`rounded-full border px-2 py-0.5 text-[10px] ${stations[step].required ? 'border-volt/30 bg-volt/[0.06] text-volt/80' : 'border-ink/10 bg-ink/[0.03] text-ink/40'}`}>{stations[step].required ? t('Required') : t('Optional')}</span>
          <span className="rounded-full border border-ink/10 bg-ink/[0.03] px-2 py-0.5 text-[10px] text-ink/40">{stations[step].effort}</span>
        </span>
      </div>
      {/* DE DÓNDE SALE EL CHECK: cada estación dice qué se leyó para darla por hecha, o por
          qué sigue pendiente — la barra jamás inventa, y aquí se ve qué mira.
          La misma franja que el gestor y el Legacy. */}
      <StationDoneStrip
        done={stations[step].done}
        how={stations[step].how}
        nextPendingLabel={nextPendingIdx >= 0 && nextPendingIdx !== step ? stations[nextPendingIdx].label : undefined}
        onNextPending={nextPendingIdx >= 0 && nextPendingIdx !== step ? () => go(nextPendingIdx) : undefined}
      />
      {stationBlocked ? (
        <div className="space-y-0.5">
          <p className="text-[11px] leading-relaxed text-tone-warning">{t('The other stations stay closed until this signature is resolved.')}</p>
          <XamanSignBlockedNote />
        </div>
      ) : null}

      {step === 0 && (
        <>
          {firstRun ? (
            <Card className="p-6">
              <MicroLabel>{t('Becoming a tenant')}</MicroLabel>
              <p className="mt-2 max-w-[66ch] text-[13px] leading-relaxed text-ink/60">
                {t('Seven stations, once. You can leave at any station and come back: everything lives on the ledger, so the setup resumes exactly where reality is — each segment turns green when the chain says so, never before.')}
              </p>
              <p className="mt-2 max-w-[66ch] text-[12px] leading-relaxed text-ink/45">
                {t('What you bring from home: your omnibus (you already run one), your Xaman, your real licence, an EVM wallet for compliance, and your backend. What you create here: ONE new governing account, accredited, with its cage.')}
              </p>
            </Card>
          ) : null}
          <Card className="p-6">
            <MicroLabel>{t('Which account is the exchange authority?')}</MicroLabel>
            <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-ink/55">
              {t('Everything on this desk follows ONE XRPL account: credentials, constitution, cage and orders. Pick which of your connected Xaman wallets is the root.')}
            </p>
            <div className="mt-3 max-w-sm">
              {xrplWallets.length === 0 ? (
                <p className="text-[12px] text-tone-warning">{t('No Xaman wallet connected yet — connect the new account from Wallets first.')}</p>
              ) : (
                <WalletSelect
                  options={xrplWallets.map((w) => {
                    const linked = linkedOf(w.address);
                    return {
                      key: w.id,
                      record: (linked ?? { address: w.address, walletType: w.walletType, ecosystem: 'xrpl' }) as WalletFaceRecord,
                      name: linked ? walletDisplayName(linked, t) : (w.nickname || 'Xaman'),
                      detail: shortAddr(w.address),
                    };
                  })}
                  value={xrplWallets.find((w) => w.address === account)?.id ?? ''}
                  onChange={(key) => { const w = xrplWallets.find((x) => x.id === key); if (w) setActiveWallet(w); }}
                />
              )}
            </div>
            {cage && existing ? (
              <p className="mt-3 flex items-center gap-2 text-[12px] text-tone-success"><Check className="h-3.5 w-3.5" /> {t('This account already governs a cage — the setup resumes where the ledger is.')}</p>
            ) : null}
            {foreignHistory ? (
              <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-3 text-[12px] leading-relaxed text-tone-warning">
                <p className="font-medium">{t('This account already has a history — it cannot be the exchange root.')}</p>
                <p className="mt-1 text-tone-warning/80">
                  {t('It governs a cage')} <span className="font-mono">{shortAddr(cage!.cage)}</span>
                  {cage!.potes.length > 0 ? <> · {cage!.potes.length} {t('pote(s)')}</> : null}
                  {' — '}{t('born before this exchange existed (a manager root, most likely). One council governs one cage, for ever: attaching an exchange to it would mix two lives in one registry. Create a NEW account in Xaman for the root and pick it here.')}
                </p>
              </div>
            ) : null}
          </Card>
          {account ? (
            <OmnibusStation root={account} omnibus={existing?.omnibusAddress ?? local.omnibus ?? ''} onSaved={(addr) => setLocal(writeLocal(account, { omnibus: addr }))} />
          ) : null}
          <ExchangeRootInXaman />
        </>
      )}

      {foreignHistory && step > 0 ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-3 text-[12px] leading-relaxed text-tone-warning">
          {t('This root already has a history from another life: what the ledger shows here belongs to that life, not to this exchange. Go back to station 1 and pick a NEW account.')}
        </div>
      ) : null}
      {step === 1 && account && <CredentialsStation account={account} status={cred} statusFailed={credFailed} onChanged={() => void detect()} />}

      {step === 2 && account && (
        <ConstitutionStation
          account={account}
          anchored={anchor.anchored}
          anchoredSha={anchor.sha256}
          onAnchored={() => settleThenDetect((r) => r.anchored)}
          // La constitución del EXCHANGE: el omnibus aparece como
          // REGLA de designación + dirección inicial (Art. 3) — rotar la caja
          // es un acto de designación, no una enmienda.
          template={buildExchangeConstitution(t, account, local.omnibus ?? '')}
          onBlockedChange={setStationBlocked}
        />
      )}

      {step === 3 && account && (
        <CageBirthStation account={account} cage={cage?.cage ?? null} onBorn={() => { setLocal(writeLocal(account, { cageBornHere: true })); settleThenDetect((r) => r.cage, 300_000); }}titleMissing={gateOn && !credOk} onGoTitle={() => go(1)} onBlockedChange={setStationBlocked} />
      )}

      {step === 4 && account && (
        <PoteStation
          account={account}
          cage={cage}
          policy={policy}
          onPolicy={(p) => setLocal(writeLocal(account, { policy: p }))}
          onOpened={() => {
            settleThenDetect((r) => r.potes > 0, 360_000);
            if (existing) window.setTimeout(() => void demoApi.resolvePote(existing.runId).then(() => refreshRuns()), 150_000);
          }}
          onBlockedChange={setStationBlocked}
        />
      )}

      {step === 5 && account && (
        <AppointmentStation root={account} omnibus={local.omnibus ?? ''} appointed={appointed} onChanged={() => void detect()} />
      )}

      {step === 6 && account && (
        <>
          <DeskStation account={account} demo={demo} existing={existing} registry={registry} policy={policy} pote={pote} omnibusDefault={local.omnibus ?? ''} onOperate={onOperate} />
          {/* El espejo del gestor: lo que ven tus clientes — tu zona
              de credencial pública (CASP con su link del registro + disclaimer). */}
          <details className="rounded-2xl border border-ink/10 bg-surface-1 p-4">
            <summary className="cursor-pointer text-xs text-ink/60 hover:text-ink">{t('What your clients see — your public credential zone')}</summary>
            <div className="mt-3">
              <ManagerPublicProfile role="exchange" account={account} />
            </div>
          </details>
        </>
      )}

      {!account && step > 0 ? <p className="text-[12px] text-tone-warning">{t('Pick the root account first (station 1).')}</p> : null}

    </div>
    </StationRailLayout>
    </ExchangeStaleLockScope>
  );
}

export default ExchangeSetupWizard;
