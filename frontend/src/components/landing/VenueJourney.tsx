'use client';

/**
 * EL VIAJE VENUES — la ficha: el protocolo como destino.
 *
 * Fundador (2026-09-20): «una sola página para la gente que son los admins de
 * venues, para que puedan entrar, revisar cómo funciona y aplicar para uno».
 * Hasta aquí la landing hablaba a quien pone capital; esta habla a quien lo
 * recibe. Misma carcasa (journeyShell), misma maqueta que las otras puertas
 * —texto a la izquierda, escena a la derecha desde el primer fotograma— y
 * el material de Empresa: un venue es una entidad.
 *
 * Lo que cuenta sale de la arquitectura del perfil del protocolo (15-sep) y
 * está EN DISEÑO; lo dice en la primera línea. Astryum no recomienda venues:
 * certifica, enseña y se aparta.
 */

import { useRef, type ReactNode } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { useMotionLevel, useReducedMotion } from '../../stores/motionStore';
import { BORDER, BORDER_STRONG, EASE } from './interactions';
import { VENUE_BEATS, VenueScene } from './art/VenueScene';
import { DirectedArtifact, LevelsArtifact, ProfileArtifact, TestsArtifact } from './art/VenueArtifacts';
import { Beat, Dock, Finale, Kicker, Line, Notes, ReadingVeil, STILL, StationAnchors, StationRail, useJumpTo, type JourneyStation } from './journeyShell';

type Lang = 'es' | 'en';
const T = (es: string, en: string, lang: Lang) => (lang === 'es' ? es : en);

const COPY = {
  hero: [0.0, VENUE_BEATS.approach[1]] as const,
  profile: VENUE_BEATS.profile,
  tests: VENUE_BEATS.tests,
  /** El certificado y los niveles son UNA parada: el certificado es el
   *  segundo nivel, y los cuatro no se entienden sin él. */
  levels: [VENUE_BEATS.certify[0], VENUE_BEATS.levels[1]] as const,
  flow: VENUE_BEATS.flow,
  close: VENUE_BEATS.close,
};

const STATIONS: readonly JourneyStation[] = [
  { id: 'venue', es: 'El destino', en: 'The destination', at: 0.04, from: 0.0, to: VENUE_BEATS.approach[1] },
  { id: 'profile', es: 'La ficha', en: 'The sheet', at: 0.19, from: COPY.profile[0], to: COPY.profile[1] },
  { id: 'tests', es: 'Las pruebas', en: 'The tests', at: 0.38, from: COPY.tests[0], to: COPY.tests[1] },
  { id: 'levels', es: 'Niveles', en: 'Levels', at: 0.63, from: COPY.levels[0], to: COPY.levels[1] },
  { id: 'flow', es: 'Capital', en: 'Capital', at: 0.83, from: COPY.flow[0], to: COPY.flow[1] },
  { id: 'close', es: 'La casa', en: 'The house', at: 0.95, from: COPY.close[0], to: 1.0 },
];

const HERO = {
  badge: { es: 'Para venues · perfil del protocolo en diseño', en: 'For venues · protocol profile in design' },
  title: { es: 'Lo que has visto, desde el otro lado: tu protocolo como destino.', en: 'What you have seen, from the other side: your protocol as the destination.' },
  lead: {
    es: 'Los potes dirigen capital solo a venues certificados. Aquí está cómo se entra en el catálogo, qué se mide y qué no puedes tocar.',
    en: 'Pots direct capital only to certified venues. This is how you enter the catalogue, what gets measured and what you cannot touch.',
  },
};

