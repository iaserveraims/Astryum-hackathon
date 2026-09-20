'use client';

/**
 * ManagerTitleStation — la estación «Título» entera, ordenada de arriba abajo
 * como se lee:
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUpRight, BadgeCheck, Bot, ChevronDown, Clock, Fingerprint, Loader2, ScrollText, ShieldAlert } from 'lucide-react';
import { useAccount, useSignMessage } from 'wagmi';
import { Card, MicroLabel } from '../ui/primitives';
import { useT } from '../../i18n/LanguageProvider';
import {
  discoverNotaryAttestation,
  notaryBindingMessage,
  readCredentialTray,
  readManagerCredentialStatus,
  requestNotaryRenew,
  type CredentialRead,
  type CredentialsTray,
  type ManagerCredentialStatus,
  type NotaryRenewLeg,
} from '../../lib/xrpl/credentialsApi';
import { setStoredManagerVc, storedManagerVc } from '../../lib/institutional/api';
import { managerTitleLegs, managerTitleTray } from '../../lib/managed/managerTitle';
import { CredentialTray } from '../institutional/CredentialTray';
import { ManagerCertificationCard } from './ManagerCertificationCard';
import { CoinbaseGuideButton } from './CoinbaseVerificationGuide';
import { refusalText, shortAddr as short } from '../../lib/institutional/format';
import { useMyWallets } from '../../hooks/useMyWallets';
import { getAppKitModal } from '../../lib/wallet/appkit';
import { WalletSelect } from '../wallet/WalletSelect';
import { walletDisplayName } from '../../lib/walletIdentity';

const UID_RE = /0x[0-9a-fA-F]{64}/;

type LegState = 'in-force' | 'pending' | 'expired' | 'other-issuer' | 'missing';

/**
 * El estado de UNA credencial exigida, leído de la bandeja. La puerta del
 * ledger solo cuenta las de un emisor de SU allowlist: una credencial válida
 * de otro emisor (p. ej. auto-emitida por la propia cuenta) existe, pero no
 * abre la puerta — y hay que decirlo así, no como «aún no la tienes».
 *
 * `tray` llega ya acotada a lo que ES de esta cuenta (sujeto = la cuenta) y a
 * las patas del gestor — ver managerTitleTray. El directorio del ledger
 * también lista lo que la cuenta EMITIÓ, y eso no es su título.
 */
function legStateOf(type: string, tray: CredentialsTray | null, issuers: Set<string>): { state: LegState; cred: CredentialRead | null } {
  if (!tray) return { state: 'missing', cred: null };
  const ofType = tray.credentials.filter((c) => c.credentialType.toUpperCase() === type.toUpperCase());
  const mine = ofType.filter((c) => issuers.size === 0 || issuers.has(c.issuer));
  const pick = (list: CredentialRead[], states: CredentialRead['state'][]) => list.find((c) => states.includes(c.state)) ?? null;
  const inForce = pick(mine, ['valid', 'expiring-soon']);
  if (inForce) return { state: 'in-force', cred: inForce };
  const pending = pick(mine, ['pending-acceptance']);
  if (pending) return { state: 'pending', cred: pending };
  const expired = pick(mine, ['expired']);
  if (expired) return { state: 'expired', cred: expired };
  const foreign = pick(ofType, ['valid', 'expiring-soon', 'pending-acceptance']);
  if (foreign) return { state: 'other-issuer', cred: foreign };
  return { state: 'missing', cred: null };
}

