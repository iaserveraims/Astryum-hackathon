'use client';

/**
 * vaultEmblems — las «imágenes tontas» de una bóveda: un
 * emblema de la casa que el gestor elige para su vault, como llevan las
 * bóvedas de demostración. Doce, dibujados con la misma familia de iconos que
 * el resto de la app, cada uno con su tono — reconocibles de un vistazo en la
 * mano de cartas sin parecer un logo ajeno.
 *
 * LA MISMA LISTA vive en el backend (`VAULT_EMBLEMS` en routes/institutional.ts):
 * el servidor rechaza claves fuera de ella. Añadir un emblema = tocar las dos.
 */

import {
  Anchor, Compass, Flame, Gem, Leaf, Mountain, Orbit, Rocket, Shield, Sprout, Sun, Waves,
  type LucideIcon,
} from 'lucide-react';

export interface VaultEmblem {
  key: string;
  Icon: LucideIcon;
  /** Tono HSL del fondo: distinto por emblema, estable. */
  hue: number;
}

export const VAULT_EMBLEMS: VaultEmblem[] = [
  { key: 'sprout', Icon: Sprout, hue: 130 },
  { key: 'shield', Icon: Shield, hue: 210 },
  { key: 'anchor', Icon: Anchor, hue: 200 },
  { key: 'compass', Icon: Compass, hue: 30 },
  { key: 'mountain', Icon: Mountain, hue: 260 },
  { key: 'flame', Icon: Flame, hue: 14 },
  { key: 'gem', Icon: Gem, hue: 300 },
  { key: 'leaf', Icon: Leaf, hue: 95 },
  { key: 'orbit', Icon: Orbit, hue: 45 },
  { key: 'rocket', Icon: Rocket, hue: 340 },
  { key: 'sun', Icon: Sun, hue: 40 },
  { key: 'waves', Icon: Waves, hue: 190 },
];

export function emblemByKey(key: string | null | undefined): VaultEmblem | null {
  if (!key) return null;
  return VAULT_EMBLEMS.find((e) => e.key === key) ?? null;
}

/** El emblema pintado: un disco con su tono y el icono encima. */
export function VaultEmblemIcon({ emblem, size = 24, className = '', square = false }: { emblem: VaultEmblem; size?: number; className?: string; square?: boolean }) {
  const { Icon, hue } = emblem;
  return (
    <span
      className={`grid shrink-0 place-items-center ${square ? 'rounded-xl' : 'rounded-full'} ${className}`}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, hsl(${hue} 55% 42% / 0.9), hsl(${(hue + 30) % 360} 50% 28% / 0.95))`,
        color: 'hsl(0 0% 100% / 0.92)',
      }}
      aria-hidden
    >
      <Icon style={{ width: size * 0.56, height: size * 0.56 }} strokeWidth={1.9} />
    </span>
  );
}
