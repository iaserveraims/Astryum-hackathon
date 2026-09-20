'use client';

/**
 * LA FICHA — la escena del mundo Venues: el protocolo como DESTINO.
 *
 * Hasta aquí la landing hablaba a quien pone capital; esta escena habla a
 * quien lo recibe. Un planeta bajo observación: la ficha que lo describe,
 * tres sondas que lo miden (control del contrato, control del proyecto,
 * identidad legal), el faro que se enciende cuando queda certificado, la
 * escalera de cuatro niveles y las naves —los potes— que aterrizan en él.
 *
 * Mismo material que Empresa (bronce, línea fina): un venue es una entidad.
 * En reposo se ve entera; cada parada añade su capa. Decorativa
 * (`aria-hidden`); sin cifras de rendimiento: lo que se mide es estructura,
 * nunca resultado (perfil-protocolo-verificacion-control-autoridad).
 */

import { memo } from 'react';
import { motion, useTransform, type MotionValue } from 'framer-motion';
import type { MotionLevel } from '../../../stores/motionStore';
import { SCENE_MONO, arc, polar, slot, useBeat, useSource } from './sceneKit';

type Lang = 'es' | 'en';

/* ── El reparto del scroll: UNA tabla, la lee también VenueJourney ─────── */
export const VENUE_BEATS = {
  approach: [0.0, 0.1],
  profile: [0.1, 0.28],
  tests: [0.28, 0.48],
  certify: [0.48, 0.64],
  levels: [0.64, 0.78],
  flow: [0.78, 0.88],
  close: [0.88, 1.0],
} as const;

const W = 1200;
const H = 700;
const CX = 740;
const CY = 360;
const R = 118;
/** Flare, en su rosa fijo: el pote llega desde allí. */
const FLR_SOFT = '#F4A8CE';

const TESTS = [
  { ang: -150, es: 'CONTRATO · FIRMA DEL DESPLEGADOR', en: 'CONTRACT · DEPLOYER SIGNATURE' },
  { ang: -30, es: 'PROYECTO · FICHERO EN SU DOMINIO', en: 'PROJECT · FILE ON ITS DOMAIN' },
  { ang: 100, es: 'IDENTIDAD · KYB', en: 'IDENTITY · KYB' },
] as const;

const LEVELS = [
  { es: 'DESCUBIERTO', en: 'DISCOVERED' },
  { es: 'CERTIFICADO', en: 'CERTIFIED' },
  { es: 'RECLAMADO', en: 'CLAIMED' },
  { es: 'ACREDITADO', en: 'ACCREDITED' },
] as const;

const SHIPS = [
  { y: 250, delay: 0, es: 'POTE · GESTOR', en: 'POT · MANAGER' },
  { y: 360, delay: 0.14, es: 'POTE · EXCHANGE', en: 'POT · EXCHANGE' },
  { y: 470, delay: 0.28, es: 'POTE · PERSONAL', en: 'POT · PERSONAL' },
] as const;

const SHEET = [
  { es: 'QUÉ ES', en: 'WHAT IT IS' },
  { es: 'CÓMO SE SALE', en: 'HOW TO EXIT' },
  { es: 'QUIÉN DECIDE', en: 'WHO DECIDES' },
  { es: 'CON QUÉ FUENTE', en: 'FROM WHICH SOURCE' },
] as const;

export interface VenueSceneProps {
  progress: MotionValue<number>;
  lang: Lang;
  level: MotionLevel;
  still?: boolean;
}

