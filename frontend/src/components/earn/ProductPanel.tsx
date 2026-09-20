'use client';

/**
 * ProductPanel — la ficha entera de una ruta, por la derecha.
 *
 * POR QUÉ A LA DERECHA Y NO DEBAJO. El detalle desplegado bajo la mano de cards
 * empuja la página hacia abajo, y al cerrarlo el navegador CLAMPA el scroll —
 * el «me manda arriba de golpe» que hubo que parchear con un scrollIntoView
 * correctivo. Un panel al lado no mueve nada: se salta de card en card
 * comparando, que es justo lo que uno hace antes de elegir.
 */

import { ArrowRight, ExternalLink, ShieldCheck, X } from 'lucide-react';
import { TokenLogo } from '@/components/ui/TokenLogo';
import { VenueContact } from '@/components/venue/VenueContact';
import { useT } from '@/i18n/LanguageProvider';
import { PROTOCOLS, type ProductAction } from '@/lib/earn/protocols';
import type { VaultKind } from './FlareDemoEarn';

/** Lo que el catálogo de hoy sabe de una ruta — estructuralmente un DemoVault,
 *  para poder pasarlo tal cual sin duplicar la ficha en dos sitios. */
export interface ProductVisual {
  kind: VaultKind;
  asset: string;
  title: string;
  action: string;
  railLabel: string;
  plain: string;
  flow: { token: string; sub: string }[];
  facts: { label: string; value: string; tone?: 'amber' | 'emerald' }[];
  legs: string[];
  icon: React.ReactNode;
  accent: string;
}

/** Cómo se sale, en palabras de persona. */
function exitLine(a: ProductAction, es: boolean): string {
  if (a.risk.exitNote) return a.risk.exitNote;
  switch (a.risk.exit) {
    case 'anytime': return es ? 'Cuando quieras' : 'Any time';
    case 'liquidity': return es ? 'Contra la liquidez viva' : 'Against live liquidity';
    case 'repay-first': return es ? 'Repagando la deuda primero' : 'Repay the debt first';
    case 'cooldown': return es ? 'Con periodo de espera' : 'With a waiting period';
    case 'epoch': return es ? 'Por ventanas' : 'In windows';
  }
}

/** Quién decide dónde va el dinero — el hecho que separa una bóveda de otra. */
function decidesLine(a: ProductAction, es: boolean): string {
  switch (a.risk.decides) {
    case 'you': return es ? 'Tú' : 'You';
    case 'protocol': return es ? 'El protocolo, on-chain' : 'The protocol, on-chain';
    case 'curator': return es ? 'Un curador, verificable on-chain' : 'A curator, verifiable on-chain';
    case 'offchain-manager':
      return es ? 'Un gestor FUERA de la cadena — no verificable' : 'A manager OFF-chain — not verifiable';
  }
}

function liquidationLine(a: ProductAction, es: boolean): string {
  switch (a.risk.liquidation) {
    case 'none': return es ? 'Sin deuda: nada puede liquidarte' : 'No debt: nothing can liquidate you';
    case 'price': return es ? 'Hay deuda: si el precio cae lo bastante, se liquida' : 'There is debt: a deep enough price fall liquidates it';
    case 'calendar': return es ? 'No liquida el precio, liquida la fecha' : 'Price cannot liquidate it — the date can';
  }
}

