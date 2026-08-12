'use client';

/**
 * LegacyYieldPanel — the only value that ever leaves the cage, with a door.
 *
 * The contract already did all of this: `harvest(venueId)` realizes what a
 * venue earned ABOVE what was put in and credits it to the payees, and
 * `claim()` pays the caller. Both permissionless, both live on mainnet. What
 * was missing was any surface at all — nobody could see what they were owed,
 * and an heir had no way to ask for it.
 *
 * Two doors, because two different people knock:
 *  - Harvest: a plain Flare transaction anyone can send (an heir, a keeper, a
 *    passer-by). It pays the sender nothing, so nobody can profit by racing it.
 *  - Claim: the heir signs ONE XRPL payment and their yield comes home as
 *    native XRP, through the redeem rail that already existed. They never have
 *    to learn what FXRP is.
 *
 * The principal is not on this page and cannot be. No call built here can reach
 * it — the vault has no function that pays principal to an address, and the
 * copy never implies otherwise.
 */

import { useCallback, useEffect, useState } from 'react';
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
import { xrplLegacy, type LegacyVaultYieldState } from '../../services/v1Api';

const FLARE_CHAIN_ID = 14;
const XRPSCAN_TX = 'https://xrpscan.com/tx/';
const FLARE_TX = 'https://flare-explorer.flare.network/tx/';

function short(a: string): string {
  return a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a;
}

function errText(err: unknown, t: (s: string) => string): string {
  const body = (err as { body?: { error?: string; detail?: string } })?.body;
  if (body?.detail) return body.detail;
  return (err as Error)?.message ?? t('Something went wrong.');
}

export default function LegacyYieldPanel({ account }: { account: string }) {
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

  /** The heir's one signature: yield out, as native XRP, to their own account. */
  const claim = useCallback(async () => {
    if (!xrplAddress) return;
    setBusy('claim');
    setError(null);
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
      const { txHash } = await sendXrpl({ tx: h.xrplPayment as never });
      setXrplTx(txHash);
      claimSettle.track(startPending('xrpl-mint', txHash), { onSettled: () => void load() });
    } catch (err) {
      setError(errText(err, t));
    } finally {
      setBusy(null);
    }
  }, [account, xrplAddress, claimAmount, sendXrpl, load, t, claimSettle]);

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
              {t(
                'This Legacy has no payees set, so ALL yield capitalizes back into the principal. To share it out, the council sends the governed order "Set the payees (who receives the yield)" from the Proposals tab.',
              )}
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
            <div className="flex flex-wrap items-end gap-2">
              <label className="grow">
                <MicroLabel>{t('Payment that carries it (XRP)')}</MicroLabel>
                <input
                  value={claimAmount}
                  onChange={(e) => setClaimAmount(e.target.value)}
                  inputMode="decimal"
                  className="mt-1 w-full rounded-lg border border-ink/10 bg-ink/5 px-3 py-2 text-sm outline-none focus:border-ink/25"
                />
              </label>
              <PrimaryButton onClick={() => void claim()} disabled={busy !== null || !xrplAddress}>
                {busy === 'claim' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {t('Claim to my XRPL account')}
              </PrimaryButton>
            </div>
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

          {error && <InlineNotice tone="warning">{error}</InlineNotice>}
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
