'use client';

/**
 * TUS CUENTAS — la parada nueva del mundo Autocustodia, DESPUÉS del viaje.
 *
 * Va fuera de SolarJourney a propósito: ese viaje calcula todas sus tablas de
 * tiempo a nivel de módulo desde sus cuatro paradas, y una quinta parecería
 * funcionar y se rompería en silencio (ver InstitutionalJourney, cabecera).
 * Aquí vive como sección propia, con la gramática del resto de la página
 * (Reveal por scroll, la tarjeta que flota de Personal) y su lámina
 * (art/AccountsArtifact).
 */

import { motion } from 'framer-motion';
import { EASE } from './interactions';
import { AccountsArtifact } from './art/AccountsArtifact';

type Lang = 'es' | 'en';
const T = (es: string, en: string, lang: Lang) => (lang === 'es' ? es : en);

export function AccountsSection({ lang }: { lang: Lang }) {
  return (
    <section id="cuentas" className="relative px-6 md:px-10 lg:px-16 py-20 md:py-28 scroll-mt-20">
      <div className="max-w-6xl mx-auto grid lg:grid-cols-[1.1fr_1fr] gap-10 lg:gap-16 items-center">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.55, ease: EASE }}
        >
          <div className="text-[11px] font-mono uppercase tracking-[0.22em]" style={{ color: 'hsl(var(--volt-soft) / 0.9)' }}>
            <span style={{ color: 'hsl(var(--volt-soft) / 0.5)' }}>05 · </span>
            {T('Tus cuentas', 'Your accounts', lang)}
          </div>
          <h2 className="mt-3 font-bold text-white text-balance" style={{ fontSize: 'clamp(1.55rem, 2.7vw, 2.4rem)', lineHeight: 1.08, letterSpacing: '-0.025em' }}>
            {T('Dentro de tu wallet, las cuentas que necesites.', 'Inside your wallet, the accounts you need.', lang)}
          </h2>
          <p className="mt-4 max-w-xl text-[15px] leading-snug text-white/55">
            {T(
              'Compartida con otros por quórum, o con un gestor dentro de una jaula. Todas siguen siendo tuyas, y las reglas viven en el ledger.',
              'Shared with others by quorum, or with a manager inside a cage. All of them stay yours, and the rules live on the ledger.',
              lang,
            )}
          </p>
        </motion.div>
        <div className="flex lg:justify-end">
          <AccountsArtifact lang={lang} />
        </div>
      </div>
    </section>
  );
}

export default AccountsSection;