function VenueSceneImpl({ progress, lang, level, still = false }: VenueSceneProps) {
  const src = useSource(progress, still);
  const profile = useBeat(src, VENUE_BEATS.profile);
  const tests = useBeat(src, VENUE_BEATS.tests);
  const certify = useBeat(src, VENUE_BEATS.certify);
  const levels = useBeat(src, VENUE_BEATS.levels);
  const flow = useBeat(src, VENUE_BEATS.flow);
  const close = useBeat(src, VENUE_BEATS.close);

  // EN REPOSO SE VE ENTERA: el planeta, su órbita, la ficha tenue, las tres
  // sondas apagadas, el faro sin luz y las naves lejos. Cada parada enciende.
  const planetO = useTransform(src, [0, VENUE_BEATS.profile[0]], [0.7, 1], { clamp: true });
  const sheetO = useTransform(profile, [0.1, 0.6], [0.35, 1], { clamp: true });
  const beaconO = useTransform(certify, [0.1, 0.5, 0.7, 1], [0, 0.9, 0.55, 0.85], { clamp: true });
  const beaconR = useTransform(certify, [0.1, 0.6], [R * 0.4, R * 1.9], { clamp: true });
  const sealO = useTransform(certify, [0.55, 0.85], [0, 1], { clamp: true });
  const railO = useTransform(levels, [0, 0.2], [0.25, 1], { clamp: true });
  const padO = useTransform(flow, [0, 0.3], [0.3, 1], { clamp: true });
  const flowLbl = useTransform(flow, [0.7, 0.95], [0, 1], { clamp: true });
  const scale = useTransform(close, [0, 1], [1, still ? 1 : 0.8]);
  const fade = useTransform(close, [0, 1], [1, still ? 1 : 0.5]);
  const live = level === 'full' && !still;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" aria-hidden fill="none">
      <motion.g style={{ scale, opacity: fade, transformOrigin: `${CX}px ${CY}px` }}>
        {/* EL FARO: la luz de la certificación, detrás del planeta */}
        <motion.circle cx={CX} cy={CY - R} r={beaconR} fill="hsl(var(--volt) / 0.12)" style={{ opacity: beaconO }} />

        {/* EL PLANETA: el protocolo, a línea, con su órbita de observación */}
        <motion.g style={{ opacity: planetO }}>
          <circle cx={CX} cy={CY} r={R} stroke="hsl(var(--volt) / 0.9)" strokeWidth="1.2" />
          <path d={arc(CX, CY, R * 0.72, -160, -40)} stroke="hsl(var(--volt) / 0.45)" strokeWidth="1" />
          <path d={arc(CX, CY, R * 0.86, 20, 130)} stroke="hsl(var(--volt) / 0.35)" strokeWidth="1" />
          <ellipse cx={CX} cy={CY} rx={R * 1.7} ry={R * 0.5} stroke="hsl(var(--volt) / 0.3)" strokeWidth="1" strokeDasharray="2 5" />
          <text x={CX} y={CY + 4} textAnchor="middle" fontFamily={SCENE_MONO} fontSize="11" fontWeight="600" letterSpacing="1.8" fill="#ffffff">
            {lang === 'es' ? 'TU PROTOCOLO' : 'YOUR PROTOCOL'}
          </text>
          <text x={CX} y={CY + 20} textAnchor="middle" fontFamily={SCENE_MONO} fontSize="8.5" letterSpacing="1.6" fill="hsl(var(--volt-soft))">
            {lang === 'es' ? 'EL DESTINO' : 'THE DESTINATION'}
          </text>
        </motion.g>

        {/* EL FARO, el punto: en el norte del planeta */}
        <motion.circle cx={CX} cy={CY - R} r="5" fill="hsl(var(--volt-hi))" style={{ opacity: beaconO }} />
        <motion.g style={{ opacity: sealO }}>
          <text x={CX + 14} y={CY - R - 14} fontFamily={SCENE_MONO} fontSize="9.5" letterSpacing="1.4" fill="#ffffff">
            {lang === 'es' ? 'CERTIFICADO · FECHADO · REVOCABLE' : 'CERTIFIED · DATED · REVOCABLE'}
          </text>
          <text x={CX + 14} y={CY - R - 1} fontFamily={SCENE_MONO} fontSize="8.5" letterSpacing="1.2" fill="hsl(var(--volt-soft))">
            {lang === 'es' ? 'AUDITORÍA FIRMADA POR EL AUDITOR · ERC-7512' : 'AUDIT SIGNED BY THE AUDITOR · ERC-7512'}
          </text>
        </motion.g>

        {/* LA FICHA: cuatro líneas que se escriben en el tiempo del perfil */}
        <motion.g style={{ opacity: sheetO }}>
          <rect x={CX - R - 300} y={CY - 168} width="228" height="118" rx="3" stroke="hsl(var(--volt) / 0.6)" strokeWidth="1" fill="hsl(var(--volt) / 0.04)" />
          <line x1={CX - R - 72} y1={CY - 109} x2={CX - R - 8} y2={CY - 40} stroke="hsl(var(--volt) / 0.5)" strokeWidth="1" />
          {SHEET.map((s, i) => (
            <SheetLine key={s.en} i={i} beat={profile} label={lang === 'es' ? s.es : s.en} x={CX - R - 286} y={CY - 142 + i * 26} />
          ))}
        </motion.g>

        {/* LAS TRES PRUEBAS: sondas que miden, una a una */}
        {TESTS.map((t, i) => (
          <Probe key={t.en} i={i} ang={t.ang} beat={tests} label={lang === 'es' ? t.es : t.en} />
        ))}

        {/* LA ESCALERA DE NIVELES, a la derecha del planeta */}
        <motion.g style={{ opacity: railO }}>
          <line x1={CX + R + 150} y1={CY - 110} x2={CX + R + 150} y2={CY + 110} stroke="hsl(var(--volt) / 0.4)" strokeWidth="1" />
          {LEVELS.map((l, i) => (
            <Level key={l.en} i={i} beat={levels} label={lang === 'es' ? l.es : l.en} x={CX + R + 150} y={CY + 110 - i * 73} />
          ))}
        </motion.g>

        {/* LA PISTA DE ATERRIZAJE y las naves: los potes que dirigen capital */}
        <motion.g style={{ opacity: padO }}>
          <path d={arc(CX, CY, R + 16, 150, 210)} stroke={FLR_SOFT} strokeWidth="3" strokeLinecap="round" />
        </motion.g>
        {SHIPS.map((s, i) => (
          <Ship key={s.en} i={i} ship={s} beat={flow} lang={lang} live={live} />
        ))}
        <motion.text x={CX - R - 40} y={H - 34} fontFamily={SCENE_MONO} fontSize="9.5" letterSpacing="1.4" fill="hsl(var(--tone-success))" style={{ opacity: flowLbl }}>
          {lang === 'es' ? '3 POTES DIRIGEN CAPITAL · CADA UNO CON SU ATRIBUCIÓN' : '3 POTS DIRECT CAPITAL · EACH WITH ITS ATTRIBUTION'}
        </motion.text>
      </motion.g>
    </svg>
  );
}

