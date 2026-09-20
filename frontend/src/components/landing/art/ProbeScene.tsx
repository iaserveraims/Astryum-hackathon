'use client';

/**
 * LA SONDA — la escena del mundo Agente.
 *
 * Un pote —un solo planeta— del que sale una sonda por un CORREDOR: dos
 * paredes a trazo discontinuo que son los límites que el dueño firmó una vez.
 * La sonda avanza y deja sus acciones dentro; cuando una intenta salirse, la
 * pared la rechaza. Plata apagada, trazo discontinuo, casi sin nada más: la
 * sobriedad mínima de algo que todavía está en diseño y no promete nada.
 */

import { memo } from 'react';
import { motion, useTransform, type MotionValue } from 'framer-motion';
import type { MotionLevel } from '../../../stores/motionStore';
import { SCENE_MONO, bezier, bezierAngle, cubic, slot, useBeat, useSource, type Pt } from './sceneKit';

type Lang = 'es' | 'en';

/* ── El reparto del scroll: UNA tabla, la lee también AgenteJourney ────── */
export const PROBE_BEATS = {
  pot: [0.0, 0.1],
  corridor: [0.1, 0.3],
  flight: [0.3, 0.56],
  rejected: [0.56, 0.72],
  log: [0.72, 0.86],
  close: [0.86, 1.0],
} as const;

const W = 1200;
const H = 700;
const POT: Pt = [300, 540];
const POT_R = 130;

/** La trayectoria y sus dos paredes. */
const P: [Pt, Pt, Pt, Pt] = [[420, 440], [620, 330], [840, 300], [1130, 120]];
const U: [Pt, Pt, Pt, Pt] = [[395, 395], [605, 278], [830, 248], [1118, 72]];
const L: [Pt, Pt, Pt, Pt] = [[445, 487], [635, 382], [850, 352], [1142, 170]];

/** Dónde deja la sonda cada acción, en t de la trayectoria. */
const WAYPOINTS = [0.22, 0.46, 0.7] as const;
/** La sonda llega hasta aquí: el corredor sigue, el mandato no ha acabado. */
const HEAD_END = 0.9;

export interface ProbeSceneProps {
  progress: MotionValue<number>;
  lang: Lang;
  level: MotionLevel;
  still?: boolean;
}

