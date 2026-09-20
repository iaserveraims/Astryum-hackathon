'use client';

/**
 * GovernedMovements — the "Movements" tab for a governed (multisig council)
 * account in Astryum Legacy.
 *
 * Same rails as the personal MovementsPanel (send / set XRP aside / native DEX
 * buy-sell), but the VERB changes with the authority (actionCatalog): a personal
 * wallet EXECUTES (you sign, it settles); a governed account PROPOSES (the
 * council signs by quorum). So every action here composes an UNSIGNED tx bound
 * to the council account and drops it into the proposal inbox — the quorum signs
 * it in the Proposals tab. Astryum never signs, never holds a key (#1); one live
 * proposal per account (XRPL pins one Sequence at a time).
 *
 * The unsigned tx bodies come from the SAME prepare endpoints the personal panel
 * uses (escrow-create, offer-create) — only the hand-off differs: propose vs
 * sign. The plain Payment is composed inline (Account = the council).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'react-qr-code';
import {
  ArrowLeftRight,
  ArrowUpRight,
  QrCode,
  PiggyBank,
  Repeat,
  TrendingUp,
  TrendingDown,
  Loader2,
  Landmark,
  Copy,
} from 'lucide-react';
import {
  Card,
  GhostButton,
  MicroLabel,
  Pill,
  PrimaryButton,
  SectionTitle,
} from '../ui/primitives';
import { RevealGroup, RevealItem } from '../ui/motion';
import { CouncilSigningDoors } from './CouncilMultisigFlow';
import { InlineNotice } from './InlineNotice';
import { useT } from '../../i18n/LanguageProvider';
import { fmtQtyActive } from '../../lib/format';
import { tryParseBaseUnits } from '../../lib/legacy/baseUnits';
import { describeServerRefusal, type ReadableRefusal } from '../../lib/errors/serverRefusal';
import { ServerRefusalBody } from '../ui/ServerRefusalBody';
import { getUserRegion } from '../../lib/region';
import {
  addressBookService,
  councilProposalsApi,
  xrplSavings,
  xrplDex,
  type AddressBookEntry,
  type XrplAmount,
  type XrplTxHandoff,
} from '../../services/v1Api';
import { WalletSelect } from '../wallet/WalletSelect';
import { TokenLogo } from '../ui/TokenLogo';
import { useMyWallets } from '../../hooks/useMyWallets';
import { walletDisplayName } from '../../lib/walletIdentity';
import { fetchNativeBalance, type NativeBalance } from '../../lib/wallet/nativeBalance';
import type { BackendWallet } from '../../services/walletLinkService';

const XRPL_CLASSIC_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

// RLUSD on XRPL mainnet — non-standard (5-char) code travels as 40-char hex;
// issuer mirrors the backend default (one source of truth with MovementsPanel).
const RLUSD = {
  label: 'RLUSD',
  currency: '524C555344000000000000000000000000000000',
  issuer: 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De',
} as const;

/**
 * G6 (auditoría 17-ago) — XRP humano → drops, por la doctrina F4.
 *
 * Antes: `String(Math.round(n * 1_000_000))` sobre un float. Con `0.0000001`
 * devolvía la cadena `"0"` — que es **truthy** — así que pasaba el guard
 * `if (!drops)` y se componía un Payment de CERO drops que el quórum firmaba.
 * Es el mismo bug que la superficie hermana (`GovernedMoneyFlows`) ya había
 * corregido con `parseBaseUnits`; esta nunca migró. Ahora: sin floats, sin
 * redondeo silencioso, y una precisión imposible se RECHAZA con su motivo en
 * vez de truncarse.
 */
function toDrops(xrp: string): string | null {
  return tryParseBaseUnits(xrp, 6)?.toString() ?? null;
}

function fmtXrp(amount: string | number): string {
  const n = Number(amount);
  return isFinite(n) ? fmtQtyActive(n, 6) : String(amount);
}

/** Trim a decimal to XRPL's 15 significant digits, no trailing zeros. */
function iouValue(n: number): string {
  if (!isFinite(n) || n <= 0) return '0';
  return Number(n.toPrecision(15)).toString();
}

function short(a: string): string {
  return a.length > 14 ? `${a.slice(0, 7)}…${a.slice(-5)}` : a;
}

