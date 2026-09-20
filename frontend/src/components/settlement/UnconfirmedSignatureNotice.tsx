'use client';

/**
 * UnconfirmedSignatureNotice — the ending that exists so nobody signs twice.
 * Frente `familia-no-pude-leer` (2026-08-20).
 *
 * A signature we could not follow is neither a success nor a failure, and the
 * screen that pretends otherwise is the most expensive screen in the product:
 * after a 0xFE dispatch, a second signature is a second carrier fee in XRP, a
 * second nonce seat and a second movement of real money. The two vault modals
 * grew this panel inline during `settling-final` (2026-08-19); it is the same
 * amber block, the same sentences and the same rule in all of them, so it is
 * one component now — the surfaces that adopt it cannot drift, and the sentence
 * that prevents the double dispatch is reviewed in ONE place.
 *
 * The rules the shape encodes:
 *  - amber, never red: nothing here says the operation failed;
 *  - NO route back to the sign button — the only offer is to close and look;
 *  - the hash when there is one, so "check it yourself" is actionable;
 *  - the wallet's VERBATIM words or none at all (`unconfirmedTrace` already
 *    dropped anything that reads as a retry invitation or as a verdict).
 *
 * The 0xFE nonce seat is deliberately never released from this state either:
 * the dispatch may already have consumed it. Callers keep `abandonable` gated
 * on the review phase, so reaching this panel is enough.
 */

import { AlertTriangle } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { explorerTxUrl } from '../../lib/wallet/inFlightError';
import type { UnconfirmedSignature } from '../../lib/wallet/signOutcome';

export function UnconfirmedSignatureNotice({
  rail,
  chainId,
  xrplKind = 'dispatch',
  unconfirmed,
  onClose,
}: {
  /** Which rail was signed: an XRPL transaction in Xaman or a plain EVM wallet tx. */
  rail: 'xrpl' | 'evm';
  /** Chain of the EVM hash, for the explorer link (Flare when unknown). Ignored on 'xrpl'. */
  chainId?: number;
  /**
   * XRPL only — what went to Xaman. 'dispatch' (default) is the 0xFE order,
   * whose second signature costs a carrier fee and a nonce seat. 'payment' is a
   * plain XRPL Payment: no carrier, no seat, and saying otherwise would send the
   * reader looking for fees that do not exist instead of at the ledger.
   * 'transaction' is any other XRPL transaction the user signs directly (an
   * escrow, a DEX order, a SignerListSet, an anchor): same rule, no fees named.
   */
  xrplKind?: 'dispatch' | 'payment' | 'transaction';
  unconfirmed: UnconfirmedSignature;
  onClose: () => void;
}) {
  const { t } = useT();
  // An XRPL hash lives on the XRP Ledger: linked to Flarescan it reads «not
  // found» on the very screen that says «check the hash before signing again».
  const explorerHref = unconfirmed.txHash
    ? explorerTxUrl(rail === 'xrpl' ? 'xrpl' : (chainId ?? 14), unconfirmed.txHash)
    : null;
  return (
    <div className="bg-amber-500/5 border border-amber-500/25 rounded-xl p-4 space-y-3 text-xs text-amber-200 leading-relaxed">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <p className="text-sm font-medium text-amber-100">
          {t('We could not confirm your signature')}
        </p>
      </div>
      <p>
        {rail === 'xrpl'
          ? xrplKind === 'payment'
            ? t('The payment went to Xaman and we could not confirm how it ended. Do NOT sign it again — it may already be on the ledger. Check the hash and your account history first.')
            : xrplKind === 'transaction'
            ? t('The transaction went to Xaman and we could not confirm how it ended. Do NOT sign it again — it may already be on the ledger. Check the hash and your account history first.')
            : t('The order went to Xaman and we could not read what happened next. Do NOT sign it again: a second dispatch pays a second carrier fee in XRP and takes a second nonce seat. Check your XRPL account and your position first.')
          :/* batch-evm (2026-08-20): this panel is ALSO the ending of a PARTIAL
               execution (`PARTIAL_EXECUTION` → `signOutcome` → 'unconfirmed'),
               and there the receipts of the earlier steps WERE read — they came
               back successful. Claiming «we could not read its receipt» over
               that state is a small lie in the one place that must not lie: it
               tells the reader this is a read failure of ours when the truth is
               that money already moved. The verdict (amber, no way back to the
               sign button) was right; the sentence now covers both halves
               without asserting either. */
            t('The operation was sent to your wallet and we could not confirm how it ended. Do NOT sign it again — it may already be on the chain, in full or in part. Check it on the explorer and reload your position.')}
      </p>
      {explorerHref && (
        <a
          href={explorerHref}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-300 hover:text-sky-200 underline underline-offset-2 block font-mono"
        >
          {t('Check it on the explorer →')}
        </a>
      )}
      {/* The wallet's OWN words, verbatim and clipped, or nothing. A translated
          verdict here ("nothing moved — try again in a minute", which is what a
          timeout translates to) told the reader the opposite of the paragraph
          above and sent them to sign a second time.

          batch-evm (2026-08-20): the label lied about the SOURCE. On a partial
          execution the trace is OUR OWN diagnostic — `partialExecutionError`'s
          "Step 2 of 2 did not complete. 1 earlier step is already on the
          chain…" — deliberately written so no wallet wording survives into it.
          Attributing our sentence to the wallet invites "well, the wallet is
          wrong, let me try again". The label now claims only what it can. */}
      {unconfirmed.trace && (
        <p className="text-[11px] text-ink/45">
          {t('What we know so far:')}{' '}
          <span className="font-mono break-all">{unconfirmed.trace}</span>
        </p>
      )}
      <button
        onClick={onClose}
        className="w-full border border-ink/10 bg-ink/5 text-ink/70 text-sm py-2.5 rounded-xl hover:bg-ink/10 transition-colors"
      >
        {t('Close and refresh my positions')}
      </button>
    </div>
  );
}