function SheetLine({ i, beat, label, x, y }: { i: number; beat: MotionValue<number>; label: string; x: number; y: number }) {
  const [a, b] = slot([0.15, 0.95], i, SHEET.length, 0.4);
  const len = useTransform(beat, [a, b], [0, 1], { clamp: true });
  const o = useTransform(beat, [a, a + (b - a) * 0.3], [0.5, 1], { clamp: true });
  return (
    <motion.g style={{ opacity: o }}>
      <text x={x} y={y} fontFamily={SCENE_MONO} fontSize="8.5" letterSpacing="1.4" fill="rgba(255,255,255,0.85)">
        {label}
      </text>
      <motion.line x1={x} y1={y + 8} x2={x + 200} y2={y + 8} stroke="hsl(var(--volt) / 0.7)" strokeWidth="1" style={{ pathLength: len }} />
    </motion.g>
  );
}

/** Una sonda de medición: se acerca por su radio, toca el planeta y marca. */
function Probe({ i, ang, beat, label }: { i: number; ang: number; beat: MotionValue<number>; label: string }) {
  const [a, b] = slot([0.05, 0.95], i, TESTS.length, 0.45);
  const len = useTransform(beat, [a, a + (b - a) * 0.6], [0, 1], { clamp: true });
  const mark = useTransform(beat, [a + (b - a) * 0.6, b], [0, 1], { clamp: true });
  const [ox, oy] = polar(CX, CY, R + 110, ang);
  const [ix, iy] = polar(CX, CY, R + 8, ang);
  const rad = (ang * Math.PI) / 180;
  const tx = ox + Math.cos(rad) * 16;
  const ty = oy + Math.sin(rad) * 16;
  const anchor = Math.cos(rad) < -0.3 ? 'end' : Math.cos(rad) > 0.3 ? 'start' : 'middle';
  return (
    <>
      <circle cx={ox.toFixed(1)} cy={oy.toFixed(1)} r="6" stroke="hsl(var(--volt))" strokeWidth="1.2" fill="#0d0f12" />
      <motion.line x1={ox.toFixed(1)} y1={oy.toFixed(1)} x2={ix.toFixed(1)} y2={iy.toFixed(1)} stroke="hsl(var(--volt-soft))" strokeWidth="1" strokeDasharray="3 3" style={{ pathLength: len }} />
      <motion.g style={{ opacity: mark }}>
        <circle cx={ox.toFixed(1)} cy={oy.toFixed(1)} r="6" fill="hsl(var(--tone-success))" />
        <path d={`M${(ox - 3).toFixed(1)} ${oy.toFixed(1)} l2 2 l4 -4`} stroke="#0d0f12" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        <text x={tx.toFixed(1)} y={(ty + 3).toFixed(1)} textAnchor={anchor} fontFamily={SCENE_MONO} fontSize="9" letterSpacing="1.3" fill="rgba(255,255,255,0.85)">
          {label}
        </text>
      </motion.g>
    </>
  );
}

