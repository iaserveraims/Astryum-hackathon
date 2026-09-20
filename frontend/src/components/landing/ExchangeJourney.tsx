'use client';

/**
 * EL VIAJE EXCHANGE — la estación.
 *
 * La página para un exchange: su ómnibus, una casilla por cliente, el flujo de
 * acuñaciones hacia el pote en Flare, la reserva que el contrato obliga a
 * mantener y la conciliación de los tres libros. Sobre la carcasa compartida
 * (journeyShell), con su escena (art/StationScene) y sus láminas en el idioma
 * de operaciones (art/ExchangeArtifacts).
 *
 * Un rótulo, un titular y UNA frase por parada. Astryum prepara; el exchange
 * firma desde su propio ómnibus. Nadie en Astryum admite a ningún cliente:
 * lo dice el texto porque lo dice el diseño (`acceso-publico-credencial…`).
 */

import { useRef, type ReactNode } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { useMotionLevel, useReducedMotion } from '../../stores/motionStore';
import { BORDER, BORDER_STRONG, EASE } from './interactions';
import { STATION_BEATS, StationScene } from './art/StationScene';
import { FlowArtifact, ReconArtifact, ReserveArtifact, SlotsArtifact } from './art/ExchangeArtifacts';
import { Beat, Dock, Finale, Kicker, Line, Notes, ReadingVeil, STILL, StationAnchors, StationRail, useJumpTo, type JourneyStation } from './journeyShell';

type Lang = 'es' | 'en';
const T = (es: string, en: string, lang: Lang) => (lang === 'es' ? es : en);

const COPY = {
  hero: [0.0, STATION_BEATS.hub[1]] as const,
  bays: STATION_BEATS.bays,
  flow: STATION_BEATS.flow,
  reserve: STATION_BEATS.reserve,
  reconcile: STATION_BEATS.reconcile,
  close: STATION_BEATS.close,
};

const STATIONS: readonly JourneyStation[] = [
  { id: 'hub', es: 'El ómnibus', en: 'The omnibus', at: 0.04, from: 0.0, to: STATION_BEATS.hub[1] },
  { id: 'bays', es: 'Casillas', en: 'Slots', at: 0.2, from: COPY.bays[0], to: COPY.bays[1] },
  { id: 'flow', es: 'Flujo', en: 'Flow', at: 0.39, from: COPY.flow[0], to: COPY.flow[1] },
  { id: 'reserve', es: 'Reserva', en: 'Reserve', at: 0.56, from: COPY.reserve[0], to: COPY.reserve[1] },
  { id: 'reconcile', es: 'Conciliación', en: 'Reconciliation', at: 0.75, from: COPY.reconcile[0], to: COPY.reconcile[1] },
  { id: 'close', es: 'La casa', en: 'The house', at: 0.95, from: COPY.close[0], to: 1.0 },
];

const HERO = {
  badge: { es: 'Aplicado a un exchange · piloto en preparación', en: 'Applied to an exchange · pilot in preparation' },
  title: { es: 'Lo que has visto, con tu ómnibus a los mandos.', en: 'What you have seen, with your omnibus at the controls.' },
  lead: {
    es: 'Tu exchange abre su instancia: su ómnibus, sus casillas, sus clientes. Astryum prepara; tu llave firma; los límites los impone un contrato.',
    en: 'Your exchange opens its instance: its omnibus, its slots, its clients. Astryum prepares; your key signs; a contract enforces the limits.',
  },
};

