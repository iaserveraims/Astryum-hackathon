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
 * see CLAUDE.md's colour-tokens rule).
 */

import type { WalletBrand } from '../../lib/walletIdentity';

export default function WalletBrandIcon({
  brand,
  size = 18,
  className = '',
}: {
  brand: WalletBrand;
  size?: number;
  className?: string;
}) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', className, 'aria-hidden': true as const };

  switch (brand) {
    case 'metamask':
      // The fox, reduced to an angular head: two peaked ears, a tapered
      // snout, a stroked muzzle line — centred at (12, 12).
      return (
        <svg {...common} fill="none">
          <path
            d="M12 3.4 20.2 8l-1.3 6.4L15.6 19h-7.2l-3.3-4.6L3.8 8 12 3.4z"
            fill="#f6851b"
          />
          <path
            d="M12 3.4 8.8 8.6 12 10.6l3.2-2L12 3.4z"
            fill="#e2761b"
          />
          <path
            d="M8.8 14.6h6.4L14 17.4h-4l-1.2-2.8z"
            fill="#d7c1b3"
          />
          <path
            d="M9.6 15.4 12 17l2.4-1.6"
            stroke="#4a2b0f"
            strokeWidth="1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'xaman':
      // The sharp double-X shard — two crossing chevrons meeting at centre.
      return (
        <svg {...common} fill="none">
          <path
            d="M4.6 4.8h3.9l3.5 4.7 3.5-4.7h3.9l-5.5 7.2 5.5 7.2h-3.9l-3.5-4.7-3.5 4.7H4.6l5.5-7.2-5.5-7.2z"
            fill="#3bc1f5"
          />
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
