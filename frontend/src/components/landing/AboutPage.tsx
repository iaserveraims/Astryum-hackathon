'use client';

/**
 * /about — la PÁGINA DE CONFIANZA (founder 2026-07-25, segunda pasada): en
 * cripto un desconocido asume scam por defecto, y eso no se desmonta con una
 * misión bonita — se desmonta con hechos comprobables y mesura. Estructura:
 *
 *   1. La arquitectura que nos ata las manos — por qué NO PODEMOS quedarnos
 *      con el dinero de nadie (no-custodia como hecho técnico, comprobable en
 *      cada firma), no como promesa.
 *   2. Posición regulatoria estricta por diseño — estructurados para no ser CASP; las patas
 *      que MiCA reserva a entidades autorizadas pasan por partners
 *      licenciados. SIN mención de jurisdicción propia (founder: "lo de
 *      Andorra no").
 *   3. Quiénes somos de verdad — equipo pequeño con cara, el background real
 *      (construimos esto porque somos USUARIOS de esto) y la misión (una sola
 *      app para controlar todas tus finanzas).
 *   4. Se construye a la vista — evaluación pública (hackathons), y la
 *      honestidad de la beta: lo que hay y lo que aún no está.
 *
 * Reglas de copy con fuerza extra aquí: nada de "100% seguro", nada de
 * "auditado", nada de rendimientos — el lenguaje de garantía es exactamente
 * como hablan los timos. Direcciones de contrato/explorador: NO por ahora
 * (founder) — cuando toque, van en el bloque 1.
 *
 * FOUNDERS carries the real names (2026-07-27) and the real portraits
 * (512×512 square crops in /public/founders/, derived from /assets — the
 * heavy originals stay out of git). If a photo ever fails to resolve, the
 * frame falls back to initials over the gold gradient, never a broken image.
 */

import { motion } from 'framer-motion';
import SubpageShell from './SubpageShell';
import { BORDER, GOLD, MaskLines, Reveal, SpotlightCard } from './interactions';
import { T, type Lang } from './useLang';

const GOLD_SOFT = '#E8C25A';
const CARD_STYLE = { border: `1px solid ${BORDER}`, background: 'rgba(255,255,255,0.02)' } as const;

// ── The crew — real names 2026-07-27 (founder). The two bios are the page's
// strongest trust argument and they are DELIBERATELY asymmetric: Eric operates
// in DeFi daily, Guillem was kept out by its complexity. That asymmetry IS the
// product thesis, so don't "balance" it into two generic founder blurbs.
// Photos: square 512 crops in /public/founders/ (sourced from /assets).
const FOUNDERS: Array<{
  name: string;
  roleEs: string;
  roleEn: string;
  bioEs: string;
  bioEn: string;
  photo: string | null;
}> = [
  {
    name: 'Eric',
    roleEs: 'Cofundador · Arquitectura y protocolo',
    roleEn: 'Co-founder · Architecture & protocol',
    bioEs:
      'El criterio técnico del proyecto y el origen de la mayoría de sus ideas. Opera en DeFi a diario —posiciones abiertas, riesgo real— y de ahí sale cada decisión de arquitectura: los raíles sobre XRPL y Flare, los intents sin firmar y la frontera que mantiene las claves fuera de nuestro alcance. Sabe qué le falta a la herramienta porque lo echa en falta él.',
    bioEn:
      'The project’s technical judgement and the source of most of its ideas. He operates in DeFi daily — open positions, real risk — and every architectural decision comes from there: the rails on XRPL and Flare, the unsigned intents, and the boundary that keeps keys out of our reach. He knows what the tooling is missing because he misses it himself.',
    photo: '/founders/eric.jpg',
  },
  {
    name: 'Guillem',
    roleEs: 'Cofundador · Diseño de producto',
    roleEn: 'Co-founder · Product design',
    bioEs:
      'Diseña la interfaz y baja las ideas a tierra. No es usuario avanzado de DeFi: mantiene sus posiciones en holding porque la complejidad actual echa para atrás a cualquiera que no viva dentro — y ese es exactamente el criterio con el que revisa cada pantalla. Si algo necesita explicación previa para entenderse, no está terminado.',
    bioEn:
      'Designs the interface and brings the ideas down to earth. He is not an advanced DeFi user: he holds and little else, because today’s complexity pushes away anyone who doesn’t live inside it — and that is exactly the standard he reviews every screen against. If something needs prior explanation to be understood, it isn’t finished.',
    photo: '/founders/guillem.jpg',
  },
];

function initialsOf(name: string): string {
  const words = name.replace(/[—-].*$/, '').trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || 'A';
}

