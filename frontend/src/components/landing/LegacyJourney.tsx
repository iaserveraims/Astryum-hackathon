'use client';

/**
 * EL VIAJE LEGACY — el arco.
 *
 * Encargo del fundador (2026-09-18): «tenemos que hacer algo con el Legacy que
 * esté entre narrativa espacial y narrativa de tierra como en el
 * institucional». Y sobre la primera respuesta a eso: «el legacy es una mierda
 * jaja, no se entiende el concepto… le falta concepto y personalidad. Cásate
 * con una idea y ejecuta».
 *
 * La idea, una sola, está en art/ThresholdScene.tsx: SE CONSTRUYE UN ARCO.
 * Un hueco, una cimbra que lo sostiene todo mientras estás, las dovelas
 * colocadas una a una, la clave, y entonces el descimbrado — se retira el
 * soporte y el arco se queda de pie. Eso es un legado, contado con el único
 * objeto que lo cuenta entero: construyes el soporte en vida, y el día que el
 * soporte se va la estructura tiene que aguantar sola.
 *
 * Y es literalmente lo que está entre el cielo y la tierra: un arco se apoya en
 * la roca y se recorta contra la noche, y por su ojo se ve el cielo.
 *
 * ── LO QUE ESTE VIAJE NO DICE ────────────────────────────────────────────
 * Ni una cifra de rendimiento, ni una promesa, ni un «cuando tú faltes» — el
 * producto es una jaula con consejo y quórum, no un seguro de vida. El quórum,
 * los pesos iguales y la clave maestra deshabilitada son MECANISMO. El aviso
 * honesto del conmutador sigue siendo la pieza que impide que una narrativa
 * bonita se lea como una puerta abierta.
 */

