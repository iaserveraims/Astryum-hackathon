'use client';

/**
 * ManagedVaultNotice — el aviso que no se cierra.
 *
 * Fundador 2026-08-27: «HAY que poner un disclaimer siempre a la vista del
 * vault avisando de que esto no es un vault normal y que hay una persona detrás
 * manejándolo».
 *
 * ── POR QUÉ NO ES DESCARTABLE ───────────────────────────────────────────────
 * Un aviso con una X se cierra la primera vez y no se vuelve a ver nunca, justo
 * cuando lo que dice sigue siendo verdad cada día. Y aquí lo que dice es LA
 * diferencia entre este producto y el resto del catálogo: en una estrategia de
 * Earn el riesgo lo pone el protocolo; aquí hay ADEMÁS una persona decidiendo,
 * y sus decisiones son el riesgo. Eso no caduca al leerlo una vez.
 *
 * Va en la ficha de la bóveda y en el modal de entrada — los dos sitios donde
 * alguien está a punto de decidir. No en el catálogo entero, porque un aviso
 * repetido en cada card es ruido y el ruido se deja de leer.
 *
 * ── LO QUE DICE, Y LO QUE NO ────────────────────────────────────────────────
 * Dice el HECHO: hay una persona, elige ella, y sus decisiones pueden hacerte
 * perder dinero aunque el contrato la mantenga dentro de sus reglas. No dice
 * «ten cuidado» ni «invierte con responsabilidad»: un consejo genérico es ruido
 * de cumplimiento y se salta igual que se salta una cookie.
 */

import { UserRound } from 'lucide-react';

import { useT } from '../../i18n/LanguageProvider';

export function ManagedVaultNotice({ className = '' }: { className?: string }) {
  const { t } = useT();
  return (
    <div
      role="note"
      className={`flex items-start gap-3 rounded-xl border border-tone-warning/30 bg-tone-warning/[0.07] p-4 ${className}`}
    >
      <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-tone-warning" strokeWidth={1.8} />
      <p className="max-w-[70ch] text-[13px] leading-relaxed text-ink/70">
        <span className="font-semibold text-ink/85">{t('This is not an ordinary vault.')}</span>{' '}
        {t('A person decides what happens to the capital inside it, day to day. The contract keeps them within the vault’s rules, but it cannot make their decisions good ones — you can lose money without anybody breaking a rule.')}
      </p>
    </div>
  );
}

export default ManagedVaultNotice;
