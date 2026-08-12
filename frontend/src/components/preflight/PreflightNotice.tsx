'use client';

/**
 * PreflightNotice — the review-step verdict of the prepare's dry-run
 * (invariant #11). Same three postures as the council card:
 *   - would succeed  → quiet confirmation (with how much was verifiable),
 *   - would FAIL     → the reason, loud, BEFORE the wallet ever opens,
 *   - unavailable    → "proceed with care", never a fake green, never a block.
 * Renders nothing when the prepare carries no preflight (older endpoints).
 */

import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import type { PreflightInfo } from '../../lib/preflight';
import { translateError } from '../../lib/errors/translateError';

export function PreflightNotice({ preflight }: { preflight?: PreflightInfo | null }) {
  const { t } = useT();
  if (!preflight) return null;

  if (!preflight.available) {
    return (
      <div className="bg-ink/5 border border-ink/10 rounded-xl p-3 text-xs text-ink/55 flex items-start gap-2">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <span>{t("We couldn't test this operation in advance — double-check the figures before signing.")}</span>
      </div>
    );
  }

  if (!preflight.willSucceed) {
    return (
      <div className="bg-tone-danger/5 border border-tone-danger/30 rounded-xl p-3 text-xs text-tone-danger flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <span>
          <span className="font-medium">{t('We tested this operation without signing it — it would FAIL:')}</span>{' '}
          {/* The chain's reason is a tec-code or revert string — translate it. */}
          {preflight.reason ? translateError(preflight.reason, t).message : t('the simulation reported a failure')}
        </span>
      </div>
    );
  }

  // A merged verdict with a BLIND leg (one side of the hand-off could not be
  // simulated) must not wear the full green: amber, with the blind leg named.
  if (preflight.partial) {
    return (
      <div className="bg-tone-warning/5 border border-tone-warning/25 rounded-xl p-3 text-xs text-tone-warning flex items-start gap-2">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <span>
          <span className="font-medium">{t('Partial dry-run:')}</span>{' '}
          {t('what could be simulated would succeed — one leg could not be checked.')}
          {preflight.reason && <span className="text-ink/50"> {preflight.reason}</span>}
        </span>
      </div>
    );
  }

  const steps = preflight.steps ?? [];
  const verified = steps.filter((s) => s.verdict === 'ok').length;
  const partial = steps.length > 0 && verified < steps.length;
  return (
    <div className="bg-tone-success/5 border border-tone-success/25 rounded-xl p-3 text-xs text-tone-success flex items-start gap-2">
      <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
      <span>
        {t('We tested this operation without signing it — it would succeed')}
        {partial && (
          <span className="text-ink/45">
            {' '}
            ({verified}/{steps.length} {t('steps verifiable before signing')})
          </span>
        )}
        .
      </span>
    </div>
  );
}
