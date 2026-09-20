'use client';

/**
 * ExitRiskWarnings — the token scanner's DANGER verdict, in the review step of
 * an exit, ABOVE the sign button.
 *
 * The exit is never gated: the backend composes the exit even when GoPlus flags
 * FXRP or RLUSD, and sends the verdict as `riskWarnings`. This box is what makes
 * that honest — the user can still sign, but only with the flags in front of
 * them (invariants #6/#10: risk visible before signing). Renders nothing when
 * there is nothing flagged.
 */
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { riskWarningViews, type ExitRiskWarning } from '../../lib/earn/exitRiskWarnings';

export function ExitRiskWarnings({ warnings }: { warnings: ExitRiskWarning[] }) {
  const { t } = useT();
  if (warnings.length === 0) return null;
  const views = riskWarningViews(warnings);
  return (
    <div role="alert" className="rounded-xl border border-tone-danger/40 bg-tone-danger/[0.07] p-3.5 space-y-2.5">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-tone-danger" />
        <div className="space-y-1">
          <p className="text-xs font-medium text-ink/90">
            {t('The token scanner flags a token in this exit as dangerous.')}
          </p>
          <p className="text-[11px] text-ink/60 leading-relaxed">
            {t('Taking your own capital out is not blocked — read the flags below before you sign.')}
          </p>
        </div>
      </div>
      <ul className="space-y-2">
        {views.map((v) => (
          <li key={v.key} className="rounded-lg border border-tone-danger/20 bg-surface-1/40 px-3 py-2 text-[11px] space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-tone-danger">{v.token}</span>
              {v.addressShort && v.explorerUrl && (
                <a
                  href={v.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-ink/45 hover:text-ink/70"
                >
                  {v.addressShort} <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            <p className="text-ink/75">
              <span className="text-ink/45">{t('Flags')}:</span>{' '}
              {v.flagsText ?? t('flagged as dangerous — the scanner did not list a reason')}
            </p>
            {v.note && <p className="text-ink/55 leading-relaxed">{v.note}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default ExitRiskWarnings;
