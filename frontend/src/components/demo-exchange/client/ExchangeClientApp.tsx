'use client';

/**
 * ExchangeClientApp — la cuenta del cliente en su exchange, PRODUCTIZADA
 * (fundador 14-sep: «una ui como la de un exchange para un user… para entrar
 * pide passkey, para hacer acciones de movimiento de assets pide passkey…
 * perfil de usuario donde pone que tiene el KYC… sitio para entrar a vault con
 * su xrp… sitio para depositar xrp en la cuenta del exchange… sitio para sacar
 * fxrp del vault y retirar a su cuenta particular»).
 *
 * Cinco pantallas sobre UNA cuenta: Inicio · Depositar · Vault · Retirar · Perfil.
 * La lógica es la de siempre (useExchangeClient ⇐ ClientInner); aquí solo cambia
 * la casa. La maqueta de referencia: claude.ai/code/artifact/ffc46fca-….
 *
 * LA PASSKEY, dicho con precisión:
 *   · ENTRAR: la pestaña Exchange pide la passkey del dispositivo (una firma
 *     WebAuthn local) antes de abrir la cuenta. Es un cerrojo de pantalla, NO
 *     una sesión de servidor: la propiedad de la fila la sigue decidiendo la
 *     sesión de Astryum en el backend. El resto de Astryum no se toca.
 *   · MOVER: sacar del vault lo firma la passkey (es la llave de la cuenta de
 *     las participaciones). Meter en el vault y retirar XRP del exchange los
 *     ejecuta el exchange desde su omnibus a petición del cliente.
 *   · DEPOSITAR: lo firma la wallet XRPL donde está el XRP. Una passkey
 *     (WebAuthn P-256) no firma en el XRP Ledger — y se dice en pantalla.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BadgeCheck,
  Building2,
  Check,
  Copy,
  ExternalLink,
  Landmark,
  Loader2,
  Lock,
  RefreshCw,
  ScanFace,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { Card, EmptyState, GhostButton, MicroLabel, Pill, PrimaryButton, SegmentedControl } from '../../ui/primitives';
import { RevealGroup, RevealItem } from '../../ui/motion';
import { useT } from '../../../i18n/LanguageProvider';
import { PasskeyGate } from '../../institutional/user/PasskeyGate';
import { usePasskeyActions } from '../../../lib/institutional/usePasskeyActions';
import { signWithPasskey } from '../../../lib/institutional/passkey';
import { describePasskeyError } from '../../../lib/institutional/passkeyErrors';
import { useDemoRun, type DemoRunApi } from '../../../lib/demo-exchange/useDemoRun';
import { demoApi, dropsToXrp, networkRefusal, shortHash, type ClientRequest, type DeskPayment, type Refusal, type RunCredentialRow, type RunSummary } from '../../../lib/demo-exchange/api';
import { fillParams, redemptionFeeSentence, type ClientExitTo } from '../../../lib/demo-exchange/clientExitPlan';
import { venueIdentity } from '../../../lib/institutional/venueIdentity';
import { fmtBase } from '../../../lib/institutional/policyCatalog';
import { UnconfirmedSignatureNotice } from '../../settlement/UnconfirmedSignatureNotice';
import { ManagerPublicProfile } from '../../managed/ManagerPublicProfile';
import { DepositQrSign } from '../DepositXamanQr';
import { ClientKycCard } from '../ClientKycCard';
import { WithdrawalWalletCard } from './ExchangeClientSite';
import type { ClientIntent } from '../ExchangeWelcome';
import { useExchangeClient, XRP_RE, type ExchangeClientApi } from './useExchangeClient';
import { PortalRefusal } from './PortalRefusal';
import { portalDataFrom, portalView, type PortalData, type PortalMembership } from '../../../lib/demo-exchange/clientPortalView';
import { RequestRefusalActions } from './RequestRefusalActions';

type Tab = 'home' | 'deposit' | 'vault' | 'withdraw' | 'profile';
const UNLOCK_KEY = 'astryum:exchange:unlocked';

const inputClass =
  'w-full rounded-xl border border-ink/10 bg-surface-2 px-3.5 py-3 font-mono text-[18px] text-ink placeholder-ink/25 focus:border-volt/50 focus:outline-none';

/* ── Entrar: la passkey del dispositivo abre la pestaña ──────────────────── */
function PasskeyEntry({ children }: { children: (account: string) => ReactNode }) {
  const { t } = useT();
  const { state, forget } = usePasskeyActions();
  const [phase, setPhase] = useState<'checking' | 'locked' | 'open'>('checking');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // Sin llave en este dispositivo, PasskeyGate la crea — y crearla ya es haberla usado.
    if (!state.handle) return setPhase('open');
    try {
      setPhase(window.sessionStorage.getItem(UNLOCK_KEY) === state.handle.credentialId ? 'open' : 'locked');
    } catch {
      setPhase('locked');
    }
  }, [state.handle]);

  async function unlock() {
    const h = state.handle;
    if (!h) return;
    setBusy(true);
    setError('');
    try {
      const challenge = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
      await signWithPasskey(h.credentialId, challenge);
      try {
        window.sessionStorage.setItem(UNLOCK_KEY, h.credentialId);
      } catch {
        /* sin almacén: se pide otra vez al recargar */
      }
      setPhase('open');
    } catch (e) {
      setError(describePasskeyError(e));
    } finally {
      setBusy(false);
    }
  }

  if (phase === 'checking') return <EmptyState variant="loading" title={t('Opening your account…')} />;
  if (phase === 'open') return <PasskeyGate>{children}</PasskeyGate>;

  return (
    <div className="mx-auto max-w-lg pt-6">
      <Card glow className="p-8">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl border border-volt/25 bg-volt/10 text-volt">
            <Lock className="h-5 w-5" strokeWidth={1.7} />
          </span>
          <MicroLabel>{t('Exchange')}</MicroLabel>
        </div>
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">{t('Sign in to your exchange account')}</h1>
        <p className="mt-2.5 text-[14px] leading-relaxed text-ink/55">
          {t('Your passkey is the key: it opens your account and confirms every movement inside it — the vault and your withdrawals. It lives on your device; nobody else holds it, not the exchange and not Astryum.')}
        </p>
        <PrimaryButton onClick={() => void unlock()} disabled={busy} className="mt-7 w-full py-3.5 text-[15px]">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ScanFace className="h-5 w-5" strokeWidth={1.8} />}
          {t('Sign in with passkey')}
        </PrimaryButton>
        {error ? <p className="mt-3 text-[12px] text-tone-warning">{t(error)}</p> : null}
        {/* LA SALIDA DEL CERROJO (fundador 14-sep: «no puedo acceder al exchange
            creado»). Con una llave guardada que en ESTE navegador no firma (en el
            PC, la de un intento de Windows; la buena vive en el móvil), el único
            botón la volvía a pedir para siempre. Olvidar es solo el material
            PÚBLICO local: la llave sigue en su dispositivo. */}
        <button
          type="button"
          onClick={() => {
            forget();
            setError('');
            setPhase('open');
          }}
          disabled={busy}
          className="mt-3 w-full text-center text-[12.5px] text-ink/50 underline underline-offset-2 transition-colors hover:text-ink disabled:opacity-40"
        >
          {t('This key does not work here? Use another one')}
        </button>
        <p className="mt-1 text-center text-[11px] leading-relaxed text-ink/35">
          {t('It only forgets the key in this browser; the key itself stays on your device. If your account key lives on your phone, open this page there.')}
        </p>
        <div className="mt-7 space-y-4 border-t border-ink/[0.06] pt-6">
          {[
            { icon: Building2, title: t('Your XRP, at the exchange'), body: t('You deposit with your tag, like at any exchange.') },
            { icon: ScanFace, title: t('What works is in your name'), body: t('Your shares live in an account only your passkey opens.') },
            { icon: ArrowUpFromLine, title: t('Taking it out of the vault is yours'), body: t('One passkey confirmation. It never depends on the exchange or on your KYC.') },
          ].map((f) => (
            <div key={f.title} className="flex items-start gap-3">
              <f.icon className="mt-0.5 h-4 w-4 shrink-0 text-volt/80" strokeWidth={1.7} />
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-ink/85">{f.title}</p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink/50">{f.body}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ── ¿De qué exchanges soy cliente? Por identidad; y a cuáles puedo pedir acceso ── */
function ClientPortal({ account, intent = 'create' }: { account: string; intent?: ClientIntent }) {
  const { t } = useT();
  const [state, setState] = useState<
    | { phase: 'resolving' }
    | { phase: 'ready'; data: PortalData }
    | { phase: 'error'; refusal: Refusal }
  >({ phase: 'resolving' });
  const [chosen, setChosen] = useState<string | null>(null);
  // it. 21 (3.2): «try again» has to actually try again — a counter the effect
  // depends on, so the button re-asks instead of only re-wording the wall.
  const [attempt, setAttempt] = useState(0);
  // ENTRAR NO ES CREAR (15-sep, la portada): al que viene a entrar y no tiene
  // ficha se le dice que aún no tiene cuenta — no se le mete un alta que no
  // pidió. Al que viene a crearla, el alta es exactamente lo que pidió.
  // Y CREAR NO ES ENTRAR (18-sep): la llave que ya es cliente de un exchange
  // viene a pedir acceso a OTRO — la regla entera en lib/demo-exchange/clientPortalView.
  const [opening, setOpening] = useState(intent === 'create');

  useEffect(() => {
    let cancelled = false;
    setState({ phase: 'resolving' });
    void demoApi.forAccount(account).then((r) => {
      if (cancelled) return;
      if (!r.ok) return setState({ phase: 'error', refusal: r.refusal });
      setState({ phase: 'ready', data: portalDataFrom(r.data) });
    }).catch((e: unknown) => {
      // it. 33 (7): `fetch` itself can throw (offline, DNS, CORS); without this
      // the portal stayed on «Finding your exchange…» forever. A network failure
      // is a retryable «could not read», never «no exchange».
      if (cancelled) return;
      setState({ phase: 'error', refusal: networkRefusal(e) });
    });
    return () => { cancelled = true; };
  }, [account, attempt]);

  if (state.phase === 'resolving') return <EmptyState variant="loading" title={t('Finding your exchange…')} />;
  if (state.phase === 'error') {
    // it. 21 (3.2) — «NO PUDE LEER» NO ES «NO EXISTE». The strict run read (it. 19)
    // turned a database blink into a 500 and this screen into «your exchange could
    // not be found», which tells a client their account is gone. A retryable
    // refusal (503 RUN_UNREADABLE and friends) says what it is — nothing changed —
    // and offers the only useful action.
    //
    // it. 31 (4.2) — and this is now ALSO where a takeover mark the server could
    // not use lands (503 OWNERSHIP_UNREADABLE from `for-account`), instead of the
    // `heldElsewhere.reclaimRequired` branch below, which has no button. The
    // phase is its own component so a test can render it against the real
    // refusal and see the retry (`PortalRefusal.test.tsx`).
    return <PortalRefusal refusal={state.refusal} onRetry={() => setAttempt((n) => n + 1)} />;
  }

  const { data } = state;
  const view = portalView({ mode: opening ? 'create' : 'enter', data, chosen });
  if (view.kind === 'run') return <ClientRunView runId={view.runId} account={account} />;

  // La llave YA es cliente, pero su ficha no es de esta sesión (14-sep). Antes caía
  // en «abrir una cuenta» — con un solo exchange, directo a crear una SEGUNDA
  // ficha para la misma llave. Se dice qué pasa, sin decir de quién es.
  const heldNote = data.heldElsewhere ? (
    <>
      <h2 className="mt-2 text-[18px] font-semibold tracking-tight text-ink">
        {t('This key already has an account at {exchange}').replace('{exchange}', data.heldElsewhere.exchange.label)}
      </h2>
      <p className="mt-3 text-[13.5px] leading-relaxed text-ink/60">
        {data.heldElsewhere.reclaimRequired
          ? t('Your sign-in changed since you opened it: the exchange has to confirm it is you again with a claim code.')
          : t('But it was opened with another Astryum account. Sign in with the account you used to open it — your balance and your shares are there.')}
      </p>
    </>
  ) : null;

  if (view.kind === 'held-elsewhere') {
    return (
      <Card className="p-6">
        <MicroLabel>{t('Exchange')}</MicroLabel>
        {heldNote}
      </Card>
    );
  }
  // Vino a ENTRAR y esta llave no tiene ficha en ningún exchange: se dice tal
  // cual, y abrir una queda a UN clic. Antes se caía directo en el alta, que
  // para el que solo quería entrar parecía que su cuenta había desaparecido.
  if (view.kind === 'no-account-yet') {
    return (
      <Card className="p-6">
        <MicroLabel>{t('Exchange')}</MicroLabel>
        <h2 className="mt-2 text-[18px] font-semibold tracking-tight text-ink">{t('This key does not have an account at any exchange yet')}</h2>
        <p className="mt-3 max-w-[60ch] text-[13.5px] leading-relaxed text-ink/60">
          {t('Nothing is missing and nothing was lost: no account has been opened with this passkey. Opening one takes a name and a moment.')}
        </p>
        <PrimaryButton onClick={() => setOpening(true)} className="mt-4">{t('Open an account')}</PrimaryButton>
      </Card>
    );
  }
  if (view.kind === 'pick-mine' || view.kind === 'already-everywhere') {
    const everywhere = view.kind === 'already-everywhere';
    return (
      <Card className="p-6" data-testid={everywhere ? 'already-a-client' : 'pick-mine'}>
        <MicroLabel>{everywhere ? t('Create a client account') : t('Exchange')}</MicroLabel>
        <h2 className="mt-2 text-[18px] font-semibold tracking-tight text-ink">
          {everywhere ? t('This passkey already has an account at every exchange taking clients') : t('Your exchange accounts')}
        </h2>
        <p className="mt-3 max-w-[62ch] text-[13.5px] leading-relaxed text-ink/60">
          {everywhere
            ? t('There is no other exchange to ask for access right now. Your accounts are here:')
            : t('One account per exchange, each with its own deposit tag and its own verification. Which one do you want to open?')}
        </p>
        <MembershipButtons memberships={data.memberships} onPick={setChosen} />
      </Card>
    );
  }

  // pick-join / none-open: los exchanges a los que esta llave aún puede pedir acceso.
  return (
    <Card className="p-6">
      <MicroLabel>{t('Open an account')}</MicroLabel>
      <h2 className="mt-2 text-[18px] font-semibold tracking-tight text-ink">{t('Which exchange do you want an account with?')}</h2>
      <p className="mt-2 max-w-[62ch] text-[12.5px] leading-relaxed text-ink/45">
        {t('Each exchange verifies its own clients: you are inside an exchange only once it has registered your KYC. Your account at one exchange does not open another.')}
      </p>
      {data.joinable.length === 0 ? (
        <p className="mt-3 text-[13px] text-ink/50">{t('No exchange is open for new accounts right now.')}</p>
      ) : (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {data.joinable.map((x) => (
            <button key={x.runId} type="button" onClick={() => setChosen(x.runId)} className="flex flex-col items-start rounded-xl border border-ink/10 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-volt/40 hover:bg-volt/[0.04]">
              <span className="flex items-center gap-2 text-[14px] font-semibold text-ink"><Building2 className="h-4 w-4 text-volt/80" strokeWidth={1.7} /> {x.label}</span>
              <span className="mt-2 text-[12px] text-volt">{t('Open my account here')} →</span>
            </button>
          ))}
        </div>
      )}
      {data.memberships.length > 0 ? (
        <div className="mt-5 border-t border-ink/[0.06] pt-4">
          <p className="text-[12px] text-ink/50">{t('You already have an account at:')}</p>
          <MembershipButtons memberships={data.memberships} onPick={setChosen} />
        </div>
      ) : null}
      {data.heldElsewhere ? <div className="mt-5 border-t border-ink/[0.06] pt-4">{heldNote}</div> : null}
    </Card>
  );
}

/** Tus cuentas, una por exchange: cada botón abre la suya. */
function MembershipButtons({ memberships, onPick }: { memberships: PortalMembership[]; onPick: (runId: string) => void }) {
  const { t } = useT();
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {memberships.map((m) => (
        <button key={m.runId} type="button" onClick={() => onPick(m.runId)} className="flex flex-col items-start rounded-xl border border-ink/10 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-volt/40 hover:bg-volt/[0.04]">
          <span className="flex items-center gap-2 text-[14px] font-semibold text-ink"><Building2 className="h-4 w-4 text-volt/80" strokeWidth={1.7} /> {m.exchangeLabel}</span>
          {m.client ? <span className="mt-1 text-[12px] text-ink/50">{m.client.label} · {t('your tag')} <span className="font-mono">{m.client.tag}</span></span> : null}
          <span className="mt-2 text-[12px] text-volt">{t('Go to my account')} →</span>
        </button>
      ))}
    </div>
  );
}

function ClientRunView({ runId, account }: { runId: string; account: string }) {
  const { t } = useT();
  const demo = useDemoRun({ fixedRunId: runId });
  if (demo.error && !demo.run)
    return (
      <EmptyState
        variant="error"
        title={t('Your exchange could not be opened')}
        hint={demo.error}
        // Same rule one screen down: the read is the only thing that failed, so
        // the only thing to offer is the read again.
        action={<PrimaryButton onClick={() => { demo.setError(''); void demo.loadRun(runId); }}>{t('Try again')}</PrimaryButton>}
      />
    );
  if (!demo.run) return <EmptyState variant="loading" title={t('Opening your account…')} />;
  return <ClientDashboard demo={demo} account={account} />;
}

/* ── El KYC de la casilla, leído del ledger (para la cabecera y el inicio) ── */
function useClientKyc(runId: string, clientId: string | undefined) {
  const [row, setRow] = useState<RunCredentialRow | null>(null);
  const [required, setRequired] = useState(true);
  const [unreadable, setUnreadable] = useState(false);
  const read = useCallback(async () => {
    if (!clientId) return;
    const r = await demoApi.runCredentials(runId).catch(() => null);
    if (!r || !r.ok) return setUnreadable(true);
    setUnreadable(false);
    setRequired(r.data.required);
    setRow(r.data.clients.find((c) => c.clientId === clientId) ?? null);
  }, [runId, clientId]);
  useEffect(() => { void read(); }, [read]);
  return { row, required, unreadable, read };
}
type ClientKyc = ReturnType<typeof useClientKyc>;

function KycPill({ kyc }: { kyc: ClientKyc }) {
  const { t } = useT();
  if (!kyc.required) return null;
  if (kyc.unreadable) return <Pill tone="warning">{t('KYC could not be read')}</Pill>;
  if (!kyc.row) return <Pill>{t('Reading KYC…')}</Pill>;
  if (kyc.row.ok) return <Pill tone="success"><BadgeCheck className="h-3 w-3" /> {t('KYC verified')}</Pill>;
  return <Pill tone="warning">{t('KYC pending at the exchange')}</Pill>;
}

/* ── La cuenta ───────────────────────────────────────────────────────────── */
function ClientDashboard({ demo, account }: { demo: DemoRunApi; account: string }) {
  const { t } = useT();
  const c = useExchangeClient(demo, account);
  const kyc = useClientKyc(c.run.runId, c.me?.id);
  const [tab, setTab] = useState<Tab>('home');

  // El vigía del omnibus: los depósitos aparecen solos, sin pulsar nada.
  const scan = demo.scanOmnibus;
  useEffect(() => {
    void scan();
    const id = window.setInterval(() => void scan(), 30_000);
    return () => window.clearInterval(id);
  }, [scan]);

  // it. 33 (2) — «NO PUDE LEER SI ESTA CUENTA ES TUYA» NO ES «ABRE UNA». The
  // book reloads every 20 s; with the viewer's takeover mark unusable the server
  // answers every row `mine:false` and `c.me` went undefined — a person with XRP
  // at the exchange saw «Open an account» (and a 409 if they tried). The server
  // now says why (`viewerUnreadable`, same body as the portal's 503) and this
  // shows that sentence with the read again, never the alta.
  if (!c.me && c.ownershipUnreadable) return <PortalRefusal refusal={c.ownershipUnreadable} onRetry={() => void demo.reload()} />;
  if (!c.me) return <OpenAccount c={c} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <div className="mb-2 text-xs font-medium text-ink/40">{t('Exchange')} · {c.run.label}</div>
          <h1 className="text-[24px] font-semibold leading-[1.15] tracking-tight text-ink md:text-[28px]">{t('Hello, {name}').replace('{name}', c.me.label)}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink/55">{t('Your XRP at the exchange and what works in the vault, in your name.')}</p>
        </div>
        <div className="flex flex-col items-start gap-2 md:items-end">
          <div className="flex flex-wrap items-center gap-2">
            <KycPill kyc={kyc} />
            <Pill><ScanFace className="h-3 w-3" /> {t('Passkey · this device')}</Pill>
          </div>
          <span className="text-[12px] text-ink/40">{t('your tag')} <span className="font-mono text-ink/70">{c.me.tag}</span></span>
        </div>
      </div>

      <SegmentedControl<Tab>
        layoutId="exchange-client-tabs"
        value={tab}
        onChange={(k) => { c.setError(''); c.setNotice(''); setTab(k); }}
        options={[
          { key: 'home', label: t('Home') },
          { key: 'deposit', label: t('Deposit') },
          { key: 'vault', label: t('Vault') },
          { key: 'withdraw', label: t('Withdraw') },
          { key: 'profile', label: t('Profile') },
        ]}
      />

      {c.needsClaim ? <ClaimCard c={c} /> : null}
      {c.notice ? <p className="rounded-xl border border-volt/30 bg-volt/[0.05] p-3 text-[13px] text-ink/80">{c.notice}</p> : null}
      {c.error ? <p className="rounded-xl border border-tone-warning/30 bg-tone-warning/[0.06] p-3 text-[13px] text-tone-warning">{c.error}</p> : null}

      <RevealGroup key={tab} className="space-y-4" stagger={0.05}>
        {tab === 'home' ? <HomePanel c={c} demo={demo} kyc={kyc} go={setTab} /> : null}
        {tab === 'deposit' ? <DepositPanel c={c} demo={demo} /> : null}
        {tab === 'vault' ? <VaultPanel c={c} /> : null}
        {tab === 'withdraw' ? <WithdrawPanel c={c} demo={demo} /> : null}
        {tab === 'profile' ? <ProfilePanel c={c} demo={demo} /> : null}
      </RevealGroup>
    </div>
  );
}

function OpenAccount({ c }: { c: ExchangeClientApi }) {
  const { t } = useT();
  const [label, setLabel] = useState('');
  return (
    <div className="mx-auto max-w-lg space-y-4 pt-2">
      <Card glow className="p-8">
        <MicroLabel>{t('Open an account')}</MicroLabel>
        <h1 className="mt-2 text-[24px] font-semibold tracking-tight text-ink">{c.run.label}</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-ink/55">
          {t('The exchange assigns your deposit tag — your slot in its account. From then on this page is your account there.')}
        </p>
        <label className="mt-6 block text-[12px] text-ink/55">
          {t('Your name')}
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('e.g. Lucía Ferrer')} className="mt-1.5 w-full rounded-xl border border-ink/10 bg-surface-2 px-3.5 py-3 text-[15px] text-ink placeholder-ink/25 focus:border-volt/50 focus:outline-none" />
        </label>
        <PrimaryButton onClick={() => void c.openAccount(label)} disabled={c.busy !== null} className="mt-5 w-full py-3.5">
          {c.busy === 'create' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {t('Open my exchange account')}
        </PrimaryButton>
        {c.error ? <p className="mt-3 text-[12px] text-tone-warning">{c.error}</p> : null}
        <p className="mt-4 text-[12px] leading-relaxed text-ink/45">{t('Before any money comes in, the exchange registers your KYC on the XRP Ledger. You sign nothing for it.')}</p>
      </Card>
    </div>
  );
}

function ClaimCard({ c }: { c: ExchangeClientApi }) {
  const { t } = useT();
  const [code, setCode] = useState('');
  return (
    <Card className="border-tone-warning/30 p-5">
      <p className="text-[13px] text-ink/80">{t('The exchange opened this account with your passkey, but it is not yours yet. Enter the claim code the exchange gave you — until then nothing here can be changed.')}</p>
      <div className="mt-3 flex gap-2">
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('Claim code from the exchange (XXXX-XXXX-…)')} autoComplete="off" className="flex-1 rounded-xl border border-ink/10 bg-surface-2 px-3 py-2.5 font-mono text-[13px] text-ink" />
        <PrimaryButton onClick={() => void c.claimMine(code)} disabled={c.busy !== null || !code.trim()}>{t('Claim')}</PrimaryButton>
      </div>
    </Card>
  );
}

