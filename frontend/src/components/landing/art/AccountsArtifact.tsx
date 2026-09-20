'use client';

/**
 * TUS CUENTAS — la lámina nueva del mundo Autocustodia.
 *
 * Y después: «una
 * familia, tú y otros y tu gestor es self custody con las subcuentas
 * personalizadas» — así que Legacy deja de ser un producto y pasa a ser una
 * cuenta compartida por quórum, aquí.
 *
 * Dibujada en el material de Personal —la tarjeta que flota, radio 14, como
 * las viñetas del viaje solar (JourneyArtifacts)— y no en una plancha: es la
 * misma persona mirando su propia wallet. Las tres cuentas son de MAQUETA.
 */

import { motion } from 'framer-motion';
import { BORDER, EASE } from '../interactions';

type Lang = 'es' | 'en';
const T = (es: string, en: string, l: Lang) => (l === 'es' ? es : en);

const INDIGO = '#A5B1FD';
const FLR_SOFT = '#F4A8CE';
const GOLD_SOFT = 'hsl(var(--product-personal))';

const ACCOUNTS = [
  { es: 'Principal', en: 'Main', sub: { es: 'La de siempre', en: 'The usual one' }, rule: { es: 'Solo tu firma', en: 'Your signature only' }, seats: [true], color: GOLD_SOFT, dashed: false },
  { es: 'Compartida', en: 'Shared', sub: { es: 'Pareja, socios, familia', en: 'Partner, associates, family' }, rule: { es: '2 de 3', en: '2 of 3' }, seats: [true, true, false], color: INDIGO, dashed: false },
  { es: 'Con gestor', en: 'With a manager', sub: { es: 'Dirige dentro de una jaula · tú sales', en: 'Directs inside a cage · you exit' }, rule: { es: 'La jaula', en: 'The cage' }, seats: [true], color: FLR_SOFT, dashed: false },
  { es: 'Apartada', en: 'Set aside', sub: { es: 'Un objetivo, aparte', en: 'One goal, kept apart' }, rule: { es: 'En preparación', en: 'In preparation' }, seats: [true], color: 'rgba(255,255,255,0.45)', dashed: true },
];

export function AccountsArtifact({ lang }: { lang: Lang }) {
  return (
    <div
      aria-hidden
      className="w-full max-w-[420px] px-4 py-3.5"
      style={{ border: `1px solid ${BORDER}`, background: 'rgba(12,11,9,0.62)', borderRadius: 14, boxShadow: '0 30px 60px -40px rgba(0,0,0,0.9), 0 0 60px -30px hsl(var(--product-personal) / 0.5)' }}
    >
      <div className="flex items-center gap-2.5 pb-3">
        <span className="w-[18px] h-[18px] rounded-full shrink-0" style={{ background: 'radial-gradient(circle at 35% 30%, #fff, hsl(var(--product-personal)) 46%, #14121F 100%)' }} />
        <span className="text-[13px] font-semibold text-white">{T('Tu wallet', 'Your wallet', lang)}</span>
        <span className="ml-auto text-[9px] font-mono uppercase tracking-[0.14em] text-white/45">{T('una llave · varias cuentas', 'one key · several accounts', lang)}</span>
      </div>
      <div className="ml-2 pl-3.5 space-y-2" style={{ borderLeft: '1px dashed hsl(var(--product-personal) / 0.45)' }}>
        {ACCOUNTS.map((a, i) => (
          <motion.div
            key={a.en}
            initial={{ opacity: 0, x: 10 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.45, delay: i * 0.08, ease: EASE }}
            className="grid grid-cols-[1fr_auto] gap-3 items-center px-3 py-2.5 rounded-xl"
            style={{ border: `1px ${a.dashed ? 'dashed' : 'solid'} rgba(255,255,255,${a.dashed ? 0.18 : 0.09})`, background: a.dashed ? 'transparent' : 'rgba(255,255,255,0.02)' }}
          >
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-white">{T(a.es, a.en, lang)}</span>
              <span className="block text-[11px] text-white/55 leading-tight">{T(a.sub.es, a.sub.en, lang)}</span>
            </span>
            <span className="flex flex-col items-end gap-1.5">
              <span className="flex gap-1">
                {a.seats.map((on, k) => (
                  <span key={k} className="block w-[10px] h-[10px] rounded-full" style={on ? { background: a.color } : { border: '1.4px solid rgba(255,255,255,0.3)' }} />
                ))}
              </span>
              <span className="text-[9.5px] font-mono uppercase tracking-[0.08em]" style={{ color: a.color }}>
                {T(a.rule.es, a.rule.en, lang)}
              </span>
            </span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

export default AccountsArtifact;
