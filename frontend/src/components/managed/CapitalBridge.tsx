'use client';

/**
 * CapitalBridge — EL CAPITAL DE UN VISTAZO.
 *
 * Antes: cuatro cifras en una tarjeta y una lista de direcciones en otra.
 * Ahora: UNA barra que es la bóveda entera, de izquierda a derecha —
 * lo que trabaja en cada destino (cada uno con su color), lo que puedes
 * desplegar hoy (dorado) y el suelo intocable (ámbar) — con las cuatro
 * cifras como leyenda debajo. La barra se mueve con muelle cuando el
 * capital cambia de sitio; vacía, respira despacio y dice lo que toca:
 * «esperando el primer depósito», con el enlace para traerlo.
 *
 * Solo pinta HECHOS del contrato (total, libre, suelo, valor por destino);
 * nada de rentabilidad (#9). Pura, sin red: la alimenta la consola.
 */

import { motion } from 'framer-motion';
import { Share2 } from 'lucide-react';
import { useReducedMotion } from '../../stores/motionStore';
import { Card, GhostButton, MicroLabel } from '../ui/primitives';
import { useT } from '../../i18n/LanguageProvider';
import { fmtBase } from '../../lib/institutional/policyCatalog';

const ZERO = BigInt(0);
const TEN_K = BigInt(10000);

export interface BridgeVenue {
  id: number;
  /** Nombre visible (Kinetic · isoFXRP) o dirección abreviada. */
  label: string;
  value: bigint;
  /** Tono HSL del destino, estable (venueHue). */
  hue: number;
  retired?: boolean;
}

export function CapitalBridge({
  total,
  free,
  floor,
  deployable,
  floorBps,
  decimals,
  symbol,
  venues,
  onShare,
}: {
  total: bigint;
  free: bigint;
  floor: bigint;
  deployable: bigint;
  floorBps: number;
  decimals: number;
  symbol: string;
  venues: BridgeVenue[];
  /** Copiar el enlace de captación (la carta ya está en Earn). */
  onShare?: () => void;
}) {
  const { t } = useT();
  const reduce = useReducedMotion() ?? false;
  const pct = (x: bigint) => (total > ZERO ? Number((x * TEN_K) / total) / 100 : 0);
  const deployed = venues.reduce((acc, v) => acc + v.value, ZERO);
  // Lo que de verdad queda del suelo: si las salidas lo mordieron, es lo libre.
  const floorShown = free < floor ? free : floor;
  const belowFloor = total > ZERO && free < floor;
  const segments = [
    ...venues.filter((v) => v.value > ZERO).map((v) => ({ key: `v${v.id}`, label: v.label, value: v.value, style: { background: `hsl(${v.hue} 62% 52%)` } })),
    { key: 'deployable', label: t('Deployable now'), value: deployable, style: { background: 'hsl(var(--volt) / 0.85)' } },
    { key: 'floor', label: t('Untouchable floor'), value: floorShown, style: { background: 'repeating-linear-gradient(135deg, hsl(38 92% 55% / 0.55) 0 6px, hsl(38 92% 55% / 0.25) 6px 12px)' } },
  ];
  const empty = total === ZERO;
  const spring = reduce ? { duration: 0 } : { type: 'spring' as const, stiffness: 180, damping: 26 };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <MicroLabel>{t('The capital, at a glance')}</MicroLabel>
        <p className="font-mono text-[13px] text-ink/80">
          {fmtBase(total, decimals)} <span className="text-ink/40">{symbol} · {t('in the vault')}</span>
        </p>
      </div>

      {/* LA BARRA: la bóveda entera, de izquierda a derecha. */}
      <div
        className={`relative mt-3 flex h-3.5 w-full overflow-hidden rounded-full ${empty ? 'border border-dashed border-ink/20 bg-ink/[0.02]' : 'bg-ink/[0.06]'}`}
        role="img"
        aria-label={
          empty
            ? t('Empty vault')
            : segments.map((s) => `${s.label} ${fmtBase(s.value, decimals)} ${symbol}`).join(' · ')
        }
      >
        {empty ? (
          <span className="hero-sheen" aria-hidden />
        ) : (
          segments.map((s) => (
            <motion.span
              key={s.key}
              layout
              initial={false}
              animate={{ width: `${Math.max(s.value > ZERO ? 1.2 : 0, pct(s.value))}%` }}
              transition={spring}
              title={`${s.label} · ${fmtBase(s.value, decimals)} ${symbol}`}
              className="h-full shrink-0 border-r border-surface-1/60 last:border-r-0"
              style={s.style}
            />
          ))
        )}
      </div>

      {/* La leyenda: cada tramo con su punto, su cifra y su parte. */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-ink/60">
        {venues.map((v) => (
          <span key={v.id} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: `hsl(${v.hue} 62% 52%)` }} aria-hidden />
            <span className={v.retired ? 'line-through' : ''}>{v.label}</span>
            <span className="font-mono text-ink/80">{fmtBase(v.value, decimals)}</span>
            <span className="text-ink/35">{pct(v.value).toFixed(1)}%</span>
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-volt/85" aria-hidden />
          {t('Deployable now')} <span className="font-mono text-ink/80">{fmtBase(deployable, decimals)}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-tone-warning/60" aria-hidden />
          {t('Untouchable floor')} <span className="font-mono text-ink/80">{fmtBase(floorShown, decimals)}</span>
          <span className="text-ink/35">{floorBps / 100}%</span>
        </span>
        <span className="inline-flex items-center gap-1.5 text-ink/45">
          {t('Working')} <span className="font-mono text-ink/70">{fmtBase(deployed, decimals)}</span>
          <span className="text-ink/35">{pct(deployed).toFixed(1)}%</span>
        </span>
      </div>

      {belowFloor ? (
        <p className="mt-2 text-[11px] leading-relaxed text-tone-warning/90">
          {t('Exits have dipped into the floor: nothing is deployable until deposits or recalls bring the idle balance back above it.')}
        </p>
      ) : null}

      {empty ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink/10 bg-ink/[0.02] px-3 py-2.5">
          <p className="text-[12px] leading-relaxed text-ink/60">
            {t('Waiting for the first deposit. Your vault is already listed in Earn — the link below opens it straight on your card.')}
          </p>
          {onShare ? (
            <GhostButton onClick={onShare} className="shrink-0 text-xs">
              <Share2 className="mr-1.5 inline h-3.5 w-3.5" /> {t('Copy vault link')}
            </GhostButton>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-[11px] leading-relaxed text-ink/35">
          {t('The floor is yours to respect and your clients’ to cross: redemptions may dip into it, you may not.')}
        </p>
      )}
    </Card>
  );
}

export default CapitalBridge;