function FounderCard({ founder, lang, index }: { founder: (typeof FOUNDERS)[number]; lang: Lang; index: number }) {
  return (
    <Reveal delay={0.12 + index * 0.12}>
      <SpotlightCard className="h-full rounded-2xl p-6" style={CARD_STYLE}>
        {/* the photo frame — a portal ring around the portrait (or initials
            until the real photo lands in /public/founders/) */}
        <div className="relative mx-auto h-36 w-36">
          <div
            className="absolute -inset-2 rounded-full border border-dashed"
            style={{ borderColor: 'rgba(201,162,39,0.35)' }}
            aria-hidden
          />
          <div
            className="relative h-36 w-36 overflow-hidden rounded-full"
            style={{ boxShadow: `inset 0 0 0 2px rgba(201,162,39,0.45), 0 12px 40px -18px rgba(201,162,39,0.5)` }}
          >
            {founder.photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={founder.photo} alt={founder.name} className="h-full w-full object-cover" />
            ) : (
              <div
                className="flex h-full w-full items-center justify-center text-3xl font-bold text-black"
                style={{ background: `radial-gradient(circle at 35% 30%, #FFF3D0, ${GOLD_SOFT} 45%, ${GOLD} 100%)` }}
                aria-hidden
              >
                {initialsOf(founder.name)}
              </div>
            )}
          </div>
        </div>
        <div className="mt-5 text-center">
          <div className="text-lg font-semibold text-white">{founder.name}</div>
          <div className="mt-1 text-[11px] font-mono uppercase tracking-[0.18em]" style={{ color: GOLD_SOFT }}>
            {T(founder.roleEs, founder.roleEn, lang)}
          </div>
          <p className="mt-3 text-sm leading-relaxed text-white/55">{T(founder.bioEs, founder.bioEn, lang)}</p>
        </div>
      </SpotlightCard>
    </Reveal>
  );
}

// ── Block 1 — the architecture that ties our hands (facts, not promises) ─────
const HANDCUFFS = (lang: Lang) => [
  {
    title: T('Tu llave nunca sale de tu wallet', 'Your key never leaves your wallet', lang),
    body: T(
      'Astryum prepara cada transacción SIN firmar. La firma ocurre siempre en tu wallet — Xaman, MetaMask — donde puedes leer exactamente qué autorizas, operación a operación. No hace falta creernos: lo ves en cada firma.',
      'Astryum prepares every transaction UNSIGNED. Signing always happens in your wallet — Xaman, MetaMask — where you can read exactly what you authorize, operation by operation. No need to believe us: you see it at every signature.',
      lang,
    ),
  },
  {
    title: T('No custodiamos — no podemos custodiar', 'We don’t custody — we can’t custody', lang),
    body: T(
      'No hay depósito, no hay cuenta que abrir con nosotros, no hay saldo "en Astryum". Tu capital vive en tus wallets y en los protocolos. Si Astryum desapareciera mañana, todo sigue siendo tuyo y operable sin nosotros.',
      'There is no deposit, no account to open with us, no balance "at Astryum". Your capital lives in your wallets and in the protocols. If Astryum vanished tomorrow, everything remains yours and operable without us.',
      lang,
    ),
  },
  {
    title: T('Cero discreción', 'Zero discretion', lang),
    body: T(
      'Nada se mueve sin una condición que tú firmaste antes. Las protecciones son reglas deterministas; el agente solo compila lo que le pides — tú revisas y tú firmas. Nadie aquí puede decidir por ti, tampoco nosotros.',
      'Nothing moves without a condition you signed beforehand. Protections are deterministic rules; the agent only compiles what you ask — you review and you sign. Nobody here can decide for you, including us.',
      lang,
    ),
  },
];