const STOPS = [
  { id: 'profile', num: '02', kicker: { es: 'La ficha', en: 'The sheet' }, line: { es: 'Un perfil verificado, no un logo.', en: 'A verified profile, not a logo.' }, note: { es: 'Qué es, cómo se sale, quién decide y con qué fuente. Tú propones; lo medido no se edita.', en: 'What it is, how to exit, who decides and with which source. You propose; what was measured is not edited.' } },
  { id: 'tests', num: '03', kicker: { es: 'Las pruebas', en: 'The tests' }, line: { es: 'Tres pruebas que nadie puede hacer por ti.', en: 'Three tests nobody can do for you.' }, note: { es: 'Firma desde la cuenta que desplegó el contrato, un fichero en tu propio dominio y la identidad legal de la empresa.', en: 'A signature from the account that deployed the contract, a file on your own domain and the company’s legal identity.' } },
  { id: 'levels', num: '04', kicker: { es: 'Niveles', en: 'Levels' }, line: { es: 'Certificado y fechado. Y revocable en el acto.', en: 'Certified and dated. And revocable on the spot.' }, note: { es: 'Subir de nivel lleva verificación; bajar es inmediato. Quien ya tiene capital dentro puede salir siempre.', en: 'Moving up takes verification; moving down is immediate. Whoever already has capital inside can always leave.' } },
  { id: 'flow', num: '05', kicker: { es: 'Capital', en: 'Capital' }, line: { es: 'Los potes dirigen capital hacia ti. Con atribución.', en: 'Pots direct capital to you. With attribution.' }, note: { es: 'Cada pote que te elige queda atribuido. Astryum no recomienda venues: certifica y enseña.', en: 'Every pot that picks you is attributed. Astryum does not recommend venues: it certifies and lists.' } },
] as const;

const CLOSE = {
  kicker: { es: 'La casa', en: 'The house' },
  line: { es: 'Astryum no recomienda. Certifica, enseña y se aparta.', en: 'Astryum does not recommend. It certifies, lists and steps aside.' },
  sub: { es: 'Quien dirige el capital decide; el contrato impone sus límites. Pide la verificación y entra en el catálogo por tus pruebas, no por un favor.', en: 'Whoever directs the capital decides; the contract enforces its limits. Request verification and enter the catalogue on your tests, not on a favour.' },
};

export default function VenueJourney({ lang, finaleCta, switcher }: { lang: Lang; finaleCta: ReactNode; switcher?: ReactNode }) {
  const reduce = useReducedMotion();
  const level = useMotionLevel();
  const trackRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: trackRef, offset: ['start start', 'end end'] });
  const jumpTo = useJumpTo(trackRef);
  const heroOpacity = useTransform(scrollYProgress, [COPY.hero[0], COPY.profile[0] + 0.03], [1, 0], { clamp: true });
  const heroY = useTransform(scrollYProgress, [0, 0.14], [0, -60], { clamp: true });

  if (reduce) return <StaticVenue lang={lang} finaleCta={finaleCta} switcher={switcher} />;

  return (
    <>
      <div className="lg:hidden">
        <StaticVenue lang={lang} finaleCta={finaleCta} switcher={switcher} />
      </div>

      <section ref={trackRef} id="journey" className="relative hidden lg:block h-[760svh]">
        <StationAnchors stations={STATIONS} />

        <div className="sticky top-0 h-[100svh] overflow-hidden">
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
            <VenueScene progress={scrollYProgress} lang={lang} level={level} />
          </div>

          <ReadingVeil progress={scrollYProgress} from={COPY.profile[0]} to={COPY.flow[1]} />

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
  if (id === 'profile') return <ProfileArtifact lang={lang} active={active} progress={progress} compact={compact} />;
  if (id === 'tests') return <TestsArtifact lang={lang} active={active} progress={progress} compact={compact} />;
  if (id === 'levels') return <LevelsArtifact lang={lang} active={active} progress={progress} compact={compact} />;
  return <DirectedArtifact lang={lang} active={active} progress={progress} compact={compact} />;
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

function StaticVenue({ lang, finaleCta, switcher }: { lang: Lang; finaleCta: ReactNode; switcher?: ReactNode }) {
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
          <VenueScene progress={STILL} lang={lang} level="minimal" still />
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