export function ManagerTitleStation({ account, onChanged }: { account: string; onChanged?: () => void }) {
  const { t } = useT();
  const [status, setStatus] = useState<ManagerCredentialStatus | null>(null);
  const [tray, setTray] = useState<CredentialsTray | null>(null);
  /** «No pude leer» la puerta o la bandeja: se dice, y NADA se pinta como vigente. */
  const [readFailed, setReadFailed] = useState<'status' | 'tray' | null>(null);
  const [tick, setTick] = useState(0);
  // Secuencia (revisión): al cambiar de cuenta, una respuesta lenta de
  // la anterior no puede pintarse bajo la nueva.
  const seqRef = useRef(0);

  const reload = useCallback(() => {
    const mine = ++seqRef.current;
    setReadFailed(null);
    readManagerCredentialStatus(account)
      .then((s) => { if (mine === seqRef.current) setStatus(s); })
      .catch(() => { if (mine === seqRef.current) { setStatus(null); setReadFailed('status'); } });
    readCredentialTray(account)
      .then((tr) => { if (mine === seqRef.current) setTray(tr); })
      .catch(() => { if (mine === seqRef.current) { setTray(null); setReadFailed((f) => f ?? 'tray'); } });
  }, [account]);
  useEffect(() => { setStatus(null); setTray(null); reload(); }, [reload, tick]);
  useEffect(() => () => { seqRef.current += 1; }, []);
  const bump = () => { setTick((n) => n + 1); onChanged?.(); };

  // ── El robot: descubrir la atestación → firmar el reto → emitir ─────────
  const { signMessageAsync } = useSignMessage();
  // LA WALLET EVM DE LA PATA KYC. Antes solo contaba la sesión viva de wagmi, que se guarda POR
  // DOMINIO: en otro navegador o en el dominio del preview no había sesión y
  // la estación decía «sin wallet EVM» con las dos enlazadas en Wallets. La
  // atestación de Coinbase se busca por DIRECCIÓN, así que una EVM enlazada a
  // la cuenta sirve para descubrirla; solo la firma del reto exige la sesión
  // viva, y ahí se abre el conector para ESA dirección. Misma regla que la
  // cuenta XRPL del gestor (useManagerAccount).
  const { address: liveEvm } = useAccount();
  const { wallets: myWallets } = useMyWallets();
  const linkedEvm = useMemo(
    () => myWallets.filter((w) => /^0x[0-9a-fA-F]{40}$/.test(w.address) && !/smart/i.test(w.walletType ?? '')),
    [myWallets],
  );
  const [chosenEvm, setChosenEvm] = useState<string | null>(null);
  const evmOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: { key: string; record: { address: string; walletType?: string; ecosystem?: string; color?: string | null; icon?: string | null }; name: string; detail: string }[] = [];
    if (liveEvm) {
      seen.add(liveEvm.toLowerCase());
      const linked = linkedEvm.find((w) => w.address.toLowerCase() === liveEvm.toLowerCase());
      out.push({ key: liveEvm, record: linked ?? { address: liveEvm, walletType: 'metamask', ecosystem: 'evm' }, name: linked ? walletDisplayName(linked, t) : 'MetaMask', detail: `${short(liveEvm)} · ${t('connected')}` });
    }
    for (const w of linkedEvm) {
      if (seen.has(w.address.toLowerCase())) continue;
      seen.add(w.address.toLowerCase());
      out.push({ key: w.address, record: w, name: walletDisplayName(w, t), detail: short(w.address) });
    }
    return out;
  }, [liveEvm, linkedEvm, t]);
  const evmAddress: string | undefined =
    (chosenEvm && evmOptions.some((o) => o.key.toLowerCase() === chosenEvm.toLowerCase()) ? chosenEvm : undefined) ??
    liveEvm ??
    linkedEvm[0]?.address;
  const evmLive = !!liveEvm && !!evmAddress && liveEvm.toLowerCase() === evmAddress.toLowerCase();
  const [attUrl, setAttUrl] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [robotBusy, setRobotBusy] = useState(false);
  const [legs, setLegs] = useState<{ label: string; leg: NotaryRenewLeg }[] | null>(null);
  const [robotError, setRobotError] = useState('');
  const [discoverMiss, setDiscoverMiss] = useState('');
  const [vc, setVc] = useState('');
  useEffect(() => { setVc(storedManagerVc() ?? ''); }, []);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(`astryum-notary-att:${account}`);
      if (saved) setAttUrl(saved);
    } catch { /* sin memoria no pasa nada */ }
  }, [account]);

  async function robotRenew(manual = false) {
    setRobotError('');
    setDiscoverMiss('');
    setLegs(null);
    setRobotBusy(true);
    try {
      let attestation: string | undefined;
      let evmSignature: string | undefined;
      let attRef = manual ? attUrl.trim() : '';
      if (!attRef && !manual && evmAddress) {
        const found = await discoverNotaryAttestation({ subject: account, evmAddress });
        if (found.ok) { attRef = found.data.url; setAttUrl(found.data.url); }
        else setDiscoverMiss(found.refusal.detail ?? found.refusal.error);
      }
      const m = attRef.match(UID_RE);
      if (m) {
        const uid = m[0].toLowerCase();
        const sigKey = `astryum-notary-sig:${account}:${uid}`;
        try { evmSignature = window.localStorage.getItem(sigKey) ?? undefined; } catch { /* se firma */ }
        if (!evmSignature) {
          // Firmar exige la sesión viva de ESA dirección: con una enlazada
          // sin sesión, se abre el conector y se vuelve a pulsar.
          if (!evmLive) {
            try { getAppKitModal().open(); } catch { /* sin modal: el aviso basta */ }
            setRobotError(`${t('Connect MetaMask with')} ${short(evmAddress ?? '')} ${t('to sign the binding, then press again.')}`);
            return;
          }
          evmSignature = await signMessageAsync({ message: notaryBindingMessage(account, uid) });
          try {
            window.localStorage.setItem(sigKey, evmSignature);
            window.localStorage.setItem(`astryum-notary-att:${account}`, attRef);
          } catch { /* conveniencia */ }
        }
        attestation = attRef;
      }
      const res = await requestNotaryRenew({ subject: account, attestation, evmSignature });
      if (!res.ok) return setRobotError(refusalText(res.refusal));
      setLegs([{ label: 'KYC', leg: res.data.kyc }, { label: 'AIFM', leg: res.data.aifm }]);
      bump();
    } catch (e) {
      setRobotError(e instanceof Error ? e.message : String(e));
    } finally {
      setRobotBusy(false);
    }
  }

  // ── Las credenciales exigidas, con su estado — identidad antes que licencia ─
  // La puerta habla en grupos OR (`AIFM|CASP`, `KYC|KYB`: la licencia de CADA
  // sector y su identidad). Esta mesa es la del GESTOR: cada grupo se resuelve
  // a su pata —AIFM, KYC— y SOLO esas se leen. Antes el grupo entero se buscaba como tipo literal: a una cuenta
  // con AIFM+KYC vigentes se le decía «0 / 2» y las filas se titulaban con
  // los tipos del exchange.
  const required = useMemo(() => managerTitleLegs(status?.credentialTypes), [status]);
  // De todo el directorio de la cuenta, SU título: sujeto = la cuenta, tipo =
  // una de sus patas. Lo emitido a otros, y cualquier otro tipo, no se pinta.
  const ownTray = useMemo(() => managerTitleTray(tray, account, required), [tray, account, required]);
  const issuers = useMemo(() => new Set(status?.acceptedIssuers ?? []), [status]);
  // Sin veredicto de la puerta (aún cargando, o ilegible) NO se decide nada:
  // una lista de emisores vacía por no haberla leído pintaba «vigente» lo que
  // la puerta rechazaría (revisión).
  const gateKnown = status !== null;
  const rows = required.map((type) => ({ type, ...(gateKnown ? legStateOf(type, ownTray, issuers) : { state: 'missing' as LegState, cred: null }) }));
  const inForceCount = rows.filter((r) => r.state === 'in-force').length;
  const anyPending = rows.some((r) => r.state === 'pending');
  const gateOff = status?.gate === 'disabled';

  const stateChip = (s: LegState, cred: CredentialRead | null) => {
    if (s === 'in-force')
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-tone-success/30 bg-tone-success/10 px-2 py-0.5 text-[11px] text-tone-success">
          <BadgeCheck className="h-3 w-3" strokeWidth={2} /> {t('In force')}{cred?.expiresAtISO ? ` · ${t('until')} ${new Date(cred.expiresAtISO).toLocaleDateString()}` : ''}
        </span>
      );
    if (s === 'pending')
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-volt/40 bg-volt/[0.08] px-2 py-0.5 text-[11px] text-volt">
          <Clock className="h-3 w-3" strokeWidth={2} /> {t('Waiting for your signature')} <ArrowDown className="h-3 w-3" />
        </span>
      );
    if (s === 'expired')
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-tone-warning/30 bg-tone-warning/10 px-2 py-0.5 text-[11px] text-tone-warning">
          <ShieldAlert className="h-3 w-3" strokeWidth={2} /> {t('Expired — renew')}
        </span>
      );
    if (s === 'other-issuer')
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-tone-warning/30 bg-tone-warning/10 px-2 py-0.5 text-[11px] text-tone-warning">
          <ShieldAlert className="h-3 w-3" strokeWidth={2} /> {t('Held, but not from an accepted issuer')}
        </span>
      );
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-ink/15 bg-ink/[0.03] px-2 py-0.5 text-[11px] text-ink/55">
        {t('Not held yet')}
      </span>
    );
  };

  const legMeta = (type: string) =>
    type.toUpperCase() === 'KYC'
      ? { Icon: Fingerprint, title: t('KYC — who you are'), how: t('Verified by Coinbase. Astryum reads the public attestation of the EVM wallet you connect; no document ever touches Astryum.') }
      : type.toUpperCase() === 'AIFM'
        ? { Icon: ScrollText, title: t('AIFM — your licence to manage'), how: t('Three public facts the notary re-checks: your account declares a domain, that domain’s xrp-ledger.toml lists this account, and the domain is in the AIFM register. Or your issuer grants it directly.') }
        : { Icon: ScrollText, title: type, how: '' };

  return (
    <div className="space-y-4">
      {/* 1 · Qué es esto y cuánto llevas — la orientación va PRIMERO. */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <MicroLabel>{t('Manager title')}</MicroLabel>
            <p className="mt-2 max-w-[60ch] text-[13px] leading-relaxed text-ink/60">
              {t('To run a grouped vault, this XRPL account must hold these credentials. The ledger checks them on every order — Astryum neither issues nor verifies them; it reads them and composes what you sign.')}
            </p>
          </div>
          <span className={`shrink-0 rounded-full border px-2.5 py-1 font-mono text-[12px] ${inForceCount === rows.length && rows.length > 0 ? 'border-tone-success/40 text-tone-success' : 'border-ink/15 text-ink/60'}`}>
            {inForceCount} / {rows.length} · {t('in force')}
          </span>
        </div>
        {gateOff ? <p className="mt-2 text-[11px] text-ink/40">{t('The ledger gate is off in this environment — nothing is required yet, but everything here already works.')}</p> : null}
        {readFailed ? (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-tone-warning/90">
            {t('The gate or the ledger could not be read right now, so nothing here is marked in force — that says nothing about your credentials.')}
            <button type="button" onClick={() => setTick((n) => n + 1)} className="underline underline-offset-2">{t('Retry')}</button>
          </p>
        ) : !gateKnown ? (
          <p className="mt-2 flex items-center gap-2 text-[11px] text-ink/40"><Loader2 className="h-3 w-3 animate-spin" /> {t('Reading the gate and your credentials…')}</p>
        ) : null}
      </Card>

      {/* 2 · La lista: una fila por credencial, con su estado y su cómo. */}
      <Card className="p-0">
        <ul className="divide-y divide-ink/5">
          {rows.map((r) => {
            const meta = legMeta(r.type);
            return (
              <li key={r.type} className="flex items-start gap-3 px-5 py-4">
                <meta.Icon className="mt-0.5 h-5 w-5 shrink-0 text-ink/35" strokeWidth={1.6} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[14px] font-semibold text-ink">{meta.title}</p>
                    {stateChip(r.state, r.cred)}
                  </div>
                  {meta.how ? <p className="mt-1 max-w-[60ch] text-[12px] leading-relaxed text-ink/50">{meta.how}</p> : null}
                  {r.state === 'other-issuer' && r.cred ? (
                    <p className="mt-1.5 max-w-[60ch] rounded-lg border border-tone-warning/25 bg-tone-warning/[0.06] px-2.5 py-2 text-[12px] leading-relaxed text-ink/70">
                      {t('The ledger holds this credential, issued by')} <span className="font-mono">{short(r.cred.issuer)}</span>
                      {r.cred.issuer === account ? ` (${t('this very account — self-issued')})` : ''}. {t('The gate only counts issuers on its list')}
                      {issuers.size > 0 ? <>: <span className="font-mono">{[...issuers].map(short).join(', ')}</span></> : null}. {t('Ask your issuer to grant it from an accepted key; it will then appear below to accept.')}
                    </p>
                  ) : null}
                  {/* La puerta al partner y la GUÍA paso a paso, en la fila que les toca.
                  { */}
                  {r.type.toUpperCase() === 'KYC' && r.state !== 'in-force' ? (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {(status?.verificationPartners ?? []).map((p) => (
                        <a
                          key={p.url}
                          href={`${p.url}${p.url.includes('?') ? '&' : '?'}subject=${encodeURIComponent(account)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-lg border border-ink/15 px-2.5 py-1 text-[12px] text-ink/75 hover:border-ink/30"
                        >
                          1 · {t('Verify with')} {p.name} <ArrowUpRight className="h-3 w-3" />
                        </a>
                      ))}
                      <CoinbaseGuideButton className="text-[12px]" />
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>

        {/* 3 · UNA acción: el notario comprueba las dos y emite lo que falte. */}
        {status?.notaryIssuer && inForceCount < rows.length ? (
          <div className="border-t border-ink/5 px-5 py-4">
            <p className="flex items-center gap-1.5 text-[12px] font-medium text-ink/75">
              <Bot className="h-3.5 w-3.5 text-volt" /> {rows.length > 1 ? '2 · ' : ''}{t('Let the notary check and issue')}
            </p>
            {rows.some((r) => r.type.toUpperCase() === 'KYC' && r.state !== 'in-force') ? (
              <div className="mt-1 text-[11px] text-ink/50">
                {evmAddress ? (
                  <>
                    {evmOptions.length > 1 ? (
                      <div className="mb-1.5 max-w-sm">
                        <WalletSelect options={evmOptions} value={evmAddress} onChange={(k) => setChosenEvm(k)} />
                      </div>
                    ) : null}
                    {evmLive ? (
                      <>{t('Connected EVM wallet')}: <span className="font-mono text-ink/75">{short(evmAddress)}</span> — {t('the one you connected at Coinbase')}</>
                    ) : (
                      <>
                        {t('EVM wallet linked to your account')}: <span className="font-mono text-ink/75">{short(evmAddress)}</span> — {t('the one you verified at Coinbase. Not connected in this browser: MetaMask will be asked to connect it when it has to sign.')}{' '}
                        <button type="button" onClick={() => { try { getAppKitModal().open(); } catch { /* sin modal */ } }} className="text-volt underline-offset-2 hover:underline">
                          {t('Connect it now')}
                        </button>
                      </>
                    )}
                  </>
                ) : (
                  <span className="text-tone-warning/90">{t('No EVM wallet connected — connect the one you used at Coinbase (Wallets → MetaMask) for the KYC leg.')}</span>
                )}
              </div>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void robotRenew(false)}
                disabled={robotBusy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-volt px-4 py-2 text-[12px] font-semibold text-volt-ink disabled:opacity-50"
              >
                {robotBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />}
                {t('Verify & issue what is missing')}
              </button>
              <button type="button" onClick={() => setManualOpen((v) => !v)} className="text-[10px] text-ink/40 underline-offset-2 hover:text-ink/70 hover:underline">
                {t('Paste the attestation link yourself (if the automatic lookup fails)')}
              </button>
            </div>
            {manualOpen ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <input value={attUrl} onChange={(e) => setAttUrl(e.target.value)} placeholder="https://base.easscan.org/attestation/view/0x…" className="min-w-[16rem] flex-1 rounded-md border border-ink/10 bg-ink/[0.03] text-ink placeholder:text-ink/30 focus:border-volt/40 focus:outline-none px-2 py-1.5 font-mono text-[10px]" />
                <button type="button" onClick={() => void robotRenew(true)} disabled={robotBusy || !UID_RE.test(attUrl)} className="rounded-lg border border-ink/15 px-3 py-1.5 text-[11px] text-ink/70 disabled:opacity-50">
                  {t('Issue from this link')}
                </button>
              </div>
            ) : null}
            {discoverMiss ? <p className="mt-2 text-[11px] leading-relaxed text-tone-warning">{discoverMiss}</p> : null}
            {legs ? (
              <ul className="mt-2 space-y-1">
                {legs.map(({ label, leg }) => {
                  // Una pata que YA está vigente por otro camino no es un aviso: se dice neutra.
                  const rowInForce = rows.some((r) => r.type.toUpperCase() === label && r.state === 'in-force');
                  const settled = leg.status === 'already-valid' || (rowInForce && leg.status !== 'issued');
                  const tone = leg.status === 'issued' ? 'text-emerald-500/90' : settled ? 'text-ink/60' : 'text-tone-warning';
                  const text = leg.status === 'issued' ? `${t('issued')} — ${t('accept it below')}` : settled ? t('already in force') : leg.detail;
                  return (
                    <li key={label} className={`flex items-start gap-2 text-[11px] leading-relaxed ${tone}`}>
                      <span className="mt-px shrink-0 rounded border border-current/30 px-1 font-mono text-[10px]">{label}</span>
                      <span>{text}</span>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {robotError ? <p className="mt-2 text-[11px] leading-relaxed text-tone-warning">{robotError}</p> : null}
          </div>
        ) : null}
        {!status?.notaryIssuer && status && inForceCount < rows.length ? (
          <p className="border-t border-ink/5 px-5 py-3 text-[11px] text-ink/45">
            {t('Your issuer grants the credentials to this account; when one arrives, it appears below to accept.')}
          </p>
        ) : null}
        {/* El paste-link del AIFM llamaba al notario de RODAJE (issue-aifm-demo).
            Esa emisión vive en /app/admin, tras la puerta de los
            fundadores: aquí el título lo concede un emisor acreditado, o el
            notario con sus comprobaciones de verdad («Verify & issue»). */}
      </Card>

      {/* 4 · La firma: lo que espera tu aceptación, destacado (y lo vigente). */}
      <div id="title-signature">
        {anyPending ? <p className="mb-2 text-[12px] font-medium text-ink/70">{rows.length > 1 ? '3 · ' : ''}{t('Accept it in your Xaman — that signature is what makes it count')}</p> : null}
        {/* La bandeja enseña SOLO el título de esta cuenta (sujeto = ella,
            KYC/AIFM): el directorio entero —lo emitido a otros, otros tipos—
            no es de esta mesa. */}
        <CredentialTray account={account} refreshKey={tick} onAccepted={bump} gateIssuers={status?.acceptedIssuers ?? []} tray={readFailed === 'tray' ? null : ownTray} onReload={() => setTick((n) => n + 1)} />
      </div>

      {/* 5 · Lo demás, plegado: emisores, credencial del partner, certificadora. */}
      <details className="group rounded-xl border border-ink/10">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[12px] text-ink/60">
          <span>{t('More: accepted issuers, partner credential, the certifier')}</span>
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-4 border-t border-ink/5 px-4 py-4">
          {status?.acceptedIssuers && status.acceptedIssuers.length > 0 ? (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-ink/40">{t('Accepted issuers (on-ledger, XLS-70)')}</p>
              <ul className="mt-1 space-y-0.5">
                {status.acceptedIssuers.map((iss) => <li key={iss} className="font-mono text-[11px] text-ink/60">{short(iss)}</li>)}
              </ul>
            </div>
          ) : (
            <p className="text-[11px] text-tone-warning/80">{t('No accredited issuer is configured yet — this is the partner still to be lined up.')}</p>
          )}
          {status?.offLedgerPartners && status.offLedgerPartners.length > 0 ? (
            <div className="rounded-lg border border-ink/10 p-2.5">
              <p className="text-[11px] font-medium text-ink/70">{t('Or present your partner credential (off-ledger)')}</p>
              <p className="mt-0.5 text-[10px] leading-relaxed text-ink/45">
                {t('The partner verified your title off-chain and signed a credential. Paste it here (it stays in this browser) and it travels with your orders. No document goes on-chain.')}
              </p>
              <textarea value={vc} onChange={(e) => setVc(e.target.value)} placeholder="eyJ… (VC JWT)" rows={2} className="mt-1.5 w-full rounded-md border border-ink/10 bg-ink/[0.03] text-ink placeholder:text-ink/30 focus:border-volt/40 focus:outline-none px-2 py-1.5 font-mono text-[10px]" />
              <button type="button" onClick={() => { setStoredManagerVc(vc); reload(); }} className="mt-1.5 rounded-md border border-ink/10 px-2.5 py-1 text-[11px] text-ink/70 hover:text-ink">
                {vc.trim() ? t('Save credential') : t('Clear')}
              </button>
              <ul className="mt-1.5 space-y-0.5">
                {status.offLedgerPartners.map((iss) => <li key={iss} className="font-mono text-[10px] text-ink/45">{iss}</li>)}
              </ul>
            </div>
          ) : null}
          <ManagerCertificationCard />
        </div>
      </details>
    </div>
  );
}

export default ManagerTitleStation;
