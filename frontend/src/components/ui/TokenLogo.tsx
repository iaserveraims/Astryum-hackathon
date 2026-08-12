'use client';

import { useState } from 'react';
import { FXRP_FAMILY } from '@/lib/assetLogos';

// CoinGecko stable asset CDN — industry standard used by Uniswap, Aave, etc.
// Covers ~95% of DeFi tokens by TVL. Falls back to JSDelivr for long tail.
const LOGO_MAP: Record<string, string> = {
  // ── Native + Wrapped ─────────────────────────────────────────────────────────
  ETH:     'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  WETH:    'https://assets.coingecko.com/coins/images/2518/small/weth.png',
  BTC:     'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
  WBTC:    'https://assets.coingecko.com/coins/images/7598/small/wrapped_bitcoin_wbtc.png',
  BNB:     'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
  WBNB:    'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
  MATIC:   'https://assets.coingecko.com/coins/images/4713/small/polygon-matic-logo.png',
  POL:     'https://assets.coingecko.com/coins/images/4713/small/polygon-matic-logo.png',
  WMATIC:  'https://assets.coingecko.com/coins/images/4713/small/polygon-matic-logo.png',
  SOL:     'https://assets.coingecko.com/coins/images/4128/small/solana.png',
  AVAX:    'https://assets.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png',
  WAVAX:   'https://assets.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png',
  FLR:     'https://assets.coingecko.com/coins/images/28624/small/FLR-icon200x200.png',
  SGB:     'https://assets.coingecko.com/coins/images/26492/small/SGB.png',
  // CoinGecko's "xrp-symbol-white" PNG is a DARK mark — invisible on the dark
  // UI. The cryptocurrency-icons build carries the navy-circle + white-X mark.
  XRP:     'https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/xrp.svg',
  // FXRP is NOT XRP: it is the FAssets representation on Flare and carries its
  // own mark (the X on Flare crimson). Self-hosted so the flagship asset never
  // depends on a third-party CDN — and so no CDN learns who is looking at it.
  // Flare-side receipts backed by FXRP read as FXRP too.
  ...FXRP_FAMILY,
  // ── Stablecoins ──────────────────────────────────────────────────────────────
  USDC:    'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
  USDT:    'https://assets.coingecko.com/coins/images/325/small/Tether.png',
  DAI:     'https://assets.coingecko.com/coins/images/9956/small/dai.png',
  FRAX:    'https://assets.coingecko.com/coins/images/13422/small/frax_share.png',
  LUSD:    'https://assets.coingecko.com/coins/images/14666/small/Group_3.png',
  USDS:    'https://assets.coingecko.com/coins/images/39978/small/USDS.png',
  USDE:    'https://assets.coingecko.com/coins/images/33613/small/usde.png',
  SUSDE:   'https://assets.coingecko.com/coins/images/36810/small/sUSDe.png',
  SUSDE_:  'https://assets.coingecko.com/coins/images/36810/small/sUSDe.png',
  GHO:     'https://assets.coingecko.com/coins/images/30097/small/gho.png',
  PYUSD:   'https://assets.coingecko.com/coins/images/31212/small/PYUSD_Logo.png',
  CRVUSD:  'https://assets.coingecko.com/coins/images/30118/small/crvusd.png',
  FDUSD:   'https://assets.coingecko.com/coins/images/31079/small/firstdigitalusd.jpeg',
  TUSD:    'https://assets.coingecko.com/coins/images/3449/small/tusd.png',
  BUSD:    'https://assets.coingecko.com/coins/images/9576/small/BUSD.png',
  USDP:    'https://assets.coingecko.com/coins/images/6013/small/Pax_Dollar.png',
  // ── Liquid Staking Tokens ────────────────────────────────────────────────────
  STETH:   'https://assets.coingecko.com/coins/images/13442/small/steth_logo.png',
  WSTETH:  'https://assets.coingecko.com/coins/images/18834/small/wstETH.png',
  RETH:    'https://assets.coingecko.com/coins/images/20764/small/reth.png',
  CBETH:   'https://assets.coingecko.com/coins/images/27008/small/cbeth.png',
  FRXETH:  'https://assets.coingecko.com/coins/images/28284/small/frxETH.png',
  SFRXETH: 'https://assets.coingecko.com/coins/images/28285/small/sfrxETH.png',
  EETH:    'https://assets.coingecko.com/coins/images/33049/small/eETH.png',
  WEETH:   'https://assets.coingecko.com/coins/images/33033/small/weETH.png',
  METH:    'https://assets.coingecko.com/coins/images/33345/small/symbol_transparent_background.png',
  EZETH:   'https://assets.coingecko.com/coins/images/34753/small/ezeth.png',
  RSETH:   'https://assets.coingecko.com/coins/images/35867/small/rseth.png',
  SFRL:    'https://assets.coingecko.com/coins/images/28624/small/FLR-icon200x200.png',
  // ── DeFi Governance Tokens ───────────────────────────────────────────────────
  AAVE:    'https://assets.coingecko.com/coins/images/12645/small/AAVE.png',
  UNI:     'https://assets.coingecko.com/coins/images/12504/small/uniswap-uni.png',
  CRV:     'https://assets.coingecko.com/coins/images/12124/small/Curve.png',
  CVX:     'https://assets.coingecko.com/coins/images/15585/small/convex.png',
  LDO:     'https://assets.coingecko.com/coins/images/13573/small/Lido_DAO.png',
  COMP:    'https://assets.coingecko.com/coins/images/10775/small/COMP.png',
  MKR:     'https://assets.coingecko.com/coins/images/1364/small/Mark_Maker.png',
  SNX:     'https://assets.coingecko.com/coins/images/3406/small/SNX.png',
  SUSHI:   'https://assets.coingecko.com/coins/images/12271/small/512x512_Logo_no_chop.png',
  BAL:     'https://assets.coingecko.com/coins/images/11683/small/Balancer.png',
  PENDLE:  'https://assets.coingecko.com/coins/images/15069/small/Pendle_Logo_Normal-03.png',
  EIGEN:   'https://assets.coingecko.com/coins/images/36637/small/eigen.jpeg',
  // ── L2 Tokens ────────────────────────────────────────────────────────────────
  OP:      'https://assets.coingecko.com/coins/images/25244/small/Optimism.png',
  ARB:     'https://assets.coingecko.com/coins/images/16547/small/photo_2023-03-29_21.47.00.jpeg',
  STRK:    'https://assets.coingecko.com/coins/images/26433/small/starknet.png',
  METIS:   'https://assets.coingecko.com/coins/images/15595/small/metis.jpeg',
  MNT:     'https://assets.coingecko.com/coins/images/30980/small/token-logo.png',
  BLAST:   'https://assets.coingecko.com/coins/images/35494/small/Blast.jpg',
  // ── Oracles / Infrastructure ─────────────────────────────────────────────────
  LINK:    'https://assets.coingecko.com/coins/images/877/small/chainlink-new-logo.png',
  GRT:     'https://assets.coingecko.com/coins/images/13397/small/Graph_Token.png',
};