export default function AboutPage() {
  return (
    <SubpageShell>
      {(lang) => (
        <>
          {/* hero — trust is proven, not requested */}
          <section className="px-6 pt-40 pb-16 text-center md:pt-44">
            <Reveal>
              <div className="mb-5 text-[11px] font-mono uppercase tracking-[0.2em]" style={{ color: GOLD_SOFT }}>
                {T('Quiénes somos · y por qué puedes comprobarlo', 'Who we are · and why you can verify it', lang)}
              </div>
            </Reveal>
            <h1
              className="mx-auto max-w-3xl font-bold text-white text-balance"
              style={{ fontSize: 'clamp(2.2rem, 5vw, 3.8rem)', lineHeight: 1.06, letterSpacing: '-0.03em' }}
            >
              <MaskLines
                lines={[
                  T('En Astryum no pedimos confianza.', 'At Astryum, we don’t ask for trust.', lang),
                  <span key="l2" style={{ color: GOLD_SOFT }}>
                    {T('La demostramos.', 'We prove it.', lang)}
                  </span>,
                ]}
                delay={0.1}
              />
            </h1>
            <Reveal delay={0.3}>
              <p className="mx-auto mt-6 max-w-xl leading-relaxed text-white/55" style={{ fontSize: 'clamp(15px, 1.4vw, 18px)' }}>
                {T(
                  'Somos un equipo pequeño construyendo en abierto. Esta página no te pide que nos creas: te cuenta qué no podemos hacer con tu dinero, quiénes somos, y qué hay — y qué no hay — todavía.',
                  'We are a small team building in the open. This page doesn’t ask you to believe us: it tells you what we cannot do with your money, who we are, and what exists — and what doesn’t — yet.',
                  lang,
                )}
              </p>
            </Reveal>
          </section>

          {/* 1 · the architecture that ties our hands */}
          <section className="px-6 pb-20">
            <div className="mx-auto max-w-5xl">
              <Reveal>
                <div className="mb-8 text-center text-[11px] font-mono uppercase tracking-[0.2em]" style={{ color: GOLD_SOFT }}>
                  {T('Por qué no podemos quedarnos con tu dinero', 'Why we can’t take your money', lang)}
                </div>
              </Reveal>
              <div className="grid gap-4 md:grid-cols-3">
                {HANDCUFFS(lang).map((c, i) => (
                  <Reveal key={c.title} delay={0.1 + i * 0.1}>
                    <SpotlightCard className="h-full rounded-2xl p-6" style={CARD_STYLE}>
                      <div className="flex items-center gap-2.5">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: GOLD }} aria-hidden />
                        <h3 className="text-[15px] font-semibold text-white">{c.title}</h3>
                      </div>
                      <p className="mt-3 text-sm leading-relaxed text-white/55">{c.body}</p>
                    </SpotlightCard>
                  </Reveal>
                ))}
              </div>
              <Reveal delay={0.25}>
                <p className="mx-auto mt-6 max-w-2xl text-center text-[13px] leading-relaxed text-white/40">
                  {T(
                    'La mejor prueba de que esto no es un timo no es un sello: es que, por arquitectura, no hay forma de que tu capital pase por nuestras manos.',
                    'The best proof this isn’t a scam is not a badge: it is that, by architecture, there is no path for your capital to pass through our hands.',
                    lang,
                  )}
                </p>
              </Reveal>
            </div>
          </section>

          {/* 2 · a strict regulatory position, by design (no jurisdiction named) */}
          <section className="px-6 pb-20">
            <div className="mx-auto max-w-3xl">
              <Reveal>
                <SpotlightCard className="rounded-2xl p-7 md:p-8" style={CARD_STYLE}>
                  <div className="text-[11px] font-mono uppercase tracking-[0.2em]" style={{ color: GOLD_SOFT }}>
                    {T('Posición regulatoria · estricta por diseño', 'Regulatory position · strict by design', lang)}
                  </div>
                  <p className="mt-4 text-[15px] leading-relaxed text-white/70">
                    {T(
                      'Estamos estructurados para no ser un CASP — un proveedor de servicios cripto según la ley europea MiCA. Por diseño: no custodiamos, no tocamos dinero de clientes, y nada se ejecuta sin tu firma. Nuestra posición es deliberadamente más estricta que la de la mayoría del sector.',
                      'We are structured not to be a CASP — a crypto-asset service provider under the European MiCA law. By design: we hold no custody, we never touch client money, and nothing executes without your signature. Our position is deliberately stricter than most of the industry’s.',
                      lang,
                    )}
                  </p>
                  <p className="mt-3 text-[15px] leading-relaxed text-white/70">
                    {T(
                      'Las patas que MiCA reserva a entidades autorizadas — como el paso entre euros y cripto — pasan por partners licenciados para exactamente eso, nunca por nosotros. Astryum se queda donde puede demostrar su límite: observar, preparar y entregarte la firma.',
                      'The legs MiCA reserves for authorized entities — like moving between euros and crypto — go through partners licensed for exactly that, never through us. Astryum stays where it can prove its boundary: observe, prepare, and hand you the signature.',
                      lang,
                    )}
                  </p>
                </SpotlightCard>
              </Reveal>
            </div>
          </section>

          {/* 3 · who we really are — the two-halves background + the crew + mission */}
          <section className="px-6 pb-20">
            <div className="mx-auto max-w-3xl">
              <Reveal>
                <div className="mb-6 text-center text-[11px] font-mono uppercase tracking-[0.2em]" style={{ color: GOLD_SOFT }}>
                  {T('Quiénes somos de verdad', 'Who we really are', lang)}
                </div>
                <p className="mx-auto mb-10 max-w-2xl text-center leading-relaxed text-white/60" style={{ fontSize: 'clamp(15px, 1.4vw, 17px)' }}>
                  {T(
                    'Somos las dos mitades del problema que queremos resolver. Uno de nosotros opera en DeFi a diario y conoce con precisión dónde la herramienta se queda corta. El otro se ha quedado fuera precisamente por eso: mantiene sus posiciones en holding, porque hoy usar DeFi exige un nivel de detalle que aparta a quien no vive dentro. Astryum sale de juntar esas dos vistas — la de quien conoce el terreno y la de quien no debería necesitar conocerlo para mover su propio dinero con confianza.',
                    'We are the two halves of the problem we set out to solve. One of us operates in DeFi daily and knows precisely where the tooling falls short. The other was kept out by exactly that: he holds and little else, because using DeFi today demands a level of detail that pushes away anyone who doesn’t live inside it. Astryum comes from putting those two views together — the one who knows the terrain, and the one who shouldn’t need to know it to move his own money with confidence.',
                    lang,
                  )}
                </p>
              </Reveal>
              <div className="grid gap-6 sm:grid-cols-2">
                {FOUNDERS.map((f, i) => (
                  <FounderCard key={i} founder={f} lang={lang} index={i} />
                ))}
              </div>
              <Reveal delay={0.2}>
                <p className="mx-auto mt-10 max-w-2xl text-center text-[15px] leading-relaxed text-white/60">
                  <span className="font-mono text-[11px] uppercase tracking-[0.2em]" style={{ color: GOLD_SOFT }}>
                    {T('La misión — ', 'The mission — ', lang)}
                  </span>
                  {T(
                    'que controlar todas tus finanzas quepa en una sola app que nunca custodia nada, y que no haga falta ser experto para usarla con confianza: tú ves todo, tú decides todo, tú firmas todo.',
                    'that controlling all your finances fits in one single app that never custodies anything, and that using it with confidence takes no expertise: you see everything, you decide everything, you sign everything.',
                    lang,
                  )}
                </p>
              </Reveal>
            </div>
          </section>

          {/* 4 · built in plain sight — context a scam doesn't bother to have */}
          <section className="px-6 pb-24">
            <div className="mx-auto max-w-3xl">
              <Reveal>
                <SpotlightCard className="rounded-2xl p-7" style={CARD_STYLE}>
                  <div className="text-[11px] font-mono uppercase tracking-[0.2em]" style={{ color: GOLD_SOFT }}>
                    {T('Se construye a la vista', 'Built in plain sight', lang)}
                  </div>
                  <p className="mt-4 text-sm leading-relaxed text-white/60">
                    {T(
                      'Astryum se presenta a evaluación pública en los programas de builders de Flare y de XRPL — con jurado, en abierto. Un timo no se somete a eso.',
                      'Astryum stands for public evaluation in the Flare and XRPL builder programs — judged, in the open. A scam doesn’t submit to that.',
                      lang,
                    )}
                  </p>
                  <p className="mt-3 text-sm leading-relaxed text-white/60">
                    {T(
                      'Y la parte honesta: esto es un acceso anticipado. Hay cosas que funcionan hoy sobre mainnet y cosas que aún no están — y preferimos decírtelo nosotros antes de que lo descubras tú. Lo que no está, no se promete.',
                      'And the honest part: this is early access. Some things run on mainnet today and some aren’t there yet — and we’d rather tell you ourselves than have you find out. What isn’t there isn’t promised.',
                      lang,
                    )}
                  </p>
                </SpotlightCard>
              </Reveal>
            </div>
          </section>

          {/* the principle + door */}
          <section className="px-6 pb-28 text-center">
            <motion.blockquote
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-15%' }}
              transition={{ duration: 0.8 }}
              className="mx-auto max-w-2xl font-light text-white/85"
              style={{ fontSize: 'clamp(1.2rem, 2.4vw, 1.7rem)', lineHeight: 1.35 }}
            >
              {T(
                '“El dinero siempre debe fluir. Cuando el dinero está en movimiento, el dinero trabaja para ti.”',
                '“Money must always flow. When money is in motion, money works for you.”',
                lang,
              )}
            </motion.blockquote>
            <Reveal delay={0.15}>
              <div className="mt-4 text-sm font-mono" style={{ color: GOLD }}>
                {T('— un principio de Astryum', '— an Astryum principle', lang)}
              </div>
              <a
                href="/early-access"
                className="mt-10 inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-black transition-transform hover:scale-[1.02]"
                style={{ background: GOLD, boxShadow: '0 8px 28px hsl(var(--volt) / 0.3)' }}
              >
                {T('Solicita acceso anticipado', 'Request early access', lang)} →
              </a>
            </Reveal>
          </section>
        </>
      )}
    </SubpageShell>
  );
}
