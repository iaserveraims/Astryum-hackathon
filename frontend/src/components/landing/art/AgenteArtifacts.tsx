'use client';

/**
 * LAS LÁMINAS DEL MUNDO AGENTE — el mandato, el vuelo y el registro.
 *
 * Tres láminas y una sola idea, la de INVARIANTS #8: la IA prepara, el dueño
 * firma los límites UNA vez, el contrato los impone. El agente no tiene
 * discreción fuera de lo firmado y el dueño lo revoca con una firma. Ninguna
 * lámina le da al agente un verbo que no sea «operar dentro de».
 *
 * Material entre los dos mundos (Plate tone="between", radio 8) y en la plata
 * apagada de algo que está en diseño: se enseña cómo funcionará, no se vende.
 * Atadas a los tiempos de la sonda (PROBE_BEATS): el mandato se lee mientras
 * se dibuja el corredor, las acciones se marcan mientras la sonda las deja y
 * el registro se escribe cuando se escriben los recibos.
 */

import { motion, useTransform, type MotionValue } from 'framer-motion';
import { Cue, Mark, Plate, TONE, useCue, useSelfActive } from './plateStyle';
import { PLATE } from './craft';
import { PROBE_BEATS } from './ProbeScene';

type Lang = 'es' | 'en';
const T = (es: string, en: string, l: Lang) => (l === 'es' ? es : en);

export interface AgentArtifactProps {
  lang: Lang;
  active?: boolean;
  compact?: boolean;
  progress?: MotionValue<number>;
}

/* ═══════════════════════════════════════════════════════════════════════
   EL MANDATO — lo que el dueño firmó, y que el contrato impone
   ══════════════════════════════════════════════════════════════════════ */

const TERMS = [
  { k: { es: 'Alcance', en: 'Scope' }, v: { es: 'Un pote', en: 'One pot' } },
  { k: { es: 'Puede', en: 'May' }, v: { es: 'Mover entre venues permitidos', en: 'Move between allowed venues' } },
  { k: { es: 'No puede', en: 'May not' }, v: { es: 'Retirar · añadir venues · otras cuentas', en: 'Withdraw · add venues · other accounts' } },
  { k: { es: 'Tope por acción', en: 'Cap per action' }, v: { es: '5 % del pote', en: '5 % of the pot' } },
  { k: { es: 'Caduca', en: 'Expires' }, v: { es: 'En 30 días', en: 'In 30 days' } },
  { k: { es: 'Revocación', en: 'Revocation' }, v: { es: 'Una firma del dueño', en: 'One signature by the owner' } },
];

export function MandateArtifact({ lang, active, compact, progress }: AgentArtifactProps) {
  const { ref, live, enter } = useSelfActive(active);
  const [a, b] = PROBE_BEATS.corridor;
  const span = b - a;
  const foot = useCue(progress, a + span * 0.84, a + span * 0.98, live, TERMS.length + 1);
  return (
    <div ref={ref}>
      <Plate title={T('Mandato', 'Mandate', lang)} note={T('Datos de ejemplo', 'Example data', lang)} tone="between" enter={enter} live={live} compact={compact}>
        {TERMS.map((t, i) => (
          <TermRow key={t.k.en} term={t} i={i} lang={lang} progress={progress} live={live} a={a} span={span} />
        ))}
        <Cue t={foot} className="mt-3">
          <span className="block pt-3 text-[10px] font-mono uppercase tracking-[0.16em]" style={{ borderTop: `1px dashed ${PLATE.ruleStrong}`, color: 'hsl(var(--volt-soft) / 0.9)' }}>
            {T('Firmado una vez · impuesto por el contrato', 'Signed once · enforced by the contract', lang)}
          </span>
        </Cue>
      </Plate>
    </div>
  );
}

