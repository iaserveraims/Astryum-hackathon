'use client';

/**
 * VenueContact — la otra mitad de declarar el riesgo heredado: una dirección.
 *
 * EL HUECO. Astryum ya dice de quién hereda el riesgo
 * de cada ruta — quién decide, si te pueden liquidar, si la estrategia es
 * verificable. Lo que nunca dijo es a QUIÉN se escribe cuando el problema es
 * del sitio y no nuestro: una bóveda pausada, una tasa que se movió, una cola
 * de salida que no avanza. Sin esa línea, la persona escribe al Discord de
 * Astryum, donde nadie puede hacer nada, porque no construimos la cosa que se
 * rompió.
 */

import { ExternalLink } from 'lucide-react';
import { useT } from '@/i18n/LanguageProvider';
import { PROTOCOLS, builderOf, channelsOf, type ProtocolId } from '@/lib/earn/protocols';

export function VenueContact({
  protocol,
  variant = 'panel',
  className = '',
}: {
  protocol: ProtocolId;
  /**
   * `panel` — la ficha, antes de firmar: la lista entera.
   * `dense` — el recibo, después: una línea y las dos mejores puertas, porque
   *   un recibo no es un directorio.
   */
  variant?: 'panel' | 'dense';
  className?: string;
}) {
  const { t } = useT();
  const p = PROTOCOLS[protocol];
  const builder = builderOf(p);
  const channels = channelsOf(p, variant === 'dense' ? 2 : undefined);

  if (variant === 'dense') {
    return (
      <div className={`flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px] text-ink/40 ${className}`}>
        <span>
          <span className="text-ink/60">{builder}</span> —{' '}
          {channels.length > 0 ? `${t('their own channels')}:` : t('It publishes no channel we can link to.')}
        </span>
        {channels.length > 0 &&
          channels.map((c) => (
            <a
              key={c.url}
              href={c.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-ink/55 hover:text-volt"
            >
              {c.name}
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          ))}
      </div>
    );
  }

  return (
    <div className={`space-y-1.5 ${className}`}>
      <p className="text-[11.5px] leading-snug text-ink/55">
        <span className="font-medium text-ink/75">{builder}</span> {t('built this — Astryum did not.')}
      </p>
      {channels.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[11px] text-ink/40">{t('Where to ask them')}:</span>
          {channels.map((c) => (
            <a
              key={c.url}
              href={c.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11.5px] text-ink/70 hover:text-volt"
            >
              {c.name}
              <ExternalLink className="h-3 w-3" />
            </a>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-ink/40">{t('It publishes no channel we can link to.')}</p>
      )}
    </div>
  );
}

export default VenueContact;
