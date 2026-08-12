'use client';

/**
 * StrategyFinder — the guided way into "Choose a Strategy" (founder
 * 2026-08-08: six detailed cards at once read as noise for a first-timer;
 * founder 2026-08-12: the wizard should EXPLAIN, not just filter). Two
 * questions — what you hold, how it should work — then a RESULT step that
 * teaches each matching route before landing on the cards: the plain
 * sentence, the live protocol rate with its source, and the risk fact.
 * FACTUAL matching only, never advice: the copy filters ("fits what you
 * told us"), it does not recommend (invariant #9).
 *
 * Same wizard grammar as FirstWalletGuide: pill progress, back chevron,
 * one decision per screen, ModalOverlay shell. Vault data and the live
 * yield chip arrive as PROPS from FlareDemoEarn (no runtime import cycle).
 */

import { useState } from 'react';
import { ArrowRight, ChevronLeft, Coins, Flame, HandCoins, Layers, Scale, Sparkles } from 'lucide-react';
import { ModalOverlay } from '@/components/ui/ModalPortal';
import { Pill } from '@/components/ui/primitives';
import { TokenLogo } from '@/components/ui/TokenLogo';
import { useT } from '@/i18n/LanguageProvider';
import type { VaultKind } from './FlareDemoEarn';

type Step = 'asset' | 'style' | 'result';

/** The slice of DemoVault the result step teaches from — structural on
 *  purpose: FlareDemoEarn passes DEMO_VAULTS and stays the single source. */
export interface FinderVault {
  kind: VaultKind;
  asset: string;
  title: string;
  action: string;
  plain: string;
  facts: { label: string; value: string; tone?: 'amber' | 'emerald' }[];
}

/** The factual map answers→kinds. Data straight from each vault's own card:
 *  asset it moves and mechanism it uses — nothing subjective in here. */
const XRP_STYLES: Array<{
  icon: typeof HandCoins;
  title: string;
  desc: string;
  kinds: VaultKind[];
}> = [
  {
    icon: HandCoins,
    title: 'Lend it out — simple',
    desc: 'Supply FXRP to a lending market and withdraw whenever you want. No borrowing involved.',
    kinds: ['e3'],
  },
  {
    icon: Scale,
    title: 'Lend and borrow against it (carry)',
    desc: 'Supply FXRP and borrow a stablecoin against it. More moving parts — it carries liquidation risk.',
    kinds: ['e1'],
  },
  {
    icon: Layers,
    title: 'Deposit into a managed vault',
    desc: 'A vault whose strategy is run by its manager (Clearstar, Monarq). You deposit and hold the vault token.',
    kinds: ['v-earnxrp', 'v-monarq'],
  },
  {
    icon: Flame,
    title: 'Stake it',
    desc: 'Convert to stXRP through Firelight and hold the staked position.',
    kinds: ['v-firelight'],
  },
];

