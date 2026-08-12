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

import { useCallback, useState } from 'react';
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
import { InlineNotice } from './InlineNotice';
import { useT } from '../../i18n/LanguageProvider';
import { fmtQtyActive } from '../../lib/format';
import { getUserRegion } from '../../lib/region';
import {
  councilProposalsApi,
  xrplSavings,
  xrplDex,
  type XrplAmount,
  type XrplTxHandoff,
} from '../../services/v1Api';

const XRPL_CLASSIC_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

// RLUSD on XRPL mainnet — non-standard (5-char) code travels as 40-char hex;
// issuer mirrors the backend default (one source of truth with MovementsPanel).
const RLUSD = {
  label: 'RLUSD',
  currency: '524C555344000000000000000000000000000000',
  issuer: 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De',
} as const;

function toDrops(xrp: string): string | null {
  const n = Number(xrp);
  if (!isFinite(n) || n <= 0) return null;
  return String(Math.round(n * 1_000_000));
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

/** Backend errors → honest, human copy (same posture as the Earn/Movements gate). */
function proposeError(err: unknown, t: (s: string) => string): string {
  const status = (err as { status?: number })?.status;
  const body = (err as { body?: { error?: string; detail?: string } })?.body;
  const code = body?.error ?? (err as Error)?.message ?? '';
  if (code === 'LIVE_PROPOSAL_EXISTS' || status === 409) {
    return t('This account already has a live proposal collecting signatures — emit, withdraw or let it expire before creating another.');
  }
  if (code === 'NOT_A_COUNCIL') {
    return t('This account is not a council yet (no multisig signer list). Constitute it first — then its movements can be proposed to the quorum.');
  }
  if (status === 451) {
    return t('DeFi execution is not available for your region. Set your region in Settings — monitoring stays available.');
  }
  if (status === 503) {
    return t('XRPL DeFi is not enabled on this deployment yet (feature flag off).');
  }
  return body?.detail || (err as Error)?.message || t('Something went wrong.');
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
  const [error, setError] = useState<string | null>(null);
  const [proposalId, setProposalId] = useState<string | null>(null);

  // ── Send (Payment) form ──
  const [dest, setDest] = useState('');
  const [sendAmt, setSendAmt] = useState('');

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

  /** The one hand-off: pin the unsigned tx to the council inbox for the quorum. */
  const propose = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const { proposal } = await councilProposalsApi.create({
        account,
        xrplTx: pending.xrplTx as Record<string, unknown>,
        title: pending.title,
        region: getUserRegion() ?? undefined,
      });
      setProposalId(proposal.id);
      setPending(null);
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
    const drops = toDrops(sendAmt);
    if (!XRPL_CLASSIC_RE.test(dest.trim())) return setError(t('Enter a valid XRPL destination (r…).'));
    if (dest.trim() === account) return setError(t('The destination must differ from the council account.'));
    if (!drops) return setError(t('Enter a positive XRP amount.'));
    setPending({
      xrplTx: { TransactionType: 'Payment', Account: account, Destination: dest.trim(), Amount: drops },
      title: `Payment ${fmtXrp(sendAmt)} XRP → ${short(dest.trim())}`,
      summary: t('Payment from the council account to {dest} for {amt} XRP.')
        .replace('{dest}', short(dest.trim()))
        .replace('{amt}', fmtXrp(sendAmt)),
    });
  }, [sendAmt, dest, account, t]);

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
    const drops = String(Math.round(xrp * 1_000_000));
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
                  <span className="text-sm font-medium text-ink">{t('Propose to the council')}</span>
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
                <div className="flex gap-2">
                  <PrimaryButton onClick={propose} disabled={busy}>
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <Landmark size={14} />}
                    {t('Create proposal')}
                  </PrimaryButton>
                  <GhostButton onClick={() => setPending(null)} disabled={busy}>{t('Back')}</GhostButton>
                </div>
                <p className="text-[10px] text-ink/40">
                  {t('This does not move funds: it pins the unsigned transaction for the quorum. The council signs it in Proposals; Astryum never signs.')}
                </p>
              </div>
            ) : (
              <>
                {/* ── Send ── */}
                {door === 'send' && (
                  <div className="rounded-xl border border-ink/10 bg-ink/[0.03] p-4 space-y-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                      <label className="flex-[2]">
                        <MicroLabel>{t('Destination (r…)')}</MicroLabel>
                        <input value={dest} onChange={(e) => setDest(e.target.value)} spellCheck={false} autoComplete="off" placeholder="rBeneficiary…"
                          className="mt-1 w-full rounded-lg border border-ink/10 bg-ink/5 px-3 py-2 text-sm font-mono outline-none focus:border-ink/25" />
                      </label>
                      <label className="flex-1">
                        <MicroLabel>{t('Amount (XRP)')}</MicroLabel>
                        <input type="number" min="0" step="any" value={sendAmt} onChange={(e) => setSendAmt(e.target.value)} placeholder="100"
                          className="mt-1 w-full rounded-lg border border-ink/10 bg-ink/5 px-3 py-2 text-sm outline-none focus:border-ink/25" />
                      </label>
                      <PrimaryButton onClick={composeSend} disabled={busy}>
                        {busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowUpRight size={14} />}
                        {t('Review')}
                      </PrimaryButton>
                    </div>
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
                          className="mt-1 w-full rounded-lg border border-ink/10 bg-ink/5 px-3 py-2 text-sm outline-none focus:border-ink/25" />
                      </label>
                      <label className="flex-1">
                        <MicroLabel>{t('Locked until')}</MicroLabel>
                        <input type="date" min={minDate} value={untilDate} onChange={(e) => setUntilDate(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-ink/10 bg-ink/5 px-3 py-2 text-sm outline-none focus:border-ink/25" />
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
                          className="mt-1 w-full rounded-lg border border-ink/10 bg-ink/5 px-3 py-2 text-sm outline-none focus:border-ink/25" />
                      </label>
                      <label className="flex-1">
                        <MicroLabel>{t('Price (RLUSD per XRP)')}</MicroLabel>
                        <input type="number" min="0" step="any" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.50"
                          className="mt-1 w-full rounded-lg border border-ink/10 bg-ink/5 px-3 py-2 text-sm outline-none focus:border-ink/25" />
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

            {error && <InlineNotice tone="warning">{error}</InlineNotice>}
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
