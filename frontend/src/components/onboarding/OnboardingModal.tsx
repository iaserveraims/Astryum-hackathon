'use client';

/**
 * First-run account setup. Launches once when an authenticated user hasn't completed it
 * (or on demand from Settings → reopen()). Steps: language → experience (sets simple/expert
 * mode) → goal (mirrors the landing paths) → wallet. Everything is skippable; skipping marks
 * setup done and the copy points the user to Settings to resume. Persistence is local for now
 * (onboardingStore) — backend persistence is a tracked follow-up.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { ShieldCheck, SlidersHorizontal, TrendingUp, Layers, Wallet2, ArrowRight, X } from 'lucide-react';
import { useOnboardingStore, type OnboardingGoal } from '../../stores/onboardingStore';
import { useAuthStore } from '../../stores/authStore';
import { useT } from '../../i18n/LanguageProvider';
import { LogoMark } from '../ui/Logo';

const EASE = [0.16, 1, 0.3, 1] as const;

function Mark() {
  return <LogoMark height={26} gap="#0c0c0f" />;
}

export default function OnboardingModal() {
  const { lang, setLang, t } = useT();
  const es = lang === 'es';
  const router = useRouter();

  const completed = useOnboardingStore((s) => s.completed);
  const forceOpen = useOnboardingStore((s) => s.forceOpen);
  const finish = useOnboardingStore((s) => s.finish);
  const skip = useOnboardingStore((s) => s.skip);
  const close = useOnboardingStore((s) => s.close);
  const setExpertMode = useAuthStore((s) => s.setExpertMode);

  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState(0);
  const [goal, setGoal] = useState<OnboardingGoal | null>(null);
  useEffect(() => setMounted(true), []);

  // avoid a hydration flash: only decide visibility on the client
  const open = mounted && (!completed || forceOpen);
  if (!open) return null;

  const TOTAL = 4;
  const next = () => setStep((s) => Math.min(s + 1, TOTAL - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));
  const done = (connect: boolean) => {
    finish(goal);
    close();
    setStep(0);
    if (connect) router.push('/app/wallets');
  };
  const onSkip = () => { skip(); close(); setStep(0); };

  const goals: { id: OnboardingGoal; icon: typeof ShieldCheck; es: string; en: string; desc: [string, string] }[] = [
    { id: 'protect', icon: ShieldCheck, es: 'Proteger', en: 'Protect', desc: ['Cuidar el patrimonio que ya tengo', 'Safeguard the wealth I already have'] },
    { id: 'control', icon: SlidersHorizontal, es: 'Controlar', en: 'Control', desc: ['Ver y decidir todo desde un sitio', 'See and decide everything in one place'] },
    { id: 'generate', icon: TrendingUp, es: 'Generar', en: 'Generate', desc: ['Hacer rendir mi capital', 'Make my capital work harder'] },
    { id: 'manage', icon: Layers, es: 'Gestionar', en: 'Manage', desc: ['Herramientas de nivel profesional', 'Professional-grade tooling'] },
  ];

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center p-4 bg-black/70 backdrop-blur-md overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE }}
        className="relative w-full max-w-lg my-auto rounded-2xl border border-ink/10 bg-surface-1 overflow-hidden"
        style={{ boxShadow: '0 40px 120px rgba(0,0,0,0.7)' }}
      >
        {/* header */}
        <div className="flex items-center justify-between px-6 pt-6">
          <Mark />
          <button onClick={onSkip} className="flex items-center gap-1.5 text-xs text-ink/40 hover:text-ink/80 transition-colors" aria-label={t('Skip setup')}>
            {es ? 'Omitir' : 'Skip'} <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* progress */}
        <div className="flex gap-1.5 px-6 pt-5">
          {Array.from({ length: TOTAL }).map((_, i) => (
            <span key={i} className="h-1 flex-1 rounded-full transition-colors" style={{ background: i <= step ? 'hsl(var(--volt))' : 'hsl(var(--ink) / 0.1)' }} />
          ))}
        </div>

        <div className="px-6 py-6 min-h-[320px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.3, ease: EASE }}
            >
              {step === 0 && (
                <Step title={es ? 'Tu idioma' : 'Your language'} subtitle={es ? 'Puedes cambiarlo cuando quieras.' : 'You can change it anytime.'}>
                  <div className="grid grid-cols-2 gap-3">
                    {([['es', 'Español'], ['en', 'English']] as const).map(([code, label]) => (
                      <button
                        key={code}
                        onClick={() => { setLang(code); next(); }}
                        className={`rounded-xl border px-4 py-5 text-left transition-colors ${lang === code ? 'border-volt/50 bg-volt/[0.08]' : 'border-ink/10 hover:border-ink/25 bg-ink/[0.02]'}`}
                      >
                        <div className="text-base font-semibold text-ink">{label}</div>
                        <div className="text-xs text-ink/40 mt-1">{code}</div>
                      </button>
                    ))}
                  </div>
                </Step>
              )}

              {step === 1 && (
                <Step title={es ? '¿Qué tal te manejas con cripto?' : 'How comfortable are you with crypto?'} subtitle={es ? 'Ajustamos cuánto te enseñamos. Cambiable en Ajustes.' : 'We tune how much we show you. Changeable in Settings.'}>
                  <div className="space-y-3">
                    {[
                      { expert: false, t: es ? 'Principiante' : 'Beginner', d: es ? 'Vista simple, sin jerga ni menús que abruman' : 'Simple view, no jargon or overwhelming menus' },
                      { expert: true, t: es ? 'Avanzado' : 'Advanced', d: es ? 'Todas las herramientas y menús desde el principio' : 'Every tool and menu from the start' },
                    ].map((o) => (
                      <button
                        key={o.t}
                        onClick={() => { setExpertMode(o.expert); next(); }}
                        className="group w-full flex items-center justify-between rounded-xl border border-ink/10 hover:border-volt/40 hover:bg-volt/[0.05] px-4 py-4 text-left transition-colors"
                      >
                        <div>
                          <div className="text-[15px] font-semibold text-ink">{o.t}</div>
                          <div className="text-xs text-ink/45 mt-0.5">{o.d}</div>
                        </div>
                        <ArrowRight className="w-4 h-4 text-ink/30 group-hover:text-volt transition-colors" />
                      </button>
                    ))}
                  </div>
                </Step>
              )}

              {step === 2 && (
                <Step title={es ? '¿Qué quieres conseguir?' : 'What do you want to achieve?'} subtitle={es ? 'Adaptamos tu panel a tu objetivo.' : 'We adapt your dashboard to your goal.'}>
                  <div className="grid grid-cols-2 gap-3">
                    {goals.map((g) => {
                      const Icon = g.icon;
                      const on = goal === g.id;
                      return (
                        <button
                          key={g.id}
                          onClick={() => { setGoal(g.id); next(); }}
                          className={`rounded-xl border px-4 py-4 text-left transition-colors ${on ? 'border-volt/50 bg-volt/[0.08]' : 'border-ink/10 hover:border-ink/25 bg-ink/[0.02]'}`}
                        >
                          <Icon className="w-5 h-5 text-volt mb-2" strokeWidth={1.6} />
                          <div className="text-[15px] font-semibold text-ink">{es ? g.es : g.en}</div>
                          <div className="text-[11px] text-ink/45 mt-1 leading-snug">{es ? g.desc[0] : g.desc[1]}</div>
                        </button>
                      );
                    })}
                  </div>
                </Step>
              )}

              {step === 3 && (
                <Step title={es ? 'Conecta tu wallet' : 'Connect your wallet'} subtitle={es ? 'Sin custodia. Tú firmas siempre. Puedes hacerlo más tarde.' : 'Non-custodial. You always sign. You can do this later.'}>
                  <div className="flex flex-col items-center text-center py-2">
                    <div className="w-14 h-14 rounded-2xl bg-volt/[0.1] border border-volt/30 flex items-center justify-center mb-4">
                      <Wallet2 className="w-6 h-6 text-volt" strokeWidth={1.6} />
                    </div>
                    <p className="text-sm text-ink/55 max-w-xs">
                      {es ? 'Conecta una wallet para ver tu capital real y preparar operaciones.' : 'Connect a wallet to see your real capital and prepare operations.'}
                    </p>
                    <button
                      onClick={() => done(true)}
                      className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 font-semibold text-volt-ink bg-volt transition-transform hover:-translate-y-0.5"
                    >
                      {es ? 'Conectar wallet' : 'Connect wallet'} <ArrowRight className="w-4 h-4" />
                    </button>
                    <button onClick={() => done(false)} className="mt-2 text-sm text-ink/45 hover:text-ink/80 transition-colors">
                      {es ? 'Lo haré más tarde' : "I'll do it later"}
                    </button>
                  </div>
                </Step>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-ink/[0.05]">
          <button
            onClick={back}
            disabled={step === 0}
            className="text-sm text-ink/45 hover:text-ink/80 transition-colors disabled:opacity-0"
          >
            {es ? '← Atrás' : '← Back'}
          </button>
          <span className="text-[11px] text-ink/30">
            {es ? 'Puedes retomarlo desde Ajustes' : 'You can resume from Settings'}
          </span>
        </div>
      </motion.div>
    </div>
  );
}

function Step({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-xl font-bold tracking-tight text-ink" style={{ letterSpacing: '-0.02em' }}>{title}</h2>
      <p className="mt-1.5 text-sm text-ink/50">{subtitle}</p>
      <div className="mt-5">{children}</div>
    </div>
  );
}
