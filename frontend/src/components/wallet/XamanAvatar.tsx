'use client';

/**
 * XamanAvatar — EL CUBITO de cada wallet de Xaman en su chip (fundador
 * 2026-09-13, hablándolo con el compañero que lo construyó en 3a6c6d7a: «lo
 * puso él… ¿puedes volver a ponerlo? Quiero que los colores de cada cubito se
 * vean reflejados en la propia card»).
 *
 * La misma imagen que el usuario ve en su app Xaman: su hashicon, o la que
 * puso a mano. Dos cosas la distinguen de la primera versión, que se retiró
 * en 7c1aeffb:
 *
 *  1. LLEGA POR NUESTRO DOMINIO (api/xaman/avatar), no por <img> directo a
 *     xumm.app: así Xaman ve la dirección y la IP del servidor, no la del
 *     usuario, y el aviso de privacidad lo declara (§4, revisión 2026-09-13).
 *     De paso, misma-origen = el canvas puede leer los píxeles.
 *  2. SOLO WALLETS DE XAMAN (usesXamanAvatar: brandOf === 'xaman'), no toda
 *     dirección XRPL: una watch-only o una de XRP Identity no es de Xaman y
 *     no se le pide su imagen a nadie.
 *
 * Y lo nuevo: al cargar, se lee su COLOR dominante (xamanHues.dominantHex) y
 * se guarda por cuenta. walletColor() lo usa como color por defecto de la
 * tarjeta — «seguir el avatar», la opción que Gestionar trae activada — hasta
 * que el usuario elija un color a mano, que siempre gana.
 *
 * Si la imagen no llega (offline, Xaman caído), cae a la marca del proveedor:
 * jamás un hueco en el chip.
 */

import { useState } from 'react';
import WalletBrandIcon from './WalletBrandIcon';
import type { WalletBrand } from '../../lib/walletIdentity';
import { dominantHex, getXamanHue, setXamanHue } from '../../lib/wallet/xamanHues';

export function XamanAvatar({
  address,
  size,
  brand = 'xaman',
}: {
  address: string;
  size: number;
  /** La marca a la que caer si la imagen falla (brandOf del wallet). */
  brand?: WalletBrand;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return <WalletBrandIcon brand={brand} size={size} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- ruta propia, sin optimización que valga
    <img
      // SIN «.png» a propósito (2026-09-13, segunda pasada): next.config.js
      // sella toda URL que acaba en .png con «Cache-Control: immutable, un
      // año» — pensado para los assets estáticos. Aplicado a esta ruta, una
      // primera respuesta fallida (Xaman caído, un despliegue a medias) se
      // quedaba cacheada en el navegador y el chip enseñaba la X para
      // siempre. Sin extensión manda la caché de un día que pone la ruta.
      src={`/api/xaman/avatar/${address}`}
      width={size}
      height={size}
      alt=""
      aria-hidden
      loading="lazy"
      decoding="async"
      className="shrink-0 rounded-full object-cover"
      onError={() => {
        // La caída a la X es silenciosa para el usuario; para quien depura, no.
        if (process.env.NODE_ENV !== 'production') console.warn(`[XamanAvatar] no llegó /api/xaman/avatar/${address}`);
        setFailed(true);
      }}
      onLoad={(e) => {
        // El color, una sola vez por cuenta: si ya se conoce, no se recalcula.
        if (getXamanHue(address)) return;
        try {
          const N = 24;
          const canvas = document.createElement('canvas');
          canvas.width = N;
          canvas.height = N;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          ctx.drawImage(e.currentTarget, 0, 0, N, N);
          const hex = dominantHex(ctx.getImageData(0, 0, N, N).data);
          if (hex) setXamanHue(address, hex);
        } catch {
          /* canvas no disponible: la tarjeta conserva el tono derivado de la dirección */
        }
      }}
    />
  );
}

export default XamanAvatar;
