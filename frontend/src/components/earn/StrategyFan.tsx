'use client';

/**
 * StrategyFan v3 — the routes as ONE overlapping hand, laid horizontally.
 * The cards are BIGGER and stack across the width,
 * each partly covering the next like cards pushed together on a table:
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, useMotionValue, useSpring } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';
import { useMotionLevel } from '../../stores/motionStore';
import { EASE_OUT } from '../ui/motion';
import { TokenLogo } from '@/components/ui/TokenLogo';
import type { VaultKind } from './FlareDemoEarn';

/** Genérica (bóvedas con gestor): `kind` es la CLAVE de la
 *  carta — para Earn sigue siendo VaultKind (el default, así ningún consumidor
 *  cambia), para el catálogo de managed vaults es la dirección del pote. Solo
 *  tipos: el render no distingue. */
export interface FanCard<K extends string = VaultKind> {
  kind: K;
  asset: string;
  title: string;
  action: string;
  icon: React.ReactNode;
  /** Una CABECERA propia en lugar del icono con logo en la esquina (
   *  bóvedas con gestor): la foto del gestor a tamaño de verdad y el token que
   *  usa, bien visible. Earn no lo usa: sus cartas siguen igual. */
  tile?: React.ReactNode;
  accent: string;
  /** Council-blocked routes stay on the table, dimmed and honest. */
  blocked: boolean;
  /** The market this route SHARES with another one (strategyTaxonomy.KINSHIP,
   *  founder): worn on the face so two look-alike cards explain
   *  themselves before being opened. Undefined = the route stands alone. */
  market?: string;
  /** The regulatory line the face wears (assetDisclosure.face, founder):
   * a real product that does not comply with MiCA says so ON the
   *  card, not only once opened. Same posture as the fee disclosure — said
   *  before, never after. Undefined = nothing to disclose, nothing rendered. */
  notice?: string;
}

const MAX_TILT_DEG = 4;
/** How far neighbours step aside when the hand opens around a hovered card. */
const SPREAD_PX = 16;
/** El SANGRADO de la fila. La fila es un scroll container y CORTA en su borde:
 *  la elegida (scale) quedaba amputada contra el filo izquierdo, y el abanico
 *  del hover empujaba la primera carta 16px dentro de la guillotina. El patrón
 *  es el de siempre: padding para el teatro + margen negativo igual, así el
 *  filo del recorte se aleja 20px pero las cartas EN REPOSO siguen empezando
 *  donde empieza todo lo demás de la página (regla). 20px = el
 *  abanico (16) + el crecimiento del scale + el ring; no más, porque el hueco
 *  hasta la ficha abierta es gap-5 (20px) y el sangrado no debe colarse bajo
 *  ella. fit() lo descuenta del ancho útil. */
const BLEED_PX = 20;
/** La cara visible de cada carta solapada: el solape deja de ser fijo — la mano
 *  MIDE su caja y reparte lo que hay, entre estos topes. El máximo es la
 *  holgura de siempre; el mínimo aún deja leer icono y arranque del título.
 *  Solo por debajo del mínimo (cajas absurdas) entra el scroll de seguridad. */
const FACE_MAX_COMPRESSED = 100;
const FACE_MAX = 168;
const FACE_MIN = 44;

/** useLayoutEffect en cliente, useEffect en SSR — el patrón isomórfico de
 *  siempre (la medición pre-pintado solo tiene sentido con DOM delante). */
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Lo que se pinta DENTRO del marco. Exportada junto con `frameClass`
 * para que las bovedas con gestor usen esta misma cara en vez de una copia:
 * la card es identidad de producto y dos que se parecen acaban divergiendo.
 *
 * Fijate en que NO usa `card.kind`: solo lo necesitan GridCard/HandCard como
 * clave de React. Por eso el tipo de abajo lo deja fuera y cualquier cosa con
 * activo, titulo y frase puede llevar esta cara.
 */
export type CardFaceData = Omit<FanCard, 'kind'>;