function ProbeSceneImpl({ progress, lang, level, still = false }: ProbeSceneProps) {
  const src = useSource(progress, still);
  const pot = useBeat(src, PROBE_BEATS.pot);
  const corridor = useBeat(src, PROBE_BEATS.corridor);
  const flight = useBeat(src, PROBE_BEATS.flight);
  const rejected = useBeat(src, PROBE_BEATS.rejected);
  const log = useBeat(src, PROBE_BEATS.log);
  const close = useBeat(src, PROBE_BEATS.close);

  // EN REPOSO SE VE EL POTE, EL CORREDOR Y LA SONDA EN SU BOCA; el scroll la hace volar y añade lo demás.
  const potO = useTransform(pot, [0.1, 0.9], [0.6, 1], { clamp: true });
  const wireO = useTransform(pot, [0.5, 1], [0.15, 0.3], { clamp: true });
  const potLbl = useTransform(pot, [0.7, 1], [0.6, 1], { clamp: true });
  const wallO = useTransform(corridor, [0.05, 0.85], [0.35, 1], { clamp: true });
  const corridorLbl = useTransform(corridor, [0.7, 1], [0, 1], { clamp: true });
  // la sonda: de la boca del corredor hasta casi el final
  const headT = useTransform(flight, [0.05, 1], [0, HEAD_END], { clamp: true });
  const trailLen = useTransform(headT, [0, 1], [0, 1]);
  const headO = useTransform(flight, [0, 0.08], [0.85, 1], { clamp: true });
  const headX = useTransform(headT, (t) => bezier(P[0], P[1], P[2], P[3], t)[0]);
  const headY = useTransform(headT, (t) => bezier(P[0], P[1], P[2], P[3], t)[1]);
  const headRot = useTransform(headT, (t) => bezierAngle(P[0], P[1], P[2], P[3], t));
  // el intento de salirse: nace en la segunda acción y muere en la pared
  const [bx, by] = bezier(P[0], P[1], P[2], P[3], 0.46);
  const [wx, wy] = bezier(U[0], U[1], U[2], U[3], 0.55);
  const branchLen = useTransform(rejected, [0.1, 0.55], [0, 1], { clamp: true });
  const crossO = useTransform(rejected, [0.55, 0.7], [0, 1], { clamp: true });
  const flashO = useTransform(rejected, [0.5, 0.62, 0.85], [0, 0.55, 0], { clamp: true });
  const rejectedLbl = useTransform(rejected, [0.7, 0.95], [0, 1], { clamp: true });
  const logLbl = useTransform(log, [0.7, 0.95], [0, 1], { clamp: true });
  const scale = useTransform(close, [0, 1], [1, still ? 1 : 0.8]);
  const fade = useTransform(close, [0, 1], [1, still ? 1 : 0.5]);
  const drift = level === 'full' && !still;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" aria-hidden fill="none">
      <motion.g style={{ scale, opacity: fade, transformOrigin: '700px 350px' }}>
        {/* EL POTE: un solo planeta, a línea */}
        <motion.circle cx={POT[0]} cy={POT[1]} r={POT_R} stroke="hsl(var(--volt) / 0.85)" strokeWidth="1.2" style={{ opacity: potO }} />
        <motion.g style={{ opacity: wireO }}>
          <ellipse cx={POT[0]} cy={POT[1]} rx={POT_R} ry={POT_R * 0.34} stroke="hsl(var(--volt))" strokeWidth="1" />
          <ellipse cx={POT[0]} cy={POT[1]} rx={POT_R * 0.38} ry={POT_R} stroke="hsl(var(--volt))" strokeWidth="1" />
        </motion.g>
        <motion.g style={{ opacity: potLbl }}>
          <text x={POT[0]} y={POT[1] + 4} textAnchor="middle" fontFamily={SCENE_MONO} fontSize="11" fontWeight="600" letterSpacing="1.8" fill="#ffffff">
            {lang === 'es' ? 'UN POTE' : 'ONE POT'}
          </text>
          <text x={POT[0]} y={POT[1] + 20} textAnchor="middle" fontFamily={SCENE_MONO} fontSize="8.5" letterSpacing="1.6" fill="hsl(var(--volt-soft))">
            {lang === 'es' ? 'EL ÚNICO ALCANCE' : 'THE ONLY REACH'}
          </text>
        </motion.g>

        {/* EL CORREDOR: las dos paredes, a trazo discontinuo — están firmadas,
            no construidas */}
        <motion.path d={cubic(...U)} stroke="hsl(var(--volt) / 0.6)" strokeWidth="1" strokeDasharray="6 6" style={{ opacity: wallO }} />
        <motion.path d={cubic(...L)} stroke="hsl(var(--volt) / 0.6)" strokeWidth="1" strokeDasharray="6 6" style={{ opacity: wallO }} />
        <motion.g style={{ opacity: corridorLbl }}>
          <text x="660" y="470" fontFamily={SCENE_MONO} fontSize="9.5" letterSpacing="1.4" fill="hsl(var(--volt-soft))">
            {lang === 'es' ? 'EL CORREDOR = LOS LÍMITES FIRMADOS POR EL DUEÑO' : 'THE CORRIDOR = THE LIMITS THE OWNER SIGNED'}
          </text>
          <line x1="654" y1="465" x2="628" y2="420" stroke="hsl(var(--volt) / 0.6)" strokeWidth="1" />
        </motion.g>

        {/* la estela y la sonda */}
        <motion.path d={cubic(...P)} stroke="hsl(var(--volt-hi))" strokeWidth="1.4" style={{ pathLength: trailLen }} />
        {WAYPOINTS.map((t, i) => (
          <Waypoint key={t} t={t} i={i} head={headT} log={log} lang={lang} />
        ))}
        <motion.g style={{ x: headX, y: headY, rotate: headRot, opacity: headO }}>
          <motion.path
            d="M0 -7 L15 0 L0 7 L3 0 Z"
            fill="hsl(var(--volt-hi))"
            animate={drift ? { x: [0, 2, 0, -1, 0] } : undefined}
            transition={drift ? { duration: 3.4, repeat: Infinity, ease: 'easeInOut' } : undefined}
          />
        </motion.g>

        {/* EL INTENTO: sale de la segunda acción, llega a la pared, y la pared
            dice que no. El destello es el contrato rechazándolo. */}
        <motion.path
          d={`M${bx.toFixed(1)} ${(by - 6).toFixed(1)} Q${(bx + 10).toFixed(1)} ${(by - 40).toFixed(1)} ${wx.toFixed(1)} ${wy.toFixed(1)}`}
          stroke="rgba(255,255,255,0.65)"
          strokeWidth="1"
          strokeDasharray="2 3"
          style={{ pathLength: branchLen }}
        />
        <motion.circle cx={wx.toFixed(1)} cy={wy.toFixed(1)} r="26" fill="hsl(var(--tone-danger))" style={{ opacity: flashO }} />
        <motion.path
          d={`M${(wx - 6).toFixed(1)} ${(wy - 6).toFixed(1)} l12 12 M${(wx + 6).toFixed(1)} ${(wy - 6).toFixed(1)} l-12 12`}
          stroke="hsl(var(--tone-danger))"
          strokeWidth="1.8"
          strokeLinecap="round"
          style={{ opacity: crossO }}
        />
        <motion.text
          x={(wx - 10).toFixed(1)}
          y={(wy - 18).toFixed(1)}
          textAnchor="end"
          fontFamily={SCENE_MONO}
          fontSize="9.5"
          letterSpacing="1.4"
          fill="hsl(var(--tone-danger))"
          style={{ opacity: rejectedLbl }}
        >
          {lang === 'es' ? 'FUERA DE LO FIRMADO · RECHAZADA' : 'OUTSIDE WHAT WAS SIGNED · REJECTED'}
        </motion.text>

        {/* el registro, dicho una vez */}
        <motion.text
          x="700"
          y={H - 40}
          textAnchor="middle"
          fontFamily={SCENE_MONO}
          fontSize="9.5"
          letterSpacing="1.6"
          fill="hsl(var(--tone-success))"
          style={{ opacity: logLbl }}
        >
          {lang === 'es' ? '3 ACCIONES · 2 EJECUTADAS · 1 RECHAZADA · CADA UNA CON SU RECIBO' : '3 ACTIONS · 2 EXECUTED · 1 REJECTED · EACH WITH ITS RECEIPT'}
        </motion.text>
      </motion.g>
    </svg>
  );
}