export function ProductPanel({
  action,
  vault,
  chip,
  onLaunch,
  onClose,
  blocked,
}: {
  action: ProductAction;
  /** La ficha del catálogo de hoy. Ausente = solo se enseña lo que el dato sabe. */
  vault?: ProductVisual;
  chip: React.ReactNode;
  onLaunch: () => void;
  onClose: () => void;
  blocked?: boolean;
}) {
  const { t, lang } = useT();
  const es = lang === 'es';
  const p = PROTOCOLS[action.protocol];

  return (
    <div className="rounded-2xl border border-ink/10 bg-surface-1 shadow-[0_10px_28px_-16px_rgba(0,0,0,0.6)]">
      {/* Identidad — el mismo lenguaje visual de la card que la abrió. */}
      <div className="flex items-start gap-3 border-b border-ink/[0.06] p-4">
        {vault && (
          <div className="relative shrink-0">
            <div className={`grid h-10 w-10 place-items-center rounded-xl border ${vault.accent}`}>{vault.icon}</div>
            <TokenLogo symbol={vault.asset} size="xs" className="absolute -bottom-1 -right-1 ring-2 ring-surface-1" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold leading-snug text-ink">{vault ? vault.title : p.name}</h3>
          <p className="mt-0.5 text-[11px] text-ink/45">
            {p.name}
            {p.company ? ` · ${p.company}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('Close')}
          className="shrink-0 rounded-lg p-1 text-ink/35 transition-colors hover:bg-ink/[0.05] hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-4 p-4">
        {/* La tasa viva, con su fuente — llega construida del padre. */}
        <div>{chip}</div>

        {/* Qué hace con tu dinero, en una frase. */}
        {vault && <p className="text-[13px] leading-relaxed text-ink/70">{t(vault.plain)}</p>}

        {/* El viaje del token, en orden. */}
        {vault && vault.flow.length > 0 && (
          <div>
            <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink/35">
              {t('The journey')}
            </p>
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
              {vault.flow.map((f, i) => (
                <span key={`${f.token}-${i}`} className="inline-flex items-center gap-1.5">
                  <span className="rounded-lg border border-ink/10 bg-ink/[0.03] px-2 py-1">
                    <span className="text-[11px] font-medium text-ink/80">{f.token}</span>
                    <span className="ml-1 text-[10px] text-ink/40">{t(f.sub)}</span>
                  </span>
                  {i < vault.flow.length - 1 && <ArrowRight className="h-3 w-3 shrink-0 text-ink/25" />}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Qué puede pasarte — del DATO, no de la prosa. */}
        <div className="space-y-1.5 rounded-xl border border-ink/10 bg-ink/[0.02] p-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink/35">
            {t('What can happen to you')}
          </p>
          <Row label={t('Liquidation')} value={liquidationLine(action, es)} />
          <Row label={t('Who decides')} value={decidesLine(action, es)} />
          <Row label={t('How you get out')} value={t(exitLine(action, es))} />
        </div>

        {/* Los hechos que la ficha de hoy ya contaba. */}
        {vault && vault.facts.length > 0 && (
          <div className="space-y-1.5">
            {vault.facts.map((f) => (
              <Row
                key={f.label}
                label={t(f.label)}
                value={t(f.value)}
                tone={f.tone}
              />
            ))}
          </div>
        )}

        {/* Las patas reales, en orden de ejecución. */}
        {vault && vault.legs.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-[0.14em] text-ink/35 transition-colors hover:text-ink/60">
              {t('Step by step')} ({vault.legs.length})
            </summary>
            <ol className="mt-2 space-y-1.5">
              {vault.legs.map((leg, i) => (
                <li key={i} className="flex gap-2 text-[11.5px] leading-snug text-ink/55">
                  <span className="font-mono text-[10px] text-ink/30">{i + 1}</span>
                  {t(leg)}
                </li>
              ))}
            </ol>
          </details>
        )}

        {/* Quién está detrás. Sin informe enlazable, se dice que no lo hay. */}
        <div className="space-y-1.5 rounded-xl border border-ink/10 bg-ink/[0.02] p-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink/35">{t('Who is behind it')}</p>
          <a
            href={p.website}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[12px] text-ink/70 hover:text-volt"
          >
            {p.website.replace(/^https:\/\//, '')} <ExternalLink className="h-3 w-3" />
          </a>
          <p className="flex items-center gap-1.5 text-[11.5px] text-ink/55">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-ink/30" strokeWidth={1.75} />
            {p.audit ? (
              <>
                {t('Audit')}:{' '}
                <a href={p.audit.url} target="_blank" rel="noreferrer" className="text-volt hover:underline">
                  {p.audit.firm}
                </a>
              </>
            ) : (
              <span className="text-ink/45">{t('Audit: not published')}</span>
            )}
          </p>
          {/* Y a quién se escribe cuando el problema es SUYO. Sin esta línea,
              «quién está detrás» se queda a medias: dice de quién heredas el
              riesgo y no dónde reclamarlo. */}
          <VenueContact protocol={action.protocol} className="pt-1" />
          {vault && <p className="text-[11px] text-ink/40">{t('Signs with')}: {t(vault.railLabel)}</p>}
        </div>
      </div>

      {/* El botón, al final: después de la información, nunca antes. */}
      <div className="border-t border-ink/[0.06] p-4">
        <button
          type="button"
          onClick={onLaunch}
          disabled={!!blocked}
          className="w-full rounded-xl bg-volt px-4 py-2.5 text-[13px] font-semibold text-volt-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {blocked ? t('Unsupported') : t('Start')}
        </button>
        <p className="mt-2 text-center text-[10.5px] leading-snug text-ink/35">
          {t('You review and sign in your own wallet. Astryum never signs.')}
        </p>
      </div>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'amber' | 'emerald' }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[12px]">
      <span className="shrink-0 text-ink/45">{label}</span>
      <span
        className={`text-right ${
          tone === 'amber' ? 'text-tone-warning/90' : tone === 'emerald' ? 'text-tone-success/90' : 'text-ink/80'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

export default ProductPanel;
