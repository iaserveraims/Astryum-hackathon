/**
 * CageConsole — la jaula v2 de una cuenta XRPL, de punta a punta.
 *
 * Tres momentos, en una sola tarjeta, según lo que la cuenta ya tenga:
 *  1. Sin jaula → nace de UNA firma (0xFE desde su Personal Account). Sin
 *     génesis: la jaula no custodia. Por defecto sigue al registro de Astryum
 *     (la whitelist, que puede crecer); opcionalmente se auto-restringe a una
 *     lista propia que no cambia jamás — la pantalla lo dice antes de firmar.
 *  2. Con jaula → abre potes (una orden de consejo por pote; los primeros N
 *     solo cuestan el gas, después la fee sale de la PA directa a la
 *     tesorería), elige sus venues iniciales DENTRO de la whitelist y fija el
 *     tope por cuenta.
 *  3. Por pote → dirige y recupera capital (órdenes de consejo).
 *
 * Toda orden sigue el raíl del 23-ago: firmar en Xaman NO ejecuta — tras la
 * firma se dispara el relay con `order.orderData`, que paga la prueba FDC y
 * llama a `bridge.execute` contra la jaula. La tarjeta lo hace sola.
 *
 * Prepare-only: el backend compone, la wallet firma, la jaula acota.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Landmark, PlusCircle, Trash2 } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import {
  CouncilOrderInFlightConfirm,
  ReadFailureNotice,
  CouncilOrderServerWarnings,
  StaleOrderLockNote,
  XamanSignBlockedNote,
  XamanSingleSign,
  useStaleOrderLock,
} from '../xrpl/XamanSingleSign';
import { composeKindOf } from '../../lib/xrpl/singleSignVerdict';
import { useSettlement } from '../../lib/settlement/useSettlement';
import { startPending } from '../../lib/settlement/settlement';
import { notifyHandoffSigned } from '../../lib/wallet/handoffRelease';
import { isRetryableReadFailure, refusalHeadline, serverDetailIfEnglish } from '../../lib/xaman/seatRefusal';
import { DRY_RUN, dryRunCageCreate, dryRunExecuteOrder } from '../../lib/dryRun';
import {
  getCageOf,
  getPoteState,
  mayConfirmAnotherOrder,
  listRegistryVenues,
  prepareCageCreate,
  prepareCageOrder,
  relayCouncilOrder,
  sameOrderMinutesAgo,
  storedManagerVc,
  type CageBirthHandoff,
  type CageOrderAction,
  type CageOrderPrepared,
  type CageSummary,
  type CageTarget,
  type PoteState,
  type RegistryVenue,
} from '../../lib/institutional/api';

/** Todas las jaulas de esta factory trabajan en FXRP (6 decimales): el tope por cuenta se teclea en FXRP. */
const ASSET_DECIMALS = 6;
const ASSET_SYMBOL = 'FXRP';
const ZERO = '0x0000000000000000000000000000000000000000';
const EVM_RE = /^0x[0-9a-fA-F]{40}$/;

type CageRead = { kind: 'loading' } | { kind: 'none' } | { kind: 'unreadable'; cage: string } | { kind: 'ok'; cage: CageSummary };

/** Importe humano → unidades base, sin flotantes. */
function toBase(human: string, decimals: number): string | null {
  const m = /^(\d+)(?:\.(\d{0,18}))?$/.exec(human.trim());
  if (!m) return null;
  const frac = (m[2] ?? '').slice(0, decimals).padEnd(decimals, '0');
  const s = `${m[1]}${frac}`.replace(/^0+(?=\d)/, '');
  return s === '' ? '0' : s;
}