import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { useMotionLevel, useReducedMotion } from '../../stores/motionStore';
import { BORDER, BORDER_STRONG, EASE } from './interactions';
import { ThresholdScene, LEGACY_BEATS } from './art/ThresholdScene';
import { CouncilArtifact, ConstitutionArtifact, QuorumArtifact, HandoverArtifact } from './art/LegacyArtifacts';
import {
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

/** Los tiempos del texto, atados a los de la escena: una sola tabla manda.
 *
 *  El último tiempo se PARTE en dos. Antes el bloque del relevo se quedaba
 *  puesto («hold») hasta el final del recorrido y el botón colgaba de su propio
 *  bloque anclado abajo en el centro, encima del indicador de scroll de la
 *  portada: el lector llegaba al final y no había NI UNA frase que cerrara —
 *  solo la viñeta del relevo y un botón. Ahora el relevo se lee, se retira, y
 *  el cierre entra con su frase y su puerta. */
const COPY_BEATS = {
  hero: [0.0, LEGACY_BEATS.gap[1]] as const,
  centring: LEGACY_BEATS.centring,
  stones: LEGACY_BEATS.stones,
  key: LEGACY_BEATS.key,
  strike: LEGACY_BEATS.strike,
  handover: [LEGACY_BEATS.cross[0], 0.935] as const,
  close: [0.925, 1.0] as const,
};

/** EL CIERRE. Mecanismo, no promesa: quién firma, y quién NO puede firmar —
 *  incluida esta casa. */
const CLOSE = {
  kicker: { es: 'El arco', en: 'The arch' },
  line: {
    es: 'Se construye mientras estás. Aguanta cuando ya no.',
    en: 'Built while you are here. It holds when you are not.',
  },
  sub: {
    es: 'Tú propones, el consejo firma, nadie firma por ti. Astryum tampoco: no custodia, no ejecuta y no tiene ninguna clave por encima de las vuestras.',
    en: 'You propose, the council signs, nobody signs for you. Astryum neither: it does not custody, does not execute, and holds no key above yours.',
  },
};

const STATIONS: readonly JourneyStation[] = [
  { id: 'gap', es: 'El hueco', en: 'The gap', at: 0.02, from: 0.0, to: LEGACY_BEATS.gap[1] },
  { id: 'centring', es: 'La cimbra', en: 'The centring', at: 0.2, from: LEGACY_BEATS.centring[0], to: LEGACY_BEATS.centring[1] },
  { id: 'stones', es: 'El consejo', en: 'The council', at: 0.41, from: LEGACY_BEATS.stones[0], to: LEGACY_BEATS.stones[1] },
  { id: 'key', es: 'La clave', en: 'The keystone', at: 0.6, from: LEGACY_BEATS.key[0], to: LEGACY_BEATS.key[1] },
  { id: 'strike', es: 'El quórum', en: 'The quorum', at: 0.77, from: LEGACY_BEATS.strike[0], to: LEGACY_BEATS.strike[1] },
  { id: 'cross', es: 'El relevo', en: 'The handover', at: 0.94, from: LEGACY_BEATS.cross[0], to: 1.0 },
];

/**
 * LA ENTRADA AL MUNDO — el fotograma en que se LLEGA aquí.
 *
 * Fundador, 2026-09-19: «cuando se entra en el legacy, el personal tiene
 * animado el texto y artefactos como aparición pero el legacy no, aparece tal
 * cual». Cierto, y no es un detalle de gusto: Personal entra escalonado —el
 * distintivo, el titular, la entradilla, la escena, cada uno con su retardo— y
 * eso es lo que convierte un cambio de producto en una llegada en vez de en un
 * corte de plano. Legacy montaba de golpe, con todo puesto en el fotograma uno.
 *
 * Los tiempos son los de `HeroContent` (LandingPage) con su mismo orden, para
 * que los mundos se sientan de la misma casa. Tres reglas que no se tocan:
 *
 *   · Va en `initial`/`animate` —montaje— y NUNCA en `whileInView`: esto está
 *     sobre el pliegue, y un `whileInView` sobre el pliegue dispara o no
 *     dispara según cómo restaure el navegador el scroll.
 *   · Va en los HIJOS y no en el bloque del portadillo, que ya lleva `opacity`
 *     e `y` del scroll: framer escribe UN transform por elemento y la entrada
 *     le pisaría la salida (o al revés) sin decir nada.
 *   · NO lleva `scale`. La cámara de la escena mide el SVG con
 *     `getBoundingClientRect` en el layout (craftHooks.useAspectViewBox) y un
 *     ancestro escalado le da un ancho falso que además no se corrige NUNCA,
 *     porque el ResizeObserver no ve los transforms. Opacidad y traslación son
 *     transparentes para esa medida; una escala, no.
 *
 * En movimiento reducido no hay nada que apagar: el `MotionConfig` de la app
 * corta cada `motion.*` a su estado final, y este mundo ya se va a la versión
 * quieta antes de llegar aquí.
 */
const ENTER = {
  badge: { duration: 0.6, ease: EASE },
  title: { duration: 0.8, delay: 0.12, ease: EASE },
  lead: { duration: 0.8, delay: 0.3, ease: EASE },
  scene: { duration: 1.1, delay: 0.18, ease: EASE },
} as const;

const HERO_TITLE = {
  es: 'Lo que construyes tiene que poder cruzar sin ti.',
  en: 'What you build has to cross without you.',
};
const HERO_LEAD = {
  es: 'Se construye como un arco: las piezas se colocan antes, lo escrito las sostiene entre sí, y el día que se retira el soporte no se cae nada.',
  en: 'Built the way an arch is built: the pieces are set first, what is written makes them hold each other, and the day the support comes away nothing falls.',
};

export default function LegacyJourney({
  lang,
  finaleCta,
  switcher,
}: {
  lang: Lang;
  finaleCta: ReactNode;
  switcher: ReactNode;
}) {
  const reduce = useReducedMotion();
  const level = useMotionLevel();
  const trackRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: trackRef, offset: ['start start', 'end end'] });
  const jumpTo = useJumpTo(trackRef);

  // EL PORTADILLO SE VA ANTES DE QUE LLEGUE LA PRIMERA PARADA. Salía hasta
  // 0,21 y la primera parada entraba en 0,14: medido en captura a 0,16 había DOS
  // titulares superpuestos, el del portadillo al 35 % por encima del de la
  // cimbra. Un titular encima de otro es lo primero que se ve y lo último que se
  // perdona.
  const heroOpacity = useTransform(scrollYProgress, [COPY_BEATS.hero[0], COPY_BEATS.hero[1]], [1, 0], { clamp: true });
  const heroY = useTransform(scrollYProgress, [0, COPY_BEATS.hero[1]], [0, -60], { clamp: true });
  const closeVeil = useTransform(scrollYProgress, [COPY_BEATS.close[0], COPY_BEATS.close[0] + 0.03], [0, 1], { clamp: true });

  if (reduce) return <StaticLegacy lang={lang} finaleCta={finaleCta} switcher={switcher} />;

  return (
    <>
      <div className="lg:hidden">
        <StaticLegacy lang={lang} finaleCta={finaleCta} switcher={switcher} />
      </div>

      <section ref={trackRef} id="journey" className="relative hidden lg:block h-[760svh]">
        {/* El escenario sube: con `pt-[16svh]` más el margen de la escena el
            horizonte caía al 80 % del cuadro y el tercio superior era cielo
            vacío. */}
        {/* Un anclaje por parada, para que el botón de scroll recorra ESTE
            itinerario y no el de Personal. Ver `StationAnchors`. */}
        <StationAnchors stations={STATIONS} />

        <div className="sticky top-0 h-[100svh] overflow-hidden flex flex-col justify-center pt-[9svh]">
          <motion.div
            style={{ opacity: heroOpacity, y: heroY }}
            className="absolute inset-x-0 top-[20svh] px-6 md:px-10 lg:px-16 z-20 pointer-events-none"
          >
            <div className="max-w-6xl mx-auto">
              <motion.span
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={ENTER.badge}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-mono uppercase tracking-[0.2em]"
                style={{ border: '1px solid hsl(var(--volt) / 0.3)', background: 'hsl(var(--volt) / 0.06)', color: 'hsl(var(--volt-soft))' }}
              >
                {T('Astryum · Legacy', 'Astryum · Legacy', lang)}
              </motion.span>
              <motion.h1
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={ENTER.title}
                className="mt-6 font-bold text-white max-w-3xl"
                style={{ fontSize: 'clamp(2rem, 4.6vw, 3.6rem)', lineHeight: 1.06, letterSpacing: '-0.03em' }}
              >
                {T(HERO_TITLE.es, HERO_TITLE.en, lang)}
              </motion.h1>
              <motion.p
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={ENTER.lead}
                className="mt-5 text-white/55 leading-relaxed max-w-xl"
                style={{ fontSize: 'clamp(15px, 1.3vw, 17px)' }}
              >
                {T(HERO_LEAD.es, HERO_LEAD.en, lang)}
              </motion.p>
            </div>
          </motion.div>

          {/* LA ESCENA, a sangre. El cielo, los dos bancos y la garganta cruzan
              el cuadro entero: dentro de una columna de texto terminaban en el
              canto del elemento y la escena se leía como un panel pegado encima
              de la página. La cámara deriva su lienzo del ancho real, así que el
              arco conserva su tamaño. */}
          {/* La escena entra DETRÁS del titular y por debajo: el hueco y sus
              dos bancos se posan, y solo entonces empieza el recorrido. La
              traslación es de 26 px —suficiente para que se lea como llegada,
              corta para que no se lea como un desplazamiento de layout. */}
          <motion.div
            className="w-full"
            initial={{ opacity: 0, y: 26 }}
            animate={{ opacity: 1, y: 0 }}
            transition={ENTER.scene}
          >
            <ThresholdScene progress={scrollYProgress} lang={lang} level={level} />
          </motion.div>

          {/* EL VELO DE LECTURA: la escena a sangre pasaba por detrás del texto
              sin nada que los separase, y el texto se perdía. */}
          {/* El velo oscurece el 72 % izquierdo para que se lea la columna. Se
              retira ANTES del cierre, que va centrado y no tiene columna. */}
          <ReadingVeil progress={scrollYProgress} from={LEGACY_BEATS.centring[0]} to={COPY_BEATS.handover[1]} />

          {/* ── LAS PARADAS: rótulo, titular, apuntes y viñeta, JUNTOS ───── */}
          <Dock progress={scrollYProgress} range={COPY_BEATS.centring}>
            {() => (
              <>
                <Kicker lang={lang} num="02" es="La cimbra" en="The centring" />
                <Line lang={lang} es="Mientras estás, lo sostienes tú." en="While you are here, you are what holds it up." />
                <Notes
                  lang={lang}
                  items={[
                    { es: 'Una cimbra es provisional por definición.', en: 'A centring is temporary by definition.' },
                    { es: 'Nada de lo que va encima se sostiene todavía solo.', en: 'Nothing above it holds itself up yet.' },
                    { es: 'Y el día que se retire, tiene que dar igual.', en: 'And the day it comes away, it has to make no difference.' },
                  ]}
                />
              </>
            )}
          </Dock>

          <Dock progress={scrollYProgress} range={COPY_BEATS.stones}>
            {(active) => (
              <>
                <Kicker lang={lang} num="03" es="El consejo" en="The council" />
                <Line lang={lang} es="Cada pieza se coloca antes de que haga falta cruzar." en="Every piece is set before anyone needs to cross." />
                <Notes
                  lang={lang}
                  items={[
                    { es: 'Se nombran en vida, no en una carta.', en: 'Named in life, not in a letter.' },
                    { es: 'Ninguna clave maestra por encima de ellos.', en: 'No master key above them.' },
                    { es: 'Y tú propones: nadie firma por ti.', en: 'And you propose: nobody signs for you.' },
                  ]}
                />
                <div className="mt-7">
                  <CouncilArtifact lang={lang} active={active} progress={scrollYProgress} />
                </div>
              </>
            )}
          </Dock>

          <Dock progress={scrollYProgress} range={COPY_BEATS.key}>
            {(active) => (
              <>
                <Kicker lang={lang} num="04" es="La clave" en="The keystone" />
                <Line lang={lang} es="Lo escrito es lo que hace que las piezas se sostengan entre sí." en="What is written is what makes the pieces hold each other." />
                <Notes
                  lang={lang}
                  items={[
                    { es: 'Quién firma, cuántos y para qué.', en: 'Who signs, how many, and for what.' },
                    { es: 'Fuera de lo escrito, nadie puede.', en: 'Outside what is written, nobody can.' },
                    { es: 'Ni el proveedor, ni tú, ni ellos.', en: 'Not the provider, not you, not them.' },
                  ]}
                />
                <div className="mt-7">
                  <ConstitutionArtifact lang={lang} active={active} progress={scrollYProgress} />
                </div>
              </>
            )}
          </Dock>

          <Dock progress={scrollYProgress} range={COPY_BEATS.strike}>
            {(active) => (
              <>
                <Kicker lang={lang} num="05" es="El quórum" en="The quorum" />
                <Line lang={lang} es="Se retira la cimbra. El arco se queda de pie." en="The centring comes away. The arch stands." />
                <Notes
                  lang={lang}
                  items={[
                    { es: 'Ninguna piedra sola sostiene el arco.', en: 'No single stone holds the arch.' },
                    { es: 'Tres de cinco bastan. Ninguna sola.', en: 'Three of five suffice. Never one alone.' },
                    { es: 'Por debajo del umbral, nada se mueve.', en: 'Below the threshold, nothing moves.' },
                  ]}
                />
                <div className="mt-7">
                  <QuorumArtifact lang={lang} active={active} progress={scrollYProgress} />
                </div>
              </>
            )}
          </Dock>

          <Dock progress={scrollYProgress} range={COPY_BEATS.handover}>
            {(active) => (
              <>
                <Kicker lang={lang} num="06" es="El relevo" en="The handover" />
                <Line lang={lang} es="Quien decide cambia. Lo que cruza, cruza entero." en="Who decides changes. What crosses, crosses whole." />
                <div className="mt-7">
                  <HandoverArtifact lang={lang} active={active} progress={scrollYProgress} />
                </div>
              </>
            )}
          </Dock>

          {/* EL FONDO DEL CIERRE. La frase va arriba y centrada, y aunque la
              cámara hunde el arco en este tiempo, el cielo por sí solo no da
              contraste suficiente para un cuerpo de 15 px. Es un degradado
              PLANO, nunca un `backdrop-filter`: detrás hay un campo de estrellas
              animándose y desenfocar el fondo cuesta un repintado de viewport
              por fotograma. */}
          <motion.div
            aria-hidden
            style={{ opacity: closeVeil, background: 'linear-gradient(180deg, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.66) 46%, transparent 100%)' }}
            className="absolute inset-x-0 top-0 h-[54svh] z-20 pointer-events-none"
          />

          {/* EL CIERRE, con su puerta dentro. Va arriba y centrado porque abajo
              en el centro vive el indicador de scroll de la portada y a media
              altura está el arco de pie. */}
          <Finale
            progress={scrollYProgress}
            range={COPY_BEATS.close}
            lang={lang}
            num="07"
            kicker={CLOSE.kicker}
            line={CLOSE.line}
            sub={CLOSE.sub}
            className="inset-x-0 top-[13svh]"
          >
            {finaleCta}
          </Finale>

          {/* La barra aguanta hasta el relevo: aquí el cierre está centrado
              arriba y no se pisan. */}
          <StationRail
            progress={scrollYProgress}
            lang={lang}
            stations={STATIONS}
            onJump={jumpTo}
            fade={[0, 0.04, COPY_BEATS.handover[1], 0.958]}
          />

          <motion.div className="absolute top-[140px] left-1/2 -translate-x-1/2 z-40" style={{ opacity: heroOpacity }}>
            {switcher}
          </motion.div>
        </div>
      </section>
    </>
  );
}