export function CardFace({ card, chip, t, big }: { card: CardFaceData; chip: React.ReactNode; t: (s: string) => string; big: boolean }) {
  return (
    <>
      <div className="flex items-start justify-between">
        {card.tile ? (
          <div className="min-w-0 shrink">{card.tile}</div>
        ) : (
          <div className="relative shrink-0">
            <div className={`${big ? 'w-12 h-12' : 'w-10 h-10'} rounded-xl grid place-items-center border ${card.accent}`}>
              {card.icon}
            </div>
            <TokenLogo symbol={card.asset} size="xs" className="absolute -bottom-1 -right-1 ring-2 ring-surface-1" />
          </div>
        )}
        {card.blocked && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-tone-warning/30 bg-tone-warning/10 text-tone-warning">
            {t('Not for this account')}
          </span>
        )}
      </div>
      <h3 className={`mt-3 font-semibold text-ink leading-snug ${big ? 'text-sm line-clamp-3' : 'text-[13px] line-clamp-2'}`}>
        {card.title}
      </h3>
      <p className={`mt-1 text-ink/45 leading-snug ${big ? 'text-xs line-clamp-3' : 'text-[11px] line-clamp-2'}`}>
        {t(card.action)}
      </p>
      {card.market && (
        <span className="mt-1.5 inline-flex w-fit items-center gap-1 rounded-full border border-ink/10 bg-ink/[0.03] px-1.5 py-0.5 font-mono text-[9px] text-ink/40">
          {card.market} · {t('same place')}
        </span>
      )}
      {card.notice && (
        <p
          role="note"
          className={`mt-1.5 flex items-start gap-1 leading-snug text-tone-warning ${big ? 'text-[10.5px]' : 'text-[10px]'}`}
        >
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden />
          <span className="line-clamp-2">{t(card.notice)}</span>
        </p>
      )}
      <div className="mt-auto pt-2">{chip}</div>
      <span className="pointer-events-none absolute bottom-2.5 right-3 font-mono text-[9px] text-ink/20">
        {card.asset}
      </span>
    </>
  );
}

/**
 * Border/ring/shadow recipe shared by both layouts here — and EXPORTADA
 * para que la card del gestor la use en vez de copiarla.
 *
 * La leccion es de ayer mismo: cuando el catalogo v2 dejo de importar esta cara
 * y describio la suya, aparecieron dos cards que se parecen y se mantienen por
 * separado. Eso siempre acaba divergiendo, y aqui el marco ES identidad de
 * producto. Exportar no cambia ni un pixel del render de esta mano.
 */
export function frameClass(selected: boolean, blocked: boolean): string {
  return `relative rounded-2xl border bg-surface-1 text-left p-4 flex flex-col transition-[border-color,box-shadow] duration-200 ${
    selected
      ? 'border-volt/60 ring-1 ring-volt/35 shadow-[0_18px_44px_-16px_hsl(var(--volt)/0.4)]'
      : 'border-ink/10 hover:border-ink/20 shadow-[0_10px_28px_-16px_rgba(0,0,0,0.6)]'
  } ${blocked ? 'opacity-55' : ''}`;
}

/** v2 survivor — the flat grid card with cursor tilt (mobile + reduced motion).
 *  Exportada porque StrategyColumns la reutiliza: una sola card, no
 *  dos que se parecen. Nada del render de esta mano cambia por exportarla. */