export function StrategyFinder({
  vaults,
  yieldChip,
  onClose,
  onResult,
}: {
  /** The live catalogue (DEMO_VAULTS) — the single source of what each route is. */
  vaults: FinderVault[];
  /** Renders the route's live protocol rate chip (LiveYieldChip, invariant #9). */
  yieldChip: (kind: VaultKind) => React.ReactNode;
  onClose: () => void;
  /** null = the user chose to browse everything (no filter). */
  onResult: (kinds: VaultKind[] | null) => void;
}) {
  const { t } = useT();
  const [step, setStep] = useState<Step>('asset');
  // What the result step explains: the matched kinds plus the answers that
  // produced them (shown back to the user so the filter is never a mystery).
  const [picked, setPicked] = useState<{ kinds: VaultKind[]; answers: string[] } | null>(null);

  const showResult = (kinds: VaultKind[], answers: string[]) => {
    setPicked({ kinds, answers });
    setStep('result');
  };

  const apply = () => {
    if (picked) onResult(picked.kinds);
    onClose();
  };

  const back = () => {
    if (step === 'result') {
      // The FLR answer skips the style question — back mirrors the way in.
      setStep(picked?.kinds.length === 1 && picked.kinds[0] === 'e2' ? 'asset' : 'style');
      setPicked(null);
    } else {
      setStep('asset');
    }
  };

  const stepIndex = step === 'asset' ? 0 : step === 'style' ? 1 : 2;
  const matched = picked ? vaults.filter((v) => picked.kinds.includes(v.kind)) : [];

  return (
    <ModalOverlay className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-surface-1 border border-ink/10 rounded-2xl w-full max-w-md my-auto shadow-2xl overflow-hidden flex flex-col max-h-[calc(100dvh-2rem)]">
        <div className="flex items-start justify-between px-6 py-5 border-b border-ink/5 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {step !== 'asset' && (
              <button
                onClick={back}
                aria-label={t('Back')}
                className="grid place-items-center w-7 h-7 rounded-full border border-ink/10 text-ink/50 hover:text-ink hover:bg-ink/[0.05] transition-colors shrink-0"
              >
                <ChevronLeft className="w-4 h-4" strokeWidth={2} />
              </button>
            )}
            <h2 className="text-base font-semibold text-ink truncate">{t('Find your route')}</h2>
          </div>
          <button onClick={onClose} className="text-ink/40 hover:text-ink transition-colors" aria-label={t('Close')}>
            <span className="text-lg leading-none">×</span>
          </button>
        </div>

        <div className="px-6 py-5 overflow-y-auto">
          <div className="flex items-center gap-2 mb-4" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === stepIndex ? 'w-6 bg-volt' : i < stepIndex ? 'w-1.5 bg-volt/50' : 'w-1.5 bg-ink/15'
                }`}
              />
            ))}
            <span className="ml-auto text-[11px] text-ink/40 tabular-nums">{stepIndex + 1} / 3</span>
          </div>

          {step === 'asset' ? (
            <div className="space-y-4">
              <Pill tone="info">{t('A filter, not advice — every route shows its own live data')}</Pill>
              <p className="text-sm text-ink/60 leading-relaxed">
                {t('Two questions narrow the six routes to the ones that can work with what you hold. You can always browse the full list.')}
              </p>
              <p className="text-[13px] font-semibold text-ink">{t('What do you want to put to work?')}</p>

              <button
                onClick={() => setStep('style')}
                className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-xl border border-sky-400/30 bg-sky-400/10 text-left hover:bg-sky-400/20 transition-colors"
              >
                <span className="grid place-items-center w-9 h-9 rounded-xl bg-surface-0/60 border border-ink/10 shrink-0">
                  <TokenLogo symbol="XRP" size="sm" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">XRP</span>
                  <span className="block text-xs text-ink/50 mt-0.5">
                    {t('In a Xaman/XRPL wallet, or already as FXRP on Flare')}
                  </span>
                </span>
              </button>

              <button
                onClick={() => showResult(['e2'], ['FLR'])}
                className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-xl border border-volt/30 bg-volt/10 text-left hover:bg-volt/20 transition-colors"
              >
                <span className="grid place-items-center w-9 h-9 rounded-xl bg-surface-0/60 border border-ink/10 shrink-0">
                  <TokenLogo symbol="FLR" size="sm" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">FLR</span>
                  <span className="block text-xs text-ink/50 mt-0.5">
                    {t('The Flare network token, in an EVM wallet — FTSO delegation')}
                  </span>
                </span>
              </button>

              <button
                onClick={() => {
                  onResult(null);
                  onClose();
                }}
                className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-xl border border-ink/10 bg-ink/[0.03] text-left hover:bg-ink/[0.06] transition-colors"
              >
                <span className="grid place-items-center w-9 h-9 rounded-xl bg-surface-0/60 border border-ink/10 shrink-0 text-ink/50">
                  <Sparkles className="w-[18px] h-[18px]" strokeWidth={1.75} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">{t('Just browsing')}</span>
                  <span className="block text-xs text-ink/50 mt-0.5">{t('Show me all six routes')}</span>
                </span>
              </button>
            </div>
          ) : step === 'style' ? (
            <div className="space-y-4">
              <p className="text-[13px] font-semibold text-ink">{t('How should your XRP work?')}</p>
              {XRP_STYLES.map((s) => (
                <button
                  key={s.title}
                  onClick={() => showResult(s.kinds, ['XRP', t(s.title)])}
                  className="w-full flex items-start gap-3.5 px-4 py-3.5 rounded-xl border border-ink/10 bg-ink/[0.03] text-left hover:border-volt/30 hover:bg-volt/[0.06] transition-colors"
                >
                  <span className="grid place-items-center w-9 h-9 rounded-xl bg-volt/10 border border-volt/20 text-volt shrink-0">
                    <s.icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="text-sm font-medium text-ink">{t(s.title)}</span>
                      <span className="ml-auto shrink-0 font-mono text-[10px] text-ink/35 tabular-nums">
                        {s.kinds.length} {s.kinds.length === 1 ? t('route') : t('routes')}
                      </span>
                    </span>
                    <span className="block text-xs text-ink/50 mt-0.5 leading-relaxed">{t(s.desc)}</span>
                  </span>
                </button>
              ))}
              <p className="text-[11px] text-ink/40 flex items-start gap-1.5">
                <Coins className="w-3.5 h-3.5 mt-px shrink-0" strokeWidth={1.75} />
                {t('Whatever you pick here only filters the list — each route still shows its live rate, risks and full composition before you decide anything.')}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* The answers, said back — the filter is never a mystery. */}
              <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-ink/45">
                <span>{t('Your answers')}:</span>
                {picked?.answers.map((a) => (
                  <span key={a} className="rounded-full border border-ink/10 bg-ink/[0.04] px-2 py-0.5 font-medium text-ink/65">
                    {a}
                  </span>
                ))}
              </div>
              <p className="text-[13px] font-semibold text-ink">
                {matched.length === 1
                  ? t('This route can work with that:')
                  : t('These routes can work with that:')}
              </p>

              {matched.map((v) => {
                const risk = v.facts.find((f) => f.label === 'Risk');
                return (
                  <div key={v.kind} className="rounded-xl border border-ink/10 bg-ink/[0.02] px-4 py-3.5 space-y-2.5">
                    <div className="flex items-center gap-2.5">
                      <TokenLogo symbol={v.asset} size="sm" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink truncate">{v.title}</p>
                        <p className="text-[11px] text-ink/45">{t(v.action)}</p>
                      </div>
                    </div>
                    <p className="text-xs text-ink/60 leading-relaxed">{t(v.plain)}</p>
                    <div className="flex items-center gap-2 flex-wrap">{yieldChip(v.kind)}</div>
                    {risk && (
                      <p className="text-[11px] text-ink/45">
                        {t('Risk')}:{' '}
                        <span className={risk.tone === 'amber' ? 'text-tone-warning' : 'text-ink/65'}>
                          {t(risk.value)}
                        </span>
                      </p>
                    )}
                  </div>
                );
              })}

              <p className="text-[11px] text-ink/40">
                {t('A factual match, not a recommendation: the full card adds the token journey, every fact and the technical composition — nothing starts without your review and your signature.')}
              </p>
            </div>
          )}
        </div>

        {step === 'result' && (
          <div className="px-6 py-4 border-t border-ink/5 shrink-0">
            <button
              onClick={apply}
              className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-volt text-volt-ink text-sm font-semibold hover:brightness-105 transition-all"
            >
              {matched.length === 1 ? t('See this route in detail') : t('See these routes in detail')}
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </ModalOverlay>
  );
}
