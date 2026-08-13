'use client';

/**
 * CouncilVaultEntry — a council enters and leaves a venue the same way a person
 * enters a vault in Earn, except the signature is the quorum's and the rail
 * underneath is always the cage.
 *
 * The founder's verdict on the old surface (2026-07-28) was blunt: "desde esta
 * ui no se puede hacer nada". It asked for a VENUE NUMBER and an AMOUNT IN BASE
 * UNITS, with nothing on screen to say which venues existed, what they held, or
 * how many decimals the token had. This is the same rail with the facts read
 * out loud — the vault's registered venues, its idle principal, its asset — and
 * amounts typed in the units a person actually thinks in.
 *
 * What did NOT change, and must not: the plumbing. Entering is `directTo`,
 * leaving is `recall`; the quorum signs one 1-drop XRPL Payment carrying the
 * order's hash; the FDC proves it; the bridge executes exactly those bytes on
 * the vault. Astryum composes and relays with zero discretion (#8), never signs
 * (#1), and no order can extract the principal — that function does not exist.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Coins, Landmark, Loader2, RefreshCw, Send } from 'lucide-react';
import { GhostButton, MicroLabel, Pill, PrimaryButton } from '../ui/primitives';
import { InlineNotice } from './InlineNotice';
import CageDisclosureModal from './CageDisclosureModal';
import CouncilMultisigFlow from './CouncilMultisigFlow';
import ProposeToCouncil from './ProposeToCouncil';
import { DisclosureBlock } from './LegacyPanel';
import { useT } from '../../i18n/LanguageProvider';
import { getUserRegion } from '../../lib/region';
import { LEGACY_ASSET_DECIMALS_FALLBACK, displayBaseUnits, formatBaseUnits, tryParseBaseUnits } from '../../lib/legacy/baseUnits';
import {
  xrplLegacy,
  type CouncilOrderHandoff,
  type LegacyVaultFundQuote,
  type LegacyVaultState,
  type LegacyVenueRow,
} from '../../services/v1Api';

/**
 * Three moves, and they are NOT interchangeable:
 *   fund — fresh XRP becomes principal inside the cage (a mint + deposit).
 *   in   — principal already inside goes to work in a venue (`directTo`).
 *   out  — it comes back OUT OF THE VENUE and sits idle IN THE VAULT (`recall`).
 * "out" is the one people misread as a withdrawal. It is not one, and the copy
 * below never lets it look like one: the cage has no way to pay principal to an
 * address, so promising otherwise would be a lie the contract then refuses.
 */
type Direction = 'fund' | 'in' | 'out';

/** The app targets ES2017, where `0n` is a syntax error — see lib/legacy/baseUnits. */
const ZERO = BigInt(0);

/** Both rails end in the same place: an unsigned XRPL tx for the quorum. */
interface PendingOrder {
  xrplTx: Record<string, unknown>;
  disclosure: { disclosedToUser: true; astryumSigns: false; note: string; facts: Record<string, string | number | boolean> };
  title: string;
  /** Funding is a mint, not a council order — it says so on the review screen. */
  kind: 'fund' | 'order';
  /**
   * The committed bytes of a council order. The quorum's signature only puts
   * the order ON XRPL; something still has to carry the FDC proof to the
   * bridge. Kept here so `onSettled` can fire that relay — without it the order
   * validates, looks signed, and simply never executes (exactly what happened
   * on the first live run, 2026-07-29 12:29 UTC).
   */
  orderData?: string;
}

function shortAddr(a: string): string {
  return a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a;
}

/** Backend failures → copy a person can act on. */
function orderError(err: unknown, t: (s: string) => string): string {
  const body = (err as { body?: { error?: string; detail?: string } })?.body;
  const status = (err as { status?: number })?.status;
  // The pre-flight speaks plainly already (it mirrors the contract's reverts).
  if (body?.error === 'ORDER_WOULD_REVERT' && body.detail) return body.detail;
  if (body?.error === 'VAULT_STATE_READ_FAILED' || status === 503) {
    return t('The vault could not be read from Flare right now. Nothing was composed — try again in a moment.');
  }
  if (status === 451) {
    return t('DeFi execution is not available for your region. Set your region in Settings — monitoring stays available.');
  }
  return body?.detail || (err as Error)?.message || t('Something went wrong.');
}

