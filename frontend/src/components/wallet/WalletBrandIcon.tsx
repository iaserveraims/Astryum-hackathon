'use client';

/**
 * WalletBrandIcon — a recognisable, simplified mark per wallet provider.
 *
 * Hand-drawn geometric marks (not the trademarked logos verbatim): evocative
 * enough to tell MetaMask from Xaman at a glance, simple enough to render at
 * 16–40px on any background. Every mark shares the same 24×24 viewBox and is
 * optically centred within it (roughly a 3px margin on every side) so the
 * chip that wraps it never looks off-balance regardless of provider.
 *
 * The surrounding chip carries the wallet's personal colour (walletIdentity);
 * these marks keep their own provider-brand hex (the one hardcode exception —
 * 's colour-tokens rule).
 */

import type { WalletBrand } from '../../lib/walletIdentity';

export default function WalletBrandIcon({
  brand,
  size = 18,
  className = '',
  tint,
}: {
  brand: WalletBrand;
  size?: number;
  className?: string;
  /**
   * EL DISTINTIVO POR WALLET. Cuando se pasa —el
   * color de esa cuenta, `walletColor()`— la marca de Xaman se dibuja DENTRO
   * de un aro de ese color: la X sigue siendo la misma en todas, que es lo que
   * dice «esto es Xaman», y el aro dice CUÁL de ellas.
   *
   * Es opt-in a propósito. La marca de agua grande de la tarjeta NO lo pasa:
   * va en escala de grises al 10%, y un aro ahí solo añadiría un círculo gris
   * alrededor de la X. Y solo lo usa la marca de Xaman: la zorra de MetaMask
   * es el logo oficial a todo color y no se tiñe ni se enmarca.
   */
  tint?: string;
}) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', className, 'aria-hidden': true as const };

  switch (brand) {
    case 'metamask': {
      // LA ZORRA ORIGINAL. Este es el metamask-fox.svg
      // canónico, polígono a polígono con su paleta oficial, en su viewBox
      // nativo de 318.6 — no una redibujada a 24px. Cada polígono lleva su
      // stroke del mismo color, como el asset original: a tamaños pequeños es
      // lo que sella las juntas entre facetas.
      const P = ({ f, pts }: { f: string; pts: string }) => (
        <polygon fill={f} stroke={f} strokeLinecap="round" strokeLinejoin="round" points={pts} />
      );
      return (
        <svg width={size} height={size} viewBox="0 0 318.6 318.6" className={className} aria-hidden fill="none">
          <P f="#E2761B" pts="274.1,35.5 174.6,109.4 193,65.8" />
          <P f="#E4761B" pts="44.4,35.5 143.1,110.1 125.6,65.8" />
          <P f="#E4761B" pts="238.3,206.8 211.8,247.4 268.5,263 284.8,207.7" />
          <P f="#E4761B" pts="33.9,207.7 50.1,263 106.8,247.4 80.3,206.8" />
          <P f="#E4761B" pts="103.6,138.2 87.8,162.1 144.1,164.6 142.1,104.1" />
          <P f="#E4761B" pts="214.9,138.2 175.9,103.4 174.6,164.6 230.8,162.1" />
          <P f="#E4761B" pts="106.8,247.4 140.6,230.9 111.4,208.1" />
          <P f="#E4761B" pts="177.9,230.9 211.8,247.4 207.1,208.1" />
          <P f="#D7C1B3" pts="211.8,247.4 177.9,230.9 180.6,253 180.3,262.3" />
          <P f="#D7C1B3" pts="106.8,247.4 138.3,262.3 138.1,253 140.6,230.9" />
          <P f="#233447" pts="138.8,193.5 110.6,185.2 130.5,176.1" />
          <P f="#233447" pts="179.7,193.5 188,176.1 208,185.2" />
          <P f="#CD6116" pts="106.8,247.4 111.6,206.8 80.3,207.7" />
          <P f="#CD6116" pts="207,206.8 211.8,247.4 238.3,207.7" />
          <P f="#CD6116" pts="230.8,162.1 174.6,164.6 179.8,193.5 188.1,176.1 208.1,185.2" />
          <P f="#CD6116" pts="110.6,185.2 130.6,176.1 138.8,193.5 144.1,164.6 87.8,162.1" />
          <P f="#E4751F" pts="87.8,162.1 111.4,208.1 110.6,185.2" />
          <P f="#E4751F" pts="208.1,185.2 207.1,208.1 230.8,162.1" />
          <P f="#E4751F" pts="144.1,164.6 138.8,193.5 145.4,227.6 146.9,182.7" />
          <P f="#E4751F" pts="174.6,164.6 171.9,182.6 173.1,227.6 179.8,193.5" />
          <P f="#F6851B" pts="179.8,193.5 173.1,227.6 177.9,230.9 207.1,208.1 208.1,185.2" />
          <P f="#F6851B" pts="110.6,185.2 111.4,208.1 140.6,230.9 145.4,227.6 138.8,193.5" />
          <P f="#C0AD9E" pts="180.3,262.3 180.6,253 178.1,250.8 140.4,250.8 138.1,253 138.3,262.3 106.8,247.4 117.8,256.4 140.1,271.9 178.4,271.9 200.8,256.4 211.8,247.4" />
          <P f="#161616" pts="177.9,230.9 173.1,227.6 145.4,227.6 140.6,230.9 138.1,253 140.4,250.8 178.1,250.8 180.6,253" />
          <P f="#763D16" pts="278.3,114.2 286.8,73.4 274.1,35.5 177.9,106.9 214.9,138.2 267.2,153.5 278.8,140 273.8,136.4 281.8,129.1 275.6,124.3 283.6,118.2" />
          <P f="#763D16" pts="31.8,73.4 40.3,114.2 34.9,118.2 42.9,124.3 36.8,129.1 44.8,136.4 39.8,140 51.3,153.5 103.6,138.2 140.6,106.9 44.4,35.5" />
          <P f="#F6851B" pts="267.2,153.5 214.9,138.2 230.8,162.1 207.1,208.1 238.3,207.7 284.8,207.7" />
          <P f="#F6851B" pts="103.6,138.2 51.3,153.5 33.9,207.7 80.3,207.7 111.4,208.1 87.8,162.1" />
          <P f="#F6851B" pts="174.6,164.6 177.9,106.9 193.1,65.8 125.6,65.8 140.6,106.9 144.1,164.6 145.3,182.8 145.4,227.6 173.1,227.6 173.3,182.8" />
        </svg>
      );
    }
    case 'xaman':
      // The Xaman X — two bold rounded strokes in the brand blue. Redrawn:
      // the old sharp
      // double-shard read as a glitch at row size; rounded caps read as the
      // actual app icon.
      //
      // Con `tint`, la MISMA X se encoge un punto y se mete en un aro del
      // color de esa cuenta (ver la prop): la marca no cambia entre wallets
      // —cambiarla sería dejar de ser Xaman— y lo que distingue es el aro.
      return tint ? (
        <svg {...common} fill="none">
          <circle cx="12" cy="12" r="10.6" stroke={tint} strokeWidth="1.9" />
          <path d="M7.6 7.6 16.4 16.4M16.4 7.6 7.6 16.4" stroke="#3052FF" strokeWidth="3.1" strokeLinecap="round" />
        </svg>
      ) : (
        <svg {...common} fill="none">
          <path d="M6.2 6.2 17.8 17.8M17.8 6.2 6.2 17.8" stroke="#3052FF" strokeWidth="3.6" strokeLinecap="round" />
        </svg>
      );
    case 'walletconnect':
      // The signal-wave "w": a wide arc reaching down, echoed by a smaller
      // arc beneath it — both centred on the same axis.
      return (
        <svg {...common} fill="none">
          <path
            d="M7 10.4a7 7 0 0 1 10 0"
            stroke="#3b99fc"
            strokeWidth="2.1"
            strokeLinecap="round"
          />
          <path
            d="M9.3 12.9a3.7 3.7 0 0 1 5.4 0l.35.35-1.9 1.9-.5-.5a.9.9 0 0 0-1.3 0l-.5.5-1.9-1.9.35-.35Z"
            fill="#3b99fc"
          />
        </svg>
      );
    case 'phantom':
      // The rounded ghost silhouette with two eye cut-outs.
      return (
        <svg {...common} fill="none">
          <path
            d="M12 4.2a7.4 7.4 0 0 1 7.4 7.4v6.6c0 .66-.8.98-1.26.5l-.5-.52a1.15 1.15 0 0 0-1.66 0l-.4.42a1.15 1.15 0 0 1-1.66 0l-.4-.42a1.15 1.15 0 0 0-1.66 0l-.4.42a1.15 1.15 0 0 1-1.66 0l-.4-.42a1.15 1.15 0 0 0-1.66 0l-.5.52c-.46.48-1.26.16-1.26-.5v-6.6A7.4 7.4 0 0 1 12 4.2z"
            fill="#ab9ff2"
          />
          <circle cx="9.4" cy="11.2" r="1.15" fill="#1c1c3a" />
          <circle cx="14.6" cy="11.2" r="1.15" fill="#1c1c3a" />
        </svg>
      );
    case 'ledger':
      // Four corner brackets forming an open square, with a small solid
      // core square offset toward the centre — the Ledger "L" cropmark.
      return (
        <svg {...common} fill="none" stroke="#d4d4d4" strokeWidth="1.8" strokeLinecap="round">
          <path d="M4 9V4.6h4.4" />
          <path d="M15.6 4.6H20V9" />
          <path d="M20 15v4.4h-4.4" />
          <path d="M8.4 19.4H4V15" />
          <rect x="9.4" y="9.4" width="5.2" height="5.2" fill="#d4d4d4" stroke="none" />
        </svg>
      );
    case 'turnkey':
      // A padlock reduced to a keyhole ring + shackle — "the embedded key".
      return (
        <svg {...common} fill="none" stroke="#34d399" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 10.4V8a4 4 0 0 1 8 0v2.4" />
          <rect x="6" y="10.4" width="12" height="8.6" rx="1.8" fill="none" />
          <circle cx="12" cy="14" r="1.3" fill="#34d399" stroke="none" />
          <path d="M12 15.3v1.6" />
        </svg>
      );
    case 'generic-xrpl':
      // Two arcs meeting at the centre line — the XRPL crossing gesture.
      return (
        <svg {...common} fill="none" stroke="#7dd3fc" strokeWidth="1.8" strokeLinecap="round">
          <path d="M5.2 6.4 9 10.2a4.3 4.3 0 0 0 6 0l3.8-3.8" />
          <path d="M5.2 17.6 9 13.8a4.3 4.3 0 0 1 6 0l3.8 3.8" />
        </svg>
      );
    case 'generic-evm':
      // The diamond — chain-agnostic EVM mark, two stacked facets.
      return (
        <svg {...common} fill="none">
          <path d="M12 3.4 17.6 12 12 15.6 6.4 12 12 3.4z" fill="#9ca3af" opacity="0.85" />
          <path d="M12 17 17.6 13.4 12 20.6 6.4 13.4 12 17z" fill="#9ca3af" opacity="0.55" />
        </svg>
      );
    default:
      return (
        <svg {...common} fill="none" stroke="#9ca3af" strokeWidth="1.8" strokeLinecap="round">
          <rect x="4.2" y="7" width="15.6" height="11" rx="2.6" />
          <path d="M14.6 12.5h2.4" />
        </svg>
      );
  }
}
