/**
 * RedemptionFeeNotice — the one block every unmint/redeem surface renders right
 * before its signing button: the FAssets redemption fee (figure, or «could not be
 * read — it is not zero»), optionally the net amount, and when the XRP arrives.
 *
 * `t` is passed in (like DispatchXrpField) so the block renders without context.
 */

import { fillFeeText } from '../wallet/paDispatchDisclosure';
import { redemptionFeeRows, type FeeText } from './redemptionFeeRow';

export function RedemptionFeeNotice({
  response,
  grossFxrp,
  t,
  showAmount = false,
  amountLabel = 'The XRP destination receives',
  className = '',
}: {
  /** The whole prepare response (figures are read from `disclosure` or the top level). */
  response: unknown;
  /** FXRP this signature redeems (before the fee); null when the surface cannot say. */
  grossFxrp: number | null;
  t: (s: string) => string;
  /** Render the amount line too — for surfaces with no amount row of their own. */
  showAmount?: boolean;
  amountLabel?: string;
  className?: string;
}) {
  const rows = redemptionFeeRows(response, grossFxrp);
  const say = (f: FeeText) => fillFeeText(t(f.text), f.params);
  const unreadable = rows.kind === 'unreadable';
  return (
    <div
      data-redemption-fee={rows.kind}
      className={`space-y-1 rounded-lg border p-2.5 text-[11px] leading-relaxed ${
        unreadable ? 'border-amber-500/30 bg-amber-500/[0.06] text-tone-warning' : 'border-ink/10 bg-ink/[0.02] text-ink/70'
      } ${className}`}
    >
      <p>{say(rows.fee)}</p>
      {showAmount && rows.amount ? (
        <p>
          {t(amountLabel)}: <span className="font-mono">{say(rows.amount)}</span>
        </p>
      ) : null}
      <p className="text-ink/50">{say(rows.arrival)}</p>
    </div>
  );
}