function TermRow({
  term,
  i,
  lang,
  progress,
  live,
  a,
  span,
}: {
  term: (typeof TERMS)[number];
  i: number;
  lang: Lang;
  progress?: MotionValue<number>;
  live: boolean;
  a: number;
  span: number;
}) {
  const t = useCue(progress, a + span * (0.1 + i * 0.12), a + span * (0.3 + i * 0.12), live, i);
  return (
    <Cue t={t}>
      <span className="grid grid-cols-[104px_1fr] gap-x-3 items-baseline py-[7px]" style={{ borderBottom: `1px dashed ${PLATE.ruleSoft}` }}>
        <span className="text-[9.5px] font-mono uppercase tracking-[0.14em]" style={{ color: 'hsl(var(--ink) / 0.45)' }}>
          {T(term.k.es, term.k.en, lang)}
        </span>
        <span className="text-[12px] text-white/85">{T(term.v.es, term.v.en, lang)}</span>
      </span>
    </Cue>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   EL VUELO — tres acciones: dos dentro, una que el contrato rechazó
   ══════════════════════════════════════════════════════════════════════ */

const ACTIONS = [
  { es: 'Reequilibrio A → B · 2 %', en: 'Rebalance A → B · 2 %', ok: true, at: 0.22 },
  { es: 'Retirada a una cuenta externa', en: 'Withdrawal to an external account', ok: false, at: 0.46 },
  { es: 'Reequilibrio B → A · 1 %', en: 'Rebalance B → A · 1 %', ok: true, at: 0.7 },
];

export function FlightArtifact({ lang, active, compact, progress }: AgentArtifactProps) {
  const { ref, live, enter } = useSelfActive(active);
  const [fa, fb] = PROBE_BEATS.flight;
  const [ra, rb] = PROBE_BEATS.rejected;
  const foot = useCue(progress, ra + (rb - ra) * 0.8, rb, live, ACTIONS.length + 1);
  return (
    <div ref={ref}>
      <Plate title={T('Acciones del agente', 'The agent’s actions', lang)} note={T('En el corredor', 'In the corridor', lang)} tone="between" enter={enter} live={live} compact={compact}>
        {ACTIONS.map((ac, i) => (
          <ActionRow key={ac.en} action={ac} i={i} lang={lang} progress={progress} live={live} flight={[fa, fb]} rejected={[ra, rb]} />
        ))}
        <Cue t={foot} className="mt-3">
          <span className="block pt-3 text-[10px] font-mono uppercase tracking-[0.16em]" style={{ borderTop: `1px dashed ${PLATE.ruleStrong}`, color: 'hsl(var(--ink) / 0.5)' }}>
            {T('Fuera de lo firmado, el contrato dice que no', 'Outside what was signed, the contract says no', lang)}
          </span>
        </Cue>
      </Plate>
    </div>
  );
}

function ActionRow({
  action,
  i,
  lang,
  progress,
  live,
  flight,
  rejected,
}: {
  action: (typeof ACTIONS)[number];
  i: number;
  lang: Lang;
  progress?: MotionValue<number>;
  live: boolean;
  flight: [number, number];
  rejected: [number, number];
}) {
  const [fa, fb] = flight;
  const [ra, rb] = rejected;
  // la fila LLEGA cuando la sonda deja la acción; la rechazada RESUELVE en el
  // tiempo del intento, cuando la pared dice que no
  const arriveAt = fa + (fb - fa) * (0.05 + action.at * 0.95);
  const arrive = useCue(progress, arriveAt, arriveAt + (fb - fa) * 0.12, live, i);
  const settle = useCue(progress, action.ok ? arriveAt : ra + (rb - ra) * 0.45, action.ok ? arriveAt + (fb - fa) * 0.16 : ra + (rb - ra) * 0.75, live, i);
  const dim = useTransform(settle, [0, 1], [1, action.ok ? 1 : 0.7], { clamp: true });
  const rule = useTransform(settle, [0.1, 0.6], [0, 1], { clamp: true });
  return (
    <Cue t={arrive}>
      <span className="relative flex items-start gap-3 py-[8px]" style={{ borderBottom: `1px dashed ${PLATE.ruleSoft}` }}>
        <span className="mt-[1px]">
          <Mark ok={action.ok} t={settle} />
        </span>
        <motion.span className="relative flex-1 min-w-0" style={{ opacity: dim }}>
          {!action.ok && <motion.span className="absolute left-0 top-0 bottom-0 w-[2px] origin-top" style={{ background: TONE.danger, scaleY: rule }} />}
          <span className="block text-[12px] leading-tight text-white/85" style={{ paddingLeft: action.ok ? 0 : 9 }}>
            {T(action.es, action.en, lang)}
          </span>
          <span className="block mt-[3px] text-[10px] font-mono uppercase tracking-[0.12em]" style={{ color: action.ok ? TONE.success : TONE.danger, paddingLeft: action.ok ? 0 : 9 }}>
            {action.ok ? T('Ejecutada', 'Executed', lang) : T('Rechazada por el contrato', 'Rejected by the contract', lang)}
          </span>
        </motion.span>
      </span>
    </Cue>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   EL REGISTRO — cada acción con su recibo, y un interruptor solo del dueño
   ══════════════════════════════════════════════════════════════════════ */

const RECEIPTS = [
  { n: '01', h: '9b1e…77a', ok: true },
  { n: '02', h: '—', ok: false },
  { n: '03', h: '3c40…e15', ok: true },
];

export function LogArtifact({ lang, active, compact, progress }: AgentArtifactProps) {
  const { ref, live, enter } = useSelfActive(active);
  const [a, b] = PROBE_BEATS.log;
  const span = b - a;
  const revoke = useCue(progress, a + span * 0.7, a + span * 0.95, live, RECEIPTS.length + 1);
  return (
    <div ref={ref}>
      <Plate title={T('Registro', 'Record', lang)} note={T('Con recibo', 'With receipt', lang)} tone="between" enter={enter} live={live} compact={compact}>
        <ul className="m-0 p-0 list-none">
          {RECEIPTS.map((r, i) => (
            <li key={r.n} style={{ borderBottom: `1px dashed ${PLATE.ruleSoft}` }}>
              <ReceiptRow receipt={r} i={i} lang={lang} progress={progress} live={live} a={a} span={span} />
            </li>
          ))}
        </ul>
        <Cue t={revoke} className="mt-4">
          <span className="flex items-center justify-between gap-3">
            <span className="text-[10px] font-mono uppercase tracking-[0.16em]" style={{ color: 'hsl(var(--ink) / 0.45)' }}>
              {T('Solo el dueño', 'The owner only', lang)}
            </span>
            {/* Un botón de MAQUETA dentro de una lámina decorativa: se dibuja
                para decir que existe y de quién es, no para pulsarse. */}
            <span className="inline-flex items-center px-3 py-2 rounded-lg text-[12px] font-semibold" style={{ border: `1px solid ${TONE.danger}`, color: TONE.danger }}>
              {T('Revocar mandato', 'Revoke mandate', lang)}
            </span>
          </span>
        </Cue>
      </Plate>
    </div>
  );
}

function ReceiptRow({
  receipt,
  i,
  lang,
  progress,
  live,
  a,
  span,
}: {
  receipt: (typeof RECEIPTS)[number];
  i: number;
  lang: Lang;
  progress?: MotionValue<number>;
  live: boolean;
  a: number;
  span: number;
}) {
  const t = useCue(progress, a + span * (0.08 + i * 0.2), a + span * (0.3 + i * 0.2), live, i);
  const clip = useTransform(t, [0.3, 0.85], ['inset(0 100% 0 0)', 'inset(0 0% 0 0)']);
  return (
    <Cue t={t} className="py-[9px]">
      <span className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2.5 min-w-0">
          <span className="font-mono text-[10px] text-white/45">{receipt.n}</span>
          <span className="text-[12px] text-white/80 truncate">
            {receipt.ok ? T('Ejecutada · recibo', 'Executed · receipt', lang) : T('Rechazada · sin recibo que emitir', 'Rejected · no receipt to issue', lang)}
          </span>
        </span>
        <motion.span className="font-mono text-[10.5px] text-white/35 tabular-nums shrink-0" style={{ clipPath: clip }}>
          {receipt.h}
        </motion.span>
      </span>
    </Cue>
  );
}
