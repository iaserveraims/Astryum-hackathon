'use client';

/**
 * StrategyPath — the interactive path that opens the catalogue (founder
 * 2026-08-22: "quiero que sea interactivo y se muestre de primeras, no que
 * tenga que darle el usuario a Guide me").
 *
 * It is NOT a wizard that ends and then reveals a result: it is a FILTER
 * wearing the face of a path. Every card you pick narrows the catalogue
 * underneath live, in front of you, and the chips below write this same
 * state — one vocabulary (lib/earn/strategyTaxonomy), one list, never two
 * copies of the same information.
 *
 * Order of the questions (founder decision): OUTCOME first — six of the eight
 * routes are FXRP, so asking for the token first barely narrows anything, and
 * "what do you want to happen" can be asked without DeFi jargon. The mechanism
 * (lend · borrow · stake · vault) rides along as the subtitle, so the word is
 * learnt instead of demanded.
 *
 * Never ranks and never recommends (invariant #9): the copy states what each
 * route does and what it risks. Counts are facts about the catalogue.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { Coins, HandCoins, Radio, Sprout, X } from 'lucide-react';
import { TokenLogo } from '@/components/ui/TokenLogo';
import { EASE_OUT } from '@/components/ui/motion';
import {
  ASSET_GROUPS,
  OUTCOMES,
  type AssetGroupId,
  type OutcomeId,
} from '@/lib/earn/strategyTaxonomy';
import type { VaultKind } from './FlareDemoEarn';

const OUTCOME_ICON: Record<OutcomeId, typeof Sprout> = {
  earn: Sprout,
  liquidity: HandCoins,
  network: Radio,
};

export function StrategyPath({
  catalogue,
  outcome,
  asset,
  matchCount,
  onOutcome,
  onAsset,
  onReset,
  t,
}: {
  /** The kinds the catalogue actually offers right now (flags included). */
  catalogue: VaultKind[];
  outcome: OutcomeId | null;
  asset: AssetGroupId | null;
  /** How many routes survive the current choices — shown, never inflated. */
  matchCount: number;
  onOutcome: (o: OutcomeId | null) => void;
  onAsset: (a: AssetGroupId | null) => void;
  onReset: () => void;
  t: (s: string) => string;
}) {
  const inCatalogue = (kinds: VaultKind[]) => kinds.filter((k) => catalogue.includes(k));

  const outcomes = OUTCOMES.map((o) => ({ ...o, live: inCatalogue(o.kinds) })).filter(
    (o) => o.live.length > 0,
  );

  // The asset step only offers what survives the chosen outcome — a dead end
  // must never be offered as a choice.
  const outcomeKinds = outcome ? (outcomes.find((o) => o.id === outcome)?.live ?? []) : catalogue;
  const assets = ASSET_GROUPS.map((g) => ({
    ...g,
    live: g.kinds.filter((k) => outcomeKinds.includes(k)),
  })).filter((g) => g.live.length > 0);

  const chosen = outcome !== null || asset !== null;

  return (
    <div className="rounded-2xl border border-ink/[0.08] bg-ink/[0.02] px-4 py-4 sm:px-5">
      {/* Step 1 — what do you want to happen */}
      <div className="flex items-baseline gap-2 mb-3">
        <span className="grid place-items-center w-4 h-4 rounded-full border border-volt/30 bg-volt/[0.08] text-volt font-mono text-[9px]">
          1
        </span>
        <p className="text-[13px] font-semibold text-ink">{t('What do you want to happen?')}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {outcomes.map((o) => {
          const Icon = OUTCOME_ICON[o.id];
          const active = outcome === o.id;
          return (
            <button
              key={o.id}
              onClick={() => onOutcome(active ? null : o.id)}
              aria-pressed={active}
              className={`text-left rounded-xl border px-3.5 py-3 transition-colors ${
                active
                  ? 'border-volt/45 bg-volt/[0.08]'
                  : 'border-ink/10 bg-ink/[0.03] hover:border-ink/20 hover:bg-ink/[0.05]'
              }`}
            >
              <span className="flex items-center gap-2">
                <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-volt' : 'text-ink/45'}`} strokeWidth={1.75} />
                <span className={`text-[13px] font-medium ${active ? 'text-ink' : 'text-ink/85'}`}>
                  {t(o.title)}
                </span>
                <span className="ml-auto font-mono text-[10px] text-ink/30 tabular-nums">{o.live.length}</span>
              </span>
              <span className="mt-1 block text-[11px] leading-snug text-ink/45">{t(o.sub)}</span>
            </button>
          );
        })}
      </div>

      {/* Step 2 — with what. Slides in once the first question is answered;
          by then the asset is nearly decided, which is why it comes second. */}
      <AnimatePresence initial={false}>
        {outcome && assets.length > 0 && (
          <motion.div
            key="assets"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: EASE_OUT }}
            className="overflow-hidden"
          >
            <div className="pt-4">
              <div className="flex items-baseline gap-2 mb-3">
                <span className="grid place-items-center w-4 h-4 rounded-full border border-volt/30 bg-volt/[0.08] text-volt font-mono text-[9px]">
                  2
                </span>
                <p className="text-[13px] font-semibold text-ink">{t('With what?')}</p>
                {assets.length === 1 && (
                  <span className="text-[11px] text-ink/40">{t('— only one asset reaches this outcome')}</span>
                )}
              </div>
              <div className="flex flex-wrap gap-2.5">
                {assets.map((g) => {
                  const active = asset === g.id;
                  return (
                    <button
                      key={g.id}
                      onClick={() => onAsset(active ? null : g.id)}
                      aria-pressed={active}
                      className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
                        active
                          ? 'border-volt/45 bg-volt/[0.08]'
                          : 'border-ink/10 bg-ink/[0.03] hover:border-ink/20 hover:bg-ink/[0.05]'
                      }`}
                    >
                      <TokenLogo symbol={g.symbol} size="sm" />
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium text-ink/85">{t(g.title)}</span>
                        <span className="block text-[10px] text-ink/45 leading-snug">{t(g.sub)}</span>
                      </span>
                      <span className="ml-1 font-mono text-[10px] text-ink/30 tabular-nums">{g.live.length}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* The state of the filter, said out loud — and the way out of it. */}
      {chosen && (
        <div className="mt-4 pt-3 border-t border-ink/[0.06] flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <p className="text-[12px] text-ink/60">
            {matchCount === 1
              ? t('1 route matches — its live data and risks are on the card below.')
              : `${matchCount} ${t('routes match — their live data and risks are on the cards below.')}`}
          </p>
          <button
            onClick={onReset}
            className="ml-auto inline-flex items-center gap-1 text-[11px] text-ink/45 hover:text-ink transition-colors"
          >
            <X className="w-3 h-3" /> {t('Clear and see all')}
          </button>
        </div>
      )}
      {!chosen && (
        <p className="mt-3 text-[11px] text-ink/35 flex items-center gap-1.5">
          <Coins className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
          {t('Pick one to narrow the list below — or scroll and read them all. Nothing here is a recommendation.')}
        </p>
      )}
    </div>
  );
}

export default StrategyPath;
