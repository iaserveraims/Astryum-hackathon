/**
 * Sample data so the data-rich views render without live capital.
 *
 * Two doors in (both client-side):
 *  - NEXT_PUBLIC_PREVIEW_DATA — set ONLY in .env.local for local design work.
 *  - The PUBLIC DEMO (founder 2026-07-18): accounts created through the
 *    landing's "Launch demo" set localStorage 'astryum:demo'; their dashboard
 *    runs on these fixtures — mock wallets, mock money, everything usable.
 *    The ACCOUNT is real (saved for launch); only the capital shown is fake.
 *
 * Wired into the central jget/jpost helpers in v1Api.ts: when active and a
 * path has a fixture, the fixture is returned instead of hitting the network.
 */

import { hasLiveWalletSession } from '../lib/demoMode';

function demoFlag(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem('astryum:demo') === '1';
  } catch {
    return false;
  }
}
/** Static preview CONTEXT (env or demo at import). Kept for AccessGate's local-design
 *  auth-inject; the DATA decision uses isPreviewActive() (below). */
export const PREVIEW_DATA = process.env.NEXT_PUBLIC_PREVIEW_DATA === 'true' || demoFlag();

/**
 * R2 HARD CUT — the ONLY gate the fixture-serving paths (v1Api jget/jpost,
 * walletLinkService.listMyWallets) may use. Fixtures are served ONLY in a preview/demo
 * context AND while NO real wallet is connected. The moment a real wallet connects
 * (connectWallet → markLiveWalletSession), this returns false and every read goes live —
 * a session with a real wallet must NEVER see sample data. Evaluated at CALL TIME so it
 * reacts to the connection, unlike the import-time PREVIEW_DATA const.
 */
export function isPreviewActive(): boolean {
  return (
    (process.env.NEXT_PUBLIC_PREVIEW_DATA === 'true' || demoFlag()) && !hasLiveWalletSession()
  );
}
export const PREVIEW_ADDRESS = '0x7B3f9C2a1D4e8F0a6C5b2E1d9A8c7B6f5E4d3C2b';

const iso = () => new Date().toISOString();

function portfolioSnapshot() {
  return {
    wallet: PREVIEW_ADDRESS,
    chainId: 14,
    totalUSD: 48250.42,
    collateralUSD: 28480,
    debtUSD: 9120,
    netWorthUSD: 39130.42,
    positions: [
      { protocolId: 'kinetic', chainId: 14, kind: 'collateral', asset: 'sFLR', amountUSD: 18400 },
      { protocolId: 'kinetic', chainId: 14, kind: 'debt', asset: 'USDC', amountUSD: 9120 },
      { protocolId: 'sparkdex', chainId: 14, kind: 'lp', asset: 'FLR / USDC', amountUSD: 9500 },
      { protocolId: 'firelight', chainId: 14, kind: 'staking', asset: 'stXRP', amountUSD: 6750 },
      { protocolId: 'kinetic', chainId: 14, kind: 'collateral', asset: 'USDT', amountUSD: 4080 },
      { protocolId: 'enosys', chainId: 14, kind: 'lp', asset: 'FLR / eUSDT', amountUSD: 3120 },
      { protocolId: 'firelight', chainId: 14, kind: 'rewards', asset: 'rFLR', amountUSD: 540 },
    ],
    breakdown: {
      byProtocol: { kinetic: 31600, sparkdex: 9500, firelight: 7290, enosys: 3120 },
      byAsset: { sFLR: 18400, USDC: 12000, 'FLR / USDC': 9500, stXRP: 6750, USDT: 4080, 'FLR / eUSDT': 3120, rFLR: 540 },
      byKind: { collateral: 22480, debt: 9120, lp: 12620, staking: 6750, rewards: 540 },
    },
    takenAt: iso(),
  };
}

function riskSnapshot() {
  return {
    scope: 'PORTFOLIO' as const,
    scopeId: PREVIEW_ADDRESS,
    healthFactor: 1.78,
    ltv: 0.42,
    liquidationDistanceUSD: 6240,
    liquidationDistancePct: 0.221,
    collateralBufferUSD: 12800,
    riskLevel: 'WATCH' as const,
    riskScore: 31,
    warnings: [
      'Health Factor below 2.0 — consider adding collateral or repaying part of the USDC borrow.',
      'USDC borrow is 32% of your collateral value on Kinetic.',
    ],
    assumptions: [
      'FTSO prices as of the latest Flare block.',
      'Liquidation threshold 0.85 for sFLR collateral on Kinetic.',
    ],
    drivers: [
      { name: 'Kinetic USDC borrow', contribution: 0.46 },
      { name: 'sFLR price volatility', contribution: 0.31 },
      { name: 'SparkDEX LP exposure', contribution: 0.14 },
      { name: 'stXRP staking lock', contribution: 0.09 },
    ],
    computedAt: iso(),
  };
}