export function GridCard({
  card,
  selected,
  dimmed,
  onSelect,
  chip,
  t,
}: {
  card: FanCard<string>;
  selected: boolean;
  /** Another card is selected — this one steps back (dim only, no blur here). */
  dimmed: boolean;
  onSelect: () => void;
  chip: React.ReactNode;
  t: (s: string) => string;
}) {
  const level = useMotionLevel();
  const reduce = level === 'minimal';
  // Sereno: la carta no se inclina ni se eleva al pasar por encima — solo
  // responde al clic. Ver la cabecera del fichero.
  const still = level !== 'full';
  const ref = useRef<HTMLButtonElement | null>(null);
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const tiltX = useSpring(rx, { stiffness: 260, damping: 24 });
  const tiltY = useSpring(ry, { stiffness: 260, damping: 24 });

  const onMove = (e: React.MouseEvent) => {
    if (still || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * 2 - 1;
    const py = ((e.clientY - r.top) / r.height) * 2 - 1;
    ry.set(px * MAX_TILT_DEG);
    rx.set(-py * MAX_TILT_DEG);
  };
  const onLeave = () => {
    rx.set(0);
    ry.set(0);
  };

  return (
    <motion.button
      ref={ref}
      type="button"
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${card.title} — ${t(card.action)}`}
      whileHover={still ? undefined : { y: -6 }}
      whileTap={reduce ? undefined : { scale: 0.97 }}
      animate={{ scale: selected ? 1.02 : 1, opacity: dimmed ? 0.6 : 1 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      style={{ rotateX: tiltX, rotateY: tiltY, transformPerspective: 900 }}
      // min-h, no h: la cara puede llevar el aviso regulatorio y una
      // carta de alto fijo lo escupiría por debajo. La rejilla estira la fila
      // entera a la carta más alta, así que siguen alineadas.
      className={`min-h-56 ${frameClass(selected, card.blocked)}`}
    >
      <CardFace card={card} chip={chip} t={t} big={false} />
    </motion.button>
  );
}

/** The overlapped hand card (md+). Offsets are driven by the PARENT (hover
 *  spread / selection) so the whole hand moves as one choreography. */
function HandCard({
  card,
  index,
  hoverIdx,
  selectedIdx,
  selected,
  compressed = false,
  calm = false,
  overlapPx,
  onSelect,
  onHover,
  chip,
  t,
}: {
  card: FanCard<string>;
  index: number;
  hoverIdx: number | null;
  selectedIdx: number | null;
  selected: boolean;
  compressed?: boolean;
  /** Nivel SERENO (cabecera): sin tilt, sin abanico, sin elevación por hover.
   *  La elegida sigue elevándose y el clic sigue hundiéndose — eso es respuesta
   *  a lo que el usuario hace, no movimiento por su cuenta. */
  calm?: boolean;
  /** Margen negativo medido por el padre (px). null = aún sin medir: quedan
   *  las clases estáticas de siempre como primer pintado. */
  overlapPx: number | null;
  onSelect: () => void;
  onHover: (i: number | null) => void;
  chip: React.ReactNode;
  t: (s: string) => string;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const tiltX = useSpring(rx, { stiffness: 190, damping: 26 });
  const tiltY = useSpring(ry, { stiffness: 190, damping: 26 });

  const onMove = (e: React.MouseEvent) => {
    if (calm || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * 2 - 1;
    const py = ((e.clientY - r.top) / r.height) * 2 - 1;
    ry.set(px * MAX_TILT_DEG);
    rx.set(-py * MAX_TILT_DEG);
  };
  const onLeave = () => {
    rx.set(0);
    ry.set(0);
    onHover(null);
  };

  const hovered = hoverIdx === index;
  // The hand opens around the hovered card: neighbours step aside. Sereno:
  // nadie se aparta — el hover solo trae la carta al frente (z), sin moverla.
  const spread = calm || hoverIdx == null || hovered ? 0 : index < hoverIdx ? -SPREAD_PX : SPREAD_PX;
  const lifted = hovered && !calm;
  const anotherSelected = selectedIdx != null && !selected;

  return (
    <motion.button
      ref={ref}
      type="button"
      onMouseMove={onMove}
      onMouseEnter={() => onHover(index)}
      onMouseLeave={onLeave}
      onFocus={() => onHover(index)}
      onBlur={() => onHover(null)}
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${card.title} — ${t(card.action)}`}
      // Dealt once onto the table (opacity/y from initial), then everything
      // moves on ONE calm spring — softer than v3's first cut.
      initial={calm ? { opacity: 0 } : { opacity: 0, y: 18 }}
      animate={{
        opacity: 1,
        x: spread,
        // COMPRIMIDA, la elevación se modera: con la ficha al lado la mano vive en una
        // caja más justa, y los -18px de la elegida la sacaban por arriba del
        // marco de su sección. Elevarse sigue diciendo «elegida»; asomarse por
        // fuera del marco solo dice descuido.
        y: selected ? (compressed ? -7 : -18) : lifted ? (compressed ? -4 : -10) : 0,
        scale: selected ? (compressed ? 1.02 : 1.05) : lifted ? 1.015 : anotherSelected ? 0.975 : 1,
      }}
      // AL PRESIONAR, la carta se hunde: el
      // clic tiene peso — baja y encoge un punto y el muelle la devuelve. Es
      // la diferencia entre pulsar un botón y pulsar una carta de verdad.
      whileTap={calm ? { scale: 0.985 } : { scale: 0.965, y: compressed ? 0 : -12 }}
      transition={{
        type: 'spring',
        stiffness: 260,
        damping: 26,
        mass: 0.8,
        opacity: { duration: 0.35, delay: index * 0.05 },
      }}
      style={{
        rotateX: tiltX,
        rotateY: tiltY,
        transformPerspective: 900,
        // Selected in FRONT of the table; hovered above its neighbours; the
        // rest keep the dealt order (later cards on top, like a pushed hand).
        zIndex: selected ? 50 : hovered ? 40 : index + 1,
        marginLeft: overlapPx != null && index > 0 ? -overlapPx : undefined,
      }}
      // Overlap: every card after the first slides over its neighbour.
      // COMPRESSED (ficha abierta al lado; segunda pasada el mismo
      // día: «tampoco quiero que se colapsen tanto, así se puede seguir
      // leyendo»). La carta conserva SU ancho y solo el solape se hunde — cada
      // una deja una franja de ~72-80px a la vista: el icono y el arranque del
      // título, suficiente para leer cuál es. La primera versión estrechaba la
      // carta y hundía el solape a la vez, y las cards quedaban ilegibles. El
      // cambio de margen es de layout, así que la transición la hace `layout`
      // (FLIP, transform-only): un gesto de la mano, no un salto.
      layout
      // El solape MEDIDO pisa a las clases estáticas en cuanto existe: la mano
      // entera cabe en su caja y nada choca con el borde. El cambio de margen
      // sigue siendo de layout, así que lo anima `layout` (FLIP) como siempre.
      className={`h-72 shrink-0 first:ml-0 cursor-pointer w-52 xl:w-56 ${
        overlapPx == null ? (compressed ? '-ml-[7.5rem] xl:-ml-[7.75rem]' : '-ml-16 xl:-ml-14') : ''
      } ${frameClass(selected, card.blocked)}`}
    >
      {/* El panel de blur/atenuado de las no elegidas MURIÓ. Existía
          para empujar el foco hacia la elegida cuando el detalle flotaba
          encima; con la ficha en su propia columna ese trabajo ya lo hace el
          layout, y el blur solo impedía LEER las otras rutas — que es
          exactamente lo que se está haciendo al comparar. Queda el leve
          scale-down (0.975), que jerarquiza sin esconder. */}
      <CardFace card={card} chip={chip} t={t} big />
    </motion.button>
  );
}

