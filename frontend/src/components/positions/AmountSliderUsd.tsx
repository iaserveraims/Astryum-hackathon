'use client';

/**
 * AmountSliderUsd — the two 2026-07-30 founder asks under a withdraw amount
 * input: the quantity as a draggable 0→balance slider (typing stays possible,
 * never required) and the small live dollar value of the typed amount
 * ("≈ $x · FTSO"). Pure presentation — the parent owns the amount state and
 * decides what "at max" means on its rail (exact-shares exit, maxBase…).
 */

export function AmountSliderUsd({
  max,
  amount,
  onAmount,
  usdPrice,
}: {
  /** Upper bound of the slider (the live balance). ≤0 hides the slider. */
  max: number;
  amount: string;
  /** (value, atMax) — atMax=true when the drag reached the exact balance. */
  onAmount: (value: string, atMax: boolean) => void;
  /** USD unit price (FTSO) — null hides the ≈ $ line, never invents one. */
  usdPrice: number | null;
}) {
  const n = parseFloat(amount) || 0;
  return (
    <>
      {max > 0 && (
        <input
          type="range"
          min={0}
          max={max}
          step={max / 1000}
          value={Math.min(n, max)}
          onChange={(e) => {
            const v = Number(e.target.value);
            const atMax = v >= max - max / 2000;
            onAmount(atMax ? String(max) : String(Number(v.toFixed(6))), atMax);
          }}
          className="w-full accent-volt mt-2"
        />
      )}
      {usdPrice != null && n > 0 && (
        <p className="text-[10px] text-ink/40 mt-1">
          ≈ ${(n * usdPrice).toLocaleString(undefined, { maximumFractionDigits: 2 })}{' '}
          <span className="text-ink/25">· FTSO</span>
        </p>
      )}
    </>
  );
}
