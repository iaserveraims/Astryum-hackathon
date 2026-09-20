'use client';

/**
 * PoliciesCatalog — F1: choose a policy WITH its exit speed in the same
 * glance. The commitment is shown at decision time, not discovered when the
 * client wants their money («tú decides qué puede hacer tu dinero; el
 * operador trabaja dentro de eso»). Live numbers come from the chain via
 * pote-state; a policy without a deployed pote never paints a door.
 */

import { useEffect, useState } from 'react';
import { Clock, Zap } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { getPoteState, type PoteState } from '../../lib/institutional/api';
import { fmtBase, type PolicyCard } from '../../lib/institutional/policyCatalog';
import { useCatalogPolicies } from '../../lib/institutional/useCatalogPolicies';
import { PoteDepositModal } from './PoteDepositModal';
import { PoteExitModal } from './PoteExitModal';

function PolicyCardView({
  policy,
  onDeposit,
  onExit,
}: {
  policy: PolicyCard;
  onDeposit: () => void;
  onExit: () => void;
}) {
  const { t } = useT();
  const [state, setState] = useState<PoteState | null>(null);
  const [readFailed, setReadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getPoteState(policy.poteAddress);
        if (!cancelled) setState(s);
      } catch {
        if (!cancelled) setReadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [policy.poteAddress]);

  return (
    <div className="rounded-2xl border border-ink/10 bg-surface-1 p-5 space-y-3 flex flex-col">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">{t(policy.title)}</h3>
        <span className="inline-flex items-center gap-1 rounded-full border border-volt/40 text-volt text-xs px-2 py-0.5">
          {policy.exitSeconds === 0 ? <Zap className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
          {t(policy.exitLine)}
        </span>
      </div>
      <p className="text-xs text-ink/60">{t(policy.strategyLine)}</p>

      {state ? (
        <div className="text-xs text-ink/70">
          {t('In the pote')}: <span className="font-mono">{fmtBase(state.totalAssets, state.asset.decimals)} {state.asset.symbol}</span>
          {' · '}
          {t('operator cut (public)')}: <span className="font-mono">{state.governance.payees.reduce((s, p) => s + p.bps, 0) / 100}%</span>
        </div>
      ) : readFailed ? (
        <p className="text-xs text-ink/50">{t('Live figures unavailable right now — the chain, not this page, is the truth.')}</p>
      ) : (
        <p className="text-xs text-ink/40">{t('Reading the pote…')}</p>
      )}

      <div className="mt-auto flex gap-2 pt-2">
        <button onClick={onDeposit} className="flex-1 rounded-lg bg-volt text-black text-xs font-semibold py-2">
          {t('Deposit')}
        </button>
        <button onClick={onExit} className="flex-1 rounded-lg bg-surface-2 border border-ink/10 text-xs font-semibold py-2 text-ink">
          {t('Exit')}
        </button>
      </div>
    </div>
  );
}

export function PoliciesCatalog() {
  const { t } = useT();
  const { policies, loading, failed } = useCatalogPolicies();
  const [modal, setModal] = useState<{ kind: 'deposit' | 'exit'; policy: PolicyCard } | null>(null);
  const [, bumpReload] = useState(0);

  if (policies.length === 0) {
    return (
      <p className="text-xs text-ink/50">
        {loading
          ? t('Reading the catalogue from the chain…')
          : failed
            ? t('The catalogue could not be read right now. That is not the same as there being none — try again in a moment.')
            : t('No policy potes are deployed on this environment yet.')}
      </p>
    );
  }

  return (
    <>
      {failed ? (
        <p className="text-[11px] text-tone-warning/80">
          {t('The catalogue could not be read right now — showing the fixed demo potes instead.')}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {policies.map((p) => (
          <PolicyCardView
            key={p.key}
            policy={p}
            onDeposit={() => setModal({ kind: 'deposit', policy: p })}
            onExit={() => setModal({ kind: 'exit', policy: p })}
          />
        ))}
      </div>
      {modal?.kind === 'deposit' ? (
        <PoteDepositModal
          policy={modal.policy}
          onClose={() => setModal(null)}
          onChanged={() => bumpReload((n) => n + 1)}
        />
      ) : null}
      {modal?.kind === 'exit' ? (
        <PoteExitModal
          policy={modal.policy}
          onClose={() => setModal(null)}
          onChanged={() => bumpReload((n) => n + 1)}
        />
      ) : null}
    </>
  );
}