const FALLBACK_COLORS = [
  'from-violet-600 to-purple-700',
  'from-blue-500 to-cyan-600',
  'from-emerald-500 to-teal-600',
  'from-amber-500 to-orange-600',
  'from-rose-500 to-pink-600',
  'from-sky-500 to-blue-600',
  'from-lime-500 to-green-600',
  'from-fuchsia-500 to-violet-600',
  'from-indigo-500 to-blue-700',
  'from-teal-500 to-emerald-700',
];

function symbolColor(s: string): string {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return FALLBACK_COLORS[h % FALLBACK_COLORS.length];
}

function cleanSymbol(raw: string): string {
  return raw.split('-')[0].split(' ')[0].split('/')[0].trim().toUpperCase();
}

// JSDelivr npm package URL (stable versioned release, not @master)
function jsdelivrUrl(clean: string): string {
  return `https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/${clean.toLowerCase()}.svg`;
}

interface TokenLogoProps {
  symbol: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

// 3-tier: CoinGecko CDN → JSDelivr (0.18.1) → gradient avatar
export function TokenLogo({ symbol, size = 'md', className = '' }: TokenLogoProps) {
  const clean = cleanSymbol(symbol);
  const primary = LOGO_MAP[clean] ?? jsdelivrUrl(clean);
  const secondary = LOGO_MAP[clean] ? jsdelivrUrl(clean) : null;

  // src/failed derive from `symbol` — when React reuses this component for a
  // DIFFERENT token (index-keyed table rows reorder as wallets load), the old
  // state must reset or the row shows the previous token's logo (FLR rendered
  // with XRP's mark). Render-time reset per the React derived-state pattern.
  const [state, setState] = useState({ for: clean, src: primary, failed: false });
  if (state.for !== clean) setState({ for: clean, src: primary, failed: false });
  const { src, failed } = state;
  const setSrc = (next: string) => setState((s) => ({ ...s, src: next }));
  const setFailed = (f: boolean) => setState((s) => ({ ...s, failed: f }));

  const sizeClass =
    size === 'xs' ? 'w-4 h-4 text-[7px]' :
    size === 'sm' ? 'w-5 h-5 text-[8px]' :
    size === 'lg' ? 'w-9 h-9 text-xs' :
    'w-6 h-6 text-[9px]';

  if (!failed) {
    return (
      <img
        src={src}
        alt={clean}
        onError={() => {
          if (secondary && src !== secondary) {
            setSrc(secondary);
          } else {
            setFailed(true);
          }
        }}
        className={`${sizeClass} rounded-full object-cover bg-ink/5 shrink-0 ${className}`}
      />
    );
  }

  const bg = symbolColor(clean);
  return (
    <div
      className={`${sizeClass} rounded-full bg-gradient-to-br ${bg} flex items-center justify-center font-bold text-white shrink-0 ${className}`}
    >
      {clean.slice(0, 2)}
    </div>
  );
}

// Stacked overlapping logos for LP pools ("USDC-WETH" → two coins)
interface PoolTokenLogosProps {
  symbol: string;
  size?: TokenLogoProps['size'];
}

export function PoolTokenLogos({ symbol, size = 'sm' }: PoolTokenLogosProps) {
  const parts = symbol.split(/[-/]/).slice(0, 3).filter(Boolean);
  if (parts.length <= 1) return <TokenLogo symbol={symbol} size={size} />;

  return (
    <div className="flex items-center">
      {parts.map((p, i) => (
        <div key={p} className="relative" style={{ marginLeft: i === 0 ? 0 : -6, zIndex: parts.length - i }}>
          <TokenLogo symbol={p} size={size} />
        </div>
      ))}
    </div>
  );
}