/**
 * Backend errors → honest, human copy.
 *
 * prosa-y-lectores — WHAT THIS FUNCTION DID TO THE SERVER'S PROSE. It collapsed
 * `status === 409` — EVERY 409 — into "emit, withdraw or let it expire before
 * creating another", and the compose route it feeds answers 409 for
 * NOT_A_COUNCIL and 422 for the seat refusals (backend/src/routes/xrplDefi.ts,
 * whose own comment names this collapse as the reason it moved off 409). So a
 * council that does not exist yet was told to let a proposal expire, and the
 * 422 that explains how a council pays twice never reached the screen at all.
 * The wording itself was retired by the backend this round.
 *
 * One reader now (`serverRefusal`, the superset of the six twins): the server's
 * `detail` wins, infrastructure refusals (401 / 451 geofence / XRPL_DEFI_DISABLED
 * flag / access list) keep their own copy, and a known code with no detail still
 * gets a sentence instead of the bare slug. Kept as a named function because
 * three call sites read it and the name says what it is for.
 */
/**
 * productizer it. 27 (3): y el lector compartido tiraba `headline`, `ways[]` y
 * `retryAfterSeconds`, que es lo único que un rechazo trae con una salida dentro.
 * El rechazo entero viaja ahora; la pantalla pinta la frase Y el camino.
 */
function proposeError(err: unknown, t: (s: string) => string): ReadableRefusal {
  return describeServerRefusal(err, t);
}

/** Disclosure fact keys → readable labels (shared shape with MovementsPanel). */
function factLabel(key: string, t: (s: string) => string): string {
  const map: Record<string, string> = {
    amountXrp: t('Amount (XRP)'),
    amountDrops: t('Amount (drops)'),
    destination: t('Destination'),
    selfEscrow: t('Back to the account'),
    earnsYield: t('Generates yield'),
    ownerReserveXrp: t('Extra ledger reserve (XRP)'),
    finishAfterISO: t('Unlocks'),
    cancelAfterISO: t('Cancellable after'),
    network: t('Network'),
    owner: t('Owner'),
    selling: t('Selling'),
    buying: t('Buying'),
    orderKind: t('Order type'),
    expirationISO: t('Expires'),
  };
  return map[key] ?? key;
}

function factValue(key: string, value: string | number | boolean, t: (s: string) => string): string {
  if (typeof value === 'boolean') return value ? t('yes') : t('no');
  if (key === 'finishAfterISO' || key === 'cancelAfterISO' || key === 'expirationISO') {
    try {
      return new Date(String(value)).toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return String(value);
    }
  }
  return String(value);
}

type Door = 'send' | 'receive' | 'save' | 'dex';