export default function CouncilVaultEntry({
  account,
  vaultTitle,
  onGoToProposals,
}: {
  /** The council (multisig) XRPL account whose quorum will sign the order. */
  account: string;
  /** The Earn card this was opened from — context only, never a promise. */
  vaultTitle?: string;
  onGoToProposals?: () => void;
}) {
  const { t } = useT();
  const [state, setState] = useState<LegacyVaultState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [direction, setDirection] = useState<Direction>('fund');
  const [venueId, setVenueId] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [pending, setPending] = useState<PendingOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The one-way disclosure, opened by the server's refusal (or by the link). */
  const [ackOpen, setAckOpen] = useState(false);
  /** Qué está pasando DESPUÉS de firmar — la etapa que antes no se contaba. */
  const [relayNote, setRelayNote] = useState<string | null>(null);

  /** The council's real XRP, its ceiling and the floor below which nothing
   *  lands — without this the amount box was blind on all three. */
  const [quote, setQuote] = useState<LegacyVaultFundQuote | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const s = await xrplLegacy.vaultState(account);
      setState(s);
      setVenueId((cur) => (cur !== null ? cur : (s.venues.find((v) => !v.retired)?.id ?? null)));
    } catch (err) {
      setLoadError(orderError(err, t));
    } finally {
      setLoading(false);
    }
    // Best-effort: a failed quote hides the balance line, it never blocks the form.
    try {
      setQuote(await xrplLegacy.vaultFundQuote(account));
    } catch {
      setQuote(null);
    }
  }, [t, account]);

  useEffect(() => {
    void load();
  }, [load]);

  // Fees visible BEFORE signing (invariant #6): the plain quote only gives the
  // floors — a quote WITH the amount returns the honest breakdown (minting fee,
  // executor fee, what actually lands as principal). Debounced per typing pause;
  // best-effort — on failure the floor-quote already on screen stays.
  useEffect(() => {
    if (direction !== 'fund') return;
    const amt = amount.trim();
    if (!amt || Number.isNaN(Number(amt)) || Number(amt) <= 0) return;
    const id = setTimeout(() => {
      void (async () => {
        try {
          setQuote(await xrplLegacy.vaultFundQuote(account, amt));
        } catch {
          /* keep the last good quote */
        }
      })();
    }, 450);
    return () => clearTimeout(id);
  }, [direction, amount, account]);

  const decimals = state?.asset.decimals ?? LEGACY_ASSET_DECIMALS_FALLBACK;
  const symbol = state?.asset.symbol ?? '';
  const venue: LegacyVenueRow | null = useMemo(
    () => state?.venues.find((v) => v.id === venueId) ?? null,
    [state, venueId],
  );

  const nowSec = Math.floor(Date.now() / 1000);
  /** The ceiling for this direction: idle principal going IN, the venue's own
   *  basis coming OUT (the contract refuses more than either). */
  const ceiling = useMemo(() => {
    if (!state) return ZERO;
    if (direction === 'fund') return ZERO; // fresh XRP — the council's balance is the only limit
    return direction === 'in' ? BigInt(state.idlePrincipal) : BigInt(venue?.basis || '0');
  }, [state, venue, direction]);

  // Funding is denominated in XRP (6 decimals, always), not in the vault asset.
  const parsed = tryParseBaseUnits(amount, direction === 'fund' ? 6 : decimals);
  const overCeiling = direction !== 'fund' && parsed !== null && parsed > ceiling;
  const venueBlocked =
    direction === 'in' && !!venue && (venue.retired || nowSec < venue.readyAt);

  /** Funding is bounded by the fee floor below and the council's balance above.
   *  Both are only known once the quote loads; without it we let the backend
   *  be the judge rather than blocking on a number we could not read. */
  const fundOutOfRange =
    direction === 'fund' &&
    quote !== null &&
    parsed !== null &&
    (Number(amount) < Number(quote.minGrossXrp) || Number(amount) > Number(quote.maxGrossXrp));

  const canCompose =
    !!state &&
    parsed !== null &&
    !state.migrated &&
    (direction === 'fund' ? !fundOutOfRange : !!venue && !overCeiling && !venueBlocked);

  const compose = useCallback(async () => {
    if (!state || parsed === null) return;
    setBusy(true);
    setError(null);
    try {
      if (direction === 'fund') {
        // A mint, not a council order: the quorum signs one XRPL payment whose
        // memo commits "mint into our own account, then deposit into the cage".
        const h = await xrplLegacy.vaultFundPrepare({
          account,
          amountXrp: amount.trim(),
          region: getUserRegion() ?? undefined,
        });
        setPending({
          xrplTx: h.xrplPayment,
          disclosure: h.disclosure,
          title: `Fund the vault with ${h.net.grossXrp} XRP`,
          kind: 'fund',
        });
      } else {
        if (venue === null) return;
        const h: CouncilOrderHandoff = await xrplLegacy.councilOrderPrepare({
          account,
          action: direction === 'in' ? 'direct-to' : 'recall',
          // Base units — the contract's own integers, never a rounded float.
          params: { venueId: venue.id, amount: parsed.toString() },
          region: getUserRegion() ?? undefined,
        });
        setPending({
          xrplTx: h.xrplTx,
          disclosure: h.disclosure,
          title: h.order.summary,
          kind: 'order',
          orderData: h.order.orderData,
        });
      }
    } catch (err) {
      // Funding adds principal that is as one-way as the first: the server holds
      // the disclosure gate, and its refusal opens the text (then retries).
      if ((err as { body?: { error?: string } })?.body?.error === 'CAGE_ACK_REQUIRED') {
        setAckOpen(true);
        return;
      }
      setError(orderError(err, t));
    } finally {
      setBusy(false);
    }
  }, [state, venue, parsed, account, direction, amount, t]);

  const reset = useCallback(() => {
    setPending(null);
    setError(null);
    setAmount('');
    setRelayNote(null);
    void load();
  }, [load]);

  /**
   * The quorum signing puts the order ON XRPL — that is NOT execution. The
   * bridge only moves when someone carries the FDC proof to it, and the relay
   * is what does that. Forgetting this call is why the first live order sat
   * validated-but-never-executed: the ceremony looked complete and nothing had
   * happened on Flare.
   *
   * Funding rides the executor's own sweep instead, so it needs no relay.
   */
  const onSettled = useCallback(
    (hash: string) => {
      if (pending?.kind === 'order') {
        setRelayNote(t('Signed on XRPL. Fetching the proof and delivering it to the vault — this takes about 2–5 minutes.'));
        void xrplLegacy
          .councilOrderRelay({ xrplTxHash: hash, orderData: pending.orderData })
          .catch((err) =>
            setRelayNote(
              `${t('The order is signed and valid, but the relay could not start:')} ${orderError(err, t)} — ${t('it can be re-delivered by anyone later; no signature is lost.')}`,
            ),
          );
      }
      reset();
    },
    [pending, reset, t],
  );

  const inputCls =
    'mt-1 w-full rounded-lg border border-ink/10 bg-ink/5 px-3 py-2 text-sm outline-none focus:border-ink/25';

  // ── The composed order, awaiting the quorum ──────────────────────────────
  if (pending) {
    return (
      <div className="space-y-3">
        <DisclosureBlock handoff={pending as never} />
        <p className="text-[12px] text-ink/55">
          {pending.kind === 'fund'
            ? t(
                'Your council signs this ONE payment — each member from their own device. It carries the whole instruction: mint the XRP into this Legacy\'s own account on Flare, then deposit it into the vault as principal. Nobody holds it in between.',
              )
            : t(
                'Your council signs this Payment — each member from their own device. The signature authorizes ONLY the order above: the bridge executes exactly those bytes on the vault, and nothing else.',
              )}
        </p>
        {pending.kind === 'fund' && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2.5 text-[12px] text-tone-warning">
            {t(
              'This is the FIRST of two signatures. It puts the capital inside the cage; choosing which venue it works in is a second, separate order of the quorum. That separation is deliberate — one signature should not both lock family capital away and decide where it goes.',
            )}
          </p>
        )}
        <CouncilMultisigFlow xrplTx={pending.xrplTx} account={account} onSettled={onSettled} />
        <ProposeToCouncil xrplTx={pending.xrplTx} account={account} defaultTitle={pending.title} />
        {onGoToProposals && (
          <button onClick={onGoToProposals} className="text-[12px] text-volt hover:underline">
            {t('Go to Proposals →')}
          </button>
        )}
        <GhostButton onClick={() => setPending(null)}>{t('Back')}</GhostButton>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* What this rail IS — said once, before any field. */}
      <div className="rounded-xl border border-[var(--authority-border)] bg-[var(--authority-soft)] p-4 space-y-1.5">
        <div className="flex items-center gap-2 text-sm font-medium text-ink/90">
          <Landmark size={15} className="text-[var(--authority-solid)]" />
          {t('The council moves this capital')}
        </div>
        <p className="text-xs leading-relaxed text-ink/60">
          {vaultTitle
            ? t('This account is governed by a council, so {vault} is entered by council order instead of a single signature.').replace('{vault}', vaultTitle)
            : t('This account is governed by a council, so capital is moved by council order instead of a single signature.')}{' '}
          {t(
            'Astryum composes the order unsigned; the quorum signs one XRPL transaction; the Flare Data Connector proves it and the vault executes exactly those bytes. Astryum never signs and never holds a key.',
          )}
        </p>
      </div>

      {/* Firmar no es ejecutar: entre una cosa y otra está la ronda del FDC. */}
      {relayNote && <InlineNotice tone="success">{relayNote}</InlineNotice>}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-ink/50">
          <Loader2 size={14} className="animate-spin" /> {t('Reading the vault on Flare…')}
        </p>
      ) : loadError ? (
        <div className="space-y-2">
          <InlineNotice tone="warning">{loadError}</InlineNotice>
          <GhostButton onClick={() => void load()}>
            <RefreshCw size={14} /> {t('Try again')}
          </GhostButton>
        </div>
      ) : !state ? null : state.venues.length === 0 ? (
        // An honest empty state beats a form that can only fail: with no venue
        // registered there is nowhere for principal to go, and no amount fixes it.
        <InlineNotice tone="warning">
          {t(
            'This vault has no venues registered yet, so capital has nowhere to work. A council order registers the first one (Propose a venue, in the Legacy hub) — it opens after the vault\'s waiting period.',
          )}
        </InlineNotice>
      ) : (
        <>
          {/* The vault, in one line of real numbers. */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-ink/[0.07] bg-ink/[0.02] px-3 py-2.5">
            <MicroLabel>{t('In the vault')}</MicroLabel>
            <span className="text-sm text-ink/80">
              {displayBaseUnits(state.idlePrincipal, decimals)} {symbol}{' '}
              <span className="text-ink/45">{t('idle')}</span>
            </span>
            <span className="text-ink/20">·</span>
            <span className="text-sm text-ink/80">
              {displayBaseUnits(state.allocatedPrincipal, decimals)} {symbol}{' '}
              <span className="text-ink/45">{t('working')}</span>
            </span>
            <span className="ml-auto">
              <GhostButton onClick={() => void load()}>
                <RefreshCw size={13} />
              </GhostButton>
            </span>
          </div>

          {state.migrated && (
            <InlineNotice tone="warning">
              {t('This vault has been migrated to a successor — it accepts no new direction.')}
            </InlineNotice>
          )}

          {/* Three moves. Each is its own quorum signature — capital entering
              the cage and capital going to work are separate decisions. */}
          <div className="inline-flex flex-wrap rounded-lg border border-ink/10 bg-ink/5 p-0.5">
            {([
              ['fund', <Coins key="i" size={13} />, t('Add capital')],
              ['in', <ArrowUpRight key="i" size={13} />, t('Put it to work')],
              ['out', <ArrowDownLeft key="i" size={13} />, t('Bring it back to the vault')],
            ] as const).map(([id, icon, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => { setDirection(id); setAmount(''); setError(null); }}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  direction === id ? 'bg-volt/15 text-ink' : 'text-ink/50 hover:text-ink/80'
                }`}
              >
                {icon} {label}
              </button>
            ))}
          </div>

          {/* Say what each move actually does — especially the one people
              misread. "Bring it back" is not a withdrawal and never will be. */}
          <p className="text-[12px] leading-relaxed text-ink/55">
            {direction === 'fund'
              ? t(
                  'Fresh XRP from the council becomes principal inside the vault. It takes ONE quorum signature; putting that principal to work is a second one.',
                )
              : direction === 'in'
                ? t('Principal already in the vault goes to work in a venue the constitution whitelists.')
                : t(
                    'Principal comes out of the VENUE and sits idle IN THE VAULT. It does not return to the council and it does not become XRP — the cage has no function that pays principal to an address. Only the yield it earns can ever be paid out.',
                  )}
          </p>

          {/* Nothing to direct yet: point at the move that fixes it, instead of
              letting someone fill a form that can only fail. */}
          {direction === 'in' && BigInt(state.idlePrincipal) === ZERO && (
            <InlineNotice tone="warning">
              {t('The vault holds no idle principal, so there is nothing to direct yet.')}{' '}
              <button onClick={() => { setDirection('fund'); setAmount(''); }} className="underline hover:text-ink">
                {t('Add capital first →')}
              </button>
            </InlineNotice>
          )}

          {/* The venues that actually exist, with what they hold. Funding does
              not pick one — it only puts principal in the vault. */}
          <div className={`space-y-2 ${direction === 'fund' ? 'hidden' : ''}`}>
            <MicroLabel>{t('Venue')}</MicroLabel>
            <div className="space-y-1.5">
              {state.venues.map((v) => {
                const notReady = nowSec < v.readyAt;
                const disabled = direction === 'in' && (v.retired || notReady);
                const selected = v.id === venueId;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => { setVenueId(v.id); setAmount(''); setError(null); }}
                    className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${
                      selected
                        ? 'border-volt/40 bg-volt/[0.08]'
                        : 'border-ink/10 bg-ink/[0.03] hover:border-ink/20 hover:bg-ink/[0.06]'
                    } ${disabled ? 'opacity-55' : ''}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-ink">
                        {t('Venue')} #{v.id}
                      </span>
                      <span className="font-mono text-[11px] text-ink/45">{shortAddr(v.target)}</span>
                      <Pill tone="neutral">{v.kind === 'erc4626' ? 'ERC-4626' : 'Compound v2'}</Pill>
                      {v.retired && <Pill tone="warning">{t('retired')}</Pill>}
                      {notReady && <Pill tone="warning">{t('not open yet')}</Pill>}
                    </div>
                    <div className="mt-1 text-[12px] text-ink/55">
                      {t('Holds')} {displayBaseUnits(v.value, decimals)} {symbol}
                      {v.basis !== v.value && (
                        <>
                          {' '}
                          <span className="text-ink/35">
                            ({t('principal')} {displayBaseUnits(v.basis, decimals)} {symbol})
                          </span>
                        </>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Why a selected venue cannot be entered — before an amount is typed. */}
          {venueBlocked && venue && (
            <InlineNotice tone="warning">
              {venue.retired
                ? t('This venue is retired: closed to new capital. Bringing capital back out of it still works.')
                : `${t('This venue opens on')} ${new Date(venue.readyAt * 1000).toLocaleString()} — ${t('the vault\'s waiting period before capital may enter.')}`}
            </InlineNotice>
          )}

          {/* The amount, in human units. */}
          <label className="block">
            <MicroLabel>
              {t('Amount')} ({direction === 'fund' ? 'XRP' : symbol})
            </MicroLabel>
            <input
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setError(null); }}
              inputMode="decimal"
              placeholder="0.0"
              spellCheck={false}
              className={inputCls}
            />
            <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-ink/45">
              {direction === 'fund' ? (
                quote ? (
                  <>
                    {t('The council holds')}{' '}
                    <span className="text-ink/70">{Number(quote.balanceXrp).toLocaleString(undefined, { maximumFractionDigits: 6 })} XRP</span>
                    {' · '}
                    {t('spendable after the ledger reserve:')}{' '}
                    <span className="text-ink/70">{Number(quote.spendableXrp).toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
                  </>
                ) : (
                  t('XRP paid from the council account. Protocol fees are taken before it lands.')
                )
              ) : direction === 'in' ? (
                `${t('Idle and available:')} ${formatBaseUnits(state.idlePrincipal, decimals)} ${symbol}`
              ) : (
                `${t('In this venue:')} ${formatBaseUnits(venue?.basis ?? '0', decimals)} ${symbol}`
              )}
              {direction === 'fund' && quote && Number(quote.maxGrossXrp) > 0 && (
                <button type="button" onClick={() => setAmount(quote.maxGrossXrp)} className="text-volt hover:underline">
                  {t('Max')}
                </button>
              )}
              {direction !== 'fund' && ceiling > ZERO && (
                <button
                  type="button"
                  onClick={() => setAmount(formatBaseUnits(ceiling, decimals))}
                  className="text-volt hover:underline"
                >
                  {t('Max')}
                </button>
              )}
            </span>
            {/* The three numbers that decide whether this can work at all —
                said before the amount is typed, not after it fails. */}
            {direction === 'fund' && quote && (
              <span className="mt-1 block text-[11px] text-ink/40">
                {t('Max keeps back the signing fee of')} {quote.txFeeXrp} XRP{' '}
                {t('(a quorum of {n} signs, so it costs more than one signature).').replace('{n}', String(quote.signerCount))}{' '}
                {t('Minimum that actually lands:')} {quote.minGrossXrp} XRP —{' '}
                {t('below that the minting and executor fees take the whole payment.')}
              </span>
            )}
            {/* The per-amount breakdown the invariant demands: what THIS payment
                pays in fees and what lands as principal, before any signature. */}
            {direction === 'fund' && quote?.quote && (
              <span className="mt-1 block text-[11px] text-ink/45">
                {t('Of')} {quote.quote.grossXrp} XRP: {t('minting fee')} {quote.quote.mintingFeeXrp} ·{' '}
                {t('executor fee')} {quote.quote.executorFeeXrp} · {t('lands as principal:')}{' '}
                {quote.quote.principalAdded} FXRP
              </span>
            )}
            {/* El tope beta, dicho ANTES de teclear (fundador 2026-08-06): el
                principal enjaulado no vuelve a una dirección; en beta la jaula
                admite un total limitado por Astryum. */}
            {direction === 'fund' && quote?.cage?.capXrp != null && (
              <span className="mt-1 block text-[11px] text-tone-warning">
                {t('Beta limit: this cage may hold at most')} {quote.cage.capXrp} XRP{' '}
                {t('in total. It holds')} {quote.cage.currentPrincipalXrp.toFixed(2)} XRP —{' '}
                {(quote.cage.remainingXrp ?? 0) > 0
                  ? `${t('room for about')} ${quote.cage.remainingXrp?.toFixed(2)} XRP ${t('more (before fees).')}`
                  : t('it is full: no more capital can enter during the beta.')}
              </span>
            )}
          </label>

          {amount && parsed === null && (
            <p className="flex items-start gap-2 text-[12px] text-tone-warning">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {t('Enter a positive amount the token can hold — at most')} {decimals} {t('decimals.')}
            </p>
          )}
          {/* Funding has its own two edges: the fee floor and the balance. */}
          {direction === 'fund' && quote && parsed !== null && Number(amount) < Number(quote.minGrossXrp) && (
            <p className="flex items-start gap-2 text-[12px] text-tone-warning">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {t('Below the minimum: the minting and executor fees would take the whole payment and no principal would reach the vault. Send at least')}{' '}
              {quote.minGrossXrp} XRP.
            </p>
          )}
          {direction === 'fund' && quote && parsed !== null && Number(amount) > Number(quote.maxGrossXrp) && (
            <p className="flex items-start gap-2 text-[12px] text-tone-warning">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {t('More than the council can spend. It holds')} {quote.balanceXrp} XRP,{' '}
              {t('of which')} {quote.reserveXrp} {t('is locked as the ledger reserve and')} {quote.txFeeXrp}{' '}
              {t('is needed to pay for the signatures.')}
            </p>
          )}
          {overCeiling && (
            <p className="flex items-start gap-2 text-[12px] text-tone-warning">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {direction === 'in'
                ? t('More than the vault holds idle. Capital already working in a venue must be brought back first.')
                : t('More than this venue holds for the vault.')}
            </p>
          )}

          <PrimaryButton onClick={() => void compose()} disabled={busy || !canCompose}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {t('Compose the order for the council')}
          </PrimaryButton>

          {error && <InlineNotice tone="warning">{error}</InlineNotice>}

          <p className="text-[11px] leading-relaxed text-ink/40">
            {t(
              'Rates and balances shown are read live from the vault and the protocol — protocol data, never an Astryum offer or promise. Composing costs nothing and moves nothing: only the quorum\'s signatures do.',
            )}
          </p>

          {direction === 'fund' && (
            <button
              type="button"
              onClick={() => setAckOpen(true)}
              className="text-[11px] text-ink/45 underline underline-offset-2 transition-colors hover:text-ink/80"
            >
              {t('How a cage works')}
            </button>
          )}
        </>
      )}

      {ackOpen && (
        <CageDisclosureModal
          account={account}
          mode="accept"
          confirmLabel={t('I understand — compose the order')}
          onAccepted={() => void compose()}
          onClose={() => setAckOpen(false)}
        />
      )}
    </div>
  );
}