/* ── Actividad: peticiones, movimientos del omnibus y salidas del vault ──── */
interface ActivityRow { key: string; at: string; title: string; detail: string; amount: string; tone: 'success' | 'info' | 'warning' | 'neutral' | 'danger'; status: string; href?: string }

/**
 * 18-sep — LA MESA LA TOMÓ PARA FIRMARLA POR QR. En el backend es una cesión
 * ('refused' con `TAKEN_BY_THE_DESK`), pero para el cliente no es una negativa:
 * su movimiento sigue, ahora como pago de la mesa (ver `deskPaymentStatus`).
 */
export function isTakenByDesk(r: Pick<ClientRequest, 'status' | 'reason'>): boolean {
  return r.status === 'refused' && typeof r.reason === 'string' && r.reason.startsWith('TAKEN_BY_THE_DESK');
}

function requestStatus(r: ClientRequest, t: (s: string) => string): { label: string; tone: ActivityRow['tone'] } {
  if (isTakenByDesk(r)) return { label: t('With the exchange'), tone: 'info' };
  switch (r.status) {
    case 'done': return { label: t('Done'), tone: 'success' };
    case 'signed': return { label: t('On its way'), tone: 'info' };
    case 'submitting': return { label: t('Sending'), tone: 'info' };
    case 'refused': return { label: t('Refused'), tone: 'danger' };
    default: return { label: t('Queued'), tone: 'neutral' };
  }
}

