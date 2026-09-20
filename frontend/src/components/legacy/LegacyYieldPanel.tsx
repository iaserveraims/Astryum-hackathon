'use client';

/**
 * LegacyYieldPanel — the only value that ever leaves the cage, with a door.
 *
 * The contract already did all of this: `harvest(venueId)` realizes what a
 * venue earned ABOVE what was put in and credits it to the payees, and
 * `claim()` pays the caller. Both permissionless, both live on mainnet. What
 * was missing was any surface at all — nobody could see what they were owed,
 * and an heir had no way to ask for it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Coins, ExternalLink, Loader2, RefreshCw, Sprout } from 'lucide-react';
import { Card, GhostButton, MicroLabel, Pill, PrimaryButton, SectionTitle } from '../ui/primitives';
import { InlineNotice } from './InlineNotice';
import { useT } from '../../i18n/LanguageProvider';
import { getUserRegion } from '../../lib/region';
import { LEGACY_ASSET_DECIMALS_FALLBACK, displayBaseUnits, formatBaseUnits } from '../../lib/legacy/baseUnits';
import { useWalletPartner } from '../../lib/wallet/useWalletPartner';
import { useXrplWalletPartner } from '../../lib/wallet/useXrplWalletPartner';
import { startPending } from '../../lib/settlement/settlement';
import { useSettlement } from '../../lib/settlement/useSettlement';
import { SettlementIndicator } from '../settlement/SettlementIndicator';
import { xrplLegacy, type LegacyVaultYieldState, type LegacyYieldClaimHandoff } from '../../services/v1Api';
import { releaseHandoffSeat, releaseHandoffSeatResult, notifyHandoffSigned } from '../../lib/wallet/handoffRelease';
import { signOutcome } from '../../lib/wallet/signOutcome';
import {
  describeSeatRefusal,
  refusalHeadline,
  serverDetailIfEnglish,
  type SeatRefusalLike,
} from '../../lib/xaman/seatRefusal';
import {
  AbandonedSeatNotice,
  SeatRefusalNotice,
  describeStaleSignature,
  normalizeSeatRefusal,
} from '../wallet/SeatRefusalNotice';
import { RedemptionFeeNotice } from '../../lib/fassets/RedemptionFeeNotice';
import { redemptionOf } from '../../lib/fassets/redemptionFeeRow';

const FLARE_CHAIN_ID = 14;
const XRPSCAN_TX = 'https://xrpscan.com/tx/';
const FLARE_TX = 'https://flare-explorer.flare.network/tx/';

function short(a: string): string {
  return a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a;
}

/**
 * A 0xFE nonce-seat refusal, in words (R5 1.7).
 *
 * The sentences are NOT written here: `lib/xaman/seatRefusal` is the one reader of
 * what the server meant by «the seat is taken», so a signed seat is never answered
 * with the words of an unsigned draft. This wrapper only normalises the ONE shape
 * that reader cannot see: the Legacy claim route still wraps the verdict in its own
 * `VAULT_YIELD_CLAIM_PREPARE_FAILED`, with the real code at the head of `detail`.
 */
function seatRefusalText(body: SeatRefusalLike | undefined, t: (s: string) => string): string | null {
  if (!body) return null;
  const refusal = normalizeSeatRefusal(body);
  const view = refusal ? describeSeatRefusal(refusal, t) : null;
  // LA FRASE, SIN EL PÁRRAFO DEL SERVIDOR (R5 5.4). Este panel pegaba el
  // `detail` del backend detrás de la frase: castellano, hashes y «~604 s» sobre
  // una pantalla en inglés. Lo que el asiento significa ya está dicho; lo que el
  // servidor escribió para sí mismo no se enseña.
  return view ? view.text : null;
}

function errText(err: unknown, t: (s: string) => string): string {
  const body = (err as { body?: SeatRefusalLike })?.body;
  const seat = seatRefusalText(body, t);
  if (seat) return seat;
  // El `detail` del servidor solo si está en el idioma de la
  // pantalla — varios de estos se componen en castellano. Sin él, el titular
  // del lector compartido, que dice el código en una frase y nunca en crudo.
  const detail = serverDetailIfEnglish(body?.detail);
  if (detail) return detail;
  const head = body ? refusalHeadline(body, t) : null;
  if (head) return head;
  return (err as Error)?.message ?? t('Something went wrong.');
}

