'use client';

/**
 * StrategyIcons — the visual identity of a strategy tile: the VAULT/PROTOCOL
 * mark and the underlying ASSET logo.
 *
 * Real logos where a stable source exists (the same cryptologos CDN the wallet
 * services already hotlink, plus each protocol's favicon via DuckDuckGo's icon
 * proxy); every image degrades to a letter-mark tile on error, so the UI never
 * shows a broken image. Letter-marks stay monochrome (white on tonal surface)
 * — the asset logo is the only chromatic voice, per the cockpit system.
 */

import { useState } from 'react';

/** Asset ticker → logo URL. XRP-family receipts all read as XRP. */
const ASSET_LOGOS: Record<string, string> = {
  XRP: 'https://cryptologos.cc/logos/xrp-xrp-logo.png',
  FXRP: 'https://cryptologos.cc/logos/xrp-xrp-logo.png',
  STXRP: 'https://cryptologos.cc/logos/xrp-xrp-logo.png',
  EARNXRP: 'https://cryptologos.cc/logos/xrp-xrp-logo.png',
  MXRPY: 'https://cryptologos.cc/logos/xrp-xrp-logo.png',
  USDT: 'https://cryptologos.cc/logos/tether-usdt-logo.png',
  USDT0: 'https://cryptologos.cc/logos/tether-usdt-logo.png',
  USDC: 'https://cryptologos.cc/logos/usd-coin-usdc-logo.png',
  FLR: 'https://cryptologos.cc/logos/flare-flr-logo.png',
  WFLR: 'https://cryptologos.cc/logos/flare-flr-logo.png',
  SFLR: 'https://cryptologos.cc/logos/flare-flr-logo.png',
};

/** Protocol slug → homepage domain, for the favicon proxy. */
const PROTOCOL_DOMAINS: Record<string, string> = {
  upshift: 'upshift.finance',
  firelight: 'firelight.fi',
  kinetic: 'kinetic.market',
  ftso: 'flare.network',
  sceptre: 'sceptre.fi',
  sparkdex: 'sparkdex.ai',
  enosys: 'enosys.global',
};

function protocolLogo(protocol: string): string | null {
  const domain = PROTOCOL_DOMAINS[protocol.toLowerCase()];
  return domain ? `https://icons.duckduckgo.com/ip3/${domain}.ico` : null;
}

/** Monochrome letter tile — the guaranteed fallback for any mark. */
function LetterMark({ text, size, rounded }: { text: string; size: number; rounded: string }) {
  return (
    <span
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.38) }}
      className={`grid place-items-center ${rounded} border border-ink/10 bg-ink/5 font-semibold text-ink/80 uppercase select-none shrink-0`}
    >
      {text.slice(0, 2)}
    </span>
  );
}

function LogoOrLetter({
  src,
  alt,
  letter,
  size,
  rounded,
}: {
  src: string | null;
  alt: string;
  letter: string;
  size: number;
  rounded: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <LetterMark text={letter} size={size} rounded={rounded} />;
  return (
    <span
      style={{ width: size, height: size }}
      className={`grid place-items-center ${rounded} border border-ink/10 bg-ink/5 overflow-hidden shrink-0`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        width={size}
        height={size}
        loading="lazy"
        onError={() => setFailed(true)}
        className="w-full h-full object-contain p-[3px]"
      />
    </span>
  );
}

/** The vault/protocol mark (earnXRP → Upshift favicon, Kinetic → its mark…). */
export function VaultIcon({ protocol, name, size = 28 }: { protocol: string; name: string; size?: number }) {
  return (
    <LogoOrLetter
      src={protocolLogo(protocol)}
      alt={protocol}
      letter={name || protocol}
      size={size}
      rounded="rounded-lg"
    />
  );
}

/** The underlying asset logo (XRP behind FXRP/stXRP/earnXRP, USDT0, FLR…). */
export function AssetIcon({ symbol, size = 18 }: { symbol: string; size?: number }) {
  const key = symbol.toUpperCase();
  return (
    <LogoOrLetter
      src={ASSET_LOGOS[key] ?? null}
      alt={symbol}
      letter={symbol}
      size={size}
      rounded="rounded-full"
    />
  );
}