/** Un pago que la mesa firma desde el omnibus por QR, visto por su cliente. */
function deskPaymentStatus(p: DeskPayment, t: (s: string) => string): { label: string; tone: ActivityRow['tone'] } {
  switch (p.status) {
    case 'settled': return { label: t('Done'), tone: 'success' };
    case 'signed': return { label: t('On its way'), tone: 'info' };
    case 'released': return { label: t('Not sent'), tone: 'neutral' };
    default: return { label: t('With the exchange'), tone: 'info' };
  }
}

function useActivity(c: ExchangeClientApi, demo: DemoRunApi): ActivityRow[] {
  const { t } = useT();
  return useMemo(() => {
    const rows: ActivityRow[] = [];
    const applied = new Set(c.run.appliedTxHashes);
    for (const r of c.myRequests) {
      const s = requestStatus(r, t);
      rows.push({
        key: `req:${r.id}`,
        at: r.createdAt,
        title: r.kind === 'put-to-work' ? t('Into the vault') : t('Withdrawal to your wallet'),
        detail: isTakenByDesk(r)
          ? t('the exchange signs it from its account')
          : r.reason ? r.reason : r.txHash ? `${t('on the XRP Ledger')} · ${shortHash(r.txHash)}` : r.kind === 'put-to-work' ? t('the exchange executes it from its account') : t('the exchange pays it from its account'),
        amount: `${dropsToXrp(r.drops)} XRP`,
        tone: s.tone,
        status: s.label,
        href: r.txHash ? `https://xrpscan.com/tx/${r.txHash}` : undefined,
      });
    }
    // Los pagos que la mesa firma por QR desde el omnibus (18-sep): sin ellos,
    // una retirada servida a mano no llegaba nunca a «Hecho» en esta lista.
    for (const p of c.run.deskPayments ?? []) {
      if (p.clientId !== c.me?.id) continue;
      const s = deskPaymentStatus(p, t);
      rows.push({
        key: `dp:${p.id}`,
        at: p.createdAt,
        title: p.kind === 'put-to-work' ? t('Into the vault') : t('Withdrawal to your wallet'),
        detail: p.txHash ? `${t('on the XRP Ledger')} · ${shortHash(p.txHash)}` : t('the exchange signs it from its account'),
        amount: `${dropsToXrp(p.drops)} XRP`,
        tone: s.tone,
        status: s.label,
        href: p.txHash ? `https://xrpscan.com/tx/${p.txHash}` : undefined,
      });
    }
    const txs = demo.omnibus?.ok ? demo.omnibus.data.txs : [];
    for (const x of txs) {
      if (x.clientId !== c.me?.id || (x.kind !== 'deposit' && x.kind !== 'return')) continue;
      const credited = applied.has(`in:${x.hash.toUpperCase()}`);
      rows.push({
        key: `tx:${x.hash}`,
        at: x.dateISO,
        title: x.kind === 'deposit' ? t('Deposit') : t('Back from the vault'),
        detail: `${t('from')} ${shortHash(x.account, 5, 4)} · ${t('tag')} ${x.destinationTag ?? '—'}`,
        amount: `+${dropsToXrp(x.drops)} XRP`,
        tone: credited ? 'success' : 'info',
        status: credited ? t('Credited') : t('Seen on the ledger'),
        href: x.explorerUrl,
      });
    }
    for (const r of c.myReceipts) {
      if (r.step !== 'U4_EXIT' && r.step !== 'U4_EXIT_XRP') continue;
      rows.push({ key: `rc:${r.id}`, at: r.at, title: t('Out of the vault'), detail: r.note ?? '', amount: '', tone: 'success', status: t('Signed with your passkey'), href: r.explorerUrl });
    }
    return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10);
  }, [c.run.appliedTxHashes, c.run.deskPayments, c.myRequests, c.myReceipts, c.me?.id, demo.omnibus, t]);
}

