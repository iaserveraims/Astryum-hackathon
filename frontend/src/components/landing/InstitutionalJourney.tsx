'use client';

/**
 * EL VIAJE INSTITUCIONAL — la tierra.
 *
 * El tercer mundo de la landing. No comparte NADA con el sistema solar: ni
 * estrellas, ni órbitas, ni planetas, ni asteroide. La escena entera es el
 * nombre de la casa abriéndose por su Y (art/ValleyScene.tsx) hasta ser un
 * valle con su lago, y después un par de cumbres.
 */

import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { useMotionLevel, useReducedMotion } from '../../stores/motionStore';
import { BORDER, BORDER_STRONG, EASE } from './interactions';
import { ValleyScene, BEATS } from './art/ValleyScene';
import { WordmarkWhole, useLetterBoxes } from './art/Wordmark';
import { PoolArtifact, FilterArtifact, RecordArtifact } from './art/InstitutionalArtifacts';
import {
  Beat,
  Dock,
  Finale,
  Kicker,
  Line,
  Notes,
  ReadingVeil,
  StationAnchors,
  STILL,
  StationRail,
  useJumpTo,
  type JourneyStation,
} from './journeyShell';
import type { ReactNode } from 'react';

type Lang = 'es' | 'en';
const T = (es: string, en: string, lang: Lang) => (lang === 'es' ? es : en);

/** Los tiempos del texto, atados a los de la escena: una sola tabla manda. */
const COPY_BEATS = {
  hero: [0.0, BEATS.approach[1]] as const,
  /** El acercamiento tenía escena y ni una palabra: seis tiempos de dibujo y
   *  tres de texto. Este es el que faltaba. */
  plane: [BEATS.approach[0] + (BEATS.approach[1] - BEATS.approach[0]) * 0.45, BEATS.approach[1]] as const,
  basin: BEATS.basin,
  filter: BEATS.filter,
  valley: BEATS.valley,
  close: BEATS.close,
};

const STATIONS: readonly JourneyStation[] = [
  { id: 'name', es: 'El nombre', en: 'The name', at: 0.02, from: 0.0, to: BEATS.approach[0] },
  { id: 'plane', es: 'El plano', en: 'The plane', at: 0.21, from: BEATS.approach[0], to: BEATS.approach[1] },
  { id: 'basin', es: 'La lámina', en: 'The pool', at: 0.33, from: BEATS.basin[0], to: BEATS.basin[1] },
  { id: 'filter', es: 'El tamiz', en: 'The sieve', at: 0.5, from: BEATS.filter[0], to: BEATS.filter[1] },
  { id: 'valley', es: 'El valle', en: 'The valley', at: 0.73, from: BEATS.valley[0], to: BEATS.valley[1] },
  { id: 'close', es: 'La casa', en: 'The house', at: 0.93, from: BEATS.close[0], to: 1.0 },
];