const STOPS = [
  { id: 'bays', num: '02', kicker: { es: 'Casillas', en: 'Slots' }, line: { es: 'Una casilla por cliente.', en: 'One slot per client.' }, note: { es: 'Tu exchange admite a cada cliente con su KYC. Sin credencial, no entra. Para salir nunca hace falta.', en: 'Your exchange admits each client with their KYC. Without a credential, no entry. To exit, it is never required.' } },
  { id: 'flow', num: '03', kicker: { es: 'Flujo', en: 'Flow' }, line: { es: 'Cada depósito, una operación trazable.', en: 'Every deposit, a traceable operation.' }, note: { es: 'Preparada, firmada por tu llave, en vuelo, liquidada.', en: 'Prepared, signed by your key, in flight, settled.' } },
  { id: 'reserve', num: '04', kicker: { es: 'Reserva', en: 'Reserve' }, line: { es: 'Las salidas, desde una reserva obligatoria.', en: 'Exits, from a mandatory reserve.' }, note: { es: 'El contrato la mantiene. La salida hacia tu ómnibus no la puede cerrar nadie.', en: 'The contract keeps it. Nobody can close the exit back to your omnibus.' } },
  { id: 'reconcile', num: '05', kicker: { es: 'Conciliación', en: 'Reconciliation' }, line: { es: 'Tres libros que tienen que cuadrar.', en: 'Three books that have to match.' }, note: { es: 'El tuyo, el de XRPL y el contrato en Flare, casilla a casilla.', en: 'Yours, XRPL’s and the contract on Flare, slot by slot.' } },
] as const;

const CLOSE = {
  kicker: { es: 'La casa', en: 'The house' },
  line: { es: 'Astryum prepara. Tu exchange firma.', en: 'Astryum prepares. Your exchange signs.' },
  sub: { es: 'Ni ómnibus, ni llaves, ni clientes: Astryum no tiene ninguno.', en: 'No omnibus, no keys, no clients: Astryum holds none.' },
};

export default function ExchangeJourney({ lang, finaleCta, switcher }: { lang: Lang; finaleCta: ReactNode; switcher?: ReactNode }) {
  const reduce = useReducedMotion();
  const level = useMotionLevel();
  const trackRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: trackRef, offset: ['start start', 'end end'] });
  const jumpTo = useJumpTo(trackRef);
  const heroOpacity = useTransform(scrollYProgress, [COPY.hero[0], COPY.bays[0] + 0.03], [1, 0], { clamp: true });
  const heroY = useTransform(scrollYProgress, [0, 0.14], [0, -60], { clamp: true });

  if (reduce) return <StaticExchange lang={lang} finaleCta={finaleCta} switcher={switcher} />;

  return (
    <>
      <div className="lg:hidden">
        <StaticExchange lang={lang} finaleCta={finaleCta} switcher={switcher} />
      </div>

      <section ref={trackRef} id="journey" className="relative hidden lg:block h-[760svh]">
        {/* Las anclas del itinerario: el botón de scroll de la página baja de
            parada en parada leyendo `stop-<id>`, y así recorre ESTE mundo. */}
        <StationAnchors stations={STATIONS} />

        <div className="sticky top-0 h-[100svh] overflow-hidden">
          {/* EL TEXTO A LA IZQUIERDA Y EL ARTEFACTO A LA DERECHA DESDE EL SEGUNDO
              CERO (fundador 2026-09-20): la misma maqueta que la portada — el
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

          <div className="absolute right-[3vw] top-1/2 -translate-y-1/2 w-[52%] z-10">
            <StationScene progress={scrollYProgress} lang={lang} level={level} />
          </div>

          <ReadingVeil progress={scrollYProgress} from={COPY.bays[0]} to={COPY.reconcile[1]} />

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
  if (id === 'bays') return <SlotsArtifact lang={lang} active={active} progress={progress} compact={compact} />;
  if (id === 'flow') return <FlowArtifact lang={lang} active={active} progress={progress} compact={compact} />;
  if (id === 'reserve') return <ReserveArtifact lang={lang} active={active} progress={progress} compact={compact} />;
  return <ReconArtifact lang={lang} active={active} progress={progress} compact={compact} />;
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

function StaticExchange({ lang, finaleCta, switcher }: { lang: Lang; finaleCta: ReactNode; switcher?: ReactNode }) {
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
          <StationScene progress={STILL} lang={lang} level="minimal" still />
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
