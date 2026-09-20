'use client';

/**
 * LAS LÁMINAS DEL MUNDO VENUES — en el idioma de quien opera un protocolo.
 *
 * La ficha del protocolo, las tres pruebas, la escalera de niveles y el
 * capital dirigido. Material impreso (Plate tone="print"): un venue es una
 * entidad. Atadas a los tiempos de la ficha (VENUE_BEATS).
 *
 * Lo que dicen sale de la arquitectura del perfil del protocolo (15-sep): lo
 * que el protocolo sube es una PROPUESTA y nunca toca un campo medido; tres
 * pruebas ortogonales (control del contrato por firma del desplegador,
 * control del proyecto por fichero en su dominio, identidad legal por KYB);
 * dos atestaciones que no puede fabricar (auditoría ERC-7512 firmada por el
 * auditor, certificación fechada); cuatro niveles acumulativos y mecánicos;
 * subir lleva verificación, bajar es inmediato, y la salida de quien ya tiene
 * capital dentro no se cierra nunca. Cifras de MAQUETA, rotuladas.
 */

import { motion, useTransform, type MotionValue } from 'framer-motion';
import { Cue, Mark, Plate, TONE, useCue, useSelfActive } from './plateStyle';
import { PLATE } from './craft';
import { VENUE_BEATS } from './VenueScene';

type Lang = 'es' | 'en';
const T = (es: string, en: string, l: Lang) => (l === 'es' ? es : en);

export interface VenueArtifactProps {
  lang: Lang;
  active?: boolean;
  compact?: boolean;
  progress?: MotionValue<number>;
}

const NOTE = { es: 'Datos de ejemplo', en: 'Example data' };

/* ═══════════════════════════════════════════════════════════════════════
   LA FICHA — qué es, cómo se sale, quién decide, con qué fuente
   ══════════════════════════════════════════════════════════════════════ */

const SHEET = [
  { k: { es: 'Qué es', en: 'What it is' }, v: { es: 'Mercado de préstamo · Flare', en: 'Lending market · Flare' }, measured: true },
  { k: { es: 'Cómo se sale', en: 'How to exit' }, v: { es: 'Retirada directa · sin cola', en: 'Direct withdrawal · no queue' }, measured: true },
  { k: { es: 'Quién decide', en: 'Who decides' }, v: { es: 'Multifirma 3 de 5 · espera 48 h', en: 'Multisig 3 of 5 · 48 h delay' }, measured: true },
  { k: { es: 'Descripción', en: 'Description' }, v: { es: 'La escribes tú', en: 'Written by you' }, measured: false },
];

export function ProfileArtifact({ lang, active, compact, progress }: VenueArtifactProps) {
  const { ref, live, enter } = useSelfActive(active);
  const [a, b] = VENUE_BEATS.profile;
  const span = b - a;
  const foot = useCue(progress, a + span * 0.82, a + span * 0.96, live, SHEET.length + 1);
  return (
    <div ref={ref}>
      <Plate title={T('La ficha del protocolo', 'The protocol sheet', lang)} note={T(NOTE.es, NOTE.en, lang)} tone="print" enter={enter} live={live} compact={compact}>
        {SHEET.map((row, i) => (
          <SheetRow key={row.k.en} row={row} i={i} lang={lang} progress={progress} live={live} a={a} span={span} />
        ))}
        <Cue t={foot} className="mt-3">
          <span className="block pt-3 text-[10px] font-mono uppercase tracking-[0.16em]" style={{ borderTop: `1px solid ${PLATE.ruleSoft}`, color: 'hsl(var(--volt-soft) / 0.9)' }}>
            {T('Lo medido no se edita · tú propones, la máquina publica', 'What was measured is not edited · you propose, the machine publishes', lang)}
          </span>
        </Cue>
      </Plate>
    </div>
  );
}