/** La carta de la ESTANTERÍA (nivel sereno): misma cara, marco plano, barra
 *  lateral en la elegida. Tweens lentos en la casa curve — nunca muelles ni
 *  tilt: llega posándose, sube tres píxeles bajo el cursor, se hunde un 1%
 *  al pulsar. Los colores (borde, barra, tinte) transicionan por CSS. */
function ShelfCard({
  card,
  index,
  selected,
  dimmed,
  onSelect,
  chip,
  t,
}: {
  card: FanCard<string>;
  index: number;
  selected: boolean;
  dimmed: boolean;
  onSelect: () => void;
  chip: React.ReactNode;
  t: (s: string) => string;
}) {
  return (
    <motion.button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      aria-label={`${card.title} — ${t(card.action)}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: dimmed ? 0.7 : 1, y: 0 }}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.99 }}
      transition={{ duration: 0.45, ease: EASE_OUT, delay: Math.min(index * 0.05, 0.4) }}
      className={`relative flex min-h-56 flex-col rounded-xl border bg-surface-1 p-4 pl-5 text-left transition-colors duration-300 ${
        selected ? 'border-volt/50 bg-volt/[0.04]' : 'border-ink/10 hover:border-ink/25'
      } ${card.blocked ? 'opacity-55' : ''}`}
    >
      <span
        aria-hidden
        className={`absolute bottom-4 left-0 top-4 w-[3px] rounded-full transition-colors duration-300 ${selected ? 'bg-volt' : 'bg-transparent'}`}
      />
      <CardFace card={card} chip={chip} t={t} big={false} />
    </motion.button>
  );
}

/** La fila de la LISTA (nivel mínimo). Siempre icono + logo, nunca `tile`:
 *  la cabecera grande de las bóvedas con gestor es un artefacto de carta y en
 *  una fila no cabe sin recortarse. */
function RouteRow({
  card,
  selected,
  onSelect,
  chip,
  t,
}: {
  card: FanCard<string>;
  selected: boolean;
  onSelect: () => void;
  chip: React.ReactNode;
  t: (s: string) => string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      aria-label={`${card.title} — ${t(card.action)}`}
      className={`grid w-full grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 px-3 py-2.5 text-left first:rounded-t-lg last:rounded-b-lg ${
        selected ? 'bg-volt/[0.06]' : 'hover:bg-ink/[0.03]'
      } ${card.blocked ? 'opacity-55' : ''}`}
    >
      <span className="relative shrink-0">
        <span className={`grid h-8 w-8 place-items-center rounded-md border ${card.accent}`}>{card.icon}</span>
        <TokenLogo symbol={card.asset} size="xs" className="absolute -bottom-1 -right-1 ring-1 ring-surface-1" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold text-ink">{card.title}</span>
        <span className="block truncate text-[11px] text-ink/50">
          {t(card.action)}
          {card.market && <span className="font-mono text-ink/35"> · {card.market}</span>}
        </span>
        {card.blocked && (
          <span className="mt-0.5 inline-block rounded-full border border-tone-warning/30 bg-tone-warning/10 px-1.5 text-[9px] text-tone-warning">
            {t('Not for this account')}
          </span>
        )}
        {card.notice && (
          <span role="note" className="mt-0.5 flex items-start gap-1 text-[10px] leading-snug text-tone-warning">
            <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden />
            <span className="line-clamp-2">{t(card.notice)}</span>
          </span>
        )}
      </span>
      <span className="shrink-0">{chip}</span>
      <span
        aria-hidden
        className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${selected ? 'border-volt' : 'border-ink/25'}`}
      >
        {selected && <span className="h-2 w-2 rounded-full bg-volt" />}
      </span>
    </button>
  );
}