function Waypoint({ t, i, head, log, lang }: { t: number; i: number; head: MotionValue<number>; log: MotionValue<number>; lang: Lang }) {
  const [x, y] = bezier(P[0], P[1], P[2], P[3], t);
  // la acción aparece cuando la sonda pasa por ella
  const o = useTransform(head, [t - 0.03, t + 0.01], [0, 1], { clamp: true });
  const sc = useTransform(head, [t - 0.03, t + 0.01, t + 0.06], [0.4, 1.3, 1], { clamp: true });
  // y su recibo se escribe en el tiempo del registro
  const [a, b] = slot([0.05, 0.7], i, WAYPOINTS.length, 0.4);
  const rcpt = useTransform(log, [a, b], [0, 1], { clamp: true });
  const hashes = ['9b1e…77a', '3c40…e15', '—'];
  const rejectedOne = i === 1;
  return (
    <>
      <motion.g style={{ opacity: o, scale: sc, transformOrigin: `${x.toFixed(1)}px ${y.toFixed(1)}px` }}>
        <path d={`M${x.toFixed(1)} ${(y - 8).toFixed(1)} l8 8 l-8 8 l-8 -8 Z`} fill="#08090b" stroke="hsl(var(--tone-success))" strokeWidth="1.3" />
      </motion.g>
      <motion.g style={{ opacity: rcpt }}>
        <text x={(x + 14).toFixed(1)} y={(y + 24).toFixed(1)} fontFamily={SCENE_MONO} fontSize="9" letterSpacing="1.2" fill="rgba(255,255,255,0.75)">
          {lang === 'es' ? 'ACCIÓN' : 'ACTION'} 0{i + 1} · {rejectedOne ? (lang === 'es' ? 'INTENTO RECHAZADO' : 'ATTEMPT REJECTED') : hashes[i]}
        </text>
      </motion.g>
    </>
  );
}

export const ProbeScene = memo(ProbeSceneImpl);
export default ProbeScene;
