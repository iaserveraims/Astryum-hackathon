'use client';

/**
 * TourPanel — el TOUR GUIADO de Operar.
 *
 * Una tarjeta pegada al lado del contenido que cuenta el paso actual del
 * guion: qué se hace, quién firma, qué hay que tener listo (con comprobaciones
 * VIVAS donde se puede: qué Xaman está conectada, si hay pote…), y un botón
 * que te LLEVA a la pestaña y estación donde ocurre. «Hecho» lo dice el
 * guion leyendo la cadena; el tour nunca marca nada por su cuenta.
 *
 * La explicación entera de cada paso vive detrás del «?» (un modal), no en la
 * tarjeta: la tarjeta orienta, el modal enseña. Salir del tour = vía libre.
 */

import { useState } from 'react';
import { ArrowRight, BookOpen, Check, ChevronLeft, ChevronRight, Circle, CircleDot, MapPin, X } from 'lucide-react';
import { Card, GhostButton, MicroLabel, PrimaryButton } from '../../ui/primitives';
import { ModalOverlay } from '../../ui/ModalPortal';
import { useT } from '../../../i18n/LanguageProvider';
import { useXrplWalletPartner } from '../../../lib/wallet/useXrplWalletPartner';
import { useWalletPartner } from '../../../lib/wallet/useWalletPartner';
import type { DemoRun } from '../../../lib/demo-exchange/api';
import type { ChainFacts } from '../../../lib/demo-exchange/useDemoRun';
import type { ReadyCheck, ScriptStep, StageTab } from './useExchangeScript';

const SIDE_TONE: Record<ScriptStep['side'], string> = {
  exchange: 'var(--authority, #A76A15)',
  user: 'var(--muscle, #1F6F70)',
  cage: 'hsl(var(--volt))',
  proof: 'currentColor',
};