function history() {
  const pts: { takenAt: string; totalUSD: number }[] = [];
  const base = 41000;
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const drift = Math.sin(i / 3) * 1400 + (29 - i) * 250;
    pts.push({ takenAt: d.toISOString(), totalUSD: Math.round(base + drift) });
  }
  return pts;
}

function alerts() {
  return [
    {
      id: 'al_01',
      severity: 'WARNING',
      title: 'Health Factor approaching watch zone',
      message: 'Your Kinetic position HF dropped to 1.78 after FLR moved −4.2% in the last hour.',
      timestamp: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
      read: false,
    },
    {
      id: 'al_02',
      severity: 'INFO',
      title: 'SparkDEX LP back in range',
      message: 'Your FLR / USDC position is earning fees again after re-entering the active range.',
      timestamp: new Date(Date.now() - 1000 * 60 * 52).toISOString(),
      read: false,
    },
  ];
}

function capitalMap() {
  return {
    userId: 'preview',
    walletCount: 2,
    totalPositions: 7,
    totalInteractions: 23,
    estimatedTotalValueUSD: 48250.42,
    byChain: [{ chainId: 14, positionCount: 7, estimatedValueUSD: 48250.42 }],
    byProtocol: [
      { protocol: 'kinetic', chainId: 14, positionCount: 3, totalValueUSD: 31600, confidenceLevel: 'high', contractTypes: ['lending'] },
      { protocol: 'sparkdex', chainId: 14, positionCount: 1, totalValueUSD: 9500, confidenceLevel: 'high', contractTypes: ['clmm'] },
      { protocol: 'firelight', chainId: 14, positionCount: 2, totalValueUSD: 7290, confidenceLevel: 'medium', contractTypes: ['staking'] },
      { protocol: 'enosys', chainId: 14, positionCount: 1, totalValueUSD: 3120, confidenceLevel: 'medium', contractTypes: ['amm'] },
    ],
    byAsset: [
      { symbol: 'sFLR', totalValueUSD: 18400, chains: [14], protocols: ['kinetic'] },
      { symbol: 'USDC', totalValueUSD: 12000, chains: [14], protocols: ['kinetic', 'sparkdex'] },
      { symbol: 'stXRP', totalValueUSD: 6750, chains: [14], protocols: ['firelight'] },
      { symbol: 'USDT', totalValueUSD: 4080, chains: [14], protocols: ['kinetic'] },
      { symbol: 'FLR', totalValueUSD: 6080, chains: [14], protocols: ['sparkdex', 'enosys'] },
    ],
    byKind: [
      { kind: 'collateral', positionCount: 2, totalValueUSD: 22480 },
      { kind: 'debt', positionCount: 1, totalValueUSD: 9120 },
      { kind: 'lp', positionCount: 2, totalValueUSD: 12620 },
      { kind: 'staking', positionCount: 1, totalValueUSD: 6750 },
      { kind: 'rewards', positionCount: 1, totalValueUSD: 540 },
    ],
    topPositions: [
      { id: 'p1', walletAddress: PREVIEW_ADDRESS, chainId: 14, protocol: 'kinetic', contractType: 'lending', asset: 'sFLR', valueUSD: 18400, confidenceLevel: 'high', sourceProvider: 'kinetic-adapter' },
      { id: 'p2', walletAddress: PREVIEW_ADDRESS, chainId: 14, protocol: 'sparkdex', contractType: 'clmm', asset: 'FLR / USDC', valueUSD: 9500, confidenceLevel: 'high', sourceProvider: 'sparkdex-adapter' },
      { id: 'p3', walletAddress: PREVIEW_ADDRESS, chainId: 14, protocol: 'kinetic', contractType: 'lending', asset: 'USDC', valueUSD: 9120, confidenceLevel: 'high', sourceProvider: 'kinetic-adapter' },
      { id: 'p4', walletAddress: PREVIEW_ADDRESS, chainId: 14, protocol: 'firelight', contractType: 'staking', asset: 'stXRP', valueUSD: 6750, confidenceLevel: 'medium', sourceProvider: 'zerion' },
      { id: 'p5', walletAddress: PREVIEW_ADDRESS, chainId: 14, protocol: 'kinetic', contractType: 'lending', asset: 'USDT', valueUSD: 4080, confidenceLevel: 'high', sourceProvider: 'kinetic-adapter' },
    ],
    riskScore: 31,
    dataQualityNote: 'Aggregated from on-chain protocol adapters and Zerion.',
    source: { providerId: 'astryum.capital', trustLevel: 'aggregator', fetchedAt: iso(), confidenceCaveat: 'Estimated values — confirm on-chain before signing.' },
  };
}

