'use client';

/**
 * ServerRefusalBody — LO QUE EL SERVIDOR DIJO, ENTERO, CON ALGO QUE PULSAR.
 *
 * . `lib/errors/serverRefusal` es el UN lector de «el
 * servidor dijo que no», y hasta esta iteración devolvía una cadena: el
 * `headline`, las `ways[]` y el `retryAfterSeconds` que `provenAddresses.ts`
 * construye y las rutas mandan verbatim se perdían en el camino. La única
 * pantalla que ofrecía una puerta era `SeatRefusalNotice`, la del carril 0xFE.
 */

import type { ReadableRefusal } from '../../lib/errors/serverRefusal';

export function ServerRefusalBody({
  refusal,
  t,
  className,
}: {
  refusal: ReadableRefusal;
  t: (s: string) => string;
  className?: string;
}) {
  const { headline, text, ways, door, retryAfterSeconds } = refusal;
  // El titular es la línea corta de arriba; si el servidor mandó el mismo texto
  // en las dos, no se repite.
  const showHeadline = !!headline && headline !== text;
  return (
    <div className={className ?? 'space-y-1.5'}>
      {showHeadline && <p className="font-medium">{headline}</p>}
      <p>{text}</p>
      {ways.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4">
          {ways.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {typeof retryAfterSeconds === 'number' && retryAfterSeconds > 0 && (
        <p className="text-ink/60">
          {t('The server asked for')} ≈{Math.ceil(retryAfterSeconds)} s {t('before trying again.')}
        </p>
      )}
      {door && (
        <a
          href={door.href}
          className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-[12px] font-medium"
        >
          {door.label}
        </a>
      )}
    </div>
  );
}