export function TourPanel({
  steps,
  index,
  onIndex,
  run,
  chain,
  tab,
  station,
  onGo,
  onExit,
}: {
  steps: ScriptStep[];
  index: number;
  onIndex: (i: number) => void;
  run: DemoRun | null;
  chain: ChainFacts | null;
  /** Dónde está el usuario ahora mismo — para saber si el paso está a la vista. */
  tab: StageTab;
  station: string | null;
  onGo: (step: ScriptStep) => void;
  onExit: () => void;
}) {
  const { t } = useT();
  const xrpl = useXrplWalletPartner();
  const evm = useWalletPartner();
  const [learn, setLearn] = useState(false);

  const step = steps[index];
  if (!step) return null;
  const done = step.done(run, chain);
  const here = tab === step.tab && (!step.station || station === null || station === step.station || step.tab !== 'exchange');
  const sideLabel = step.side === 'exchange' ? t('Exchange') : step.side === 'user' ? t('User') : step.side === 'cage' ? t('Cage') : t('Proof');
  const doneCount = steps.filter((s) => s.done(run, chain)).length;
  const nextPending = steps.findIndex((s, i) => i > index && !s.done(run, chain));

  /** Las comprobaciones vivas — undefined = no se puede saber desde aquí. */
  const live = (check?: ReadyCheck): boolean | undefined => {
    switch (check) {
      case 'run': return Boolean(run);
      case 'xaman-council': return Boolean(run && xrpl.address && xrpl.address === run.councilAddress);
      case 'xaman-omnibus': return Boolean(run && xrpl.address && xrpl.address === run.omnibusAddress);
      case 'evm': return Boolean(evm.isConnected);
      case 'pote': return Boolean(run?.poteAddress);
      case 'clients': return (run?.clients.length ?? 0) > 0;
      case 'client-account': return Boolean(run?.clients.some((c) => c.passkeyAccount));
      case 'registry': return Boolean(run?.registryAddress);
      case 'anchored': return Boolean(chain?.council.didAnchored);
      default: return undefined;
    }
  };

  return (
    <Card className="p-0">
      {/* La pista: un segmento por paso, el actual encendido. */}
      <div className="flex items-center gap-1 px-5 pt-4">
        {steps.map((s, i) => {
          const d = s.done(run, chain);
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onIndex(i)}
              title={s.title}
              aria-label={`${i + 1}/${steps.length} · ${s.title}${d ? ` · ${t('done')}` : ''}`}
              aria-current={i === index ? 'step' : undefined}
              className="group flex h-4 flex-1 items-center"
            >
              <span className={`block h-1 w-full rounded-full transition-all group-hover:h-2 ${i === index ? 'bg-volt shadow-[0_0_0_3px_hsl(var(--volt)/0.14)]' : d ? 'bg-tone-success/70' : 'bg-ink/10'}`} />
            </button>
          );
        })}
      </div>

      <div className="px-5 pb-5 pt-3">
        <div className="flex items-center justify-between gap-2">
          <MicroLabel>{t('Guided tour')} · {index + 1}/{steps.length}</MicroLabel>
          <span className="font-mono text-[10px] text-ink/40">{doneCount} {t('done')}</span>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <span className="rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider" style={{ color: SIDE_TONE[step.side], borderColor: 'currentColor' }}>
            {sideLabel}
          </span>
          {step.station ? <span className="font-mono text-[10px] text-ink/40">{step.station}</span> : null}
          {step.optional ? <span className="rounded-full border border-ink/10 bg-ink/[0.03] px-2 py-0.5 text-[10px] text-ink/40">{t('Optional')}</span> : null}
          {done ? (
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-tone-success"><Check className="h-3.5 w-3.5" strokeWidth={2.5} /> {t('Done — read from the chain')}</span>
          ) : null}
        </div>

        <h3 className="mt-2 text-[17px] font-semibold leading-snug tracking-tight text-ink">{step.title}</h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink/60">{step.lede}</p>
        {step.signs ? (
          <p className="mt-2 text-[12px] text-ink/55">
            <span className="text-ink/35">{t('Signs')}:</span> {step.signs}
          </p>
        ) : null}

        {step.ready.length ? (
          <ul className="mt-3 space-y-1.5">
            {step.ready.map((r) => {
              const ok = live(r.check);
              return (
                <li key={r.label} className="flex items-start gap-2 text-[12px] leading-relaxed">
                  {ok === true ? (
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-tone-success" strokeWidth={2.5} />
                  ) : ok === false ? (
                    <CircleDot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-tone-warning" />
                  ) : (
                    <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink/25" />
                  )}
                  <span className={ok === false ? 'text-ink/75' : 'text-ink/55'}>{r.label}</span>
                </li>
              );
            })}
          </ul>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {here ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-volt/30 bg-volt/[0.06] px-3 py-1.5 text-[12px] text-volt">
              <MapPin className="h-3.5 w-3.5" /> {t('You are here')}
            </span>
          ) : (
            <PrimaryButton onClick={() => onGo(step)}>
              {t('Take me there')} <ArrowRight className="ml-1 inline h-3.5 w-3.5" />
            </PrimaryButton>
          )}
          <GhostButton onClick={() => setLearn(true)} aria-label={t('Learn more about this step')}>
            <BookOpen className="mr-1.5 inline h-3.5 w-3.5" /> {t('Why')}
          </GhostButton>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-ink/5 pt-3">
          <button type="button" onClick={() => onIndex(Math.max(0, index - 1))} disabled={index === 0} className="inline-flex items-center gap-1 text-[12px] text-ink/50 transition-colors hover:text-ink disabled:opacity-30">
            <ChevronLeft className="h-3.5 w-3.5" /> {t('Back')}
          </button>
          <div className="flex items-center gap-3">
            {nextPending > index + 1 ? (
              <button type="button" onClick={() => onIndex(nextPending)} className="text-[11px] text-ink/40 underline-offset-2 hover:text-ink hover:underline">
                {t('Skip to the next pending')}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onIndex(Math.min(steps.length - 1, index + 1))}
              disabled={index === steps.length - 1}
              className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[12px] transition-colors disabled:opacity-30 ${done ? 'border-tone-success/40 text-tone-success' : 'border-ink/10 text-ink/60 hover:border-ink/25 hover:text-ink'}`}
            >
              {t('Next')} <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <button type="button" onClick={onExit} className="mt-3 inline-flex items-center gap-1 text-[11px] text-ink/35 transition-colors hover:text-ink">
          <X className="h-3 w-3" /> {t('Exit the tour — free path')}
        </button>
      </div>

      {learn ? (
        <ModalOverlay onEscape={() => setLearn(false)} lockScroll className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm">
          <div className="my-auto flex max-h-[min(90dvh,40rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-ink/10 bg-surface-1 shadow-2xl">
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-ink/5 px-6 py-5">
              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-wider" style={{ color: SIDE_TONE[step.side] }}>{sideLabel}{step.station ? ` · ${step.station}` : ''}</p>
                <h2 className="mt-1 text-lg font-semibold tracking-tight text-ink">{step.title}</h2>
              </div>
              <button type="button" onClick={() => setLearn(false)} aria-label={t('Close')} className="mt-1 shrink-0 text-ink/40 transition-colors hover:text-ink"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto scrollbar-thin px-6 py-5">
              <p className="text-[13px] leading-relaxed text-ink/70">{step.lede}</p>
              {step.learn.map((p) => (
                <p key={p} className="text-[13px] leading-relaxed text-ink/55">{p}</p>
              ))}
              {step.signs ? <p className="text-[12px] text-ink/45"><span className="text-ink/35">{t('Signs')}:</span> {step.signs}</p> : null}
            </div>
          </div>
        </ModalOverlay>
      ) : null}
    </Card>
  );
}

export default TourPanel;