/** La versión quieta: móvil y movimiento reducido. El arco terminado y de pie,
 *  y las cuatro láminas apiladas. Que no haya scrollytelling no quiere decir
 *  que no haya producto. */
function StaticLegacy({ lang, finaleCta, switcher }: { lang: Lang; finaleCta: ReactNode; switcher: ReactNode }) {
  const stops = [
    {
      id: 'council',
      kicker: { es: 'El consejo', en: 'The council' },
      line: { es: 'Cada pieza se coloca antes de que haga falta cruzar.', en: 'Every piece is set before anyone needs to cross.' },
      art: <CouncilArtifact lang={lang} compact />,
    },
    {
      id: 'constitution',
      kicker: { es: 'La clave', en: 'The keystone' },
      line: { es: 'Lo escrito es lo que hace que las piezas se sostengan entre sí.', en: 'What is written is what makes the pieces hold each other.' },
      art: <ConstitutionArtifact lang={lang} compact />,
    },
    {
      id: 'quorum',
      kicker: { es: 'El quórum', en: 'The quorum' },
      line: { es: 'Se retira la cimbra y el arco se queda de pie. Ninguna piedra sola lo sostiene.', en: 'The centring comes away and the arch stands. No single stone holds it.' },
      art: <QuorumArtifact lang={lang} compact />,
    },
    {
      id: 'handover',
      kicker: { es: 'El relevo', en: 'The handover' },
      line: { es: 'Quien decide cambia. Lo que cruza, cruza entero.', en: 'Who decides changes. What crosses, crosses whole.' },
      art: <HandoverArtifact lang={lang} compact />,
    },
  ];

  return (
    <section className="relative px-6 md:px-10 lg:px-16 pt-36 pb-24">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-center mb-10">{switcher}</div>
        {/* La misma llegada escalonada que el recorrido: en móvil este bloque
            también está sobre el pliegue, así que también se monta, no se
            revela por scroll. */}
        <motion.span
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={ENTER.badge}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-mono uppercase tracking-[0.2em]"
          style={{ border: '1px solid hsl(var(--volt) / 0.3)', background: 'hsl(var(--volt) / 0.06)', color: 'hsl(var(--volt-soft))' }}
        >
          {T('Astryum · Legacy', 'Astryum · Legacy', lang)}
        </motion.span>
        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={ENTER.title}
          className="mt-6 font-bold text-white"
          style={{ fontSize: 'clamp(2rem, 7vw, 3rem)', lineHeight: 1.08, letterSpacing: '-0.03em' }}
        >
          {T(HERO_TITLE.es, HERO_TITLE.en, lang)}
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={ENTER.lead}
          className="mt-5 text-white/55 leading-relaxed max-w-xl"
        >
          {T(HERO_LEAD.es, HERO_LEAD.en, lang)}
        </motion.p>

        <div className="mt-12 rounded-2xl p-6" style={{ border: `1px solid ${BORDER_STRONG}` }}>
          <ThresholdScene progress={STILL} lang={lang} level="minimal" still />
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

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: EASE }}
          className="mt-12"
        >
          {finaleCta}
        </motion.div>
      </div>
    </section>
  );
}
