'use client';

/**
 * WalletGlyphIcon — renders the user's personal identity glyph for a wallet
 * (walletIdentity's WALLET_ICON_PRESETS). Same split as brandOf/WalletBrandIcon:
 * walletIcon() resolves the validated slug (data), this component draws it.
 *
 * Every mark shares the 24×24 viewBox and currentColor, so a single `color`
 * prop (normally the wallet's personal colour, walletColor()) tints the whole
 * glyph — no hardcoded hex here, unlike the provider brand marks.
 */

import type { WalletIconSlug } from '../../lib/walletIdentity';

export default function WalletGlyphIcon({
  icon,
  size = 18,
  color,
  className = '',
}: {
  icon: WalletIconSlug;
  size?: number;
  /** currentColor source — defaults to inherited text colour. */
  color?: string;
  className?: string;
}) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    className,
    style: color ? { color } : undefined,
    'aria-hidden': true as const,
  };

  switch (icon) {
    case 'planet':
      return (
        <svg {...common} fill="none">
          <circle cx="12" cy="12" r="5.4" stroke="currentColor" strokeWidth="1.6" />
          <path d="M4.3 15.2c3.2-2.3 12.2-2.3 15.4 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );
    case 'saturn':
      return (
        <svg {...common} fill="none">
          <g transform="rotate(-18 12 12)">
            <ellipse cx="12" cy="12" rx="9.2" ry="2.7" stroke="currentColor" strokeWidth="1.3" />
          </g>
          <circle cx="12" cy="12" r="4" fill="currentColor" />
        </svg>
      );
    case 'moon':
      return (
        <svg {...common} fill="none">
          <path
            d="M20 13.6A8.4 8.4 0 1 1 10.4 4a6.6 6.6 0 0 0 9.6 9.6Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
            fill="currentColor"
            fillOpacity="0.15"
          />
        </svg>
      );
    case 'comet':
      return (
        <svg {...common} fill="none">
          <circle cx="8.4" cy="15.6" r="3" fill="currentColor" />
          <path
            d="M11 13.2 19 5.4M12.6 15.2l6.6-4.6M13.6 17.6l5.1-2"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            opacity="0.55"
          />
        </svg>
      );
    case 'star':
      return (
        <svg {...common} fill="none">
          <path
            d="M12 3.2 13.9 9 19.8 10.9 13.9 12.8 12 18.6 10.1 12.8 4.2 10.9 10.1 9 12 3.2z"
            fill="currentColor"
          />
        </svg>
      );
    case 'orbit':
      return (
        <svg {...common} fill="none">
          <ellipse
            cx="12"
            cy="12"
            rx="9"
            ry="4.4"
            stroke="currentColor"
            strokeWidth="1.3"
            transform="rotate(-25 12 12)"
          />
          <circle cx="12" cy="12" r="1.9" fill="currentColor" />
          <circle cx="19.1" cy="9.3" r="1.4" fill="currentColor" />
        </svg>
      );
    case 'rocket':
      return (
        <svg {...common} fill="none">
          <path
            d="M12 2.6c2.7 2 4.1 5.3 4.1 8.7 0 2-.5 3.9-1.4 5.5H9.3c-.9-1.6-1.4-3.5-1.4-5.5 0-3.4 1.4-6.7 4.1-8.7Z"
            fill="currentColor"
          />
          <path
            d="M9 15.6 6.6 19l3.2-1.1M15 15.6 17.4 19l-3.2-1.1"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="9.6" r="1.6" stroke="currentColor" strokeWidth="1.2" />
          <path d="M10.4 19.2h3.2l-1.6 2.7z" fill="currentColor" opacity="0.65" />
        </svg>
      );
    case 'asteroid':
      return (
        <svg {...common} fill="none">
          <path
            d="M5.2 12.6 7.5 8.7 12 6.4l4 1.5 3 3.6-1 3.9-3 3.4-5 .5-4-2-1.4-4.7z"
            fill="currentColor"
          />
          <circle cx="10.2" cy="12.2" r="1.05" fill="currentColor" opacity="0.35" style={{ mixBlendMode: 'multiply' }} />
          <circle cx="14" cy="10.4" r="0.75" fill="currentColor" opacity="0.35" style={{ mixBlendMode: 'multiply' }} />
        </svg>
      );
    case 'satellite':
      return (
        <svg {...common} fill="none">
          <rect x="9.9" y="9.9" width="4.2" height="4.2" rx="0.8" fill="currentColor" />
          <rect
            x="2.4"
            y="9.5"
            width="5.6"
            height="5"
            rx="0.7"
            stroke="currentColor"
            strokeWidth="1.2"
            transform="rotate(-30 5.2 12)"
          />
          <rect
            x="16"
            y="9.5"
            width="5.6"
            height="5"
            rx="0.7"
            stroke="currentColor"
            strokeWidth="1.2"
            transform="rotate(30 18.8 12)"
          />
          <path d="M14.4 9.8 17 7.2M17.5 6.2l1.1 1.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      );
    case 'sun':
      return (
        <svg {...common} fill="none">
          <circle cx="12" cy="12" r="4" fill="currentColor" />
          <path
            d="M12 3.4v2.3M12 18.3v2.3M3.4 12h2.3M18.3 12h2.3M5.9 5.9l1.6 1.6M16.5 16.5l1.6 1.6M18.1 5.9l-1.6 1.6M7.5 16.5l-1.6 1.6"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'constellation':
      return (
        <svg {...common} fill="none">
          <path
            d="M5 17.2 10 8.4l6 2.8 3-6"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.55"
          />
          <circle cx="5" cy="17.2" r="1.35" fill="currentColor" />
          <circle cx="10" cy="8.4" r="1.35" fill="currentColor" />
          <circle cx="16" cy="11.2" r="1.35" fill="currentColor" />
          <circle cx="19" cy="5.2" r="1.35" fill="currentColor" />
        </svg>
      );
    case 'nebula':
      return (
        <svg {...common} fill="none">
          <circle cx="9" cy="12.4" r="5" fill="currentColor" opacity="0.22" />
          <circle cx="14.2" cy="10.2" r="4.2" fill="currentColor" opacity="0.32" />
          <circle cx="13" cy="15.2" r="4.6" fill="currentColor" opacity="0.26" />
          <circle cx="17.2" cy="6.8" r="1" fill="currentColor" />
          <circle cx="6.2" cy="7.4" r="0.75" fill="currentColor" />
        </svg>
      );
    default:
      return null;
  }
}
