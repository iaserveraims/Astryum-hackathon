'use client';

/**
 * EL VIAJE EMPRESA — la carta estelar.
 *
 * El mismo cielo que Autocustodia, medido para una entidad. Nace al lado de
 * los otros viajes sobre la carcasa compartida (journeyShell), con su escena
 * (art/StarChartScene) y sus láminas en el idioma de quien las lee
 * (art/EmpresaArtifacts): liquidez por plazo, matriz de firmas, exposición
 * contra un tope, registro de transacciones.
 */

import { useRef, type ReactNode } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { useMotionLevel, useReducedMotion } from '../../stores/motionStore';
import { BORDER, BORDER_STRONG, EASE } from './interactions';
import { CHART_BEATS, StarChartScene } from './art/StarChartScene';
import { ExposureArtifact, LadderArtifact, LedgerArtifact, MatrixArtifact } from './art/EmpresaArtifacts';
import { Beat, Dock, Finale, Kicker, Line, Notes, ReadingVeil, STILL, StationAnchors, StationRail, useJumpTo, type JourneyStation } from './journeyShell';

type Lang = 'es' | 'en';
const T = (es: string, en: string, lang: Lang) => (lang === 'es' ? es : en);

/** Los tiempos del texto, atados a los de la escena: una sola tabla manda. */
const COPY = {
  hero: [0.0, CHART_BEATS.chart[1]] as const,
  position: CHART_BEATS.position,
  organ: CHART_BEATS.organ,
  limits: CHART_BEATS.limits,
  record: CHART_BEATS.record,
  close: CHART_BEATS.close,
};

const STATIONS: readonly JourneyStation[] = [
  { id: 'chart', es: 'La carta', en: 'The chart', at: 0.16, from: 0.0, to: CHART_BEATS.chart[1] },
  { id: 'position', es: 'Posición', en: 'Position', at: 0.34, from: COPY.position[0], to: COPY.position[1] },
  { id: 'organ', es: 'Órgano', en: 'Body', at: 0.5, from: COPY.organ[0], to: COPY.organ[1] },
  { id: 'limits', es: 'Límites', en: 'Limits', at: 0.66, from: COPY.limits[0], to: COPY.limits[1] },
  { id: 'record', es: 'Registro', en: 'Record', at: 0.81, from: COPY.record[0], to: COPY.record[1] },
  { id: 'close', es: 'La casa', en: 'The house', at: 0.95, from: COPY.close[0], to: 1.0 },
];

const HERO = {
  badge: { es: 'Aplicado a una entidad', en: 'Applied to an entity' },
  title: { es: 'Lo que has visto, a los mandos de tu entidad.', en: 'What you have seen, with your entity at the controls.' },
  lead: {
    es: 'La misma cuenta y las mismas piezas. Las llaves, la credencial y el quórum los pone la entidad; Astryum prepara y se aparta.',
    en: 'The same account and the same pieces. The keys, the credential and the quorum are the entity’s; Astryum prepares and steps aside.',
  },
};

const STOPS = [
  { id: 'position', num: '02', kicker: { es: 'Posición', en: 'Position' }, line: { es: 'La posición de la entidad, por plazo de liquidez.', en: 'The entity’s position, by liquidity term.' }, note: { es: 'Cuánto puede moverse hoy, en 24 horas o solo tras una cola de salida.', en: 'How much can move today, in 24 hours, or only after an exit queue.' } },
  { id: 'organ', num: '03', kicker: { es: 'Órgano', en: 'Body' }, line: { es: 'Cada cuenta de la entidad, con su quórum.', en: 'Each of the entity’s accounts, with its quorum.' }, note: { es: 'Firma el órgano de la entidad, no una persona. Está escrito en el ledger.', en: 'The entity’s governing body signs, not a person. It is written on the ledger.' } },
  { id: 'limits', num: '04', kicker: { es: 'Límites', en: 'Limits' }, line: { es: 'La exposición de la entidad la limita un contrato.', en: 'A contract limits the entity’s exposure.' }, note: { es: 'Venues permitidos, tope por venue y una reserva siempre líquida. Si la entidad gestiona capital de terceros, es también su jaula: dirige, no retira.', en: 'Allowed venues, a cap per venue and an always-liquid reserve. If the entity manages third-party capital, it is also its cage: it directs, it does not withdraw.' } },
  { id: 'record', num: '05', kicker: { es: 'Registro', en: 'Record' }, line: { es: 'Cada transacción de la entidad deja su asiento.', en: 'Every transaction of the entity leaves its entry.' }, note: { es: 'Simulada, autorizada, liquidada. Conciliable contra el explorador por quien lo pida.', en: 'Simulated, authorized, settled. Reconcilable against the explorer by whoever asks.' } },
] as const;

