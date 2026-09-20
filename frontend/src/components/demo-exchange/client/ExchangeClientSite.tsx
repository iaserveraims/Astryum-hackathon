'use client';

/**
 * ExchangeClientSite — EL SITIO DEL CLIENTE del exchange, el que vive en el
 * menú (fundador 2026-09-11: «tiene que haber un sitio para el usuario y un
 * sitio para el operador; el del operador más escondido… el usuario del
 * exchange tiene que tener una estética más como el resto de la página, más
 * acogedora, con animaciones»).
 *
 * QUIÉN ES EL CLIENTE AQUÍ (flujo canónico §2): alguien que se da de alta en
 * un exchange y recibe su TAG — su casilla dentro del omnibus del exchange
 * (la segunda cuenta, la de los usuarios). Su XRP vive en ese omnibus por
 * tag; sus participaciones, cuando el XRP trabaja, viven en SU cuenta Flare
 * de passkey (Face ID), a su nombre y fuera del alcance del exchange. No
 * necesita cuenta XRPL propia para ENTRAR; la necesita para RETIRAR a
 * autocustodia — y aquí puede crearla, elegir una ya conectada o conectar
 * una nueva.
 *
 * LO QUE ENVUELVE: la lógica del lado cliente es ClientInner (ClientApp.tsx),
 * sin reescribir — aquí se le pone la casa alrededor: cabecera, escena, el
 * camino en cuatro pasos leído del run, la elección de exchange por
 * identidad (jamás por selector cuando ya se es cliente), y la wallet de
 * retiradas. Solo fundadores por ahora (PreviewOnly en la página); cuando
 * llegue CredentialAccessGate, este será el sitio público.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Building2, Check, KeyRound, Landmark, PenLine, Plus, ScanFace, Smartphone, Wallet } from 'lucide-react';
import { Card, EmptyState, GhostButton, MicroLabel, PageHeader, PrimaryButton } from '../../ui/primitives';
import { RevealGroup, RevealItem } from '../../ui/motion';
import { TetherScene } from '../../earn/icons';
import { useT } from '../../../i18n/LanguageProvider';
import { PasskeyGate } from '../../institutional/user/PasskeyGate';
import { ClientInner } from '../ClientApp';
import { EXCHANGE_EXIT_PROMISE } from '../../../lib/demo-exchange/clientExitPlan';
import { useDemoRun } from '../../../lib/demo-exchange/useDemoRun';
import { demoApi, describeRefusal, networkRefusal, type DemoClient, type DemoRun, type Refusal, type RunSummary, type WalletProofRow } from '../../../lib/demo-exchange/api';
import { PortalRefusal } from './PortalRefusal';
import { confirmBinding, initiateBinding } from '../../../services/walletLinkService';
import { WalletServiceFactory } from '../../../services/wallets/WalletServiceFactory';
import type { XamanWalletService } from '../../../services/wallets/XamanWalletService';
import type { ChainFacts } from '../../../lib/demo-exchange/useDemoRun';
import { useWalletStore } from '../../../stores/walletStore';
import { WalletSelect, type WalletFaceRecord } from '../../wallet/WalletSelect';
import { useLinkedRecordOf } from '../../../hooks/useLinkedRecordOf';
import { useMyWallets } from '../../../hooks/useMyWallets';
import { isXrplWallet, walletDisplayName } from '../../../lib/walletIdentity';
import { shortAddr } from '../../../lib/institutional/format';

const XRPL_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

/* ── La escena de entrada: qué es esto, en tres hechos ───────────────────── */
function Hero() {
  const { t } = useT();
  const facts = [
    { icon: Building2, title: t('Your XRP, at the exchange'), body: t('You deposit with your tag, like at any exchange. The exchange keeps the XRP in its omnibus account.') },
    { icon: ScanFace, title: t('Working, in your name'), body: t('When it works, the shares live in an account that only your Face ID controls. The exchange cannot touch them.') },
    // The promise has to hold for BOTH policies (lib/demo-exchange/clientExitPlan):
    // a pote with an exit window pays a ticket into the Face ID account, not a wallet.
    { icon: Landmark, title: t('Out with one signature'), body: t(EXCHANGE_EXIT_PROMISE) },
  ];
  return (
    <Card className="overflow-hidden p-0" glow>
      <div className="grid gap-6 p-6 md:grid-cols-[minmax(0,1fr)_200px] md:items-center">
        <div className="min-w-0">
          <MicroLabel>{t('A custodial exchange, on the rail')}</MicroLabel>
          <h2 className="mt-2 text-[20px] font-semibold tracking-tight text-ink">{t('Your capital works, and stays yours')}</h2>
          <ul className="mt-4 space-y-3">
            {facts.map((f) => (
              <li key={f.title} className="flex items-start gap-3">
                <f.icon className="mt-0.5 h-4 w-4 shrink-0 text-volt/80" strokeWidth={1.7} />
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-ink/85">{f.title}</p>
                  <p className="mt-0.5 max-w-[58ch] text-[12.5px] leading-relaxed text-ink/50">{f.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="hidden justify-self-center md:block" aria-hidden>
          <TetherScene width={190} height={150} />
        </div>
      </div>
    </Card>
  );
}

/* ── El camino, en cuatro pasos, leído del run ───────────────────────────── */
function Journey({ run, chain, me }: { run: DemoRun; chain: ChainFacts | null; me: DemoClient | undefined }) {
  const { t } = useT();
  const facts = me ? chain?.clients.find((c) => c.clientId === me.id) : undefined;
  const mine = (step: string[]) => Boolean(me && run.receipts.some((r) => r.clientId === me.id && step.includes(r.step)));
  const steps = [
    { label: t('Account'), hint: t('your tag at the exchange'), done: Boolean(me) },
    { label: t('Deposit'), hint: t('XRP with your tag'), done: Boolean(me && (BigInt(me.xrpOnExchangeDrops || '0') > BigInt(0) || mine(['U1_DEPOSIT']))) },
    { label: t('Working'), hint: t('shares in your name'), done: Boolean((facts?.shares && BigInt(facts.shares) > BigInt(0)) || mine(['E5_PUT_TO_WORK'])) },
    { label: t('Out'), hint: t('one Face ID'), done: mine(['U4_EXIT', 'U4_EXIT_XRP']) },
  ];
  const current = steps.findIndex((s) => !s.done);
  return (
    <div className="grid gap-2 sm:grid-cols-4" role="list" aria-label={t('Your path at the exchange')}>
      {steps.map((s, i) => {
        const isCurrent = i === current;
        return (
          <div key={s.label} role="listitem" className={`rounded-xl border p-3 transition-colors ${s.done ? 'border-tone-success/30 bg-tone-success/[0.05]' : isCurrent ? 'border-volt/40 bg-volt/[0.05]' : 'border-ink/10'}`}>
            <div className="flex items-center gap-2">
              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${s.done ? 'bg-tone-success/20 text-tone-success' : isCurrent ? 'bg-volt/20 text-volt' : 'border border-ink/15 text-ink/35'}`}>
                {s.done ? <Check className="h-3 w-3" strokeWidth={2.5} /> : <span className="font-mono text-[10px]">{i + 1}</span>}
              </span>
              <span className={`text-[13px] font-medium ${s.done || isCurrent ? 'text-ink' : 'text-ink/55'}`}>{s.label}</span>
            </div>
            <p className="mt-1 text-[11px] text-ink/45">{s.hint}</p>
          </div>
        );
      })}
    </div>
  );
}

/* ── La wallet de retiradas: elegir, probar por firma, o crear ─────────────── */
/**
 * Iteración 6 del ciclo productizer: la tarjeta decía «You can change it any
 * time» cuando la wallet se fija UNA vez; enseñaba códigos crudos; listaba cada
 * Xaman conectada como si valiera, y mandaba a «conectar» (que no prueba nada).
 * Ahora: copy honesto, describeRefusal, el VEREDICTO del servidor por wallet
 * (/wallet-proof: la de login, o una atada por firma) y la firma de propiedad
 * aquí mismo — la misma de «Enable transactions» en Wallets.
 */
export function WithdrawalWalletCard({ run, me, onSaved }: { run: DemoRun; me: DemoClient; onSaved: (run: DemoRun) => void }) {
  const { t } = useT();
  const allWallets = useWalletStore((s) => s.wallets);
  const { wallets: myWallets } = useMyWallets();
  // TODAS las wallets XRPL del cliente, no solo la de la sesión viva de ESTE
  // navegador (fundador 15-sep-2026). Xaman conecta una cuenta cada vez, así
  // que filtrar por `isConnected` escondía el resto de wallets enlazadas y el
  // selector parecía tener una sola opción. La prueba de propiedad sigue
  // exigiéndose igual: firmar en Xaman, que pide ESA cuenta.
  const xrplWallets = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ id: string; address: string; nickname?: string; walletType: string; live: boolean }> = [];
    for (const w of allWallets) {
      if (!w.isConnected || w.walletType !== 'xaman' || seen.has(w.address)) continue;
      seen.add(w.address);
      out.push({ id: w.id, address: w.address, nickname: w.nickname, walletType: w.walletType, live: true });
    }
    for (const w of myWallets) {
      if (!isXrplWallet(w) || (w.id ?? '').startsWith('legacy:') || seen.has(w.address)) continue;
      seen.add(w.address);
      // El nombre bonito lo pone `linkedOf` al pintar; aquí solo hace falta la
      // dirección y de dónde sale.
      out.push({ id: w.id ?? w.address, address: w.address, walletType: w.walletType ?? 'xaman', live: false });
    }
    return out;
  }, [allWallets, myWallets]);
  // El apodo del DUEÑO, no la etiqueta de sesión «Xaman 1 (…)» (2026-09-13).
  const linkedOf = useLinkedRecordOf();
  const [door, setDoor] = useState<'pick' | 'create' | null>(null);
  const [picked, setPicked] = useState(xrplWallets[0]?.id ?? '');
  const [busy, setBusy] = useState<'save' | 'bind' | null>(null);
  const [error, setError] = useState('');
  // The server's verdict per connected wallet (never inferred on the client).
  const [proofs, setProofs] = useState<Map<string, WalletProofRow> | null>(null);
  const [sessionWallet, setSessionWallet] = useState<string | null>(null);
  const [proofReadFailed, setProofReadFailed] = useState(false);
  const [proofNonce, setProofNonce] = useState(0);
  const addressesKey = xrplWallets.map((w) => w.address).join(',');

  useEffect(() => {
    if (!picked && xrplWallets[0]) setPicked(xrplWallets[0].id);
  }, [xrplWallets, picked]);

  useEffect(() => {
    if (me.xrplAddress || !addressesKey) {
      setProofs(null);
      return;
    }
    let alive = true;
    setProofReadFailed(false);
    demoApi
      .walletProof(addressesKey.split(','))
      .then((r) => {
        if (!alive) return;
        if (!r.ok) {
          setProofs(null);
          setProofReadFailed(true);
          return;
        }
        setSessionWallet(r.data.sessionWallet);
        setProofs(new Map(r.data.wallets.map((w) => [w.address, w])));
      })
      .catch(() => {
        if (alive) setProofReadFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [addressesKey, me.xrplAddress, proofNonce]);

  function proofLabel(address: string): string {
    if (!proofs) return proofReadFailed ? t('could not check if it is proven') : t('checking…');
    const row = proofs.get(address);
    if (!row || row.unreadable) return t('could not check if it is proven');
    if (row.proof === 'session') return t('proven · the wallet you signed in with');
    if (row.proof === 'binding') return t('proven · bound to your account by signature');
    return t('not proven yet · needs one ownership signature');
  }

  async function save(addr: string) {
    setError('');
    if (!XRPL_RE.test(addr)) return setError(t('The XRPL address is not valid'));
    setBusy('save');
    try {
      const r = await demoApi.patchClient(run.runId, me.id, { xrplAddress: addr });
      if (!r.ok) {
        setProofNonce((n) => n + 1);
        return setError(describeRefusal(r.refusal, t));
      }
      setDoor(null);
      onSaved(r.data.run);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  /** The Wallets «Enable transactions» proof for XRPL: an AccountSet signed in Xaman, never submitted. */
  async function proveThenSave(addr: string) {
    setError('');
    setBusy('bind');
    try {
      const { nonce, message } = await initiateBinding(addr, 'xrpl');
      const xaman = WalletServiceFactory.getWalletService('xaman') as XamanWalletService;
      const { signedTxHex } = await xaman.signOwnershipProof(addr, message);
      await confirmBinding({ nonce, message, signedTxHex, address: addr, chainType: 'xrpl', mode: 'read_and_receive' });
    } catch (e) {
      setBusy(null);
      setProofNonce((n) => n + 1);
      return setError(t('The ownership signature did not complete — nothing was changed. {reason}').replace('{reason}', e instanceof Error ? e.message : String(e)));
    }
    setBusy(null);
    setProofNonce((n) => n + 1);
    await save(addr);
  }

  const pickedWallet = xrplWallets.find((x) => x.id === picked);
  const pickedProof = pickedWallet ? proofs?.get(pickedWallet.address) : undefined;
  const pickedNeedsProof = Boolean(pickedProof && !pickedProof.proof && !pickedProof.unreadable);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <MicroLabel>{t('Your wallet for withdrawals')}</MicroLabel>
          <p className="mt-1 max-w-[60ch] text-[12.5px] leading-relaxed text-ink/55">
            {me.xrplAddress
              ? t('Withdrawals from the exchange go to this XRPL account of yours. It is set once: to change it, ask the exchange.')
              : t('Optional to operate; needed to withdraw to self-custody. It is set once, and it has to be proven yours: the wallet you signed in with, or a Xaman wallet you bind to your account with one ownership signature (nothing is sent to the ledger, no cost).')}
          </p>
          {!me.xrplAddress && proofs && !sessionWallet ? (
            <p className="mt-1 max-w-[60ch] text-[12px] leading-relaxed text-tone-warning">
              {t('You signed in with email or a passkey, so your sign-in proves no wallet: every Xaman wallet needs that one ownership signature before it can receive withdrawals.')}
            </p>
          ) : null}
        </div>
        {me.xrplAddress ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-tone-success/30 bg-tone-success/[0.06] px-2.5 py-1 font-mono text-[11px] text-tone-success">
            <Check className="h-3 w-3" strokeWidth={2.5} /> {shortAddr(me.xrplAddress)}
          </span>
        ) : null}
      </div>
      {me.xrplAddress ? null : (
      <div className="mt-3 flex flex-wrap gap-2">
        <GhostButton onClick={() => setDoor(door === 'pick' ? null : 'pick')} className={door === 'pick' ? 'border-volt/50 text-volt' : ''}><KeyRound className="mr-1.5 inline h-3.5 w-3.5" /> {t('Pick a connected wallet')}</GhostButton>
        <GhostButton onClick={() => setDoor(door === 'create' ? null : 'create')} className={door === 'create' ? 'border-volt/50 text-volt' : ''}><Smartphone className="mr-1.5 inline h-3.5 w-3.5" /> {t('Create one in Xaman')}</GhostButton>
        <Link href="/app/wallets?add=1" className="inline-flex items-center gap-1.5 rounded-lg border border-ink/10 px-3 py-1.5 text-[12px] text-ink/70 transition-colors hover:border-ink/25 hover:text-ink">
          <Plus className="h-3.5 w-3.5" /> {t('Connect Xaman in Wallets, then prove it here')}
        </Link>
      </div>
      )}
      {!me.xrplAddress && door === 'pick' ? (
        <div className="mt-3 space-y-2">
          {xrplWallets.length === 0 ? (
            <p className="text-[12px] text-tone-warning">{t('No Xaman wallet connected yet — connect it from Wallets first.')}</p>
          ) : (
            <>
              <div className="max-w-sm">
                <WalletSelect
                  options={xrplWallets.map((w) => {
                    const linked = linkedOf(w.address);
                    return {
                    key: w.id,
                    record: (linked ?? { address: w.address, walletType: w.walletType, ecosystem: 'xrpl' }) as WalletFaceRecord,
                    name: linked ? walletDisplayName(linked, t) : (w.nickname || 'Xaman'),
                    detail: `${shortAddr(w.address)} · ${proofLabel(w.address)}`,
                    badge: w.live ? undefined : t('not connected here'),
                  };
                  })}
                  value={picked}
                  onChange={setPicked}
                />
              </div>
              {pickedWallet && !pickedWallet.live ? (
                <p className="max-w-[60ch] text-[12px] text-ink/45">{t('Linked to your account, not connected in this browser — Xaman will ask for this account when you sign.')}</p>
              ) : null}
              {pickedNeedsProof ? (
                <>
                  <p className="max-w-[60ch] text-[12px] text-ink/55">{t('This wallet is connected but not proven yours. Sign once in Xaman (an ownership proof — never sent to the ledger), and it is saved as your withdrawal wallet.')}</p>
                  <PrimaryButton onClick={() => { if (pickedWallet) void proveThenSave(pickedWallet.address); }} disabled={busy !== null}>
                    {busy === 'bind' ? t('Waiting for your signature in Xaman…') : t('Prove it in Xaman and use it')}
                  </PrimaryButton>
                </>
              ) : (
                <PrimaryButton onClick={() => { if (pickedWallet) void save(pickedWallet.address); }} disabled={busy !== null || !pickedWallet}>
                  {t('Use this wallet for withdrawals')}
                </PrimaryButton>
              )}
              {proofReadFailed ? (
                <p className="text-[11px] text-tone-warning">
                  {t('Could not check which wallets are proven right now — the exchange still checks it when you save.')}{' '}
                  <button onClick={() => setProofNonce((n) => n + 1)} className="underline hover:text-ink">{t('Retry')}</button>
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
      {!me.xrplAddress && door === 'create' ? (
        <ol className="mt-3 space-y-2.5">
          {[
            { icon: Smartphone, body: t('Install Xaman (xaman.app) and create a new account — the keys are born on your phone.') },
            { icon: PenLine, body: t('Write the family seed on paper, offline. Whoever holds it holds the account.') },
            { icon: Wallet, body: t('Activate it with ~2 XRP (1 stays as reserve), connect it in Wallets, pick it above and prove it with one signature.') },
          ].map((s, i) => (
            <li key={i} className="flex items-start gap-3 text-[12px] leading-relaxed text-ink/55">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-ink/15 font-mono text-[10px] text-ink/45">{i + 1}</span>
              <s.icon className="mt-0.5 h-4 w-4 shrink-0 text-ink/35" strokeWidth={1.7} />
              <span>{s.body}</span>
            </li>
          ))}
          <li>
            <a href="https://xaman.app" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] text-volt hover:underline">{t('Get Xaman')} <ArrowUpRight className="h-3 w-3" /></a>
          </li>
        </ol>
      ) : null}
      {error ? <p className="mt-2 text-[11px] text-tone-warning">{error}</p> : null}
    </Card>
  );
}

/* ── La vista de un cliente en SU exchange ───────────────────────────────── */
function ClientRunView({ runId, account }: { runId: string; account: string }) {
  const { t } = useT();
  // Anclado a UN exchange: el hook ni lista ni deambula.
  const demo = useDemoRun({ fixedRunId: runId });
  const run = demo.run;
  // The SAME rule as ClientInner: my row is the one the server says is mine; an
  // unowned row with my passkey is only a claim prompt (ClientInner asks for the
  // code). A row owned by someone else — a passkey address is public — is never me.
  const { mine, claimable } = useMemo(() => {
    const byAccount = run?.clients.filter((c) => c.passkeyAccount?.toLowerCase() === account.toLowerCase()) ?? [];
    const own = byAccount.find((c) => c.mine);
    return { mine: own, claimable: own ? undefined : byAccount.find((c) => !c.owned) };
  }, [run, account]);
  const me = mine ?? claimable;

  if (demo.error) return <EmptyState variant="error" title={t('Your exchange could not be opened')} hint={demo.error} />;
  if (!run) return <EmptyState variant="loading" title={t('Opening your account…')} />;

  return (
    <RevealGroup className="space-y-4" stagger={0.06}>
      <RevealItem>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[15px] font-semibold tracking-tight text-ink">{run.label}</span>
          <span className="text-[12px] text-ink/45">
            {t('policy')} {run.policy} · {run.policy === 'B' ? t('72h cooldown exit') : t('immediate exit')}
          </span>
        </div>
      </RevealItem>
      <RevealItem><Journey run={run} chain={demo.chain} me={me} /></RevealItem>
      <RevealItem>
        {/* La lógica del cliente, tal cual; la casa alrededor (exchange-client, globals.css). */}
        <div className="exchange-client">
          <ClientInner demo={demo} account={account} />
        </div>
      </RevealItem>
      {/* Only on MY row: an unclaimed one takes no wallet until its code is entered above. */}
      {mine ? <RevealItem><WithdrawalWalletCard run={run} me={mine} onSaved={demo.setRun} /></RevealItem> : null}
    </RevealGroup>
  );
}

/* ── ¿De qué exchange soy cliente? Por identidad; si de ninguno, elegir ──── */
function ClientPortal({ account }: { account: string }) {
  const { t } = useT();
  const [state, setState] = useState<{ phase: 'resolving' } | { phase: 'found'; runId: string; exchange: RunSummary } | { phase: 'new'; exchanges: RunSummary[] } | { phase: 'error'; refusal: Refusal }>({ phase: 'resolving' });
  const [chosen, setChosen] = useState<string | null>(null);
  // it. 33 (7): «try again» has to actually try again (same as the product portal, it. 21).
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ phase: 'resolving' });
    void demoApi.forAccount(account).then((r) => {
      if (cancelled) return;
      if (!r.ok) return setState({ phase: 'error', refusal: r.refusal });
      if (r.data.found) setState({ phase: 'found', runId: r.data.runId, exchange: r.data.exchange });
      else setState({ phase: 'new', exchanges: r.data.exchanges });
    }).catch((e: unknown) => {
      if (cancelled) return;
      setState({ phase: 'error', refusal: networkRefusal(e) });
    });
    return () => { cancelled = true; };
  }, [account, attempt]);

  if (state.phase === 'resolving') return <EmptyState variant="loading" title={t('Finding your exchange…')} />;
  // it. 33 (7): this «classic» portal is sticky in localStorage, and it read the
  // 503 of `for-account` (RUN_UNREADABLE, OWNERSHIP_UNREADABLE…) as «could not be
  // found» with no button. Same phase component as the product portal.
  if (state.phase === 'error') return <PortalRefusal refusal={state.refusal} onRetry={() => setAttempt((n) => n + 1)} />;
  if (state.phase === 'found') return <ClientRunView runId={state.runId} account={account} />;
  if (chosen) return <ClientRunView runId={chosen} account={account} />;

  return (
    <RevealGroup className="space-y-4" stagger={0.06}>
      <RevealItem>
        <Card className="p-6">
          <MicroLabel>{t('Open an account')}</MicroLabel>
          <h2 className="mt-2 text-[18px] font-semibold tracking-tight text-ink">{t('Which exchange do you want an account with?')}</h2>
          <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-ink/55">
            {t('Your Face ID account is not a client of any exchange yet. Choose one: it assigns your deposit tag — your slot in its omnibus — and from then on this page is your account there.')}
          </p>
          {state.exchanges.length === 0 ? (
            <p className="mt-3 text-[12px] text-ink/50">{t('No exchange is open for new accounts right now.')}</p>
          ) : (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {state.exchanges.map((x) => (
                <button key={x.runId} type="button" onClick={() => setChosen(x.runId)} className="flex flex-col items-start rounded-xl border border-ink/10 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-volt/40 hover:bg-volt/[0.04]">
                  <span className="flex items-center gap-2 text-[14px] font-semibold text-ink"><Building2 className="h-4 w-4 text-volt/80" strokeWidth={1.7} /> {x.label}</span>
                  <span className="mt-1 text-[11.5px] text-ink/50">
                    {t('policy')} {x.policy} · {x.policy === 'B' ? t('72h cooldown exit') : t('immediate exit')} · {x.clients} {t('clients')}
                  </span>
                  <span className="mt-2 text-[12px] text-volt">{t('Open my account here')} →</span>
                </button>
              ))}
            </div>
          )}
        </Card>
      </RevealItem>
    </RevealGroup>
  );
}

export function ExchangeClientSite() {
  const { t } = useT();
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t('Exchange')}
        title={t('My exchange account')}
        subtitle={t('Your XRP at the exchange, working or not — and the way out, always yours. Face ID once creates the on-chain account where your shares live, in your name.')}
      />
      <RevealGroup className="space-y-5" stagger={0.06}>
        <RevealItem><Hero /></RevealItem>
        <RevealItem>
          <PasskeyGate>{(account) => <ClientPortal account={account} />}</PasskeyGate>
        </RevealItem>
      </RevealGroup>
      {/* El sitio del operador: escondido, pero a un clic — al pie, tenue. */}
      <p className="pt-2 text-[11px] text-ink/35">
        {t('Do you run an exchange?')}{' '}
        <Link href="/app/exchange/operator" className="underline underline-offset-2 transition-colors hover:text-ink">{t('Operator desk')} →</Link>
      </p>
    </div>
  );
}

export default ExchangeClientSite;