/** Does a failed claim signature leave a draft that may still be released? */
type ClaimSeatFate = 'still-unsigned' | 'stale' | 'maybe-signed';

/**
 * THE SEAT IS DECIDED BY THE WALLET'S ANSWER, NOT BY THE CLICK (R5 1.7).
 *
 * `handedToPartner` is true here because `sendXrpl` was called; only an error that
 * PROVES nothing left (a rejection in Xaman, an expired payload, a partner that
 * was never connected) leaves the draft releasable. Anything we could not read
 * stays 'maybe-signed', and a seat that may carry a signature is never freed.
 */
function claimSeatAfterSignFailure(err: unknown): ClaimSeatFate {
  // A VERDICT WE READ BEATS EVERY INFERENCE (R5 5.2). `tefMAX_LEDGER` /
  // `tefPAST_SEQ` say this exact payload can never validate: nothing was
  // dispatched, nothing ever will be, and its nonce seat is free to release.
  // Without this it landed in 'maybe-signed' — the seat kept for a payment that
  // does not exist, and «we could not confirm it» over a claim that provably
  // never happened.
  if (describeStaleSignature(err, (s) => s)) return 'stale';
  return signOutcome(err, true).kind === 'not-sent' ? 'still-unsigned' : 'maybe-signed';
}

type ClaimSignResult =
  | { kind: 'signed'; txHash: string }
  | { kind: 'still-unsigned'; error: unknown }
  | { kind: 'stale'; error: unknown }
  | { kind: 'maybe-signed'; error: unknown };

/** The three refs the seat rule reads: handed, in flight, and still on screen. */
interface ClaimSignRefs {
  handed: { current: boolean };
  inFlight: { current: boolean };
  mounted: { current: boolean };
}

/**
 * The signature and what it does to the seat, in one place so a test can run it.
 *
 * «Handed» is marked only once the send RESOLVED (Xaman accepted and submitted) or
 * once a failure we could not read made a signature possible. While the payload is
 * with Xaman nothing is released, and a rejection that lands after the panel is
 * gone frees the seat then — the same draft an unmount would have freed.
 */
async function runClaimSignature(handoff: { xrplPayment: unknown; memoHex: string }, send: (tx: unknown) => Promise<{ txHash: string }>, refs: ClaimSignRefs, release: (memoHex: string) => void): Promise<ClaimSignResult> {
  refs.inFlight.current = true;
  try {
    const { txHash } = await send(handoff.xrplPayment);
    refs.handed.current = true;
    return { kind: 'signed', txHash };
  } catch (error) {
    const fate = claimSeatAfterSignFailure(error);
    // Releasable ⇔ no signature of THIS payload can ever land: it was refused
    // before leaving, or the ledger already said it is too late.
    const releasable = fate !== 'maybe-signed';
    refs.handed.current = !releasable;
    if (releasable && !refs.mounted.current) release(handoff.memoHex);
    return { kind: fate, error };
  } finally {
    refs.inFlight.current = false;
  }
}