const CLOSE = {
  kicker: { es: 'La casa', en: 'The house' },
  line: { es: 'Astryum compila la operación, la enseña entera y se aparta.', en: 'Astryum compiles the operation, shows it whole and steps aside.' },
  sub: { es: 'La entidad decide, y la entidad firma.', en: 'The entity decides, and the entity signs.' },
};

export default function EmpresaJourney({ lang, finaleCta, switcher }: { lang: Lang; finaleCta: ReactNode; switcher?: ReactNode }) {
  const reduce = useReducedMotion();
  const level = useMotionLevel();
  const trackRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: trackRef, offset: ['start start', 'end end'] });
  const jumpTo = useJumpTo(trackRef);
  const heroOpacity = useTransform(scrollYProgress, [COPY.hero[0], COPY.hero[1] * 0.7], [1, 0], { clamp: true });
  const heroY = useTransform(scrollYProgress, [0, 0.16], [0, -60], { clamp: true });

  if (reduce) return <StaticEmpresa lang={lang} finaleCta={finaleCta} switcher={switcher} />;

  return (
    <>
      <div className="lg:hidden">
        <StaticEmpresa lang={lang} finaleCta={finaleCta} switcher={switcher} />
      </div>

      <section ref={trackRef} id="journey" className="relative hidden lg:block h-[760svh]">
        {/* Las anclas del itinerario: el botón de scroll de la página baja de
            parada en parada leyendo `stop-<id>`, y así recorre ESTE mundo. */}
        <StationAnchors stations={STATIONS} />

        <div className="sticky top-0 h-[100svh] overflow-hidden">
          {/* EL TEXTO A LA IZQUIERDA Y EL ARTEFACTO A LA DERECHA DESDE EL SEGUNDO
              CERO: la misma maqueta que la portada — el
              hero ocupa la columna izquierda, la escena la derecha, y las
              paradas entran después por la izquierda mientras la escena se
              queda donde estaba. */}
          <motion.div style={{ opacity: heroOpacity, y: heroY }} className="absolute left-0 top-[22svh] w-[48%] pl-[6vw] pr-6 z-20 pointer-events-none">
            <div>
              <HeroBadge lang={lang} />
              <h1 className="mt-6 font-bold text-white text-balance" style={{ fontSize: 'clamp(1.8rem, 3.3vw, 3rem)', lineHeight: 1.06, letterSpacing: '-0.03em' }}>
                {T(HERO.title.es, HERO.title.en, lang)}
              </h1>
              <p className="mt-5 text-white/55 leading-relaxed max-w-xl" style={{ fontSize: 'clamp(15px, 1.3vw, 17px)' }}>
                {T(HERO.lead.es, HERO.lead.en, lang)}
              </p>
            </div>
          </motion.div>

          {/* LA ESCENA, acotada al alto de la ventana: la carta es un círculo y
              a toda anchura se saldría por abajo. */}
          <div className="absolute right-[3vw] top-1/2 -translate-y-1/2 w-[52%] z-10">
            <StarChartScene progress={scrollYProgress} lang={lang} level={level} />
          </div>

          <ReadingVeil progress={scrollYProgress} from={COPY.position[0]} to={COPY.record[1]} />

          {STOPS.map((s) => (
            <Dock key={s.id} progress={scrollYProgress} range={COPY[s.id]}>
              {(active) => (
                <>
                  <Kicker lang={lang} num={s.num} es={s.kicker.es} en={s.kicker.en} />
                  <Line lang={lang} es={s.line.es} en={s.line.en} />
                  <Notes lang={lang} items={[s.note]} />
                  <div className="mt-7">
                    <Artifact id={s.id} lang={lang} active={active} progress={scrollYProgress} />
                  </div>
                </>
              )}
            </Dock>
          ))}

          <Finale progress={scrollYProgress} range={COPY.close} lang={lang} num="06" kicker={CLOSE.kicker} line={CLOSE.line} sub={CLOSE.sub} />
          <Beat progress={scrollYProgress} range={COPY.close} hold className="left-1/2 -translate-x-1/2 bottom-[15svh] text-center">
            <div className="pointer-events-auto">{finaleCta}</div>
          </Beat>

          <StationRail progress={scrollYProgress} lang={lang} stations={STATIONS} onJump={jumpTo} />
          {switcher && (
            <motion.div className="absolute top-[140px] left-1/2 -translate-x-1/2 z-40" style={{ opacity: heroOpacity }}>
              {switcher}
            </motion.div>
          )}
        </div>
      </section>
    </>
  );
}

