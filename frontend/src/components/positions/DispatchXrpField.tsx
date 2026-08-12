'use client';

/**
 * DispatchXrpField (F12) — every 0xFE order rides an XRPL Payment ("dispatch").
 * The old UI put an editable input in the MAIN flow of three different modals,
 * each behind a 60-word protocol paragraph the user had to read to learn the
 * number was fine as it was. The default (1 XRP) is right for every normal
 * case, so the main flow now states the fact in one line and the knob lives
 * folded under "advanced". The exact fee figures still come from the prepared
 * disclosure before signing (invariant #6) — this field never claims them.
 */
export function DispatchXrpField({
  value,
  onChange,
  t,
}: {
  value: string;
  onChange: (v: string) => void;
  t: (s: string) => string;
}) {
  return (
    <div className="bg-ink/5 border border-ink/10 rounded-xl p-3 text-xs space-y-2">
      <p className="text-ink/60 leading-relaxed">
        {t('This account is steered from your XRPL wallet, so every order travels on a small XRP payment — that payment IS your signature.')}{' '}
        (<span className="font-mono text-ink/85">{value || '1'} XRP</span>){' '}
        {t('It is not lost: it comes back to you as FXRP. Net cost ≈ 0.3 XRP — exact figures before signing. Nothing goes to Astryum.')}
      </p>
      <details>
        <summary className="cursor-pointer text-[11px] text-ink/40 hover:text-ink/60">
          {t('Adjust the carrier payment (advanced)')}
        </summary>
        <div className="mt-2 space-y-1.5">
          <input
            type="number"
            min="0"
            step="any"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full px-3.5 py-2.5 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm focus:outline-none focus:border-volt/50"
          />
          <p className="text-[10px] text-ink/35 leading-relaxed">
            {t("NOT a fee and NOT the amount of your operation: the order must ride an XRPL Payment to the FAssets Core Vault (Xaman will show it). It returns to your account as FXRP minus the protocol's fees — minting max(0.1%, 0.1 XRP) + 0.2 XRP for the executor.")}
          </p>
        </div>
      </details>
    </div>
  );
}

export default DispatchXrpField;
