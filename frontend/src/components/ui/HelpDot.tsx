'use client';

/**
 * HelpDot — el interrogante que guarda la letra pequeña.
 *
 * El reparto que instaura: el botón lleva UNA línea corta; la explicación
 * entera vive aquí y aparece al pasar el ratón por el interrogante — visible
 * siempre, repetitivo nunca. Tooltip 100% CSS (el patrón del disabledReason
 * de PrimaryButton): nada de estado, nada de framer. El clic se traga
 * (stopPropagation) para que preguntar jamás abra la puerta anfitriona; con
 * teclado, enfocar el punto también muestra la ayuda.
 */
export function HelpDot({
  text,
  side = 'bottom',
  align = 'right',
  className = '',
}: {
  /** La explicación completa — la que antes sobrecargaba el botón. */
  text: string;
  /** Hacia dónde abre el globo: bottom (bajo el punto) o top (encima —
   *  para puntos que viven al pie de su tarjeta). */
  side?: 'bottom' | 'top';
  /** Con qué borde del punto se alinea el globo. */
  align?: 'right' | 'left';
  className?: string;
}) {
  return (
    <span
      className={className || undefined}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      <span
        role="note"
        aria-label={text}
        tabIndex={0}
        className="group/help relative inline-grid h-5 w-5 cursor-help place-items-center rounded-full border border-ink/20 bg-surface-2/90 font-mono text-[10px] font-semibold text-ink/50 transition-colors hover:border-volt/45 hover:text-ink/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt/50"
      >
        ?
        <span
          role="tooltip"
          className={`pointer-events-none absolute z-30 w-64 rounded-lg border border-ink/10 bg-surface-2 px-3 py-2 text-left font-sans text-[11.5px] font-normal normal-case leading-relaxed tracking-normal text-ink/80 opacity-0 shadow-xl transition-opacity duration-150 group-hover/help:opacity-100 group-focus-visible/help:opacity-100 ${
            side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          } ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {text}
        </span>
      </span>
    </span>
  );
}