export default function InstitutionalJourney({
  lang,
  finaleCta,
  switcher,
}: {
  lang: Lang;
  finaleCta: ReactNode;
  /** El conmutador de mundos, montado por la página: con tres productos el
   *  botón no puede vivir dentro de uno de ellos. */
  switcher: ReactNode;
}) {
  const reduce = useReducedMotion();
  const level = useMotionLevel();
  const trackRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: trackRef, offset: ['start start', 'end end'] });
  const { letters, measured, settled } = useLetterBoxes();
  const jumpTo = useJumpTo(trackRef);

  const heroOpacity = useTransform(scrollYProgress, [COPY_BEATS.hero[0], COPY_BEATS.hero[1] * 0.7], [1, 0], { clamp: true });
  const heroY = useTransform(scrollYProgress, [0, 0.16], [0, -60], { clamp: true });

  // Movimiento reducido y móvil: la misma historia, quieta y apilada. No es un
  // párrafo disfrazado — lleva la escena en su fotograma de reposo y las tres
  // viñetas de producto, que es donde está el contenido.
  if (reduce) return <StaticInstitutional lang={lang} finaleCta={finaleCta} switcher={switcher} letters={letters} measured={measured} />;

  return (
    <>
      <div className="lg:hidden">
        <StaticInstitutional lang={lang} finaleCta={finaleCta} switcher={switcher} letters={letters} measured={measured} />
      </div>

      {/* 760svh: pista suficiente para que un golpe de trackpad cubra UN
          tiempo y no tres — la misma lección que el viaje solar pagó. */}
      <section ref={trackRef} id="journey" className="relative hidden lg:block h-[760svh]">
        {/* Un anclaje por parada, para que el botón de scroll recorra ESTE
            itinerario y no el de Personal. Ver `StationAnchors`. */}
        <StationAnchors stations={STATIONS} />

        <div className="sticky top-0 h-[100svh] overflow-hidden flex flex-col justify-center pt-[16svh]">
          {/* EL TEXTO DE ENTRADA — se aparta en cuanto la cámara entra en la Y.
              A top-[20svh] y no a 17: el aviso honesto del conmutador cuelga a
              196 px y el titular se le cruzaba (medido en captura). El que se
              mueve es el titular — el conmutador vive a top-[140px] en los TRES
              mundos y moverlo aquí haría saltar el botón al cambiar de producto. */}
          <motion.div
            style={{ opacity: heroOpacity, y: heroY }}
            className="absolute inset-x-0 top-[20svh] px-6 md:px-10 lg:px-16 z-20 pointer-events-none"
          >
            {/* LA ENTRADA ANIMA EL BLOQUE ENTERO, no solo el nombre.
                La primera versión puso el gesto únicamente en
                las letras del logotipo y el cuño, el titular y el pie salían ya
                puestos — que es peor que no animar nada, porque delata que lo
                animado es un adorno y no una entrada.
            { *
                Tres retardos escalonados, en el mismo orden en que se lee. Van
                antes que las letras del nombre (que arrancan a 0,1 s) porque
                así el nombre REMATA la entrada en vez de abrirla. */}
            <div className="max-w-6xl mx-auto">
              {[
                <span
                  key="k"
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-mono uppercase tracking-[0.2em]"
                  style={{ border: '1px solid hsl(var(--volt) / 0.3)', background: 'hsl(var(--volt) / 0.06)', color: 'hsl(var(--volt-soft))' }}
                >
                  {T('Astryum · para entidades', 'Astryum · for entities', lang)}
                </span>,
                <h1
                  key="h"
                  className="mt-6 font-bold text-white max-w-3xl"
                  style={{ fontSize: 'clamp(2rem, 4.6vw, 3.6rem)', lineHeight: 1.06, letterSpacing: '-0.03em' }}
                >
                  {T('Un plano de control para el capital de una entidad.', 'A control plane for an entity’s capital.', lang)}
                </h1>,
                <p key="p" className="mt-5 text-white/55 leading-relaxed max-w-xl" style={{ fontSize: 'clamp(15px, 1.3vw, 17px)' }}>
                  {T(
                    'Se ve entero, se mueve cuando la entidad lo decide, y cada acción deja su prueba.',
                    'Seen whole, moved when the entity decides, and every action leaves its proof.',
                    lang,
                  )}
                </p>,
              ].map((node, i) => (
                <motion.div
                  key={i}
                  initial={reduce ? false : { opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.7, delay: 0.05 + i * 0.09, ease: EASE }}
                >
                  {node}
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* LA ESCENA. La cámara interpola también el ASPECTO, así que el
              elemento necesita un alto de verdad y no `h-auto`: con la franja de
              154 px de antes, a ×4,6 la ventana medía treinta y dos unidades y
              las dos cumbres, el fondo de la cuenca y la nieve caían fuera. */}
          {/* SIN `max-w`: la escena sangra a toda la ventana. El nombre sigue
              midiendo lo mismo porque la cámara deriva su lienzo del ancho real
              (`targetPx`), y el paisaje ya no termina en el canto de una
              columna de texto. */}
          <div className="w-full mt-[2svh]">
            <ValleyScene progress={scrollYProgress} lang={lang} letters={letters} measured={measured} settled={settled} level={level} />
          </div>

          {/* EL VELO DE LECTURA. Sin él la escena a sangre pasa por detrás del
              texto sin nada que los separe, y el texto se pierde. */}
          <ReadingVeil progress={scrollYProgress} from={COPY_BEATS.plane[0]} to={BEATS.valley[1]} />

          {/* ── LAS PARADAS: rótulo, titular, apuntes y viñeta, JUNTOS ─────
              Antes el texto vivía abajo a la izquierda y la viñeta abajo a la
              derecha, con media pantalla de escena entre los dos: dos cosas
              pequeñas en dos esquinas en vez de una columna que se lee. */}
          <Dock progress={scrollYProgress} range={COPY_BEATS.plane}>
            {() => (
              <>
                <Kicker lang={lang} num="02" es="El plano" en="The control plane" />
                <Line lang={lang} es="Un sitio donde el capital de la entidad se ve entero." en="One place where the entity’s capital is seen whole." />
                <Notes
                  lang={lang}
                  items={[
                    { es: 'Sin sacar las llaves de donde están.', en: 'Without moving the keys from where they are.' },
                    { es: 'Sin pedirle a nadie que firme en su nombre.', en: 'Without asking anyone to sign on its behalf.' },
                  ]}
                />
              </>
            )}
          </Dock>

          <Dock progress={scrollYProgress} range={COPY_BEATS.basin}>
            {(active) => (
              <>
                <Kicker lang={lang} num="03" es="La lámina" en="The pool" />
                <Line lang={lang} es="El capital de la entidad, junto y a la vista." en="The entity’s capital, together and in plain sight." />
                <Notes
                  lang={lang}
                  items={[
                    { es: 'Varias cuentas, una sola superficie.', en: 'Several accounts, a single surface.' },
                    { es: 'Las llaves siguen donde estaban.', en: 'The keys stay where they were.' },
                    { es: 'Y quien firma sigue siendo la entidad.', en: 'And the one who signs is still the entity.' },
                  ]}
                />
                <div className="mt-7">
                  <PoolArtifact lang={lang} active={active} progress={scrollYProgress} />
                </div>
              </>
            )}
          </Dock>

          <Dock progress={scrollYProgress} range={COPY_BEATS.filter}>
            {(active) => (
              <>
                <Kicker lang={lang} num="04" es="El tamiz" en="The sieve" />
                <Line lang={lang} es="Lo que no cumple la política, no entra." en="What fails the policy does not enter." />
                <Notes
                  lang={lang}
                  items={[
                    { es: 'La regla se escribe antes, no después.', en: 'The rule is written before, not after.' },
                    { es: 'Dos de seis principios se quedan fuera.', en: 'Two of six principles stay out.' },
                    { es: 'Y lo que se queda fuera dice por qué.', en: 'And what stays out says why.' },
                  ]}
                />
                <div className="mt-7">
                  <FilterArtifact lang={lang} active={active} progress={scrollYProgress} />
                </div>
              </>
            )}
          </Dock>

          <Dock progress={scrollYProgress} range={COPY_BEATS.valley}>
            {(active) => (
              <>
                <Kicker lang={lang} num="05" es="El valle" en="The valley" />
                <Line lang={lang} es="Se opera desde Andorra." en="Operated from Andorra." />
                <Notes
                  lang={lang}
                  items={[
                    { es: 'Cada movimiento deja su asiento.', en: 'Every movement leaves its entry.' },
                    { es: 'Comprobable por quien lo pida.', en: 'Verifiable by whoever asks.' },
                    { es: 'Sin pedirle permiso a nadie para salir.', en: 'Without asking anyone’s permission to leave.' },
                  ]}
                />
                <div className="mt-7">
                  <RecordArtifact lang={lang} active={active} progress={scrollYProgress} />
                </div>
              </>
            )}
          </Dock>

          {/* ── EL CIERRE ────────────────────────────────────────────────
              La sexta parada se llamaba «La casa» en la barra y no decía nada.
              Lo que la casa ES son los tres verbos que Astryum NO hace: es el
              invariante número uno del repo y a la vez la única frase que
              justifica todo lo que se acaba de mirar —el plano, la lámina, el
              tamiz y el asiento— sin prometer ni un resultado. */}
          <Finale
            progress={scrollYProgress}
            range={COPY_BEATS.close}
            lang={lang}
            num="06"
            kicker={{ es: 'La casa', en: 'The house' }}
            line={{
              es: 'Astryum no firma, no custodia y no ejecuta.',
              en: 'Astryum never signs, never holds, never executes.',
            }}
            sub={{
              es: 'Compila la operación, la enseña entera y se aparta. La entidad decide, y la entidad firma.',
              en: 'It compiles the operation, shows it whole and steps aside. The entity decides, and the entity signs.',
            }}
          />

          {/* A 15 svh y no a 11: medido en captura, el botón se solapaba con el
              indicador de scroll que la página ancla abajo en el centro. */}
          <Beat progress={scrollYProgress} range={COPY_BEATS.close} hold className="left-1/2 -translate-x-1/2 bottom-[15svh] text-center">
            <div className="pointer-events-auto">{finaleCta}</div>
          </Beat>

          <StationRail progress={scrollYProgress} lang={lang} stations={STATIONS} onJump={jumpTo} />

          {/* El conmutador, en el fotograma de entrada y en el mismo sitio que
              en el viaje solar: cambiar de mundo se hace desde el mismo botón,
              esté uno en el mundo que esté. */}
          <motion.div className="absolute top-[140px] left-1/2 -translate-x-1/2 z-40" style={{ opacity: heroOpacity }}>
            {switcher}
          </motion.div>
        </div>
      </section>
    </>
  );
}

/**
 * La versión quieta: móvil y movimiento reducido. Misma historia, sin scroll
 * atado — la escena en su fotograma de reposo y las tres viñetas apiladas.
 * Que no haya scrollytelling no quiere decir que no haya producto.
 */
function StaticInstitutional({
  lang,
  finaleCta,
  switcher,
  letters,
  measured,
}: {
  lang: Lang;
  finaleCta: ReactNode;
  switcher: ReactNode;
  letters: ReturnType<typeof useLetterBoxes>['letters'];
  measured: boolean;
}) {
  const stops = [
    {
      id: 'pool',
      kicker: { es: 'La lámina', en: 'The pool' },
      line: { es: 'El capital de la entidad, junto y a la vista.', en: 'The entity’s capital, together and in plain sight.' },
      art: <PoolArtifact lang={lang} compact />,
    },
    {
      id: 'sieve',
      kicker: { es: 'El tamiz', en: 'The sieve' },
      line: { es: 'Lo que no cumple la política, no entra.', en: 'What fails the policy does not enter.' },
      art: <FilterArtifact lang={lang} compact />,
    },
    {
      id: 'record',
      kicker: { es: 'El valle', en: 'The valley' },
      line: { es: 'Se opera desde Andorra, y cada acción deja su prueba.', en: 'Operated from Andorra, and every action leaves its proof.' },
      art: <RecordArtifact lang={lang} compact />,
    },
  ];

  return (
    <section className="relative px-6 md:px-10 lg:px-16 pt-36 pb-24">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-center mb-10">{switcher}</div>
        <span
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-mono uppercase tracking-[0.2em]"
          style={{ border: '1px solid hsl(var(--volt) / 0.3)', background: 'hsl(var(--volt) / 0.06)', color: 'hsl(var(--volt-soft))' }}
        >
          {T('Astryum · para entidades', 'Astryum · for entities', lang)}
        </span>
        <h1 className="mt-6 font-bold text-white" style={{ fontSize: 'clamp(2rem, 7vw, 3rem)', lineHeight: 1.08, letterSpacing: '-0.03em' }}>
          {T('Un plano de control para el capital de una entidad.', 'A control plane for an entity’s capital.', lang)}
        </h1>
        <p className="mt-5 text-white/55 leading-relaxed max-w-xl">
          {T(
            'Se ve entero, se mueve cuando la entidad lo decide, y cada acción deja su prueba.',
            'Seen whole, moved when the entity decides, and every action leaves its proof.',
            lang,
          )}
        </p>

        <div className="mt-12 rounded-2xl p-6" style={{ border: `1px solid ${BORDER_STRONG}` }}>
          <ValleyScene progress={STILL} lang={lang} letters={letters} measured={measured} level="minimal" still />
          <div className="mt-6 text-[10px] font-mono uppercase tracking-[0.24em]" style={{ color: 'hsl(var(--volt-soft) / 0.8)' }}>
            {T('Se opera desde Andorra', 'Operated from Andorra', lang)}
          </div>
        </div>

        <div className="mt-12 space-y-10">
          {stops.map((s) => (
            <motion.div
              key={s.id}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.55, ease: EASE }}
              className="pt-6"
              style={{ borderTop: `1px solid ${BORDER}` }}
            >
              <Kicker lang={lang} es={s.kicker.es} en={s.kicker.en} />
              <Line lang={lang} es={s.line.es} en={s.line.en} />
              <div className="mt-5">{s.art}</div>
            </motion.div>
          ))}
        </div>

        {/* EL CIERRE, también aquí. La versión quieta contaba las tres paradas
            y saltaba al botón: la frase que resuelve el recorrido no puede ser
            un privilegio del que tenga ratón y pantalla grande. */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.6, ease: EASE }}
          className="mt-12 pt-8"
          style={{ borderTop: `1px solid ${BORDER}` }}
        >
          <Kicker lang={lang} num="06" es="La casa" en="The house" />
          <Line
            lang={lang}
            es="Astryum no firma, no custodia y no ejecuta."
            en="Astryum never signs, never holds, never executes."
          />
          <p className="mt-5 max-w-xl text-[15px] leading-snug text-white/55">
            {T(
              'Compila la operación, la enseña entera y se aparta. La entidad decide, y la entidad firma.',
              'It compiles the operation, shows it whole and steps aside. The entity decides, and the entity signs.',
              lang,
            )}
          </p>
          <div className="mt-8">{finaleCta}</div>
        </motion.div>
      </div>
    </section>
  );
}

export { WordmarkWhole };