export default function LegacyYieldPanel({
  account,
  onGoToProposals,
}: {
  account: string;
  /** The banner's click-through: "no payees" used to POINT at the Proposals
   *  tab in prose without a way to get there (E6) — same prop pattern as
   *  LegacyActivityFeed. */
  onGoToProposals?: () => void;
}) {
  const { t } = useT();
  const { sendIntent: sendEvm } = useWalletPartner();
  const { sendIntent: sendXrpl, address: xrplAddress } = useXrplWalletPartner();

  const [state, setState] = useState<LegacyVaultYieldState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [flareTx, setFlareTx] = useState<string | null>(null);
  const [xrplTx, setXrplTx] = useState<string | null>(null);
  const [claimAmount, setClaimAmount] = useState('1');
  // Truthful settlement (unearned-success discipline): the submit hash is not
  // the verdict. Each door tracks its own rail — harvest a plain Flare receipt,
  // claim the same 0xFE mint machinery every other dispatch rides.
  const harvestSettle = useSettlement();
  const claimSettle = useSettlement();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setState(await xrplLegacy.vaultYield(account));
    } catch (err) {
      setError(errText(err, t));
    } finally {
      setLoading(false);
    }
  }, [account, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const decimals = state?.asset.decimals ?? LEGACY_ASSET_DECIMALS_FALLBACK;
  const symbol = state?.asset.symbol ?? '';

  /** Realize a venue's gain. Permissionless — any Flare wallet may send it. */
  const harvest = useCallback(
    async (venueId: number) => {
      setBusy(`harvest-${venueId}`);
      setError(null);
      setFlareTx(null);
      try {
        const plan = await xrplLegacy.vaultHarvestPrepare({ account, venueId });
        const { txHash } = await sendEvm({
          to: plan.call.to,
          data: plan.call.data,
          value: plan.call.value,
          chainId: FLARE_CHAIN_ID,
        } as never);
        setFlareTx(txHash);
        harvestSettle.track(startPending('evm', txHash), { onSettled: () => void load() });
      } catch (err) {
        setError(errText(err, t));
      } finally {
        setBusy(null);
      }
    },
    [account, sendEvm, load, t, harvestSettle],
  );

  /**
   * The heir's claim: PREPARE → review → ONE signature. It used to prepare and
   * open Xaman in the same click, so the FAssets redemption fee of this unmint
   * was never on screen before signing (invariant #6, 4.2).
   * Now the review shows it — figure, or «could not be read — it is not zero» —
   * with the net XRP and when it arrives, and only then the signature.
   */
  const [claimHandoff, setClaimHandoff] = useState<LegacyYieldClaimHandoff | null>(null);
  /** Una firma que llegó tarde: no validó ni validará, y se prepara otra vez. */
  const [staleSign, setStaleSign] = useState<unknown>(null);
  /** El cuerpo de un rechazo de asiento: lo dice y lo resuelve el aviso compartido. */
  const [seatRefusal, setSeatRefusal] = useState<unknown>(null);
  // True only once something MAY have been signed (see runClaimSignature). It used
  // to be set before `sendXrpl`, so a rejection in Xaman kept the nonce seat of this
  // 0xFE taken until its TTL: the heir could not prepare another claim, and nothing
  // on screen said why (R5 1.7).
  const claimHanded = useRef(false);
  // The payload is with Xaman right now: nobody releases anything until it answers.
  const claimInFlight = useRef(false);
  // Is this panel still on screen? A rejection that lands after the heir left frees
  // the seat there, exactly as leaving the review does.
  const claimMounted = useRef(true);
  /**
   * EL MEMO SOBREVIVE AL PAYLOAD (R5 5.2). Esto era
   * `claimSeat.current = claimHandoff?.memoHex ?? null`, así que en cuanto una
   * firma tardía vaciaba `claimHandoff` el memo se perdía y ni «Back» ni el
   * desmontaje podían liberar ya el asiento: tapiado hasta su TTL por un pago
   * que nunca existió. Ahora solo se pisa con un memo NUEVO, y se borra
   * explícitamente cuando algo se firmó (el asiento es del despacho) o cuando
   * este panel ya lo ha liberado.
   */
  const claimSeat = useRef<string | null>(null);
  if (claimHandoff?.memoHex) claimSeat.current = claimHandoff.memoHex;
  useEffect(() => {
    claimMounted.current = true;
    return () => {
      claimMounted.current = false;
      // Abandoned unsigned review (unmount) → free the nonce seat; never while Xaman
      // holds the payload, and never once a signature is possible.
      if (claimSeat.current && !claimHanded.current && !claimInFlight.current) {
        releaseHandoffSeat(claimSeat.current);
      }
    };
  }, []);

  const prepareClaim = useCallback(async () => {
    if (!xrplAddress) return;
    setBusy('claim');
    setError(null);
    setStaleSign(null);
    setXrplTx(null);
    try {
      const h = await xrplLegacy.vaultYieldClaimPrepare({
        // El consejo que DEBE (de qué jaula sale) y el heredero que FIRMA no
        // son la misma cuenta — ser payee es justamente no ser el consejo.
        council: account,
        xrplAddress,
        amountXrpForMint: claimAmount.trim() || '1',
        region: getUserRegion() ?? undefined,
      });
      claimHanded.current = false;
      setSeatRefusal(null);
      setClaimHandoff(h);
    } catch (err) {
      // Un asiento tomado no es «no se pudo»: es un 0xFE anterior de esta misma
      // cuenta en el nonce, y suele ser el borrador que este panel dejó. El
      // aviso compartido lo dice en inglés y ofrece liberarlo (R5 5.4).
      const body = (err as { body?: unknown })?.body;
      setSeatRefusal(normalizeSeatRefusal(body) ? body : null);
      setError(errText(err, t));
    } finally {
      setBusy(null);
    }
  }, [account, xrplAddress, claimAmount, t]);

  const signClaim = useCallback(async () => {
    if (!claimHandoff) return;
    const handoff = claimHandoff;
    setBusy('claim-sign');
    setError(null);
    const outcome = await runClaimSignature(
      handoff,
      (tx) => sendXrpl({ tx: tx as never }),
      { handed: claimHanded, inFlight: claimInFlight, mounted: claimMounted },
      releaseHandoffSeat,
    );
    try {
      if (outcome.kind === 'signed') {
        notifyHandoffSigned(handoff.memoHex, outcome.txHash);
        setXrplTx(outcome.txHash);
        claimSettle.track(startPending('xrpl-mint', outcome.txHash), { onSettled: () => void load() });
        // Signed: this payload is spent from the screen and its seat stays taken —
        // the dispatch is on its way. The memo is dropped so nothing frees it.
        claimSeat.current = null;
        setClaimHandoff(null);
      } else if (outcome.kind === 'still-unsigned') {
        // Declined in Xaman, expired, or it never got there: nothing was signed, the
        // prepared payment is still good, and «Back» frees its seat as it always did.
        setError(errText(outcome.error, t));
      } else if (outcome.kind === 'stale') {
        // TOO LATE, AND WE KNOW IT (R5 5.2). The payload cannot enter any
        // ledger: nothing was claimed, nothing is «on its way», and the honest
        // offer is a fresh prepare. The payload goes, the MEMO STAYS — «Back» and
        // the unmount can still free that seat, and so can «Prepare it again».
        setStaleSign(outcome.error);
        setClaimHandoff(null);
      } else {
        // We could not read what happened: the claim may already be out, so the seat
        // stays taken and the review closes instead of offering a second signature.
        setClaimHandoff(null);
        setError(
          t(
            'We could not confirm whether this claim was signed — it may already be on its way. Check your XRPL account before preparing another one.',
          ),
        );
      }
    } finally {
      setBusy(null);
    }
  }, [claimHandoff, sendXrpl, load, t, claimSettle]);

  const discardClaim = useCallback(() => {
    if (claimHandoff && !claimHanded.current && !claimInFlight.current) {
      releaseHandoffSeat(claimHandoff.memoHex);
      claimSeat.current = null;
    }
    setClaimHandoff(null);
  }, [claimHandoff]);

  /**
   * «Prepare it again» tras una firma tardía: primero se LIBERA el asiento del
   * payload muerto y SOLO entonces se compone el siguiente — al revés, el
   * prepare chocaría contra su propio borrador y la persona se quedaría delante
   * de un `NONCE_SEAT_TAKEN` que ella misma acaba de causar (R1 1.5).
   */
  const prepareClaimAgain = useCallback(async () => {
    const memo = claimSeat.current;
    if (memo && !claimHanded.current && !claimInFlight.current) {
      claimSeat.current = null;
      await releaseHandoffSeatResult(memo).catch(() => {});
    }
    setStaleSign(null);
    await prepareClaim();
  }, [prepareClaim]);

  const ripe = state?.harvestable.filter((h) => BigInt(h.amount) > BigInt(0)) ?? [];

  return (
    <Card className="p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Sprout size={16} className="text-ink/50" />
        <SectionTitle>{t('Yield')}</SectionTitle>
        <span className="ml-auto">
          <GhostButton onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </GhostButton>
        </span>
      </div>

      <p className="text-[12px] leading-relaxed text-ink/55">
        {t(
          'What the capital EARNS can be paid out; the capital itself cannot. Harvesting turns a venue\'s gain above its basis into an amount the payees are owed, and each payee claims their own share. The principal is never touched by either step.',
        )}
      </p>

      {loading && !state ? (
        <p className="flex items-center gap-2 text-sm text-ink/50">
          <Loader2 size={14} className="animate-spin" /> {t('Reading the vault…')}
        </p>
      ) : !state ? null : (
        <>
          {/* No payees = every harvest capitalizes back into principal. Saying
              nothing here would make an empty table look like a failure. */}
          {state.capitalizesToPrincipal && (
            <InlineNotice tone="warning">
              <div className="space-y-2">
                <div>
                  {t(
                    'This Legacy has no payees set, so ALL yield capitalizes back into the principal. To share it out, the council sends the governed order "Set the payees (who receives the yield)" from the Proposals tab.',
                  )}
                </div>
                {onGoToProposals && (
                  <GhostButton onClick={onGoToProposals}>
                    {t('Set the payees (who receives the yield)')} →
                  </GhostButton>
                )}
              </div>
            </InlineNotice>
          )}

          {/* What is ripe to realize, per venue. */}
          <div className="space-y-2">
            <MicroLabel>{t('Ready to realize')}</MicroLabel>
            {ripe.length === 0 ? (
              <p className="text-[12px] text-ink/45">
                {t('No venue is above what was put into it right now, so there is nothing to harvest. A venue that is flat or down yields nothing and its principal is never touched.')}
              </p>
            ) : (
              ripe.map((h) => (
                <div key={h.venueId} className="flex flex-wrap items-center gap-2 rounded-xl border border-ink/10 bg-ink/[0.03] px-3 py-2.5">
                  <span className="text-sm text-ink/80">
                    {t('Venue')} #{h.venueId}
                  </span>
                  <span className="text-sm font-medium text-tone-success">
                    +{displayBaseUnits(h.amount, decimals)} {symbol}
                  </span>
                  <span className="ml-auto">
                    <GhostButton onClick={() => void harvest(h.venueId)} disabled={busy !== null}>
                      {busy === `harvest-${h.venueId}` ? <Loader2 size={14} className="animate-spin" /> : <Coins size={14} />}
                      {t('Harvest')}
                    </GhostButton>
                  </span>
                </div>
              ))
            )}
            <p className="text-[11px] text-ink/40">
              {t('Anyone can harvest — it pays the sender nothing, it only credits the payees. Sent from your own Flare wallet.')}
            </p>
          </div>

          {/* Who is owed what. */}
          <div className="space-y-2">
            <MicroLabel>{t('Owed to the payees')}</MicroLabel>
            {state.payees.length === 0 ? (
              <p className="text-[12px] text-ink/45">{t('No payees configured.')}</p>
            ) : (
              <ul className="divide-y divide-ink/5">
                {state.payees.map((p) => (
                  <li key={p.account} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                    <span className="font-mono text-ink/75">{short(p.account)}</span>
                    <Pill tone="neutral">{(p.bps / 100).toFixed(2)}%</Pill>
                    <span className="ml-auto text-ink/80">
                      {formatBaseUnits(p.claimable, decimals)} {symbol}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* The heir's door. */}
          <div className="space-y-2 rounded-xl border border-[var(--authority-border)] bg-[var(--authority-soft)] p-3">
            <div className="text-sm font-medium text-ink/90">{t('Claim your yield as XRP')}</div>
            <p className="text-[12px] leading-relaxed text-ink/60">
              {t(
                'If this Legacy owes you yield, one signature brings it home as native XRP to your own XRPL account — you never have to hold FXRP. The rail rides a small payment, so enter what you are willing to send with it; it is minted and redeemed back to you along with the yield.',
              )}
            </p>
            {!claimHandoff ? (
              <div className="flex flex-wrap items-end gap-2">
                <label className="grow">
                  <MicroLabel>{t('Payment that carries it (XRP)')}</MicroLabel>
                  <input
                    value={claimAmount}
                    onChange={(e) => setClaimAmount(e.target.value)}
                    inputMode="decimal"
                    className="mt-1 w-full rounded-lg border border-ink/10 bg-ink/5 px-3 py-2 text-sm text-ink caret-ink placeholder:text-ink/30 outline-none focus:border-ink/25"
                  />
                </label>
                <PrimaryButton onClick={() => void prepareClaim()} disabled={busy !== null || !xrplAddress}>
                  {busy === 'claim' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  {t('Review before signing')}
                </PrimaryButton>
              </div>
            ) : (
              // The review: what is claimed, the redemption fee and the net, THEN Xaman.
              <div className="space-y-2 rounded-lg border border-ink/10 bg-ink/[0.03] p-3">
                <p className="text-[12px] text-ink/75">
                  {t('Claim')}{' '}
                  <span className="font-mono">
                    {claimHandoff.claimableHuman} {symbol}
                  </span>{' '}
                  → <span className="font-mono">{short(claimHandoff.destination)}</span>
                </p>
                {claimHandoff.disclosure?.note ? (
                  <p className="text-[11px] leading-relaxed text-ink/50">{claimHandoff.disclosure.note}</p>
                ) : null}
                <RedemptionFeeNotice
                  response={claimHandoff}
                  grossFxrp={redemptionOf(claimHandoff).grossFxrp}
                  t={t}
                  showAmount
                  amountLabel="Your XRPL account receives"
                />
                <div className="flex flex-wrap gap-2">
                  <PrimaryButton onClick={() => void signClaim()} disabled={busy !== null}>
                    {busy === 'claim-sign' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    {t('Sign in Xaman')}
                  </PrimaryButton>
                  <GhostButton onClick={discardClaim} disabled={busy !== null}>
                    {t('Back')}
                  </GhostButton>
                </div>
              </div>
            )}
            {!xrplAddress && (
              <p className="flex items-start gap-2 text-[12px] text-tone-warning">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                {t('Connect the XRPL account that is a payee of this Legacy to claim.')}
              </p>
            )}
            <p className="text-[11px] text-ink/40">
              {t('FAssets will not redeem below its on-chain minimum; under that, the yield simply stays owed in the vault until there is enough. Nothing is lost.')}
            </p>
          </div>

          {/* El asiento tomado y la firma tardía tienen su propia salida: una
              libera el borrador, la otra vuelve a preparar. Ninguna deja a la
              persona delante de un código ni de un párrafo en castellano. */}
          {seatRefusal ? (
            <SeatRefusalNotice
              refusal={seatRefusal}
              t={t}
              fallbackMemoHex={claimSeat.current}
              onPrepareAgain={() => void prepareClaimAgain()}
            />
          ) : null}
          {staleSign ? (
            <InlineNotice tone="warning">
              <div className="space-y-2">
                <div>{describeStaleSignature(staleSign, t)?.text}</div>
                <GhostButton onClick={() => void prepareClaimAgain()} disabled={busy !== null}>
                  {t('Prepare it again')}
                </GhostButton>
              </div>
            </InlineNotice>
          ) : null}
          {/* Rechazar en Xaman deja el 0xFE sentado en el
              nonce y nadie lo decía. Se dice, y con CUÁNDO se suelta; soltarlo
              desde aquí no se ofrece mientras el payload siga siendo firmable. */}
          {claimHandoff && error && !seatRefusal && !staleSign ? (
            <AbandonedSeatNotice
              memoHex={claimHandoff.memoHex}
              t={t}
              stillSignable
              onPrepareAgain={() => void prepareClaimAgain()}
            />
          ) : null}
          {error && !seatRefusal && <InlineNotice tone="warning">{error}</InlineNotice>}
          {/* Green comes from the settlement machine, never from the submit
              hash — the tx can still revert (harvest) or sit unexecuted
              (claim's 0xFE dispatch). Explorer link stays either way. */}
          {flareTx && harvestSettle.state && (
            <div className="space-y-1">
              <SettlementIndicator
                state={harvestSettle.state}
                pendingText={t('Sent — waiting for the Flare receipt…')}
                settledText={t('Harvested — the payees are now owed it.')}
              />
              <a href={`${FLARE_TX}${flareTx}`} target="_blank" rel="noreferrer" className="text-[12px] text-ink/55 underline">
                <ExternalLink size={12} className="mr-1 inline" />
                {t('View on Flare')}
              </a>
            </div>
          )}
          {xrplTx && claimSettle.state && (
            <div className="space-y-1">
              <SettlementIndicator
                state={claimSettle.state}
                pendingText={t('Signed — the executor is dispatching your claim…')}
                settledText={t('Claimed — your yield is on its way back as XRP.')}
              />
              <a href={`${XRPSCAN_TX}${xrplTx}`} target="_blank" rel="noreferrer" className="text-[12px] text-ink/55 underline">
                <ExternalLink size={12} className="mr-1 inline" />
                {t('View on XRPScan')}
              </a>
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-ink/40">
            {t(
              'The principal stays in the vault whatever happens here. It can work in whitelisted venues, come back to the vault, or migrate to a verified successor — it can never be paid out to an address. That is the cage, and it is the point.',
            )}
          </p>
        </>
      )}
    </Card>
  );
}
