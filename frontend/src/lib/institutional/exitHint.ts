/**
 * exitHint — the short promises VaultEntryModal makes BEFORE a prepare exists:
 * the signing-wallet hint of an exit, and the intro / after-signing line of a
 * claim.
 *
 * Why this exists (reviewer, 14-sep): the exit hint said «one Xaman signature
 * redeems them and sends XRP back to you» while `unmintOnExit` defaults to
 * false — the FXRP stays in the Personal Account; and the claim said «moves the
 * capital to your wallet» with FXRP by default. The unit follows the CURRENT
 * choice, through the same `exitCopyFor` the prepared review already uses, so
 * the hint and the review can never tell two stories.
 *
 * Strings are English sources for `t()`.
 */
import { exitCopyFor } from './exitCopy';

/**
 * The hint under the signing-wallet picker in exit mode.
 *  · Flare wallet: a direct redeem, one signature.
 *  · XRPL (Personal Account), pot with an exit window: the amount is fixed in
 *    FXRP now, the XRP/FXRP choice happens at claim.
 *  · XRPL, immediate exit: XRP only when unmint is selected; otherwise FXRP
 *    into the user's own Flare account.
 */
export function exitHintFor(input: {
  rail: 'flare' | 'xrp';
  unmint: boolean;
  cooldownSeconds: number | null | undefined;
}): string {
  if (input.rail === 'flare') {
    return 'Redeem the shares held by this Flare wallet — one signature here.';
  }
  if ((input.cooldownSeconds ?? 0) > 0) {
    return 'Your shares live in this account’s Smart Account: one Xaman signature starts the exit window and fixes the amount in FXRP. You choose FXRP or XRP when you claim.';
  }
  const copy = exitCopyFor(input.unmint ? 'sync' : 'sync-fxrp');
  return copy.unit === 'XRP'
    ? 'Your shares live in this account’s Smart Account: one Xaman signature redeems them and sends XRP back to you.'
    : 'Your shares live in this account’s Smart Account: one Xaman signature redeems them, and the FXRP stays in your Flare account (your Personal Account) unless you choose XRP below.';
}

/** The claim intro, before the prepare. `viaXrpl` = claimed by the ticket's XRPL owner (Xaman). */
export function claimIntroFor(input: { unmint: boolean; viaXrpl: boolean }): string {
  if (!input.viaXrpl) {
    return 'This exit has matured. Claiming sends the FXRP to the Flare wallet that holds the ticket.';
  }
  return exitCopyFor('claim', input.unmint).unit === 'XRP'
    ? 'This exit has matured. Claiming converts it back to XRP and sends it to the XRPL account that owns the ticket.'
    : 'This exit has matured. Claiming moves it as FXRP into your own Flare account (your Personal Account). Choose XRP below to convert it in the same signature.';
}

/**
 * The line after signing an exit or a claim. With a Xaman handoff, the backend's
 * own `mode`/`unminted` decide (exitCopyFor); without one (EVM rail) the FXRP
 * goes to the signing Flare wallet.
 */
export function exitSentLineFor(input: {
  mode: 'exit' | 'claim';
  handoff: { mode?: string; unminted?: boolean } | null | undefined;
}): string {
  if (input.handoff) {
    return exitCopyFor(input.handoff.mode ?? (input.mode === 'claim' ? 'claim' : undefined), input.handoff.unminted).sent;
  }
  return input.mode === 'claim'
    ? 'Signed. The FXRP is on its way to the Flare wallet that holds the ticket.'
    : 'Signed. If this vault has an exit window, the clock starts now.';
}
