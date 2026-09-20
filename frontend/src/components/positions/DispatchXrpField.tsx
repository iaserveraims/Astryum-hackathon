'use client';

/**
 * DispatchXrpField — every 0xFE order rides an XRPL Payment ("carrier").
 *
 * V2: the knob is GONE. The carrier is a protocol
 * necessity with a knowable minimum, so the app now sets it automatically
 * from live fees (lib/flare/carrier.ts — fees + margin, floored at 0.35,
 * so a fee move can never block the operation) and this component only
 * STATES the fact in one calm line, with the details folded. The exact
 * figures still ride the prepared disclosure before signing (invariant #6).
 */
export function DispatchXrpField({
  xrp,
  t,
}: {
  /** The live auto carrier (useCarrierXrp) shown to the user. */
  xrp: number;
  t: (s: string) => string;
}) {
  return (
    <div className="bg-ink/5 border border-ink/10 rounded-xl p-3 text-xs space-y-2">
      <p className="text-ink/60 leading-relaxed">
        {t('This account is steered from your XRPL wallet, so every order travels on a small XRP payment — that payment IS your signature.')}{' '}
        (<span className="font-mono text-ink/85">≈ {xrp} XRP</span>, {t('set automatically')}){' '}
        {t('It is not lost: it comes back to you as FXRP. Exact figures before signing. Nothing goes to Astryum.')}
      </p>
      <details>
        <summary className="cursor-pointer text-[11px] text-ink/40 hover:text-ink/60">
          {t('How this figure is set')}
        </summary>
        <p className="mt-2 text-[10px] text-ink/35 leading-relaxed">
          {t("NOT a fee and NOT the amount of your operation: the order must ride an XRPL Payment to the FAssets Core Vault (Xaman will show it). The app reads the protocol's live fees — minting max(0.1%, 0.1 XRP) + 0.2 XRP for the executor — and adds a small margin so the order can never fail for lack of carrier. The margin returns to your account as FXRP.")}
        </p>
      </details>
    </div>
  );
}

export default DispatchXrpField;
