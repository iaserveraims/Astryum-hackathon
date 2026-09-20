'use client';

/**
 * UN MISMO CIELO, CUATRO INSTRUMENTOS — las cuatro puertas de la portada.
 *
 * Cada tarjeta enseña el instrumento con el que su mundo mira el mismo cielo
 * —el sistema solar, la carta estelar, la estación, la sonda— en su material:
 * el radio, el trazo y el brillo salen de governors.ts, que es donde vive «lo
 * que cambia por producto». Las tres escenas nuevas se pintan en su fotograma
 * de reposo; el sistema solar, que en su mundo es tridimensional y vive en
 * LandingPage, aquí es un eco a línea.
 */

import { motion } from 'framer-motion';
import { EASE, Magnetic } from './interactions';
import { GOVERNORS, readinessColor, tint, type Governor } from './governors';
import { STILL } from './journeyShell';
import { StarChartScene } from './art/StarChartScene';
import { StationScene } from './art/StationScene';
import { ProbeScene } from './art/ProbeScene';

type Lang = 'es' | 'en';
const T = (es: string, en: string, lang: Lang) => (lang === 'es' ? es : en);

export function InstrumentsSection({ lang }: { lang: Lang }) {
  return (
    <section id="instrumentos" className="relative px-6 md:px-10 lg:px-16 py-20 md:py-28 scroll-mt-20">
      <div className="max-w-6xl mx-auto">
        <div className="max-w-2xl">
          <div className="text-[11px] font-mono uppercase tracking-[0.2em]" style={{ color: 'hsl(var(--volt-soft))' }}>
            {T('Un mismo cielo', 'One sky', lang)}
          </div>
          <h2 className="mt-3 font-bold text-white" style={{ fontSize: 'clamp(1.9rem, 3.6vw, 2.75rem)', lineHeight: 1.08, letterSpacing: '-0.03em' }}>
            {T('Cuatro instrumentos para mirarlo.', 'Four instruments to look at it.', lang)}
          </h2>
          <p className="mt-4 text-white/55 text-[15px] md:text-base">
            {T('Cada tarjeta abre la página de su producto: el mismo sistema, contado para ese campo, y cómo empezar.', 'Each card opens its product’s page: the same system, told for that field, and how to start.', lang)}
          </p>
        </div>
        <div className="mt-10 grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {GOVERNORS.map((g, i) => (
            <Card key={g.id} g={g} i={i} lang={lang} />
          ))}
        </div>
      </div>
    </section>
  );
}

function Card({ g, i, lang }: { g: Governor; i: number; lang: Lang }) {
  // LA TARJETA SIGUE AL RATÓN. Es la señal de «esto se pulsa» de toda la web
  // —cada CTA es un Magnetic— y por eso no lleva un botón dentro. Fuerza baja: la tarjeta es grande y basta con que ceda.
  return (
    <Magnetic strength={0.12} className="flex">
    <motion.a
      href={g.route}
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.5, delay: i * 0.07, ease: EASE }}
      whileHover={{ y: -4, borderColor: tint(g, 0.95), boxShadow: `0 0 70px -24px ${tint(g, 0.7)}` }}
      aria-label={T(`Conocer ${g.label.es}`, `Explore ${g.label.en}`, lang)}
      className="group flex-1 flex flex-col gap-3.5 p-5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      style={{
        border: `1px ${g.dashed ? 'dashed' : 'solid'} ${tint(g, 0.42)}`,
        background: 'rgba(12,11,9,0.62)',
        borderRadius: g.radius,
        boxShadow: g.glow ? `0 0 60px -30px ${tint(g, 0.55)}` : `0 0 0 0 ${tint(g, 0)}`,
      }}
    >
      <div className="h-40 flex items-center justify-center overflow-hidden" style={{ borderRadius: g.innerRadius }} aria-hidden>
        <Mini g={g} lang={lang} />
      </div>
      <div className="text-[10px] font-mono uppercase tracking-[0.16em]" style={{ color: g.accent }}>
        0{i + 1} · {T(g.scene.es, g.scene.en, lang)}
      </div>
      <div className="text-[22px] font-bold text-white leading-tight tracking-tight">{T(g.label.es, g.label.en, lang)}</div>
      <div className="text-[14px] text-white/70 leading-snug">{T(g.tagline.es, g.tagline.en, lang)}</div>
      <div className="text-[10px] font-mono uppercase tracking-[0.08em] text-white/55">{T(g.vocabulary.es, g.vocabulary.en, lang)}</div>
      <div className="mt-auto pt-3 flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.12em]" style={{ borderTop: '1px solid rgba(255,255,255,0.08)', color: readinessColor(g.readiness) }}>
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: readinessColor(g.readiness) }} />
        {T(g.notice.es, g.notice.en, lang)}
      </div>
    </motion.a>
    </Magnetic>
  );
}

/** El instrumento, en pequeño y quieto. */
function Mini({ g, lang }: { g: Governor; lang: Lang }) {
  if (g.id === 'business') return <StarChartScene progress={STILL} lang={lang} level="minimal" still />;
  if (g.id === 'exchange') return <StationScene progress={STILL} lang={lang} level="minimal" still />;
  if (g.id === 'agent') return <ProbeScene progress={STILL} lang={lang} level="minimal" still />;
  return <SolarMini />;
}

function SolarMini() {
  return (
    <svg viewBox="0 0 240 150" className="w-full h-auto block" fill="none">
      <defs>
        <radialGradient id="lp-mini-p" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="46%" stopColor="hsl(var(--product-personal))" />
          <stop offset="100%" stopColor="#4a3608" />
        </radialGradient>
        <radialGradient id="lp-mini-s" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFF4D6" />
          <stop offset="35%" stopColor="rgba(232,194,90,0.7)" />
          <stop offset="100%" stopColor="rgba(232,194,90,0)" />
        </radialGradient>
      </defs>
      <ellipse cx="120" cy="75" rx="108" ry="50" transform="rotate(-10 120 75)" stroke="hsl(var(--product-personal) / 0.32)" />
      <ellipse cx="120" cy="75" rx="76" ry="35" transform="rotate(-10 120 75)" stroke="hsl(var(--product-personal) / 0.28)" />
      <ellipse cx="120" cy="75" rx="44" ry="20" transform="rotate(-10 120 75)" stroke="hsl(var(--product-personal) / 0.24)" />
      <circle cx="120" cy="75" r="26" fill="url(#lp-mini-s)" />
      <circle cx="120" cy="75" r="6" fill="#FFF4D6" />
      <circle cx="24" cy="66" r="7" fill="url(#lp-mini-p)" />
      <circle cx="178" cy="40" r="5.5" fill="url(#lp-mini-p)" />
      <circle cx="150" cy="104" r="4.5" fill="url(#lp-mini-p)" />
    </svg>
  );
}

export default InstrumentsSection;