function SheetRow({
  row,
  i,
  lang,
  progress,
  live,
  a,
  span,
}: {
  row: (typeof SHEET)[number];
  i: number;
  lang: Lang;
  progress?: MotionValue<number>;
  live: boolean;
  a: number;
  span: number;
}) {
  const t = useCue(progress, a + span * (0.1 + i * 0.16), a + span * (0.35 + i * 0.16), live, i);
  return (
    <Cue t={t}>
      <span className="grid grid-cols-[96px_1fr_auto] gap-x-3 items-baseline py-[8px]" style={{ borderBottom: `1px solid ${PLATE.ruleSoft}` }}>
        <span className="text-[9.5px] font-mono uppercase tracking-[0.14em]" style={{ color: 'hsl(var(--ink) / 0.45)' }}>
          {T(row.k.es, row.k.en, lang)}
        </span>
        <span className="text-[12.5px] text-white/85">{T(row.v.es, row.v.en, lang)}</span>
        <span className="text-[9px] font-mono uppercase tracking-[0.12em] px-1.5 py-[2px]" style={{ border: `1px solid ${row.measured ? 'hsl(var(--volt) / 0.5)' : PLATE.ruleStrong}`, color: row.measured ? 'hsl(var(--volt-soft))' : 'hsl(var(--ink) / 0.5)', borderRadius: 2 }}>
          {row.measured ? T('Medido', 'Measured', lang) : T('Propuesto', 'Proposed', lang)}
        </span>
      </span>
    </Cue>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   LAS TRES PRUEBAS — y las dos atestaciones que nadie puede fabricar
   ══════════════════════════════════════════════════════════════════════ */

const TESTS = [
  { es: 'Control del contrato', en: 'Control of the contract', note: { es: 'Firma desde la cuenta que lo desplegó (o EIP-1271)', en: 'A signature from the deploying account (or EIP-1271)' } },
  { es: 'Control del proyecto', en: 'Control of the project', note: { es: 'Un fichero en tu propio dominio, como el toml de XRPL', en: 'A file on your own domain, like XRPL’s toml' } },
  { es: 'Identidad legal', en: 'Legal identity', note: { es: 'KYB de la empresa que opera el protocolo', en: 'KYB of the company that runs the protocol' } },
];
const ATTEST = [
  { es: 'Auditoría firmada por el auditor', en: 'Audit signed by the auditor', tag: 'ERC-7512' },
  { es: 'Certificación fechada de Astryum', en: 'Astryum’s dated certification', tag: { es: 'revocable', en: 'revocable' } },
];

export function TestsArtifact({ lang, active, compact, progress }: VenueArtifactProps) {
  const { ref, live, enter } = useSelfActive(active);
  const [a, b] = VENUE_BEATS.tests;
  const span = b - a;
  const att = useCue(progress, a + span * 0.72, a + span * 0.95, live, TESTS.length + 1);
  return (
    <div ref={ref}>
      <Plate title={T('Tres pruebas', 'Three tests', lang)} note={T('Nadie las hace por ti', 'Nobody does them for you', lang)} tone="print" enter={enter} live={live} compact={compact}>
        {TESTS.map((row, i) => (
          <TestRow key={row.en} row={row} i={i} lang={lang} progress={progress} live={live} a={a} span={span} />
        ))}
        <Cue t={att} className="mt-3">
          <span className="block pt-3" style={{ borderTop: `1px solid ${PLATE.ruleSoft}` }}>
            <span className="block text-[9.5px] font-mono uppercase tracking-[0.16em] mb-2" style={{ color: 'hsl(var(--ink) / 0.45)' }}>
              {T('Y dos atestaciones que no puedes fabricar', 'And two attestations you cannot fabricate', lang)}
            </span>
            {ATTEST.map((x) => (
              <span key={x.en} className="flex items-center justify-between gap-3 py-[5px] text-[12px] text-white/80">
                <span>{T(x.es, x.en, lang)}</span>
                <span className="text-[9.5px] font-mono uppercase tracking-[0.12em]" style={{ color: 'hsl(var(--volt-soft))' }}>
                  {typeof x.tag === 'string' ? x.tag : T(x.tag.es, x.tag.en, lang)}
                </span>
              </span>
            ))}
          </span>
        </Cue>
      </Plate>
    </div>
  );
}

function TestRow({
  row,
  i,
  lang,
  progress,
  live,
  a,
  span,
}: {
  row: (typeof TESTS)[number];
  i: number;
  lang: Lang;
  progress?: MotionValue<number>;
  live: boolean;
  a: number;
  span: number;
}) {
  const arrive = useCue(progress, a + span * (0.05 + i * 0.22), a + span * (0.2 + i * 0.22), live, i);
  const settle = useCue(progress, a + span * (0.18 + i * 0.22), a + span * (0.32 + i * 0.22), live, i);
  return (
    <Cue t={arrive}>
      <span className="flex items-start gap-3 py-[8px]" style={{ borderBottom: `1px solid ${PLATE.ruleSoft}` }}>
        <span className="mt-[1px]">
          <Mark ok t={settle} />
        </span>
        <span className="min-w-0">
          <span className="block text-[12.5px] leading-tight text-white/88">{T(row.es, row.en, lang)}</span>
          <span className="block mt-[3px] text-[11px] leading-tight" style={{ color: 'hsl(var(--ink) / 0.45)' }}>
            {T(row.note.es, row.note.en, lang)}
          </span>
        </span>
      </span>
    </Cue>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   LOS CUATRO NIVELES — acumulativos, mecánicos; subir cuesta, bajar es inmediato
   ══════════════════════════════════════════════════════════════════════ */

const LEVELS = [
  { es: 'Descubierto', en: 'Discovered', v: { es: 'Aparece en lectura', en: 'Listed, read-only' } },
  { es: 'Certificado', en: 'Certified', v: { es: 'Puede proponerse como ejecutable', en: 'Eligible as executable' } },
  { es: 'Reclamado', en: 'Claimed', v: { es: 'Editas tu ficha y propones direcciones', en: 'You edit your sheet and propose addresses' } },
  { es: 'Acreditado', en: 'Accredited', v: { es: 'Sello de socio y acuerdo', en: 'Partner seal and agreement' } },
];

export function LevelsArtifact({ lang, active, compact, progress }: VenueArtifactProps) {
  const { ref, live, enter } = useSelfActive(active);
  const [a, b] = VENUE_BEATS.levels;
  const span = b - a;
  const foot = useCue(progress, a + span * 0.8, a + span * 0.96, live, LEVELS.length + 1);
  return (
    <div ref={ref}>
      <Plate title={T('Cuatro niveles', 'Four levels', lang)} note={T('Sin juicio: mecánicos', 'No judgement: mechanical', lang)} tone="print" enter={enter} live={live} compact={compact}>
        {LEVELS.map((row, i) => (
          <LevelRow key={row.en} row={row} i={i} lang={lang} progress={progress} live={live} a={a} span={span} />
        ))}
        <Cue t={foot} className="mt-3">
          <span className="block pt-3 text-[10px] font-mono uppercase tracking-[0.16em]" style={{ borderTop: `1px solid ${PLATE.ruleSoft}`, color: 'hsl(var(--volt-soft) / 0.9)' }}>
            {T('Subir lleva verificación · bajar es inmediato · la salida no se cierra', 'Up takes verification · down is immediate · the exit never closes', lang)}
          </span>
        </Cue>
      </Plate>
    </div>
  );
}

function LevelRow({
  row,
  i,
  lang,
  progress,
  live,
  a,
  span,
}: {
  row: (typeof LEVELS)[number];
  i: number;
  lang: Lang;
  progress?: MotionValue<number>;
  live: boolean;
  a: number;
  span: number;
}) {
  const t = useCue(progress, a + span * (0.08 + i * 0.17), a + span * (0.3 + i * 0.17), live, i);
  const pip = useTransform(t, [0.4, 1], [0.2, 1], { clamp: true });
  return (
    <Cue t={t}>
      <span className="grid grid-cols-[18px_1fr] gap-x-3 items-start py-[8px]" style={{ borderBottom: `1px solid ${PLATE.ruleSoft}` }}>
        <motion.span className="mt-[3px] block w-[10px] h-[10px] rounded-full" style={{ background: 'hsl(var(--volt))', opacity: pip }} />
        <span className="min-w-0">
          <span className="block text-[12.5px] leading-tight text-white/88">
            <span className="font-mono text-[10px] text-white/40 mr-2">0{i + 1}</span>{' '}
            {T(row.es, row.en, lang)}
          </span>
          <span className="block mt-[3px] text-[11px] leading-tight" style={{ color: 'hsl(var(--ink) / 0.45)' }}>
            {T(row.v.es, row.v.en, lang)}
          </span>
        </span>
      </span>
    </Cue>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   EL CAPITAL DIRIGIDO — los potes que te eligen, con su atribución
   ══════════════════════════════════════════════════════════════════════ */

const POTS = [
  { es: 'Pote de un gestor', en: 'A manager’s pot', amount: '1,494,200', since: '12 sep' },
  { es: 'Pote de un exchange', en: 'An exchange’s pot', amount: '820,000', since: '15 sep' },
  { es: 'Pote personal', en: 'A personal pot', amount: '3,150', since: '18 sep' },
];

export function DirectedArtifact({ lang, active, compact, progress }: VenueArtifactProps) {
  const { ref, live, enter } = useSelfActive(active);
  const [a, b] = VENUE_BEATS.flow;
  const span = b - a;
  const foot = useCue(progress, a + span * 0.8, a + span * 0.96, live, POTS.length + 1);
  return (
    <div ref={ref}>
      <Plate title={T('Capital dirigido hacia ti', 'Capital directed to you', lang)} note={T(NOTE.es, NOTE.en, lang)} tone="print" enter={enter} live={live} compact={compact}>
        {POTS.map((row, i) => (
          <PotRow key={row.en} row={row} i={i} lang={lang} progress={progress} live={live} a={a} span={span} />
        ))}
        <Cue t={foot} className="mt-3">
          <span className="flex items-center justify-between gap-3 pt-3" style={{ borderTop: `1px solid ${PLATE.ruleSoft}` }}>
            <span className="text-[10px] font-mono uppercase tracking-[0.16em]" style={{ color: 'hsl(var(--ink) / 0.45)' }}>
              {T('Atribución por pote · comisión de distribución según acuerdo', 'Attribution per pot · distribution fee per agreement', lang)}
            </span>
            <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.14em]" style={{ color: TONE.success }}>
              <Mark ok t={foot} />
              {T('Trazable', 'Traceable', lang)}
            </span>
          </span>
        </Cue>
      </Plate>
    </div>
  );
}

function PotRow({
  row,
  i,
  lang,
  progress,
  live,
  a,
  span,
}: {
  row: (typeof POTS)[number];
  i: number;
  lang: Lang;
  progress?: MotionValue<number>;
  live: boolean;
  a: number;
  span: number;
}) {
  const t = useCue(progress, a + span * (0.08 + i * 0.2), a + span * (0.32 + i * 0.2), live, i);
  return (
    <Cue t={t}>
      <span className="grid grid-cols-[1fr_auto] gap-x-3 items-baseline py-[8px]" style={{ borderBottom: `1px solid ${PLATE.ruleSoft}` }}>
        <span className="min-w-0">
          <span className="block text-[12.5px] text-white/85 truncate">{T(row.es, row.en, lang)}</span>
          <span className="block mt-[2px] text-[10px] font-mono uppercase tracking-[0.12em]" style={{ color: 'hsl(var(--ink) / 0.45)' }}>
            {T('desde', 'since', lang)} {row.since}
          </span>
        </span>
        <span className="text-[12px] text-white/80" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {row.amount} <span className="text-white/40">FXRP</span>
        </span>
      </span>
    </Cue>
  );
}