function Artifact({ id, lang, active, progress, compact }: { id: (typeof STOPS)[number]['id']; lang: Lang; active?: boolean; progress?: ReturnType<typeof useScroll>['scrollYProgress']; compact?: boolean }) {
  if (id === 'position') return <LadderArtifact lang={lang} active={active} progress={progress} compact={compact} />;
  if (id === 'organ') return <MatrixArtifact lang={lang} active={active} progress={progress} compact={compact} />;
  if (id === 'limits') return <ExposureArtifact lang={lang} active={active} progress={progress} compact={compact} />;
  return <LedgerArtifact lang={lang} active={active} progress={progress} compact={compact} />;
}

function HeroBadge({ lang }: { lang: Lang }) {
  return (
    <span
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-mono uppercase tracking-[0.2em]"
      style={{ border: '1px solid hsl(var(--volt) / 0.3)', background: 'hsl(var(--volt) / 0.06)', color: 'hsl(var(--volt-soft))' }}
    >
      {T(HERO.badge.es, HERO.badge.en, lang)}
    </span>
  );
}

/** La versión quieta: móvil y movimiento reducido. La misma historia, apilada. */
function StaticEmpresa({ lang, finaleCta, switcher }: { lang: Lang; finaleCta: ReactNode; switcher?: ReactNode }) {
  return (
    <section className="relative px-6 md:px-10 lg:px-16 pt-36 pb-24">
      <div className="max-w-4xl mx-auto">
        {switcher && <div className="flex justify-center mb-10">{switcher}</div>}
        <HeroBadge lang={lang} />
        <h1 className="mt-6 font-bold text-white" style={{ fontSize: 'clamp(2rem, 7vw, 3rem)', lineHeight: 1.08, letterSpacing: '-0.03em' }}>
          {T(HERO.title.es, HERO.title.en, lang)}
        </h1>
        <p className="mt-5 text-white/55 leading-relaxed max-w-xl">{T(HERO.lead.es, HERO.lead.en, lang)}</p>

        <div className="mt-12 rounded-2xl p-4 md:p-6" style={{ border: `1px solid ${BORDER_STRONG}` }}>
          <StarChartScene progress={STILL} lang={lang} level="minimal" still />
        </div>

        <div className="mt-12 space-y-10">
          {STOPS.map((s) => (
            <motion.div
              key={s.id}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.55, ease: EASE }}
              className="pt-6"
              style={{ borderTop: `1px solid ${BORDER}` }}
            >
              <Kicker lang={lang} num={s.num} es={s.kicker.es} en={s.kicker.en} />
              <Line lang={lang} es={s.line.es} en={s.line.en} />
              <Notes lang={lang} items={[s.note]} />
              <div className="mt-5">
                <Artifact id={s.id} lang={lang} compact />
              </div>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.6, ease: EASE }}
          className="mt-12 pt-8"
          style={{ borderTop: `1px solid ${BORDER}` }}
        >
          <Kicker lang={lang} num="06" es={CLOSE.kicker.es} en={CLOSE.kicker.en} />
          <Line lang={lang} es={CLOSE.line.es} en={CLOSE.line.en} />
          <p className="mt-5 max-w-xl text-[15px] leading-snug text-white/55">{T(CLOSE.sub.es, CLOSE.sub.en, lang)}</p>
          <div className="mt-8">{finaleCta}</div>
        </motion.div>
      </div>
    </section>
  );
}