function Level({ i, beat, label, x, y }: { i: number; beat: MotionValue<number>; label: string; x: number; y: number }) {
  const [a, b] = slot([0.1, 0.9], i, LEVELS.length, 0.4);
  const on = useTransform(beat, [a, b], [0, 1], { clamp: true });
  const fill = useTransform(on, (v) => (v > 0.5 ? 'hsl(var(--volt))' : 'transparent'));
  return (
    <g>
      <motion.circle cx={x} cy={y} r="6" stroke="hsl(var(--volt))" strokeWidth="1.2" style={{ fill }} />
      <motion.text x={x + 16} y={y + 3.5} fontFamily={SCENE_MONO} fontSize="9.5" letterSpacing="1.4" fill="rgba(255,255,255,0.85)" style={{ opacity: useTransform(on, [0, 1], [0.45, 1]) }}>
        {label}
      </motion.text>
    </g>
  );
}

/** Una nave —un pote— que llega desde la izquierda y aterriza en la pista. */
function Ship({ i, ship, beat, lang, live }: { i: number; ship: (typeof SHIPS)[number]; beat: MotionValue<number>; lang: Lang; live: boolean }) {
  const t = useTransform(beat, [0.05 + ship.delay, 0.75 + ship.delay], [0, 1], { clamp: true });
  const x = useTransform(t, [0, 1], [90, CX - R - 40]);
  const y = useTransform(t, [0, 1], [ship.y, CY + (i - 1) * 26]);
  const o = useTransform(beat, [0, 0.05], [0.5, 1], { clamp: true });
  const lbl = useTransform(t, [0, 0.15], [1, 0], { clamp: true });
  return (
    <motion.g style={{ x, y, opacity: o }}>
      <motion.path
        d="M0 -6 L14 0 L0 6 L3 0 Z"
        fill={FLR_SOFT}
        animate={live ? { x: [0, 3, 0] } : undefined}
        transition={live ? { duration: 2.6 + i * 0.4, repeat: Infinity, ease: 'easeInOut' } : undefined}
      />
      <motion.text x="-10" y="3.5" textAnchor="end" fontFamily={SCENE_MONO} fontSize="9" letterSpacing="1.3" fill="rgba(255,255,255,0.75)" style={{ opacity: lbl }}>
        {lang === 'es' ? ship.es : ship.en}
      </motion.text>
    </motion.g>
  );
}

export const VenueScene = memo(VenueSceneImpl);
export default VenueScene;