function ActivityList({ rows }: { rows: ActivityRow[] }) {
  const { t } = useT();
  if (rows.length === 0) return <p className="py-6 text-[13px] text-ink/45">{t('Nothing yet — your first deposit appears here on its own.')}</p>;
  return (
    <ul className="divide-y divide-ink/[0.05]">
      {rows.map((r) => (
        <li key={r.key} className="flex items-center gap-3 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[14px] text-ink">{r.title}</p>
            <p className="mt-0.5 truncate text-[12px] text-ink/45">
              {new Date(r.at).toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · {r.detail}
            </p>
          </div>
          {r.amount ? <span className="font-mono text-[13px] text-ink/85">{r.amount}</span> : null}
          <Pill tone={r.tone} size="sm">{r.status}</Pill>
          {r.href ? <a href={r.href} target="_blank" rel="noreferrer" className="text-ink/35 hover:text-volt" aria-label={t('See it on the explorer')}><ExternalLink className="h-3.5 w-3.5" /></a> : null}
        </li>
      ))}
    </ul>
  );
}

/* ── Inicio ──────────────────────────────────────────────────────────────── */
function HomePanel({ c, demo, kyc, go }: { c: ExchangeClientApi; demo: DemoRunApi; kyc: ClientKyc; go: (tab: Tab) => void }) {
  const { t } = useT();
  const activity = useActivity(c, demo);
  const exchangeDrops = BigInt(c.me?.xrpOnExchangeDrops || '0');
  // FXRP y XRP van a 6 decimales: la suma es exacta en unidades base.
  const total = c.dec === 6 ? exchangeDrops + c.estValue : exchangeDrops;
  // 18-sep (fundador: «pone +13 XRP are on the way… y no se hace ningún
  // payload»). Sin autopilot, una petición PENDIENTE no va de camino: espera a
  // que el exchange la firme desde su omnibus con un QR. «En camino» es solo lo
  // que ya lleva firma (la petición firmada o el pago de la mesa firmado).
  const myDesk = (c.run.deskPayments ?? []).filter((p) => p.clientId === c.me?.id && p.kind === 'put-to-work');
  const sumDrops = (xs: Array<{ drops: string }>) => xs.reduce((s, r) => s + BigInt(r.drops), BigInt(0));
  const inTransit =
    sumDrops(c.myRequests.filter((r) => r.kind === 'put-to-work' && (r.status === 'submitting' || r.status === 'signed'))) +
    sumDrops(myDesk.filter((p) => p.status === 'signed'));
  const awaitingExchange =
    sumDrops(c.myRequests.filter((r) => r.kind === 'put-to-work' && r.status === 'pending')) +
    sumDrops(myDesk.filter((p) => p.status === 'prepared'));
  const symbol = c.pote?.asset.symbol ?? 'FXRP';

  return (
    <>
      <RevealItem>
        <Card glow className="p-6">
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div>
              <MicroLabel>{t('Total balance')}</MicroLabel>
              <p className="mt-2 font-mono text-[38px] font-semibold leading-none tracking-tight text-ink">
                {c.fmt(total)} <span className="text-[15px] text-ink/45">XRP</span>
              </p>
              <p className="mt-2 text-[12px] text-ink/40">{t('XRP at the exchange + FXRP in the vault. FXRP is minted and redeemed 1:1 against XRP, minus fees.')}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <PrimaryButton onClick={() => go('deposit')}><ArrowDownToLine className="h-4 w-4" /> {t('Deposit')}</PrimaryButton>
              <GhostButton onClick={() => go('vault')}>{t('Into the vault')}</GhostButton>
              <GhostButton onClick={() => go('withdraw')}><ArrowUpFromLine className="h-4 w-4" /> {t('Withdraw')}</GhostButton>
            </div>
          </div>
          <div className="mt-6 grid gap-px overflow-hidden rounded-xl bg-ink/[0.06] sm:grid-cols-3">
            <div className="bg-surface-1 p-4">
              <p className="text-[12px] text-ink/45">{t('XRP at the exchange')}</p>
              <p className="mt-1 font-mono text-[22px] font-semibold text-ink">{c.exchangeXrp} <span className="text-[12px] text-ink/45">XRP</span></p>
              <p className="mt-1 text-[12px] text-ink/40">{t('tag {tag} · held by {exchange}').replace('{tag}', String(c.me?.tag ?? '—')).replace('{exchange}', c.run.label)}</p>
            </div>
            <div className="bg-surface-1 p-4">
              <p className="text-[12px] text-ink/45">{t('In the vault')}</p>
              <p className="mt-1 font-mono text-[22px] font-semibold text-ink">{c.pote ? c.fmt(c.estValue) : '—'} <span className="text-[12px] text-ink/45">{symbol}</span></p>
              <p className="mt-1 text-[12px] text-ink/40">
                {c.pote ? `${c.fmt(c.shares)} ${t('shares · in your account')}` : c.poteReadFailed ? t('could not be read just now') : c.run.poteAddress ? t('reading…') : t('no vault yet')}
              </p>
              {inTransit > BigInt(0) ? <p className="mt-1 text-[12px] text-volt">+ {dropsToXrp(inTransit.toString())} XRP {t('on the way')}</p> : null}
              {awaitingExchange > BigInt(0) ? (
                <p className="mt-1 text-[12px] text-ink/55">{t('{xrp} XRP waiting for the exchange to sign').replace('{xrp}', dropsToXrp(awaitingExchange.toString()))}</p>
              ) : null}
            </div>
            <div className="bg-surface-1 p-4">
              <p className="text-[12px] text-ink/45">{t('Free in your account')}</p>
              <p className="mt-1 font-mono text-[22px] font-semibold text-ink">{c.facts?.fxrpFreeHuman ?? '0'} <span className="text-[12px] text-ink/45">{symbol}</span></p>
              <p className="mt-1 text-[12px] text-ink/40">{t('what you took out of the vault and kept')}</p>
            </div>
          </div>
        </Card>
      </RevealItem>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <RevealItem>
          <Card className="p-5">
            <div className="flex items-center">
              <h2 className="text-[15px] font-semibold tracking-tight text-ink">{t('Activity')}</h2>
              <button onClick={() => { void demo.reload(); void demo.scanOmnibus(); }} className="ml-auto inline-flex items-center gap-1 text-[12px] text-ink/45 hover:text-ink"><RefreshCw className="h-3 w-3" /> {t('Refresh')}</button>
            </div>
            <ActivityList rows={activity} />
          </Card>
        </RevealItem>
        <div className="space-y-4">
          <RevealItem><VaultSummaryCard c={c} onOpen={() => go('vault')} /></RevealItem>
          {kyc.required ? (
            <RevealItem>
              <Card className="flex items-start gap-3 p-5">
                {kyc.row?.ok ? <BadgeCheck className="h-5 w-5 shrink-0 text-tone-success" strokeWidth={1.8} /> : <ShieldCheck className="h-5 w-5 shrink-0 text-tone-warning" strokeWidth={1.8} />}
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-ink">{kyc.row?.ok ? t('KYC verified') : t('KYC pending at the exchange')}</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-ink/45">
                    {kyc.row?.ok
                      ? `${kyc.row.credentialType} · ${t('registered by {exchange} on the XRP Ledger').replace('{exchange}', c.run.label)}${kyc.row.expiresAtISO ? ` · ${t('until')} ${new Date(kyc.row.expiresAtISO).toLocaleDateString()}` : ''}`
                      : t('The exchange registers it from its side; you sign nothing. Money comes in once it is done — taking money out never needs it.')}
                  </p>
                  <button onClick={() => go('profile')} className="mt-1.5 text-[12px] text-volt hover:underline">{t('See it in your profile')} →</button>
                </div>
              </Card>
            </RevealItem>
          ) : null}
        </div>
      </div>
    </>
  );
}

function VaultSummaryCard({ c, onOpen }: { c: ExchangeClientApi; onOpen?: () => void }) {
  const { t } = useT();
  const p = c.pote;
  return (
    <Card className="p-5">
      <div className="flex items-center">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">{p ? p.name : t('The vault')}</h2>
        {onOpen ? <button onClick={onOpen} className="ml-auto text-[12px] text-volt hover:underline">{t('Go to the vault')} →</button> : null}
      </div>
      {!p ? (
        <p className="mt-3 text-[13px] text-ink/45">{c.run.poteAddress ? (c.poteReadFailed ? t('The vault could not be read just now.') : t('Reading the vault…')) : t('The exchange has not opened its vault yet.')}</p>
      ) : (
        <ul className="mt-2 divide-y divide-ink/[0.05] text-[13px]">
          {p.venues.filter((v) => !v.retired).map((v) => {
            const id = venueIdentity(v.target);
            return (
              <li key={v.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="text-ink/85">{id.known ? id.name : shortHash(v.target, 6, 4)}</span>
                <span className="text-[12px] text-ink/45">{id.known ? id.product : String(v.kind)}</span>
              </li>
            );
          })}
          <li className="flex items-center justify-between gap-3 py-2.5">
            <span className="text-ink/45">{t('Exit')}</span>
            <span className="text-ink/85">{p.cooldownSeconds ? t('{h} h window').replace('{h}', String(Math.round(p.cooldownSeconds / 3600))) : t('Immediate')}</span>
          </li>
        </ul>
      )}
    </Card>
  );
}

/* ── Depositar ───────────────────────────────────────────────────────────── */
function CopyChip({ value }: { value: string }) {
  const { t } = useT();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { void navigator.clipboard?.writeText(value).then(() => { setDone(true); window.setTimeout(() => setDone(false), 1500); }).catch(() => undefined); }}
      className="inline-flex items-center gap-1.5 rounded-full border border-ink/10 px-2.5 py-1 text-[12px] text-ink/60 transition-colors hover:border-ink/25 hover:text-ink"
    >
      {done ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {done ? t('Copied') : t('Copy')}
    </button>
  );
}

function DepositPanel({ c, demo }: { c: ExchangeClientApi; demo: DemoRunApi }) {
  const { t } = useT();
  const [amount, setAmount] = useState('');
  const [door, setDoor] = useState<'qr' | null>(null);
  const [qrBlocked, setQrBlocked] = useState(false);
  const ins = c.instructions;
  const deposits = (demo.omnibus?.ok ? demo.omnibus.data.txs : []).filter((x) => x.clientId === c.me?.id && x.kind === 'deposit').slice(0, 6);
  const applied = new Set(c.run.appliedTxHashes);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <RevealItem>
        <Card className="p-6">
          <h2 className="text-[17px] font-semibold tracking-tight text-ink">{t('Deposit XRP')}</h2>
          {c.depositUnconfirmed ? (
            <div className="mt-4">
              <UnconfirmedSignatureNotice
                rail="xrpl"
                xrplKind="payment"
                unconfirmed={c.depositUnconfirmed}
                onClose={() => { c.setDepositUnconfirmed(null); c.setInstructions(null); void demo.scanOmnibus(); }}
              />
            </div>
          ) : !ins ? (
            <>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink/55">{t('Send XRP to the exchange account with your tag. It is credited to you as soon as the ledger validates it.')}</p>
              <label className="mt-5 block text-[12px] text-ink/55">
                {t('How much')}
                <div className="relative mt-1.5">
                  <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0" className={inputClass} />
                  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[13px] text-ink/40">XRP</span>
                </div>
              </label>
              <PrimaryButton onClick={() => void c.getInstructions(amount)} disabled={c.busy !== null || !XRP_RE.test(amount)} className="mt-4 w-full py-3">
                {c.busy === 'deposit' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowDownToLine className="h-4 w-4" />} {t('Prepare the deposit')}
              </PrimaryButton>
            </>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="space-y-4 rounded-xl border border-ink/[0.08] bg-surface-2 p-4">
                <div>
                  <p className="text-[12px] text-ink/45">{t('Address of {exchange}').replace('{exchange}', c.run.label)}</p>
                  <div className="mt-1 flex items-center justify-between gap-3">
                    <span className="break-all font-mono text-[14px] text-ink">{ins.destination}</span>
                    <CopyChip value={ins.destination} />
                  </div>
                </div>
                <div className="h-px bg-ink/[0.06]" />
                <div>
                  <p className="text-[12px] text-ink/45">{t('Destination tag · yours')}</p>
                  <div className="mt-1 flex items-center justify-between gap-3">
                    <span className="font-mono text-[32px] font-semibold leading-none text-volt">{ins.destinationTag}</span>
                    <CopyChip value={String(ins.destinationTag)} />
                  </div>
                </div>
                <div className="h-px bg-ink/[0.06]" />
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-ink/45">{t('Amount')}</span>
                  <span className="font-mono text-ink">{ins.amountXrp} XRP</span>
                </div>
              </div>
              <p className="flex items-start gap-2 rounded-xl border border-tone-warning/25 bg-tone-warning/[0.06] p-3 text-[12.5px] leading-relaxed text-tone-warning">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                {t('Always include tag {tag}. Without it the exchange cannot tell the deposit is yours.').replace('{tag}', String(ins.destinationTag))}
              </p>
              {door === 'qr' ? (
                <div className="space-y-2">
                  <DepositQrSign
                    instructions={ins}
                    onSettled={(hash) => { c.depositSettledByQr(hash); setDoor(null); setQrBlocked(false); }}
                    onBlockedChange={setQrBlocked}
                    onCancelled={() => { setDoor(null); setQrBlocked(false); }}
                  />
                  {!qrBlocked ? <button onClick={() => setDoor(null)} className="text-[12px] text-ink/45 hover:text-ink">{t('Back')}</button> : null}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <PrimaryButton onClick={() => setDoor('qr')} disabled={c.busy !== null}>{t('Pay with Xaman (QR)')}</PrimaryButton>
                  {c.xrplConnected ? (
                    <GhostButton onClick={() => void c.signDepositWithConnectedXaman()} disabled={c.busy !== null}>
                      {c.busy === 'sign-deposit' ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {t('Sign with my connected Xaman')}
                    </GhostButton>
                  ) : null}
                  <GhostButton onClick={() => c.setInstructions(null)} disabled={c.busy !== null}>{t('Change the amount')}</GhostButton>
                </div>
              )}
            </div>
          )}
          <p className="mt-5 text-[12px] leading-relaxed text-ink/45">
            {t('The deposit is signed by the wallet where your XRP is. A passkey does not sign on the XRP Ledger: you use it for what happens inside your account — the vault and your withdrawals.')}
          </p>
        </Card>
      </RevealItem>

      <RevealItem>
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">{t('Your deposits')}</h2>
          {deposits.length === 0 ? (
            <p className="py-6 text-[13px] text-ink/45">{t('No deposits seen yet. They show up here on their own.')}</p>
          ) : (
            <ul className="mt-1 divide-y divide-ink/[0.05]">
              {deposits.map((x) => {
                const credited = applied.has(`in:${x.hash.toUpperCase()}`);
                return (
                  <li key={x.hash} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="font-mono text-[14px] text-tone-success">+{dropsToXrp(x.drops)} XRP</p>
                      <p className="mt-0.5 text-[12px] text-ink/45">
                        {new Date(x.dateISO).toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} ·{' '}
                        {x.explorerUrl ? <a href={x.explorerUrl} target="_blank" rel="noreferrer" className="font-mono text-volt hover:underline">{shortHash(x.hash, 4, 4)}</a> : shortHash(x.hash, 4, 4)}
                      </p>
                    </div>
                    <Pill tone={credited ? 'success' : 'info'} size="sm">{credited ? t('Credited') : t('Seen on the ledger')}</Pill>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </RevealItem>
    </div>
  );
}

/* ── Vault ───────────────────────────────────────────────────────────────── */
function VaultPanel({ c }: { c: ExchangeClientApi }) {
  const { t } = useT();
  const [amount, setAmount] = useState('');
  const last = c.myRequests.find((r) => r.kind === 'put-to-work');
  const p = c.pote;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <RevealItem>
          <Card className="p-6">
            <h2 className="text-[17px] font-semibold tracking-tight text-ink">{t('Put XRP into the vault')}</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink/55">{t('From your balance at the exchange. The shares arrive in your account, in your name.')}</p>
            <div className="relative mt-5">
              <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0" className={inputClass} />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[13px] text-ink/40">XRP</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-[12px]">
              <span className="text-ink/45">{t('Available')} <span className="font-mono text-ink/75">{c.exchangeXrp} XRP</span></span>
              <button onClick={() => setAmount(c.exchangeXrp)} className="text-volt hover:underline">{t('Max')}</button>
            </div>

            <dl className="mt-5 divide-y divide-ink/[0.05] text-[13px]">
              <div className="flex items-center justify-between gap-3 py-2.5"><dt className="text-ink/45">{t('In the name of')}</dt><dd className="text-ink/85">{t('your account')} <span className="font-mono">{shortHash(c.account, 6, 4)}</span></dd></div>
              <div className="flex items-center justify-between gap-3 py-2.5"><dt className="text-ink/45">{t('Who executes it')}</dt><dd className="text-ink/85">{c.run.label}, {t('from its account')}</dd></div>
              <div className="flex items-start justify-between gap-3 py-2.5"><dt className="text-ink/45">{t('Fees')}</dt><dd className="max-w-[60%] text-right text-ink/70">{t('The FAssets minting fee is charged by the protocol when your XRP becomes FXRP. The exact figure is on your receipt.')}</dd></div>
            </dl>

            <PrimaryButton
              onClick={() => { void c.askToWork(amount).then((ok) => { if (ok) setAmount(''); }); }}
              disabled={c.busy !== null || !c.run.poteAddress || !XRP_RE.test(amount)}
              className="mt-5 w-full py-3.5 text-[15px]"
            >
              {c.busy === 'ask' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Landmark className="h-4 w-4" />} {t('Put it into the vault')}
            </PrimaryButton>
            {/* it. 31 — el rechazo JUNTO AL BOTÓN, y con su puerta: una entrada
                muerta delante (409 REQUEST_PENDING) o una salida/reserva que
                retiene el saldo (409 INSUFFICIENT_AVAILABLE_BALANCE) traen los
                ids que el propio dueño puede soltar; aquí se pulsan. */}
            {c.error && c.requestRefusal?.kind === 'put-to-work' ? <p className="mt-2 text-[12px] text-tone-warning">{c.error}</p> : null}
            {c.requestRefusal?.kind === 'put-to-work' ? (
              <RequestRefusalActions refusal={c.requestRefusal} busy={c.busy !== null} onOpenDoor={(door) => void c.openDoor(door)} onRetry={() => void c.retryRequest()} />
            ) : null}
            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-ink/[0.08] p-3">
              <input type="checkbox" checked={Boolean(c.me?.autoInvest)} onChange={() => void c.toggleAutoInvest()} className="mt-1 accent-[hsl(var(--volt))]" />
              <span>
                <span className="block text-[13px] font-medium text-ink">{t('Put every deposit into the vault')}</span>
                <span className="mt-0.5 block text-[12px] leading-relaxed text-ink/45">{t('Each credited deposit goes in automatically, with the same fees. You can switch it off at any time.')}</span>
              </span>
            </label>
          </Card>
        </RevealItem>

        {last ? (
          <RevealItem>
            <Card className="p-5">
              <div className="mb-4 flex items-center gap-2">
                <h2 className="text-[15px] font-semibold tracking-tight text-ink">{t('Your last entry')}</h2>
                <Pill tone={requestStatus(last, t).tone} size="sm">{dropsToXrp(last.drops)} XRP · {requestStatus(last, t).label}</Pill>
              </div>
              <ol className="space-y-3.5">
                {[
                  { label: t('Requested'), done: true, sub: new Date(last.createdAt).toLocaleString() },
                  { label: t('Paid by the exchange on the XRP Ledger'), done: last.status === 'signed' || last.status === 'done', sub: last.txHash ? shortHash(last.txHash) : undefined, href: last.txHash ? `https://xrpscan.com/tx/${last.txHash}` : undefined },
                  { label: t('Shares in your account'), done: last.status === 'done', sub: last.status === 'signed' ? t('minting FXRP — usually a few minutes') : undefined },
                ].map((s, i) => (
                  <li key={s.label} className="flex items-start gap-3">
                    <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full font-mono text-[11px] ${s.done ? 'bg-tone-success/15 text-tone-success' : 'border border-ink/15 text-ink/40'}`}>
                      {s.done ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className={`text-[13px] ${s.done ? 'text-ink' : 'text-ink/60'}`}>{s.label}</p>
                      {s.sub ? (s.href ? <a href={s.href} target="_blank" rel="noreferrer" className="font-mono text-[12px] text-volt hover:underline">{s.sub}</a> : <p className="text-[12px] text-ink/45">{s.sub}</p>) : null}
                    </div>
                  </li>
                ))}
              </ol>
              {isTakenByDesk(last) ? (
                <p className="mt-3 text-[12px] text-ink/55">{t('The exchange took this request to sign it from its account — its progress shows in your activity.')}</p>
              ) : last.status === 'refused' && last.reason ? <p className="mt-3 text-[12px] text-tone-warning">{last.reason}</p> : null}
            </Card>
          </RevealItem>
        ) : null}
      </div>

      <RevealItem>
        <Card className="p-6">
          <MicroLabel>{t('The vault')}</MicroLabel>
          <h2 className="mt-2 text-[18px] font-semibold tracking-tight text-ink">{p?.name ?? '—'}</h2>
          {p ? (
            <>
              <p className="mt-1 text-[12px] text-ink/45">{t('Your position')}: <span className="font-mono text-ink/80">{c.fmt(c.estValue)} {p.asset.symbol}</span></p>
              <dl className="mt-4 divide-y divide-ink/[0.05] text-[13px]">
                {p.venues.filter((v) => !v.retired).map((v) => {
                  const id = venueIdentity(v.target);
                  return (
                    <div key={v.id} className="flex items-center justify-between gap-3 py-2.5">
                      <dt className="text-ink/85">{id.known ? id.name : shortHash(v.target, 6, 4)}</dt>
                      <dd className="text-[12px] text-ink/45">{id.known ? id.product : String(v.kind)}</dd>
                    </div>
                  );
                })}
                <div className="flex items-center justify-between gap-3 py-2.5"><dt className="text-ink/45">{t('Exit')}</dt><dd className="text-ink/85">{p.cooldownSeconds ? t('{h} h window').replace('{h}', String(Math.round(p.cooldownSeconds / 3600))) : t('Immediate')}</dd></div>
                <div className="flex items-center justify-between gap-3 py-2.5"><dt className="text-ink/45">{t('Always liquid')}</dt><dd className="font-mono text-ink/85">{(p.bufferFloorBps / 100).toFixed(0)} %</dd></div>
                <div className="flex items-center justify-between gap-3 py-2.5"><dt className="text-ink/45">{t('Cap per venue')}</dt><dd className="font-mono text-ink/85">{(p.maxVenueBps / 100).toFixed(0)} %</dd></div>
              </dl>
              <p className="mt-4 flex items-start gap-2.5 rounded-xl bg-surface-2 p-3.5 text-[12.5px] leading-relaxed text-ink/70">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-volt" />
                {t('The exchange can only move your capital between the venues this vault allows. It cannot take it out: only your passkey redeems your shares.')}
              </p>
            </>
          ) : (
            <p className="mt-3 text-[13px] text-ink/45">{c.run.poteAddress ? (c.poteReadFailed ? t('The vault could not be read just now.') : t('Reading the vault…')) : t('The exchange has not opened its vault yet.')}</p>
          )}
        </Card>
      </RevealItem>
    </div>
  );
}

/* ── Retirar ─────────────────────────────────────────────────────────────── */
const EXIT_TITLE: Record<ClientExitTo, string> = {
  wallet: 'To my XRPL wallet',
  exchange: 'To my account at the exchange',
  keep: 'Keep it in my account',
};

function WithdrawPanel({ c, demo }: { c: ExchangeClientApi; demo: DemoRunApi }) {
  const { t } = useT();
  const [exitAmount, setExitAmount] = useState('');
  const [xrpAmount, setXrpAmount] = useState('');
  const review = c.exitReview?.review;
  const lastWithdraw = c.myRequests.find((r) => r.kind === 'withdraw');
  const symbol = c.pote?.asset.symbol ?? 'FXRP';
  // «Max» a la precisión REAL del activo: `c.fmt` recorta a 4 decimales para
  // leerse, y ese recorte dejaría polvo en la bóveda.
  const maxText =
    c.pote && c.estValue > BigInt(0) ? fmtBase(c.estValue, c.pote.asset.decimals, c.pote.asset.decimals) : '';
  /** Pedir el máximo ES pedirlo todo: se manda vacío, que redime TODAS las
   *  participaciones. Con una cifra, el redondeo de ida y vuelta (importe →
   *  participaciones) puede dejar una fracción dentro; «todo» no deja nada. */
  const takingAll = exitAmount.trim() === '' || (maxText !== '' && exitAmount.trim() === maxText);
  /** Por qué NO se puede pedir la salida ahora mismo — null = se puede. */
  const blockedReason: string | null = !c.run.poteAddress
    ? t('The exchange has not opened its vault yet, so there is nothing to take out.')
    : c.pote !== null && !c.poteReadFailed && c.shares <= BigInt(0)
      ? t('You hold no shares of this vault yet. Put XRP to work first and your shares will show up here.')
      : exitAmount.trim() !== '' && !XRP_RE.test(exitAmount)
        ? t('Write a number with up to 6 decimals, or leave it empty to take everything out.')
        : null;

  const exitSub = (key: ClientExitTo, enabled: boolean, reason: string | null): string => {
    if (!enabled && reason) return t(reason);
    if (key === 'wallet') return `${t('as XRP to')} ${shortHash(c.me?.xrplAddress, 5, 4)}`;
    if (key === 'exchange') return t('as XRP into your slot, tag {tag}').replace('{tag}', String(c.me?.tag ?? '—'));
    return c.pote?.cooldownSeconds ? t('as FXRP, claimable when the window ends') : t('as FXRP in your passkey account');
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <RevealItem>
        <Card className="p-6">
          <div className="flex items-center gap-3">
            <h2 className="text-[17px] font-semibold tracking-tight text-ink">{t('Take it out of the vault')}</h2>
            <span className="ml-auto text-[12px] text-ink/45">{t('in the vault')} <span className="font-mono text-ink/80">{c.pote ? c.fmt(c.estValue) : '—'} {symbol}</span></span>
          </div>

          {c.exitUnconfirmed ? (
            <div className="mt-4">
              <UnconfirmedSignatureNotice rail="evm" chainId={14} unconfirmed={c.exitUnconfirmed} onClose={() => { c.setExitUnconfirmed(null); void demo.refreshChain(); }} />
            </div>
          ) : review && c.exitReview ? (
            <div className="mt-4 space-y-3 rounded-xl border border-volt/30 bg-surface-2 p-4 text-[13px]">
              <p className="font-semibold text-ink">{t('Before your passkey — what this signature does')}</p>
              <p className="leading-relaxed text-ink/80">{fillParams(t(review.headline), review.headlineParams)}</p>
              {review.destinationIgnored ? <p className="text-tone-warning">{t('The destination you picked is not used by this pote: with an exit window the exit is a ticket for your Face ID account, not a transfer to the XRP Ledger.')}</p> : null}
              <p className="text-ink/70">
                {review.fee.kind === 'charged'
                  ? fillParams(t('Astryum service fee: {pct}% of your shares ({shares} base shares), deducted in this same signature.'), { pct: String(review.fee.bps / 100), shares: review.fee.feeShares })
                  : review.fee.kind === 'none'
                    ? t('Astryum service fee: none composed in this exit.')
                    : t('Astryum service fee: the server did not return the figure — unavailable here, not zero.')}
              </p>
              {review.mentionsRedemptionFee ? (() => {
                const fee = review.redemptionFee ?? { kind: 'unreadable' as const };
                const line = redemptionFeeSentence(fee);
                return <p className={fee.kind === 'unreadable' ? 'text-tone-warning' : 'text-ink/70'}>{fillParams(t(line.text), line.params)}</p>;
              })() : null}
              {review.disclosures.map((d, i) => (
                <div key={`${d.title}-${i}`} className="rounded-lg border border-ink/10 p-2.5">
                  <p className="font-semibold text-ink/90">{d.title}</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] text-ink/65">{d.lines.map((l, j) => <li key={j}>{l}</li>)}</ul>
                </div>
              ))}
              <div className="flex gap-2 pt-1">
                <PrimaryButton onClick={() => void c.confirmExit()} disabled={c.pkBusy || c.busy !== null} className="flex-1 py-3">
                  {c.busy === 'exit' || c.pkBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanFace className="h-4 w-4" />} {t('Confirm with passkey')}
                </PrimaryButton>
                <GhostButton onClick={() => c.setExitReview(null)} disabled={c.pkBusy || c.busy !== null}>{t('Back')}</GhostButton>
              </div>
            </div>
          ) : (
            <>
              <div className="relative mt-5">
                <input value={exitAmount} onChange={(e) => setExitAmount(e.target.value)} inputMode="decimal" placeholder={t('All')} className={`${inputClass} pr-24`} />
                <span className="absolute right-3.5 top-1/2 flex -translate-y-1/2 items-center gap-2.5">
                  {maxText ? (
                    <button type="button" onClick={() => setExitAmount(maxText)} className="text-[12px] text-volt hover:underline">{t('Max')}</button>
                  ) : null}
                  <span className="pointer-events-none text-[13px] text-ink/40">{symbol}</span>
                </span>
              </div>
              <p className="mt-2 text-[12px] text-ink/45">
                {takingAll ? t('Everything you hold in the vault leaves — the contract redeems your shares, so no dust is left behind.') : t('Leave it empty to take everything out.')}
              </p>

              <MicroLabel className="mt-5 block">{t('Where to')}</MicroLabel>
              <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                {c.exitOptions.map((o) => {
                  const on = c.exitTo === o.key;
                  return (
                    <button
                      key={o.key}
                      type="button"
                      disabled={!o.enabled}
                      onClick={() => c.setExitTo(o.key)}
                      aria-pressed={on}
                      className={`flex items-start gap-3 rounded-xl border p-3.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${on ? 'border-volt/50 bg-volt/[0.06]' : 'border-ink/10 hover:border-ink/25'}`}
                    >
                      <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border ${on ? 'border-volt' : 'border-ink/30'}`}>{on ? <span className="h-2 w-2 rounded-full bg-volt" /> : null}</span>
                      <span className="min-w-0">
                        <span className="block text-[14px] font-medium text-ink">{t(EXIT_TITLE[o.key])}</span>
                        <span className="mt-0.5 block text-[12px] leading-relaxed text-ink/45">{exitSub(o.key, o.enabled, o.reason)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>

              <PrimaryButton
                onClick={() => void c.prepareExit(takingAll ? '' : exitAmount)}
                disabled={c.pkBusy || c.busy !== null || blockedReason !== null}
                className="mt-5 w-full py-3.5 text-[15px]"
              >
                {c.busy === 'exit-prepare' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpFromLine className="h-4 w-4" />} {t('Review the exit')}
              </PrimaryButton>
              {/* UN BOTÓN APAGADO SIN MOTIVO ES UN BUG (fundador 15-sep: «no me
                  funciona»). El motivo se dice siempre: sin participaciones no
                  hay nada que redimir, y eso no se adivina mirando un botón
                  gris. */}
              {blockedReason ? <p className="mt-2 text-[12px] text-tone-warning">{blockedReason}</p> : null}
              {/* El rechazo, JUNTO AL BOTÓN: el aviso de arriba queda fuera de
                  la vista con la pestaña desplazada, y entonces «no funciona»
                  es todo lo que el usuario puede contar. */}
              {!blockedReason && c.error ? <p className="mt-2 text-[12px] text-tone-warning">{c.error}</p> : null}
            </>
          )}
          {c.poteReadFailed ? <p className="mt-3 text-[12px] text-tone-warning">{t('Your position could not be read just now. The button stays: it reads again when you press it, and the vault only redeems the shares you hold.')}</p> : null}
          {c.txUrl ? <a href={c.txUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-[13px] text-volt hover:underline">{t('See it on the explorer')} <ExternalLink className="h-3.5 w-3.5" /></a> : null}
          <p className="mt-4 text-[12px] leading-relaxed text-ink/45">{t('Taking money out of the vault never depends on the exchange or on your KYC: your passkey signs and the contract executes.')}</p>
        </Card>
      </RevealItem>

      <RevealItem>
        <div className="space-y-4">
          <Card className="p-6">
            <h2 className="text-[17px] font-semibold tracking-tight text-ink">{t('Withdraw XRP from the exchange')}</h2>
            <p className="mt-1 text-[12px] text-ink/45">{t('Available')} <span className="font-mono text-ink/80">{c.exchangeXrp} XRP</span></p>
            {c.me?.xrplAddress ? (
              <>
                <div className="relative mt-4">
                  <input value={xrpAmount} onChange={(e) => setXrpAmount(e.target.value)} inputMode="decimal" placeholder="0" className={inputClass} />
                  <button onClick={() => setXrpAmount(c.exchangeXrp)} className="absolute right-4 top-1/2 -translate-y-1/2 text-[12px] text-volt hover:underline">{t('Max')}</button>
                </div>
                <dl className="mt-4 divide-y divide-ink/[0.05] text-[13px]">
                  <div className="flex items-center justify-between gap-3 py-2.5"><dt className="text-ink/45">{t('To')}</dt><dd className="font-mono text-ink/85">{shortHash(c.me.xrplAddress, 6, 5)}</dd></div>
                  <div className="flex items-center justify-between gap-3 py-2.5"><dt className="text-ink/45">{t('Who pays it')}</dt><dd className="text-ink/85">{c.run.label}, {t('from its account')}</dd></div>
                </dl>
                <PrimaryButton onClick={() => { void c.askWithdraw(xrpAmount).then((ok) => { if (ok) setXrpAmount(''); }); }} disabled={c.busy !== null || !XRP_RE.test(xrpAmount)} className="mt-4 w-full py-3">
                  {c.busy === 'withdraw' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpFromLine className="h-4 w-4" />} {t('Withdraw to my wallet')}
                </PrimaryButton>
                {/* it. 31 — LA SALIDA JAMÁS SE GATEA, y cuando el servidor la
                    retiene por algo en vuelo, la puerta del dueño se pulsa aquí
                    (o «Try again» si lo que falló fue una lectura nuestra). */}
                {c.error && c.requestRefusal?.kind === 'withdraw' ? <p className="mt-2 text-[12px] text-tone-warning">{c.error}</p> : null}
                {c.requestRefusal?.kind === 'withdraw' ? (
                  <RequestRefusalActions refusal={c.requestRefusal} busy={c.busy !== null} onOpenDoor={(door) => void c.openDoor(door)} onRetry={() => void c.retryRequest()} />
                ) : null}
                {lastWithdraw ? (
                  <p className="mt-3 flex items-center gap-2 text-[12px] text-ink/55">
                    {t('Last withdrawal')}: <span className="font-mono">{dropsToXrp(lastWithdraw.drops)} XRP</span>
                    <Pill tone={requestStatus(lastWithdraw, t).tone} size="sm">{requestStatus(lastWithdraw, t).label}</Pill>
                  </p>
                ) : null}
              </>
            ) : (
              <p className="mt-3 text-[13px] leading-relaxed text-ink/55">{t('To withdraw to self-custody, first set your withdrawal wallet below.')}</p>
            )}
            <p className="mt-4 text-[12px] leading-relaxed text-ink/45">{t('Withdrawing never depends on your KYC.')}</p>
          </Card>
          {c.me && !c.me.xrplAddress && !c.needsClaim ? <WithdrawalWalletCard run={c.run} me={c.me} onSaved={demo.setRun} /> : null}
        </div>
      </RevealItem>
    </div>
  );
}

/* ── Perfil ──────────────────────────────────────────────────────────────── */
function ProfilePanel({ c, demo }: { c: ExchangeClientApi; demo: DemoRunApi }) {
  const { t } = useT();
  const me = c.me!;
  const initials = me.label.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <RevealItem>
        <Card className="p-6">
          <div className="flex items-center gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-surface-3 text-[18px] font-semibold text-ink/85">{initials}</span>
            <div className="min-w-0">
              <p className="text-[20px] font-semibold tracking-tight text-ink">{me.label}</p>
              <p className="text-[13px] text-ink/45">{t('Client of {exchange} since {date}').replace('{exchange}', c.run.label).replace('{date}', new Date(me.createdAt).toLocaleDateString())}</p>
            </div>
          </div>
          <dl className="mt-5 divide-y divide-ink/[0.05] text-[13px]">
            <div className="flex items-center justify-between gap-3 py-3"><dt className="text-ink/45">{t('Your tag')}</dt><dd className="font-mono text-[15px] text-volt">{me.tag}</dd></div>
            <div className="flex items-center justify-between gap-3 py-3">
              <dt className="text-ink/45">{t('Account of your shares')}<span className="block text-[11px] text-ink/35">{t('on Flare · only your passkey opens it')}</span></dt>
              <dd><a href={`https://flarescan.com/address/${c.account}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-ink/85 hover:text-volt">{shortHash(c.account, 6, 4)} <ExternalLink className="h-3 w-3" /></a></dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-3">
              <dt className="text-ink/45">{t('Withdrawal wallet')}</dt>
              <dd className="flex items-center gap-2">{me.xrplAddress ? <><span className="font-mono text-ink/85">{shortHash(me.xrplAddress, 5, 4)}</span><Pill tone="success" size="sm">{t('proven yours')}</Pill></> : <span className="text-ink/45">{t('not set yet')}</span>}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-3"><dt className="text-ink/45">{t('Passkey')}</dt><dd className="text-ink/85">{t('this device')}</dd></div>
          </dl>
        </Card>
      </RevealItem>
      <RevealItem>
        <div className="space-y-4">
          <ClientKycCard runId={c.run.runId} client={me} />
          <div>
            <MicroLabel className="mb-2 block">{t('Your exchange')}</MicroLabel>
            <ManagerPublicProfile role="exchange" account={c.run.councilAddress} />
          </div>
          {!me.xrplAddress && !c.needsClaim ? <WithdrawalWalletCard run={c.run} me={me} onSaved={demo.setRun} /> : null}
        </div>
      </RevealItem>
    </div>
  );
}

/**
 * `intent` — con qué puerta de la portada se llegó (15-sep). «create» es el
 * comportamiento de siempre (si no hay ficha, se abre una); «enter» dice antes
 * que aquí no hay cuenta todavía. Ninguna de las dos cambia una regla de dinero.
 */
export function ExchangeClientApp({ intent }: { intent?: ClientIntent } = {}) {
  return <PasskeyEntry>{(account) => <ClientPortal account={account} intent={intent} />}</PasskeyEntry>;
}

export default ExchangeClientApp;