export function StrategyFan<K extends string = VaultKind>({
  cards,
  selected,
  onSelect,
  chip,
  compressed = false,
  t,
}: {
  cards: FanCard<K>[];
  selected: K | null;
  onSelect: (kind: K) => void;
  /** The route's live protocol rate chip (LiveYieldChip — invariant #9). */
  chip: (kind: K) => React.ReactNode;
  /** Hay una ficha abierta a la derecha: la mano APRIETA —
   *  cartas más estrechas, solapamiento más profundo — para caber entera en la
   *  columna izquierda y que se sigan viendo todas mientras se compara. */
  compressed?: boolean;
  t: (s: string) => string;
}) {
  const level = useMotionLevel();
  const reduce = level === 'minimal';
  // La mano solo se monta en el nivel completo; su modo quieto queda para
  // consumidores directos (ver cabecera).
  const calm = false;
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const selectedIdx = selected ? cards.findIndex((c) => c.kind === selected) : -1;

  // ── La mano cabe en su caja SIEMPRE ──
  // Se mide el ancho real de la fila y de una carta (offsetWidth ignora los
  // transforms del tilt/lift) y el solape se reparte para que la última carta
  // termine dentro del marco, con holgura para el abanico del hover (±SPREAD).
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [overlapPx, setOverlapPx] = useState<number | null>(null);
  const fit = () => {
    const row = rowRef.current;
    if (!row) return;
    const first = row.querySelector('button');
    if (!first) return;
    const cardW = (first as HTMLElement).offsetWidth;
    const n = cards.length;
    if (n <= 1 || cardW === 0) return void setOverlapPx(0);
    // clientWidth incluye el padding del sangrado; se descuenta para que la
    // mano siga repartiéndose sobre el ancho REAL de la columna.
    const usable = row.clientWidth - BLEED_PX * 2 - SPREAD_PX * 2;
    const face = Math.max(
      FACE_MIN,
      Math.min(compressed ? FACE_MAX_COMPRESSED : FACE_MAX, (usable - cardW) / (n - 1)),
    );
    setOverlapPx(Math.max(0, Math.round(cardW - face)));
  };
  useIsoLayoutEffect(fit, [cards.length, compressed]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const ro = new ResizeObserver(fit);
    ro.observe(row);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce, cards.length, compressed]);

  const grid = (
    <div
      className={`grid gap-4 ${
        // Alineadas a la IZQUIERDA: con pocas cards, el
        // centrado las dejaba flotando en medio y la vista perdía su margen de
        // lectura. Empiezan donde empieza todo lo demás de la página.
        cards.length <= 3 ? 'grid-cols-2 sm:grid-cols-3 max-w-3xl' : 'grid-cols-2 sm:grid-cols-3'
      }`}
    >
      {cards.map((c) => (
        <GridCard
          key={c.kind}
          card={c}
          selected={selected === c.kind}
          dimmed={selected != null && selected !== c.kind}
          onSelect={() => onSelect(c.kind)}
          chip={chip(c.kind)}
          t={t}
        />
      ))}
    </div>
  );

  // ── Los otros dos artefactos (cabecera): lista en mínimo, estantería en sereno ──
  if (reduce) {
    return (
      // Sin overflow-hidden: un globo (HelpDot, tooltips) que abra desde una
      // fila no puede quedar guillotinado. Las esquinas las llevan las filas.
      <div role="radiogroup" className="divide-y divide-ink/[0.07] rounded-lg border border-ink/10 bg-surface-1">
        {cards.map((c) => (
          <RouteRow key={c.kind} card={c} selected={selected === c.kind} onSelect={() => onSelect(c.kind)} chip={chip(c.kind)} t={t} />
        ))}
      </div>
    );
  }
  if (level === 'calm') {
    return (
      <div role="radiogroup" className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))]">
        {cards.map((c, i) => (
          <ShelfCard
            key={c.kind}
            index={i}
            card={c}
            selected={selected === c.kind}
            dimmed={selected != null && selected !== c.kind}
            onSelect={() => onSelect(c.kind)}
            chip={chip(c.kind)}
            t={t}
          />
        ))}
      </div>
    );
  }

  return (
    <>
      {/* The hand — md+. Perspective on the container so every tilt shares
          one vanishing point; vertical padding hosts the lift so the table
          never clips a raised card. */}
      <div
        ref={rowRef}
        // pt-8/pb-3 comprimida: el aire que la elevación moderada aún pide —
        // la carta elegida se queda DENTRO del marco de su sección, no asomada.
        // El overflow-x queda de RED DE SEGURIDAD: con el solape medido la mano
        // cabe; solo por debajo de FACE_MIN (cajas absurdas) entra el scroll.
        // px-5 -mx-5: el sangrado (BLEED_PX) — el filo del recorte se aparta y
        // la elegida/el abanico ya no se amputan contra el límite. pt-8 en las
        // DOS variantes: la elevación sin comprimir (-18px) más el scale 1.05
        // pedían 27px y pt-6 (24) dejaba la elegida decapitada por arriba.
        className={`hidden md:flex justify-start items-end [perspective:1200px] px-5 -mx-5 ${
          compressed ? 'overflow-x-auto overscroll-x-contain pt-8 pb-3' : 'overflow-x-auto pt-8 pb-2'
        }`}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {cards.map((c, i) => (
          <HandCard
            key={c.kind}
            card={c}
            index={i}
            hoverIdx={hoverIdx}
            selectedIdx={selectedIdx >= 0 ? selectedIdx : null}
            selected={selected === c.kind}
            compressed={compressed}
            calm={calm}
            overlapPx={overlapPx}
            onSelect={() => onSelect(c.kind)}
            onHover={setHoverIdx}
            chip={chip(c.kind)}
            t={t}
          />
        ))}
      </div>
      {/* Below md the overlap has no room — the same cards keep the grid. */}
      <div className="md:hidden">{grid}</div>
    </>
  );
}

export default StrategyFan;