function ActionTile({
  icon,
  title,
  desc,
  onClick,
  active,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 min-w-[140px] text-left rounded-xl border px-4 py-3 transition-colors ${
        active
          ? 'border-volt/40 bg-volt/10'
          : 'border-ink/10 bg-ink/[0.03] hover:bg-ink/[0.07] hover:border-ink/20'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={active ? 'text-volt' : 'text-ink/60'}>{icon}</span>
        <span className="text-sm font-medium text-ink">{title}</span>
      </div>
      <p className="text-[11px] text-ink/40 mt-1 leading-snug">{desc}</p>
    </button>
  );
}

export default function GovernedMovements({
  account,
  onGoToProposals,
}: {
  /** The governed (council) XRPL account every proposal binds to. */
  account: string;
  /** Jump to the Proposals tab so the quorum can sign what was just composed. */
  onGoToProposals?: () => void;
}) {
  const { t } = useT();
  const [door, setDoor] = useState<Door>('send');

  // The composed-but-unsigned handoff awaiting the "Propose" confirm (escrow/dex
  // carry a real disclosure; the plain Payment shows a one-line summary).
  const [pending, setPending] = useState<{ xrplTx: unknown; title: string; disclosure?: XrplTxHandoff['disclosure']; summary?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // it. 27 (3): una frase nuestra, o un rechazo LEÍDO con sus salidas y su puerta.
  const [error, setError] = useState<string | ReadableRefusal | null>(null);
  const [proposalId, setProposalId] = useState<string | null>(null);

  // ── Send (Payment) form — con la GRAMÁTICA del Send genérico (fundador
  // 2026-09-11: «no me aparece el modal genérico que aparece en todas las
  // accounts… me debería aparecer»): el mismo gesto — destino elegido entre
  // TUS wallets / libreta / dirección externa, saldo vivo con MAX y la
  // reserva dicha — y el final de siempre en este raíl: el Payment compuesto
  // SIN FIRMAR pasa por los dos tempos del consejo, jamás por una sola llave.
  // Solo destinos XRPL: lo que firma el quórum viaja por XRPL; el FXRP de la
  // Smart Account del consejo no se mueve desde esta puerta. ──
  const [dest, setDest] = useState('');
  const [sendAmt, setSendAmt] = useState('');
  const [destMode, setDestMode] = useState<'mine' | 'saved' | 'external'>('mine');
  const [destWalletKey, setDestWalletKey] = useState('');
  const [savedEntries, setSavedEntries] = useState<AddressBookEntry[]>([]);
  const [savedEntryId, setSavedEntryId] = useState('');
  const [balance, setBalance] = useState<NativeBalance | null>(null);

  const { wallets: myWallets } = useMyWallets();
  const myDestinations = useMemo(
    () => myWallets.filter((w) => XRPL_CLASSIC_RE.test(w.address) && w.address !== account),
    [myWallets, account],
  );
  useEffect(() => {
    if (myDestinations.length === 0) return;
    if (!destWalletKey || !myDestinations.some((w) => w.address === destWalletKey)) {
      setDestWalletKey(myDestinations[0].address);
    }
  }, [myDestinations, destWalletKey]);

  // La libreta, como en el Send genérico — solo entradas XRPL ≠ el consejo.
  useEffect(() => {
    let cancelled = false;
    addressBookService
      .list()
      .then(({ entries }) => {
        if (cancelled) return;
        const usable = entries.filter((e) => XRPL_CLASSIC_RE.test(e.address) && e.address !== account);
        setSavedEntries(usable);
        setSavedEntryId((prev) => prev || (usable[0]?.id ?? ''));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [account]);

  // El saldo del consejo, del MISMO lector que la tarjeta (spendable ya neto
  // de reservas base + owner; reservedXrp aparte para decirlo).
  useEffect(() => {
    let cancelled = false;
    fetchNativeBalance({ address: account, ecosystem: 'xrpl', chainId: null } as BackendWallet).then((b) => {
      if (!cancelled) setBalance(b);
    });
    return () => {
      cancelled = true;
    };
  }, [account]);

  /** MAX — spendable menos colchón de fee. El fee de un multisig escala con
   *  las firmas ((1+N)×fee base ≈ decenas de drops): 0.001 XRP lo cubre con
   *  holgura para cualquier consejo de 32 asientos. */
  const maxSendable = useMemo(() => {
    if (!balance) return null;
    const m = Math.floor(Math.max(0, (parseFloat(balance.balance) || 0) - 0.001) * 1e6) / 1e6;
    return m > 0 ? m.toFixed(6).replace(/\.?0+$/, '') : null;
  }, [balance]);

  /** El destino que el modo activo resuelve — misma regla que el genérico. */
  const resolvedDest =
    destMode === 'mine' && myDestinations.length > 0
      ? (myDestinations.find((w) => w.address === destWalletKey)?.address ?? '')
      : destMode === 'saved' && savedEntries.length > 0
        ? (savedEntries.find((e) => e.id === savedEntryId)?.address ?? '')
        : dest.trim();

  // ── Set aside (EscrowCreate) form ──
  const [saveAmt, setSaveAmt] = useState('');
  const [untilDate, setUntilDate] = useState('');

  // ── DEX (OfferCreate) form ──
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<'limit' | 'market'>('limit');
  const [dexAmt, setDexAmt] = useState('');
  const [price, setPrice] = useState('');

  const minDate = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  const reset = useCallback(() => {
    setPending(null);
    setError(null);
  }, []);

  /** Empty every door's form — used once a movement leaves this surface, by
   *  either tempo (signed in one sitting, or filed for the inbox). */
  const clearForms = useCallback(() => {
    setDest('');
    setSendAmt('');
    setSaveAmt('');
    setUntilDate('');
    setDexAmt('');
    setPrice('');
  }, []);

  /** The one hand-off: pin the unsigned tx to the council inbox for the quorum. */
  const propose = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      // G6 (auditoría 17-ago) — el `preflight` venía en la respuesta y esta
      // superficie lo IGNORABA. El coordinador ya corre el `simulate` del
      // ledger (invariante #11), así que una propuesta que la red YA sabe que
      // fallará (importe malo, cuenta sin fondos, reserva insuficiente) entraba
      // igual en la bandeja, OCUPABA el único hueco vivo de la cuenta, y el
      // quórum la firmaba. Ahora se dice antes de que nadie saque el móvil.
      const { proposal, preflight } = await councilProposalsApi.create({
        account,
        xrplTx: pending.xrplTx as Record<string, unknown>,
        title: pending.title,
        region: getUserRegion() ?? undefined,
      });
      setProposalId(proposal.id);
      setPending(null);
      // La propuesta YA está creada en el servidor cuando llega esta respuesta,
      // así que el aviso dice la verdad entera: existe, ocupa el hueco vivo de
      // la cuenta, y el ledger dice que fallaría. Decir «no se envió» sería
      // mentir; lo honesto es que el quórum no la firme y la deje caducar.
      if (preflight && preflight.available && !preflight.willSucceed) {
        // El motivo viene del propio ledger (`engineResult` del simulate) —
        // se muestra tal cual porque es la única pista accionable; el mensaje
        // de arriba ya traduce lo que significa para la familia.
        const why = preflight.engineResultMessage ?? preflight.engineResult;
        setError(
          `${t('Careful: the ledger says this would fail. It is in the inbox and holds the account’s only live slot — do not sign it; let it expire and compose it again fixed.')}${
            why ? ` (${why})` : ''
          }`,
        );
      }
      // clear the forms
      setDest(''); setSendAmt(''); setSaveAmt(''); setUntilDate(''); setDexAmt(''); setPrice('');
    } catch (err) {
      setError(proposeError(err, t));
    } finally {
      setBusy(false);
    }
  }, [pending, account, t]);

  // ── compose steps (build the UNSIGNED tx bound to the council account) ──

  const composeSend = useCallback(() => {
    setError(null);
    setProposalId(null);
    const target = resolvedDest;
    const drops = toDrops(sendAmt);
    if (!XRPL_CLASSIC_RE.test(target)) return setError(t('Enter a valid XRPL destination (r…).'));
    if (target === account) return setError(t('The destination must differ from the council account.'));
    if (!drops) return setError(t('Enter a positive XRP amount.'));
    setPending({
      xrplTx: { TransactionType: 'Payment', Account: account, Destination: target, Amount: drops },
      title: `Payment ${fmtXrp(sendAmt)} XRP → ${short(target)}`,
      summary: t('Payment from the council account to {dest} for {amt} XRP.')
        .replace('{dest}', short(target))
        .replace('{amt}', fmtXrp(sendAmt)),
    });
  }, [sendAmt, resolvedDest, account, t]);

  const composeSave = useCallback(async () => {
    setError(null);
    setProposalId(null);
    const drops = toDrops(saveAmt);
    if (!drops) return setError(t('Enter a positive XRP amount.'));
    if (!untilDate) return setError(t('Pick the date the savings unlock.'));
    setBusy(true);
    try {
      const h = await xrplSavings.prepareCreate({
        account,
        amountDrops: drops,
        finishAfterISO: new Date(`${untilDate}T00:00:00Z`).toISOString(),
        region: getUserRegion() ?? undefined,
      });
      setPending({ xrplTx: h.xrplTx, title: `Programmed transfer ${fmtXrp(saveAmt)} XRP`, disclosure: h.disclosure });
    } catch (err) {
      setError(proposeError(err, t));
    } finally {
      setBusy(false);
    }
  }, [saveAmt, untilDate, account, t]);

  const composeDex = useCallback(async () => {
    setError(null);
    setProposalId(null);
    const xrp = Number(dexAmt);
    const p = Number(price);
    if (!(xrp > 0)) return setError(t('Enter a positive XRP amount.'));
    if (!(p > 0)) return setError(t('Enter a positive price (RLUSD per XRP).'));
    // G6 — misma doctrina que `toDrops`: nada de floats para el importe que se
    // firma. `dexAmt` es la cadena que tecleó el usuario, no el Number derivado.
    const drops = toDrops(dexAmt);
    if (!drops) return setError(t('Enter a positive XRP amount.'));
    const rlusd = { currency: RLUSD.currency, issuer: RLUSD.issuer, value: iouValue(xrp * p) };
    const takerGets: XrplAmount = side === 'sell' ? drops : rlusd;
    const takerPays: XrplAmount = side === 'sell' ? rlusd : drops;
    setBusy(true);
    try {
      const h = await xrplDex.prepareOfferCreate({
        account,
        takerGets,
        takerPays,
        flags: { sell: side === 'sell', immediateOrCancel: orderType === 'market' },
        region: getUserRegion() ?? undefined,
      });
      setPending({
        xrplTx: h.xrplTx,
        title: `${side === 'sell' ? 'Sell' : 'Buy'} ${fmtXrp(xrp)} XRP @ ${iouValue(p)} RLUSD`,
        disclosure: h.disclosure,
      });
    } catch (err) {
      setError(proposeError(err, t));
    } finally {
      setBusy(false);
    }
  }, [dexAmt, price, side, orderType, account, t]);

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <ArrowLeftRight className="w-4 h-4 text-volt/80" strokeWidth={1.6} />
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">{t('Movements')}</h2>
          <MicroLabel>{t('Council account')} · {short(account)}</MicroLabel>
        </div>
        <p className="text-xs text-ink/55 mt-1.5 max-w-2xl leading-relaxed">
          {t('Send, set XRP aside and trade on the native XRPL DEX — bound to the council account. Astryum composes each move UNSIGNED and drops it in the inbox; the council signs it by quorum in Proposals. Nothing moves without those signatures.')}
        </p>
      </div>

      <RevealGroup className="space-y-5">
        <RevealItem>
          <Card className="p-4 space-y-4">
            <div className="flex flex-col sm:flex-row flex-wrap gap-2.5">
              <ActionTile icon={<ArrowUpRight className="w-4 h-4" />} title={t('Send')} desc={t('Propose an XRP Payment from the council to any address.')} onClick={() => { setDoor('send'); reset(); }} active={door === 'send'} />
              <ActionTile icon={<QrCode className="w-4 h-4" />} title={t('Receive')} desc={t('Show the council account address as a QR to receive into it.')} onClick={() => { setDoor('receive'); reset(); }} active={door === 'receive'} />
              <ActionTile icon={<PiggyBank className="w-4 h-4" />} title={t('Set XRP aside')} desc={t('Propose an escrow that locks XRP until a date you choose.')} onClick={() => { setDoor('save'); reset(); }} active={door === 'save'} />
              <ActionTile icon={<Repeat className="w-4 h-4" />} title={t('Buy / Sell')} desc={t('Propose a buy/sell order on the native XRPL DEX (XRP ↔ RLUSD).')} onClick={() => { setDoor('dex'); reset(); }} active={door === 'dex'} />
            </div>

            {/* ── Proposal-review state — one confirm turns a composed tx into an inbox item ── */}
            {pending ? (
              <div className="rounded-xl border border-volt/25 bg-volt/[0.05] p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Landmark size={15} className="text-volt/80" />
                  <span className="text-sm font-medium text-ink">{t('The quorum signs this')}</span>
                </div>
                <p className="text-sm text-ink/70">{pending.disclosure?.note ?? pending.summary}</p>
                {pending.disclosure && (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {Object.entries(pending.disclosure.facts).map(([k, v]) => (
                      <div key={k} className="rounded-lg border border-ink/10 bg-ink/5 px-3 py-2">
                        <MicroLabel>{factLabel(k, t)}</MicroLabel>
                        <div className="mt-0.5 truncate text-sm text-ink/85">{factValue(k, v, t)}</div>
                      </div>
                    ))}
                  </div>
                )}
                {/* THE TWO TEMPOS, both offered here (founder 2026-08-22).
                    This surface only ever filed a proposal, so a movement from
                    a council account produced ONE QR — the signer's own, later,
                    in the inbox — when the family was sitting together and
                    expected every member's QR at once. Every other council
                    surface (cage birth, council orders, vault entry, the panel)
                    already offers both doors through this component; Movements
                    was the one left out.

                    It is CouncilSigningDoors and not two hand-rolled buttons
                    because the two tempos share one scarce thing: the account's
                    next Sequence. The component closes the propose door while a
                    ceremony holds that seat — a pair of buttons would happily
                    put both on the same seat. */}
                <CouncilSigningDoors
                  xrplTx={pending.xrplTx as Record<string, unknown>}
                  account={account}
                  defaultTitle={pending.title}
                  onSettled={() => {
                    setPending(null);
                    clearForms();
                  }}
                  onProposed={(id) => {
                    setProposalId(id);
                    setPending(null);
                    clearForms();
                  }}
                />
                <GhostButton onClick={() => setPending(null)} disabled={busy}>{t('Back')}</GhostButton>
                <p className="text-[10px] text-ink/40">
                  {t('Either way Astryum never signs: it composes the unsigned transaction and the quorum signs it — together now, or each from their own device.')}
                </p>
              </div>
            ) : (
              <>
                {/* ── Send — la gramática del Send genérico, final gobernado ── */}
                {door === 'send' && (
                  <div className="rounded-xl border border-ink/10 bg-ink/[0.03] p-4 space-y-4">
                    {/* Pay with — un solo activo honesto hoy: el XRP nativo. */}
                    <div>
                      <label className="text-xs text-ink/40 block mb-2">{t('Pay with')}</label>
                      <div className="inline-flex items-center gap-2 rounded-xl border border-volt/40 bg-volt/10 px-3 py-2">
                        <TokenLogo symbol="XRP" size="xs" />
                        <span className="text-sm font-medium text-ink">XRP</span>
                        <span className="text-[11px] text-ink/45">{t('Native')}</span>
                      </div>
                      <p className="mt-2 text-[11px] text-ink/35">
                        {t('This door moves native XRP on XRPL. The FXRP held by the council’s Flare Smart Account does not move from here.')}
                      </p>
                    </div>

                    {/* Destination — My wallets / Saved / External, como el genérico */}
                    <div>
                      <label className="text-xs text-ink/40 block mb-2">{t('Destination')}</label>
                      {(myDestinations.length > 0 || savedEntries.length > 0) && (
                        <div className="flex gap-2 mb-2">
                          {myDestinations.length > 0 && (
                            <button
                              onClick={() => setDestMode('mine')}
                              className={`text-[11px] px-3 py-1.5 rounded-lg border transition-colors ${
                                destMode === 'mine'
                                  ? 'border-volt/40 bg-volt/10 text-volt'
                                  : 'border-ink/10 bg-ink/5 text-ink/50 hover:text-ink'
                              }`}
                            >
                              {t('My wallets')}
                            </button>
                          )}
                          {savedEntries.length > 0 && (
                            <button
                              onClick={() => setDestMode('saved')}
                              className={`text-[11px] px-3 py-1.5 rounded-lg border transition-colors ${
                                destMode === 'saved'
                                  ? 'border-volt/40 bg-volt/10 text-volt'
                                  : 'border-ink/10 bg-ink/5 text-ink/50 hover:text-ink'
                              }`}
                            >
                              {t('Saved addresses')}
                            </button>
                          )}
                          <button
                            onClick={() => setDestMode('external')}
                            className={`text-[11px] px-3 py-1.5 rounded-lg border transition-colors ${
                              destMode === 'external'
                                ? 'border-volt/40 bg-volt/10 text-volt'
                                : 'border-ink/10 bg-ink/5 text-ink/50 hover:text-ink'
                            }`}
                          >
                            {t('External address')}
                          </button>
                        </div>
                      )}
                      {destMode === 'mine' && myDestinations.length > 0 ? (
                        <WalletSelect
                          value={destWalletKey}
                          onChange={setDestWalletKey}
                          options={myDestinations.map((w) => ({
                            key: w.address,
                            record: w,
                            name: walletDisplayName(w, t),
                            detail: `${w.address.slice(0, 8)}…${w.address.slice(-6)}`,
                            badge: (
                              <span className="shrink-0 rounded-full border border-ink/10 bg-ink/5 px-2 py-0.5 text-[10px] text-ink/55">
                                XRPL
                              </span>
                            ),
                          }))}
                        />
                      ) : destMode === 'saved' && savedEntries.length > 0 ? (
                        <select
                          value={savedEntryId}
                          onChange={(e) => setSavedEntryId(e.target.value)}
                          className="w-full px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm focus:outline-none focus:border-volt/50 [&>option]:bg-surface-1"
                        >
                          {savedEntries.map((entry) => (
                            <option key={entry.id} value={entry.id}>
                              {entry.label} · {short(entry.address)} · XRPL
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          placeholder="r…"
                          value={dest}
                          onChange={(e) => setDest(e.target.value)}
                          spellCheck={false}
                          autoComplete="off"
                          className="w-full px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm font-mono placeholder-ink/30 focus:outline-none focus:border-volt/50"
                        />
                      )}
                    </div>

                    {/* Amount — Available + MAX + la reserva dicha, como el genérico */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs text-ink/40">{t('Amount')} · XRP</label>
                        <span className="flex items-center gap-2">
                          {balance && (
                            <span className="text-[11px] text-ink/40">
                              {t('Available')}:{' '}
                              <span className="font-mono text-ink/60">
                                {(parseFloat(balance.balance) || 0).toFixed(4)} {balance.symbol}
                              </span>
                            </span>
                          )}
                          {maxSendable != null && (
                            <button
                              onClick={() => setSendAmt(maxSendable)}
                              title={t('Send the maximum available (fee headroom already deducted)')}
                              className="text-[10px] font-semibold px-2 py-0.5 rounded-md border border-volt/40 text-volt hover:bg-volt/10 transition-colors"
                            >
                              MAX
                            </button>
                          )}
                        </span>
                      </div>
                      <div className="relative">
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/40 text-xs font-medium">XRP</span>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          placeholder="0.00"
                          value={sendAmt}
                          onChange={(e) => setSendAmt(e.target.value)}
                          className="w-full pl-4 pr-16 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm placeholder-ink/30 focus:outline-none focus:border-volt/50"
                        />
                      </div>
                      <p className="text-[10px] text-ink/30 mt-1.5">
                        {t('XRPL keeps a 1 XRP base reserve locked in the sending account.')}
                        {balance?.reservedXrp != null && (
                          <> {`+${balance.reservedXrp} XRP ${t('locked as XRPL reserve (not spendable)')}`}</>
                        )}
                      </p>
                    </div>

                    <PrimaryButton onClick={composeSend} disabled={busy}>
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowUpRight size={14} />}
                      {t('Review')}
                    </PrimaryButton>
                  </div>
                )}

                {/* ── Receive ── */}
                {door === 'receive' && (
                  <div className="rounded-xl border border-ink/10 bg-ink/[0.03] p-4 flex flex-col items-center gap-3">
                    {/* QR modules need real paper white regardless of theme — this is
                        the one deliberate exception to the ink-token surface system. */}
                    <div className="rounded-xl bg-white p-3">
                      <QRCode value={account} size={168} />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[12px] text-ink/70 break-all">{account}</span>
                      <button onClick={() => navigator.clipboard.writeText(account).catch(() => {})} className="text-ink/40 hover:text-ink/80" title={t('Copy address')}>
                        <Copy size={13} />
                      </button>
                    </div>
                    <p className="text-[11px] text-ink/40 text-center">{t('Anyone can pay into the council account — receiving needs no signature.')}</p>
                  </div>
                )}

                {/* ── Set aside (escrow) ── */}
                {door === 'save' && (
                  <div className="rounded-xl border border-ink/10 bg-ink/[0.03] p-4 space-y-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                      <label className="flex-1">
                        <MicroLabel>{t('Amount (XRP)')}</MicroLabel>
                        <input type="number" min="0" step="any" value={saveAmt} onChange={(e) => setSaveAmt(e.target.value)} placeholder="100"
                          className="mt-1 w-full rounded-lg border border-ink/10 bg-ink/5 px-3 py-2 text-sm text-ink caret-ink placeholder:text-ink/30 outline-none focus:border-ink/25" />
                      </label>
                      <label className="flex-1">
                        <MicroLabel>{t('Locked until')}</MicroLabel>
                        <input type="date" min={minDate} value={untilDate} onChange={(e) => setUntilDate(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-ink/10 bg-ink/5 px-3 py-2 text-sm text-ink caret-ink placeholder:text-ink/30 outline-none focus:border-ink/25" />
                      </label>
                      <PrimaryButton onClick={composeSave} disabled={busy}>
                        {busy ? <Loader2 size={14} className="animate-spin" /> : <PiggyBank size={14} />}
                        {t('Review')}
                      </PrimaryButton>
                    </div>
                    <p className="text-[10px] text-ink/35">{t('A savings lock, not a yield product — it earns nothing while locked. XRP only.')}</p>
                  </div>
                )}

                {/* ── DEX buy/sell ── */}
                {door === 'dex' && (
                  <div className="rounded-xl border border-ink/10 bg-ink/[0.03] p-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="inline-flex rounded-lg border border-ink/10 bg-ink/5 p-0.5">
                        <button type="button" onClick={() => setSide('buy')} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${side === 'buy' ? 'bg-emerald-500/20 text-tone-success' : 'text-ink/50 hover:text-ink/80'}`}>
                          <TrendingUp size={13} /> {t('Buy XRP')}
                        </button>
                        <button type="button" onClick={() => setSide('sell')} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${side === 'sell' ? 'bg-red-500/20 text-tone-danger' : 'text-ink/50 hover:text-ink/80'}`}>
                          <TrendingDown size={13} /> {t('Sell XRP')}
                        </button>
                      </div>
                      <div className="inline-flex rounded-lg border border-ink/10 bg-ink/5 p-0.5">
                        <button type="button" onClick={() => setOrderType('limit')} className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${orderType === 'limit' ? 'bg-volt/15 text-ink' : 'text-ink/50 hover:text-ink/80'}`}>{t('Limit')}</button>
                        <button type="button" onClick={() => setOrderType('market')} className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${orderType === 'market' ? 'bg-volt/15 text-ink' : 'text-ink/50 hover:text-ink/80'}`}>{t('Market')}</button>
                      </div>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                      <label className="flex-1">
                        <MicroLabel>{t('Amount (XRP)')}</MicroLabel>
                        <input type="number" min="0" step="any" value={dexAmt} onChange={(e) => setDexAmt(e.target.value)} placeholder="100"
                          className="mt-1 w-full rounded-lg border border-ink/10 bg-ink/5 px-3 py-2 text-sm text-ink caret-ink placeholder:text-ink/30 outline-none focus:border-ink/25" />
                      </label>
                      <label className="flex-1">
                        <MicroLabel>{t('Price (RLUSD per XRP)')}</MicroLabel>
                        <input type="number" min="0" step="any" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.50"
                          className="mt-1 w-full rounded-lg border border-ink/10 bg-ink/5 px-3 py-2 text-sm text-ink caret-ink placeholder:text-ink/30 outline-none focus:border-ink/25" />
                      </label>
                      <PrimaryButton onClick={composeDex} disabled={busy}>
                        {busy ? <Loader2 size={14} className="animate-spin" /> : <Repeat size={14} />}
                        {t('Review')}
                      </PrimaryButton>
                    </div>
                    <p className="text-[10px] text-ink/35">{t('A spot order on the native XRPL DEX — the price comes from the open book, Astryum quotes nothing.')}</p>
                  </div>
                )}
              </>
            )}

            {error && (
              <InlineNotice tone="warning">
                {typeof error === 'string' ? error : <ServerRefusalBody refusal={error} t={t} />}
              </InlineNotice>
            )}
            {proposalId && (
              <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] px-4 py-3 space-y-1.5">
                <InlineNotice tone="success">
                  {t('Proposal created — it is in the council inbox for the quorum to sign.')}
                </InlineNotice>
                {onGoToProposals && (
                  <button onClick={onGoToProposals} className="text-[12px] text-volt hover:underline">
                    {t('Go to Proposals →')}
                  </button>
                )}
              </div>
            )}
          </Card>
        </RevealItem>

        <RevealItem>
          <Card padded={false} className="p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <Pill tone="info">{t('Quorum signs')}</Pill>
              <SectionTitle>{t('How a governed movement works')}</SectionTitle>
            </div>
            <p className="text-[12px] leading-relaxed text-ink/55">
              {t('You compose the movement here; it becomes an unsigned proposal pinned to one ledger Sequence. Each council member signs the SAME bytes in Proposals until the quorum is met, then anyone broadcasts it. The rule of custody holds: Astryum never signs, never holds a key — only the quorum moves the funds.')}
            </p>
          </Card>
        </RevealItem>
      </RevealGroup>
    </div>
  );
}