export function CageConsole({ account }: { account: string }) {
  const { t } = useT();
  const settlement = useSettlement();

  const [read, setRead] = useState<CageRead>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<{ error: string; detail?: string } | null>(null);
  const [notice, setNotice] = useState('');

  // 1. nacimiento
  const [amountXrp, setAmountXrp] = useState('2');
  // Por defecto la jaula sigue al registro de Astryum; solo si el gestor quiere
  // auto-restringirse escribe una lista propia, eterna.
  const [restrict, setRestrict] = useState(false);
  const [targets, setTargets] = useState<CageTarget[]>([{ chainId: 14, target: '' }]);
  const [birth, setBirth] = useState<CageBirthHandoff | null>(null);

  // La whitelist de Astryum: null = no se pudo leer (que no es «vacía»).
  const [registry, setRegistry] = useState<RegistryVenue[] | null>(null);

  // 2. potes
  const [poteName, setPoteName] = useState('');
  const [poteSymbol, setPoteSymbol] = useState('');
  const [cooldownSeconds, setCooldownSeconds] = useState('0');
  const [bufferFloorBps, setBufferFloorBps] = useState('1000');
  const [maxPayeeBps, setMaxPayeeBps] = useState('2000');
  const [maxDepositHuman, setMaxDepositHuman] = useState('');
  const [include, setInclude] = useState<Record<string, boolean>>({});
  const [order, setOrder] = useState<CageOrderPrepared | null>(null);
  // The order's signature already reached Xaman and is not confirmed as done:
  // dropping it here and preparing it again would sign the same order twice.
  const [orderBlocked, setOrderBlocked] = useState(false);
  // 409 COUNCIL_ORDER_IN_FLIGHT (it.13): the refused prepare, kept so an explicit
  // «compose another order anyway» re-sends exactly it — never a silent retry.
  const [inFlight, setInFlight] = useState<{ input: Parameters<typeof prepareCageOrder>[0]; detail?: string; code?: string; minutesAgo?: number | null; retryAfterSeconds?: number | null } | null>(null);
  /**
   * it.14 (R2 2.3): the order this console composed reached 'stale' and a
   * sibling of it may already be on its way to Flare. Every door that composes
   * an order here stays shut until the person says they checked — the sentence
   * inside the signing card never stopped this console from composing another.
   */
  const staleLock = useStaleOrderLock();

  // 3. dirección
  const [selectedPote, setSelectedPote] = useState('');
  const [poteState, setPoteState] = useState<PoteState | null>(null);
  const [venueId, setVenueId] = useState('0');
  // El techo por venue (bps) que el consejo puede reajustar por orden.
  const [maxVenueBps, setMaxVenueBps] = useState('');
  const [amountHuman, setAmountHuman] = useState('');
  const [capHuman, setCapHuman] = useState('');
  // 4. gobierno: director cedido (firma EVM sin peaje), venues nuevos, comisión
  const [directorAddr, setDirectorAddr] = useState('');
  const [directorDays, setDirectorDays] = useState('30');
  const [venueToPropose, setVenueToPropose] = useState('');
  const [payeeAddr, setPayeeAddr] = useState('');
  const [payeeBps, setPayeeBps] = useState('1000');
  const [gateAddr, setGateAddr] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await getCageOf(account);
      if (!r.cage) return setRead({ kind: 'none' });
      if ('unreadable' in r.cage) return setRead({ kind: 'unreadable', cage: r.cage.cage });
      setRead({ kind: 'ok', cage: r.cage });
      if (!selectedPote && r.cage.potes.length) setSelectedPote(r.cage.potes[0]);
    } catch {
      // «No pude leer» no es «no tienes jaula»: no se pinta como none.
      setRead((prev) => (prev.kind === 'ok' ? prev : { kind: 'unreadable', cage: '' }));
    }
  }, [account, selectedPote]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    listRegistryVenues()
      .then((r) => setRegistry(r.venues))
      .catch(() => setRegistry(null));
  }, []);

  /** Dónde puede nacer trabajando un pote de ESTA jaula: la whitelist activa en su
   *  chain, y si la jaula tiene lista propia, la intersección. Los kinds vienen
   *  del registro — el gestor no los teclea. */
  function candidateVenues(cage: CageSummary): RegistryVenue[] {
    if (!registry) return [];
    const own = new Set(cage.allowedTargets.filter((x) => x.chainId === cage.chainId).map((x) => x.target.toLowerCase()));
    return registry.filter(
      (v) => v.status === 'active' && v.chainId === cage.chainId && v.kind !== 'unknown' && (cage.registryOnly || own.has(v.target.toLowerCase())),
    );
  }

  useEffect(() => {
    if (!selectedPote) return setPoteState(null);
    getPoteState(selectedPote)
      .then(setPoteState)
      .catch(() => setPoteState(null));
  }, [selectedPote]);

  // ── 1. nacimiento ────────────────────────────────────────────────────────

  async function prepareBirth() {
    setBusy(true);
    setRefusal(null);
    const clean = restrict ? targets.filter((x) => x.target.trim()) : [];
    const res = await prepareCageCreate({ account, amountXrp, allowedTargets: clean, managerCredentialJwt: storedManagerVc() });
    setBusy(false);
    if (!res.ok) return setRefusal(res.refusal);
    setBirth(res.data);
  }

  function onBirthSettled(hash: string) {
    if (!birth) return;
    // El asiento de nonce queda intocable hasta ejecutar (incidente del gemelo, 21-ago).
    notifyHandoffSigned(birth.memoHex, hash);
    settlement.track(startPending('xrpl-mint', hash));
    setBirth(null);
    setNotice(t('Signed. The network is proving it; your cage will appear here on its own in a couple of minutes.'));
    setTimeout(() => void load(), 90_000);
  }

  // ── 2 y 3. órdenes ───────────────────────────────────────────────────────

  /** Every council order of this console is composed here (in-flight 409 included). */
  async function composeOrder(input: Parameters<typeof prepareCageOrder>[0]) {
    // Paused after a stale order that may already have gone out (it.14) — EXCEPT
    // an exit: a recall and an evacuate take capital OUT, and an exit is warned,
    // never stopped (it.16, R3 3.1). And `confirmAnotherOrder` is the person's
    // own «compose it again anyway», which used to hit this return and do
    // nothing at all (it.16, R5 5.5 / R2 2.3).
    if (staleLock.blocks(composeKindOf(input.action), { confirmed: input.confirmAnotherOrder === true })) return;
    setBusy(true);
    setRefusal(null);
    setInFlight(null);
    const res = await prepareCageOrder(input);
    setBusy(false);
    if (!res.ok) {
      // it. 21 (§2.7): «the same order went out» and «we could not check whether
      // it did» both land here — with opposite sentences and, for the second, a
      // retry as well as the confirm (CouncilOrderInFlightConfirm tells them apart).
      if (mayConfirmAnotherOrder(res.refusal) && !input.confirmAnotherOrder) {
        return setInFlight({
          input,
          detail: res.refusal.detail,
          code: res.refusal.error,
          minutesAgo: sameOrderMinutesAgo(res.refusal),
          retryAfterSeconds: res.refusal.retryAfterSeconds ?? null,
        });
      }
      return setRefusal(res.refusal);
    }
    setOrder(res.data);
  }

  async function preparePote(cage: CageSummary) {
    setBusy(true);
    setRefusal(null);
    const initialVenues = candidateVenues(cage)
      .filter((v) => include[v.target.toLowerCase()])
      .map((v) => ({ target: v.target, kind: v.kind }));
    const maxDepositPerUser = toBase(maxDepositHuman.trim() || '0', ASSET_DECIMALS);
    if (maxDepositPerUser === null) {
      setBusy(false);
      return setRefusal({ error: 'BAD_CAP', detail: t('The per-account cap must be a number (0 = no cap).') });
    }
    await composeOrder({
      council: account,
      action: 'create-pote',
      managerCredentialJwt: storedManagerVc(),
      params: {
        name: poteName,
        symbol: poteSymbol,
        cooldownSeconds: Number(cooldownSeconds),
        bufferFloorBps: Number(bufferFloorBps),
        maxPayeeBps: Number(maxPayeeBps),
        maxDepositPerUser,
        initialVenues,
      },
    });
  }

  /** Toda orden de consejo pasa por aquí: el backend compone, la cuenta firma, la consola relaya. */
  async function sendOrder(action: CageOrderAction, params: Record<string, unknown>) {
    // Adjunta la VC off-ledger del gestor (si la tiene guardada): la puerta del
    // título la acepta como alternativa a la XLS-70 on-ledger.
    await composeOrder({ council: account, action, params, managerCredentialJwt: storedManagerVc() });
  }

  async function prepareCap() {
    if (!poteState) return;
    const cap = toBase(capHuman.trim() || '0', poteState.asset.decimals);
    if (cap === null) return setRefusal({ error: 'BAD_CAP', detail: t('The per-account cap must be a number (0 = no cap).') });
    await sendOrder('set-max-deposit', { pote: selectedPote, cap });
  }

  /** El ensayo: la MISMA factory.create, impersonando la PA del consejo en el fork. */
  async function dryBirth() {
    setBusy(true);
    setRefusal(null);
    const res = await dryRunCageCreate(account);
    setBusy(false);
    if (!res.ok) return setRefusal({ error: res.error, detail: res.detail });
    setNotice(`${t('Dry run: your cage was born on the fork.')} ${res.data.cage}`);
    void load();
  }

  /** El ensayo: la MISMA calldata de la orden, ejecutada como la ejecutaría el bridge. */
  async function dryOrder() {
    if (!order) return;
    setBusy(true);
    const { orderData } = order.order;
    const res = await dryRunExecuteOrder(account, orderData);
    setBusy(false);
    setOrder(null);
    if (!res.ok) return setRefusal({ error: res.error, detail: res.detail });
    setNotice(t('Dry run: the order executed on the fork — same calldata, impersonated bridge, no FDC round.'));
    void load();
    if (selectedPote) getPoteState(selectedPote).then(setPoteState).catch(() => undefined);
  }

  async function prepareCede() {
    const director = directorAddr.trim();
    const days = Number(directorDays);
    if (!EVM_RE.test(director)) return setRefusal({ error: 'BAD_DIRECTOR', detail: t('The director must be an EVM address (0x…).') });
    if (!Number.isInteger(days) || days < 1 || days > 365) return setRefusal({ error: 'BAD_DAYS', detail: t('Days must be a whole number between 1 and 365.') });
    await sendOrder('cede', { director, untilISO: new Date(Date.now() + days * 86_400_000).toISOString() });
  }

  async function prepareProposeVenue(cage: CageSummary) {
    const v = candidateVenues(cage).find((x) => x.target.toLowerCase() === venueToPropose.toLowerCase());
    if (!v) return setRefusal({ error: 'BAD_VENUE', detail: t('Pick a venue from the registry.') });
    await sendOrder('propose-venue', { pote: selectedPote, target: v.target, kind: v.kind });
  }

  async function preparePayees(cage: CageSummary) {
    const addr = payeeAddr.trim();
    if (!addr) return sendOrder('set-payees', { pote: selectedPote, payees: [] });
    const bps = Number(payeeBps);
    if (!EVM_RE.test(addr)) return setRefusal({ error: 'BAD_PAYEE', detail: t('The payee must be an EVM address (0x…).') });
    if (!Number.isInteger(bps) || bps < 1 || bps > cage.maxPayeeBpsAllowed) {
      return setRefusal({ error: 'BAD_BPS', detail: `${t('The cut must be between 1 and')} ${cage.maxPayeeBpsAllowed} bps.` });
    }
    await sendOrder('set-payees', { pote: selectedPote, payees: [{ account: addr, bps }] });
  }

  async function prepareMove(action: 'direct-to' | 'recall') {
    if (!poteState) return;
    const amount = toBase(amountHuman, poteState.asset.decimals);
    if (!amount || amount === '0') return setRefusal({ error: 'BAD_AMOUNT', detail: t('Enter a positive amount.') });
    await composeOrder({
      council: account,
      action,
      params: { pote: selectedPote, venueId: Number(venueId), amount },
    });
  }

  function onOrderSettled(hash: string) {
    if (!order) return;
    const { orderData } = order.order;
    setOrder(null);
    // Firmar ≠ ejecutar: el relay paga la prueba y llama a bridge.execute.
    setNotice(t('Signed. Relaying the proof to Flare…'));
    void relayCouncilOrder(hash, orderData).then(
      (r: unknown) => {
        const d = r as { detail?: string; stage?: string };
        setNotice(t('Relayed. The cage will execute the order once the proof lands.') + (d?.detail ? ` — ${d.detail}` : ''));
        setTimeout(() => void load(), 30_000);
      },
      (e: unknown) => setNotice(t('Signed, but the relay did not start') + ` — ${e instanceof Error ? e.message : String(e)}`),
    );
  }

  // ── render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <header className="flex items-center gap-2">
        <Landmark size={16} className="text-ink/60" />
        <h3 className="text-sm font-medium">{t('Your cage')}</h3>
        <span className="ml-auto truncate font-mono text-[11px] text-ink/40">{account}</span>
      </header>

      {notice ? <p className="rounded-lg border border-white/10 bg-white/[0.02] p-2.5 text-[11px] leading-relaxed text-ink/60">{notice}</p> : null}
      {refusal ? (
        // it. 21 (§3.5): «a read of ours failed» (ACCOUNT_BUSY,
        // PROOF_STORE_UNREADABLE, an unreadable seat or inbox) is a WAIT, not a
        // verdict — its own block, with the retry the server promised and that
        // nobody could press.
        isRetryableReadFailure(refusal) ? (
          <ReadFailureNotice refusal={refusal} busy={busy} onRetry={() => void load()} />
        ) : (
        // it. 19: `refusal.error` is sometimes a sentence this screen wrote and
        // sometimes the server's raw slug — it printed whichever arrived. A slug
        // becomes the one honest generic sentence, and the Spanish `detail` of a
        // server refusal is dropped instead of set under an English headline.
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2.5" role="alert">
          <p className="text-[12px] font-medium text-tone-warning">{refusalHeadline(refusal, t)}</p>
          {serverDetailIfEnglish(refusal.detail) ? (
            <p className="text-[11px] leading-relaxed text-ink/55">{serverDetailIfEnglish(refusal.detail)}</p>
          ) : null}
        </div>
        )
      ) : null}
      {inFlight && !order ? (
        <CouncilOrderInFlightConfirm
          detail={inFlight.detail}
          code={inFlight.code}
          minutesAgo={inFlight.minutesAgo}
          retryAfterSeconds={inFlight.retryAfterSeconds}
          busy={busy}
          onConfirm={() => void composeOrder({ ...inFlight.input, confirmAnotherOrder: true })}
          onRetry={() => void composeOrder(inFlight.input)}
          onDismiss={() => setInFlight(null)}
        />
      ) : null}

      <StaleOrderLockNote lock={staleLock.lock} onRelease={staleLock.release} pausing={staleLock.pausing} />

      {read.kind === 'loading' ? <Loader2 size={14} className="animate-spin text-ink/40" /> : null}

      {read.kind === 'unreadable' ? (
        <p className="text-[11px] leading-relaxed text-ink/55">
          {t('Could not read the cage right now. This says nothing about whether it exists — try again in a moment.')}
        </p>
      ) : null}

      {/* 1. SIN JAULA: nace de una firma */}
      {read.kind === 'none' && !birth ? (
        <div className="space-y-3">
          <p className="text-[12px] leading-relaxed text-ink/55">
            {t('This account has no cage yet. One signature births it: a command contract that obeys only this account and never holds capital. Its potes can only work in destinations on the Astryum registry — the no-liquidation whitelist, which can grow.')}
          </p>
          <label className="block text-[11px] text-ink/50">
            {t('Carrier (XRP) — what it mints stays in your Flare account to pay pote creation fees')}
            <input value={amountXrp} onChange={(e) => setAmountXrp(e.target.value)} className="mt-1 w-full rounded-md bg-white/5 px-2 py-1.5 font-mono text-[12px]" />
          </label>
          <div className="space-y-1.5">
            <label className="flex items-start gap-2 text-[11px] text-ink/60">
              <input type="radio" checked={!restrict} onChange={() => setRestrict(false)} className="mt-0.5" />
              <span>{t('Follow the Astryum registry as it stands each day (a venue approved tomorrow becomes available; one removed stops at once).')}</span>
            </label>
            <label className="flex items-start gap-2 text-[11px] text-ink/60">
              <input type="radio" checked={restrict} onChange={() => setRestrict(true)} className="mt-0.5" />
              <span>{t('Restrict this cage to its own eternal list — a subset of the registry, written once, never widened.')}</span>
            </label>
          </div>
          {restrict ? (
          <div className="space-y-1.5">
            <p className="text-[11px] text-ink/50">{t('Eternal destination list (each one must already be approved by the Astryum registry)')}</p>
            {targets.map((row, i) => (
              <div key={i} className="flex gap-1.5">
                <input
                  value={row.chainId}
                  onChange={(e) => setTargets(targets.map((x, j) => (j === i ? { ...x, chainId: Number(e.target.value) || 0 } : x)))}
                  className="w-16 rounded-md bg-white/5 px-2 py-1.5 font-mono text-[12px]"
                  aria-label="chainId"
                />
                <input
                  value={row.target}
                  placeholder="0x…"
                  onChange={(e) => setTargets(targets.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)))}
                  className="flex-1 rounded-md bg-white/5 px-2 py-1.5 font-mono text-[12px]"
                  aria-label="target"
                />
                <button type="button" onClick={() => setTargets(targets.filter((_, j) => j !== i))} className="text-ink/40" aria-label={t('Remove')}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => setTargets([...targets, { chainId: 14, target: '' }])} className="inline-flex items-center gap-1 text-[11px] text-ink/60">
              <PlusCircle size={13} /> {t('Add destination')}
            </button>
          </div>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => void prepareBirth()} disabled={busy} className="rounded-lg bg-white/10 px-3 py-2 text-[13px] font-medium disabled:opacity-40">
              {busy ? <Loader2 size={14} className="animate-spin" /> : t('Prepare the birth')}
            </button>
            {DRY_RUN ? (
              <button type="button" onClick={() => void dryBirth()} disabled={busy} className="rounded-lg border border-amber-500/40 bg-amber-500/[0.08] px-3 py-2 text-[13px] font-medium text-tone-warning disabled:opacity-40">
                {t('Birth it dry (fork, no signature)')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {birth ? (
        <div className="space-y-3">
          <ul className="space-y-1">
            {birth.disclosure.lines.map((l, i) => (
              <li key={i} className="text-[11px] leading-relaxed text-ink/50">{l}</li>
            ))}
          </ul>
          {/* No parent Cancel here; cancelled in Xaman → the birth is dropped
              and «Prepare the birth» comes back (nothing was signed). */}
          {/* onSigned (it.13): the hash reaches /handoff/signed the moment Xaman signs,
              not only after validation — the backend remembers it (202 PENDING_LEDGER). */}
          <XamanSingleSign
            txjson={birth.xrplPayment}
            title={t('Birth of the cage')}
            onSigned={(hash) => notifyHandoffSigned(birth.memoHex, hash)}
            onSettled={onBirthSettled}
            onCancelled={() => setBirth(null)}
          />
        </div>
      ) : null}

      {/* 2. CON JAULA: lo que es, y abrir potes */}
      {read.kind === 'ok' ? (
        <div className="space-y-4">
          <dl className="space-y-1 text-[11px]">
            <div className="flex justify-between gap-3"><dt className="text-ink/45">{t('Cage')}</dt><dd className="truncate font-mono text-ink/70">{read.cage.cage}</dd></div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink/45">{t('Destinations')}</dt>
              <dd className="text-ink/70">{read.cage.registryOnly ? t('follows the Astryum registry') : `${read.cage.allowedTargets.length} ${t('eternal')}`}</dd>
            </div>
            <div className="flex justify-between gap-3"><dt className="text-ink/45">{t('Potes')}</dt><dd className="text-ink/70">{read.cage.potes.length}</dd></div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink/45">{t('Potes without creation fee left')}</dt>
              <dd className="text-ink/70">{read.cage.freePotesLeft} / {read.cage.freePotes}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink/45">{t('Director')}</dt>
              <dd className="truncate font-mono text-ink/70">
                {read.cage.director && read.cage.director !== ZERO && read.cage.directorUntil * 1000 > Date.now()
                  ? `${read.cage.director.slice(0, 6)}…${read.cage.director.slice(-4)} · ${t('until')} ${new Date(read.cage.directorUntil * 1000).toLocaleDateString()}`
                  : t('nobody — this account runs it by order')}
              </dd>
            </div>
            {read.cage.succeeded ? <div className="text-tone-warning">{t('This cage handed over to its successor and commands nothing more.')}</div> : null}
          </dl>

          {/* `fieldset` and not a pile of `disabled` props: while an order of
              this council may already be on its way (a stale whose sibling went
              out), NOTHING in this block composes another one. */}
          {!order ? (
            <fieldset disabled={staleLock.blocks('other')} className="min-w-0 space-y-2 rounded-lg border border-white/10 p-3">
              <p className="text-[12px] font-medium">{t('Open a pote')}</p>
              <div className="grid grid-cols-2 gap-1.5">
                <input value={poteName} onChange={(e) => setPoteName(e.target.value)} placeholder={t('Name')} className="rounded-md bg-white/5 px-2 py-1.5 text-[12px]" />
                <input value={poteSymbol} onChange={(e) => setPoteSymbol(e.target.value)} placeholder={t('Symbol')} className="rounded-md bg-white/5 px-2 py-1.5 font-mono text-[12px]" />
                <label className="text-[10px] text-ink/45">{t('Cooldown (s)')}<input value={cooldownSeconds} onChange={(e) => setCooldownSeconds(e.target.value)} className="mt-0.5 w-full rounded-md bg-white/5 px-2 py-1 font-mono text-[12px]" /></label>
                <label className="text-[10px] text-ink/45">{t('Buffer floor (bps)')}<input value={bufferFloorBps} onChange={(e) => setBufferFloorBps(e.target.value)} className="mt-0.5 w-full rounded-md bg-white/5 px-2 py-1 font-mono text-[12px]" /></label>
                <label className="text-[10px] text-ink/45">{t('Payees cap (bps, ≤ 2000 for an open pote)')}<input value={maxPayeeBps} onChange={(e) => setMaxPayeeBps(e.target.value)} className="mt-0.5 w-full rounded-md bg-white/5 px-2 py-1 font-mono text-[12px]" /></label>
                <label className="text-[10px] text-ink/45">{t('Max per account')} ({ASSET_SYMBOL}, {t('0 = no cap')})<input value={maxDepositHuman} onChange={(e) => setMaxDepositHuman(e.target.value)} placeholder="0" className="mt-0.5 w-full rounded-md bg-white/5 px-2 py-1 font-mono text-[12px]" /></label>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] text-ink/45">{t('Initial venues — from the Astryum registry (no-liquidation whitelist); more can be proposed later with a 30-day wait')}</p>
                {registry === null ? (
                  <p className="text-[11px] text-ink/50">{t('Could not read the registry right now — you can still open the pote without venues and propose them later.')}</p>
                ) : candidateVenues(read.cage).length === 0 ? (
                  <p className="text-[11px] text-ink/50">{t('No active venue on this chain yet.')}</p>
                ) : (
                  candidateVenues(read.cage).map((v) => (
                    <label key={v.target} className="flex items-center gap-2 text-[11px]">
                      <input type="checkbox" checked={Boolean(include[v.target.toLowerCase()])} onChange={(e) => setInclude({ ...include, [v.target.toLowerCase()]: e.target.checked })} />
                      <span className="truncate font-mono text-ink/60">{v.target}</span>
                      <span className="ml-auto text-ink/45">{v.kind === 'compoundv2' ? 'Compound v2' : v.kind === 'erc4626queued' ? 'ERC-4626 queued' : 'ERC-4626'}</span>
                    </label>
                  ))
                )}
              </div>
              {/* El guardarraíl cooldown ≥ cola, dicho ANTES de firmar: el raíl lo
                  rechaza igual, pero verlo aquí evita la ronda perdida. */}
              {(() => {
                const queuedSelected = candidateVenues(read.cage).some(
                  (v) => include[v.target.toLowerCase()] && v.kind === 'erc4626queued'
                );
                return queuedSelected && Number(cooldownSeconds) < 72 * 3600 ? (
                  <p className="text-[10px] leading-relaxed text-tone-warning">
                    {t(
                      'A queued venue (Firelight) needs a cooldown of at least 72h (259200s): with less, a redeem ticket matures before the withdrawal queue drains and the claim reverts. Raise the cooldown or unselect the queued venue.'
                    )}
                  </p>
                ) : null;
              })()}
              <p className="text-[10px] text-ink/45">
                {read.cage.freePotesLeft > 0
                  ? t('This pote costs only gas.')
                  : t('The free potes are used up: this one pays the creation fee from your Flare account, straight to the Astryum treasury.')}
              </p>
              <button type="button" onClick={() => void preparePote(read.cage)} disabled={busy || !poteName || !poteSymbol} className="rounded-lg bg-white/10 px-3 py-2 text-[13px] font-medium disabled:opacity-40">
                {t('Prepare the order')}
              </button>
            </fieldset>
          ) : null}

          {/* 2-bis. EL DIRECTOR: una llave EVM que dirige y recupera con MetaMask,
              sin peaje FDC por orden, dentro de lo que la jaula permite. Caduca sola. */}
          {!order ? (
            <fieldset disabled={staleLock.blocks('other')} className="min-w-0 space-y-2 rounded-lg border border-white/10 p-3">
              <p className="text-[12px] font-medium">{t('Name a director')}</p>
              <p className="text-[10px] text-ink/45">
                {t('An EVM address that may direct and recall capital between the venues that already exist — with MetaMask, no toll per order. It cannot add venues, change the cut or open potes. It expires by itself.')}
              </p>
              <div className="flex gap-1.5">
                <input value={directorAddr} onChange={(e) => setDirectorAddr(e.target.value)} placeholder="0x…" className="flex-1 rounded-md bg-white/5 px-2 py-1.5 font-mono text-[12px]" />
                <input value={directorDays} onChange={(e) => setDirectorDays(e.target.value)} className="w-16 rounded-md bg-white/5 px-2 py-1.5 font-mono text-[12px]" aria-label={t('Days')} />
              </div>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => void prepareCede()} disabled={busy || !directorAddr} className="rounded-lg bg-white/10 px-3 py-1.5 text-[12px] font-medium disabled:opacity-40">{t('Name director')}</button>
                {read.cage.director && read.cage.director !== ZERO ? (
                  <button type="button" onClick={() => void sendOrder('end-cession', {})} disabled={busy} className="rounded-lg bg-white/10 px-3 py-1.5 text-[12px] font-medium disabled:opacity-40">{t('End cession')}</button>
                ) : null}
              </div>
            </fieldset>
          ) : null}

          {/* 3. POR POTE: dirigir y recuperar.
              it.16 (R3 3.1): este bloque tiene SALIDAS (Recall, Evacuate) y
              no-salidas, así que ya no puede deshabilitarse entero — un
              `fieldset disabled` apaga todo lo de dentro, salidas incluidas, que
              es justo la regresión. Cada puerta NO-salida dice ahora que está en
              pausa; las dos salidas no lo están nunca. */}
          {read.cage.potes.length && !order ? (
            <fieldset className="min-w-0 space-y-2 rounded-lg border border-white/10 p-3">
              <p className="text-[12px] font-medium">{t('Direct capital')}</p>
              <select value={selectedPote} onChange={(e) => setSelectedPote(e.target.value)} className="w-full rounded-md bg-white/5 px-2 py-1.5 font-mono text-[12px]">
                {read.cage.potes.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              {poteState ? (
                <>
                  <p className="text-[11px] text-ink/50">
                    {poteState.name} · {t('free buffer')} {poteState.freeBalance} {poteState.asset.symbol} ({t('base units')})
                  </p>
                  <div className="flex gap-1.5">
                    <select value={venueId} onChange={(e) => setVenueId(e.target.value)} className="rounded-md bg-white/5 px-2 py-1.5 text-[12px]">
                      {poteState.venues.map((v) => <option key={v.id} value={v.id}>#{v.id} · {v.kind}{v.readyAt > Date.now() / 1000 ? ` · ${t('not ready yet')}` : ''}</option>)}
                    </select>
                    <input value={amountHuman} onChange={(e) => setAmountHuman(e.target.value)} placeholder={`0.0 ${poteState.asset.symbol}`} className="flex-1 rounded-md bg-white/5 px-2 py-1.5 font-mono text-[12px]" />
                  </div>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => void prepareMove('direct-to')} disabled={busy || staleLock.blocks('other')} className="rounded-lg bg-white/10 px-3 py-1.5 text-[12px] font-medium disabled:opacity-40">{t('Direct')}</button>
                    <button type="button" onClick={() => void prepareMove('recall')} disabled={busy} className="rounded-lg bg-white/10 px-3 py-1.5 text-[12px] font-medium disabled:opacity-40">{t('Recall')}</button>
                  </div>

                  {/* El gobierno del catálogo, del contrato a un clic (6-sep —
                      lo que faltaba para «hacer todo lo del smart contract»):
                      retirar (mecha de 30 días, solo bloquea capital NUEVO),
                      evacuar (TODO el capital del venue vuelve al colchón, en
                      el acto) y el techo por venue. Mismo raíl: orden de
                      consejo firmada en Xaman + FDC + relay. */}
                  <div className="flex flex-wrap items-center gap-1.5 border-t border-white/10 pt-2">
                    <button type="button" onClick={() => void sendOrder('retire-venue', { pote: selectedPote, venueId: Number(venueId) })} disabled={busy || staleLock.blocks('other')} className="rounded-lg bg-white/10 px-3 py-1.5 text-[12px] font-medium disabled:opacity-40">{t('Retire venue (30-day fuse)')}</button>
                    <button type="button" onClick={() => void sendOrder('evacuate', { pote: selectedPote, venueId: Number(venueId) })} disabled={busy} className="rounded-lg bg-white/10 px-3 py-1.5 text-[12px] font-medium disabled:opacity-40">{t('Evacuate venue now')}</button>
                    <input value={maxVenueBps} onChange={(e) => setMaxVenueBps(e.target.value)} placeholder="2500" inputMode="numeric" className="w-20 rounded-md bg-white/5 px-2 py-1.5 font-mono text-[12px]" />
                    <button
                      type="button"
                      onClick={() => {
                        const b = Number(maxVenueBps);
                        if (!Number.isInteger(b) || b < 0 || b > 10000) return setRefusal({ error: 'BAD_BPS', detail: t('Basis points must be 0–10000.') });
                        void sendOrder('set-max-venue-bps', { pote: selectedPote, bps: b });
                      }}
                      disabled={busy || staleLock.blocks('other')}
                      className="rounded-lg bg-white/10 px-3 py-1.5 text-[12px] font-medium disabled:opacity-40"
                    >
                      {t('Max per venue (bps)')}
                    </button>
                  </div>
                  {poteState.maxDepositPerUser !== null && poteState.maxDepositPerUser !== undefined ? (
                    <div className="space-y-1 border-t border-white/10 pt-2">
                      <p className="text-[11px] text-ink/50">
                        {t('Max per account')}:{' '}
                        {poteState.maxDepositPerUser === '0'
                          ? t('no cap')
                          : `${(Number(poteState.maxDepositPerUser) / 10 ** poteState.asset.decimals).toLocaleString()} ${poteState.asset.symbol}`}
                        {' — '}
                        {t('entries only; exits are never blocked')}
                      </p>
                      <div className="flex gap-1.5">
                        <input value={capHuman} onChange={(e) => setCapHuman(e.target.value)} placeholder={`0 ${poteState.asset.symbol} = ${t('no cap')}`} className="flex-1 rounded-md bg-white/5 px-2 py-1.5 font-mono text-[12px]" />
                        <button type="button" onClick={() => void prepareCap()} disabled={busy || staleLock.blocks('other')} className="rounded-lg bg-white/10 px-3 py-1.5 text-[12px] font-medium disabled:opacity-40">{t('Set cap')}</button>
                      </div>
                    </div>
                  ) : null}

                  {/* Un venue nuevo: solo de la whitelist, y 30 días de mecha en el pote. */}
                  {(() => {
                    const have = new Set(poteState.venues.map((v) => v.target.toLowerCase()));
                    const options = candidateVenues(read.cage).filter((v) => !have.has(v.target.toLowerCase()));
                    return (
                      <div className="space-y-1 border-t border-white/10 pt-2">
                        <p className="text-[11px] text-ink/50">{t('Propose a venue (from the Astryum registry; 30-day wait before it can receive capital)')}</p>
                        {options.length === 0 ? (
                          <p className="text-[11px] text-ink/40">{t('Every active venue of the registry is already in this pote.')}</p>
                        ) : (
                          <div className="flex gap-1.5">
                            <select value={venueToPropose} onChange={(e) => setVenueToPropose(e.target.value)} className="flex-1 rounded-md bg-white/5 px-2 py-1.5 font-mono text-[12px]">
                              <option value="">{t('Pick a venue')}</option>
                              {options.map((v) => <option key={v.target} value={v.target}>{v.target} · {v.kind}</option>)}
                            </select>
                            <button type="button" onClick={() => void prepareProposeVenue(read.cage)} disabled={busy || !venueToPropose || staleLock.blocks('other')} className="rounded-lg bg-white/10 px-3 py-1.5 text-[12px] font-medium disabled:opacity-40">{t('Propose')}</button>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* La comisión del gestor: pública, con tope de nacimiento, y solo sobre el yield. */}
                  <div className="space-y-1 border-t border-white/10 pt-2">
                    <p className="text-[11px] text-ink/50">
                      {t('Your cut of the yield')} — {t('today')}:{' '}
                      {poteState.governance.payees.length === 0
                        ? t('none (everything capitalizes for depositors)')
                        : poteState.governance.payees.map((p) => `${p.account.slice(0, 6)}…${p.account.slice(-4)} ${p.bps / 100}%`).join(', ')}
                    </p>
                    <div className="flex gap-1.5">
                      <input value={payeeAddr} onChange={(e) => setPayeeAddr(e.target.value)} placeholder={`0x… (${t('empty = no cut')})`} className="flex-1 rounded-md bg-white/5 px-2 py-1.5 font-mono text-[12px]" />
                      <input value={payeeBps} onChange={(e) => setPayeeBps(e.target.value)} className="w-20 rounded-md bg-white/5 px-2 py-1.5 font-mono text-[12px]" aria-label="bps" />
                      <button type="button" onClick={() => void preparePayees(read.cage)} disabled={busy || staleLock.blocks('other')} className="rounded-lg bg-white/10 px-3 py-1.5 text-[12px] font-medium disabled:opacity-40">{t('Set cut')}</button>
                    </div>
                    <p className="text-[10px] text-ink/40">{t('In bps of the yield only, never of the principal; the cap of this generation is')} {read.cage.maxPayeeBpsAllowed} bps.</p>
                  </div>

                  {/* La puerta de entrada (KYC del partner): quién puede RECIBIR participaciones. */}
                  <div className="space-y-1 border-t border-white/10 pt-2">
                    <p className="text-[11px] text-ink/50">
                      {t('Entry gate (the partner’s KYC registry): only approved receivers may enter. Exits are never gated.')}
                    </p>
                    <div className="flex gap-1.5">
                      <input value={gateAddr} onChange={(e) => setGateAddr(e.target.value.trim())} placeholder={`0x… (ExchangeKycRegistry)`} className="flex-1 rounded-md bg-white/5 px-2 py-1.5 font-mono text-[12px]" />
                      <button type="button" onClick={() => void sendOrder('set-user-gate', { pote: selectedPote, gate: gateAddr })} disabled={busy || !gateAddr || staleLock.blocks('other')} className="rounded-lg bg-white/10 px-3 py-1.5 text-[12px] font-medium disabled:opacity-40">{t('Point gate')}</button>
                      <button type="button" onClick={() => void sendOrder('set-user-gate', { pote: selectedPote })} disabled={busy || staleLock.blocks('other')} className="rounded-lg bg-white/10 px-3 py-1.5 text-[12px] font-medium disabled:opacity-40">{t('Open to everyone')}</button>
                    </div>
                  </div>
                </>
              ) : null}
            </fieldset>
          ) : null}

          {order ? (
            <div className="space-y-3">
              <p className="text-[12px]">{order.order.summary}</p>
              {order.disclosure.note ? <p className="text-[11px] leading-relaxed text-ink/50">{order.disclosure.note}</p> : null}
              <CouncilOrderServerWarnings
                recoveryWarning={order.recoveryWarning}
                inFlightWarning={order.inFlightWarning}
                duplicateWarning={order.duplicateWarning}
              />
              {DRY_RUN ? (
                <button type="button" onClick={() => void dryOrder()} disabled={busy || orderBlocked} className="rounded-lg border border-amber-500/40 bg-amber-500/[0.08] px-3 py-2 text-[13px] font-medium text-tone-warning disabled:opacity-40">
                  {busy ? <Loader2 size={14} className="animate-spin" /> : t('Run it dry (fork, no signature)')}
                </button>
              ) : null}
              <XamanSingleSign
                txjson={order.xrplTx}
                title={order.order.summary}
                onSettled={onOrderSettled}
                onBlockedChange={setOrderBlocked}
                onCancelled={() => setOrder(null)}
                // it.14: if this order goes stale and a sibling already went out,
                // this console stops composing until the person confirms.
                onStaleFate={staleLock.report}
              />
              {/* Cancel drops the order, and a dropped order is prepared and
                  signed again. From the moment the QR is live (13-sep: not only
                  once signed) that is a second council order, so Cancel goes
                  away and the way out is «Cancel this request» in Xaman's block. */}
              {orderBlocked ? (
                <XamanSignBlockedNote />
              ) : (
                <button type="button" onClick={() => setOrder(null)} className="text-[11px] text-ink/50">{t('Cancel')}</button>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