/** The demo's two mock wallets — shaped like BackendWallet rows so the whole
 *  wallet UI (brand icons, colours, toggles) works untouched. */
export const PREVIEW_XRPL_ADDRESS = 'rNDemoAstryumXrplWallet1234567890';
export function demoWallets() {
  return [
    {
      id: 'demo-evm',
      address: PREVIEW_ADDRESS,
      walletType: 'metamask',
      network: 'flare',
      chainId: 14,
      caip2: 'eip155:14',
      ecosystem: 'evm',
      isPrimary: true,
      purpose: 'watch',
      isConnected: true,
      nickname: 'Demo · MetaMask',
      bindingId: null,
      bindingMode: null,
      txAuthorized: false,
      includeInPortfolio: true,
      color: '#f97316',
      icon: 'rocket',
    },
    {
      id: 'demo-xrpl',
      address: PREVIEW_XRPL_ADDRESS,
      walletType: 'xaman',
      network: 'xrpl',
      chainId: 1440002,
      caip2: 'xrpl:mainnet',
      ecosystem: 'xrpl',
      isPrimary: true,
      purpose: 'watch',
      isConnected: true,
      nickname: 'Demo · Xaman',
      bindingId: null,
      bindingMode: null,
      txAuthorized: false,
      includeInPortfolio: true,
      color: '#38bdf8',
      icon: 'comet',
    },
  ];
}

function demoActivity() {
  const day = 86_400_000;
  const ev = (i: number, type: string, sym: string, amt: string, usd: number) => ({
    id: `demo-act-${i}`,
    wallet: PREVIEW_ADDRESS,
    txHash: `0xdemo${i.toString().padStart(60, '0')}`,
    blockNumber: 1_000_000 + i,
    timestamp: new Date(Date.now() - i * day).toISOString(),
    type,
    protocol: i % 2 === 0 ? 'kinetic' : 'sparkdex',
    assetIn: { asset: { symbol: sym, address: '0x0', chainId: 14, decimals: 18, priceUSD: null, source: {} }, amount: amt, amountUSD: usd },
    source: { provider: 'demo' },
  });
  return [
    ev(1, 'supply', 'FXRP', '120', 260),
    ev(2, 'swap', 'FLR', '900', 180),
    ev(4, 'claim', 'FLR', '12', 2.4),
    ev(6, 'transfer', 'FXRP', '40', 88),
    ev(9, 'stake', 'FLR', '500', 100),
  ];
}

export function previewGet(path: string): unknown | undefined {
  // Quiet fixtures so no surface errors while the demo runs on mock capital.
  if (path === '/governed-accounts') return { accounts: [] };
  if (path.startsWith('/council/proposals')) return { proposals: [] };
  if (path.startsWith('/rules')) return { rules: [] };
  if (path.startsWith('/activity')) {
    const events = demoActivity();
    return { wallet: PREVIEW_ADDRESS, count: events.length, events };
  }
  if (path === '/capital/map') return capitalMap();
  if (path === '/capital/positions') return { positions: portfolioSnapshot().positions, source: {} };
  if (path === '/capital/interactions') return { interactions: [], source: {} };
  if (path === '/portfolio' || path === '/portfolio/snapshot/latest') return portfolioSnapshot();
  if (path === '/portfolio/breakdown') {
    const s = portfolioSnapshot();
    return { wallet: s.wallet, totalUSD: s.totalUSD, breakdown: s.breakdown, takenAt: s.takenAt };
  }
  if (path === '/portfolio/history') return { count: 30, points: history() };
  if (path === '/risk/portfolio') return riskSnapshot();
  if (path.startsWith('/positions/')) return { wallet: PREVIEW_ADDRESS, positions: portfolioSnapshot().positions };
  if (path === '/alerts') {
    const a = alerts();
    return { count: a.length, alerts: a };
  }
  return undefined;
}

export function previewPost(path: string, body: any): unknown | undefined {
  if (path === '/risk/simulate-market-drop') {
    const before = riskSnapshot();
    const drop = Number(body?.dropPct) || 20;
    const after = {
      ...before,
      healthFactor: Math.max(0.92, before.healthFactor - drop * 0.019),
      riskScore: Math.min(100, Math.round(before.riskScore + drop * 1.45)),
      riskLevel: drop >= 30 ? ('DANGER' as const) : ('WARNING' as const),
      liquidationDistanceUSD: Math.max(0, before.liquidationDistanceUSD - drop * 240),
    };
    return { before, after, newHFsByPosition: [], computedAt: iso() };
  }
  return undefined;
}
