/**
 * walletIdentity — provider brand + personal colour of a wallet.
 *
 * The colour is IDENTITY, not data: the user tags each wallet and the same
 * hue follows it across Wallets, Summary and Portfolio, so "which wallet is
 * this row" is answered at a glance. Stored server-side in the wallet's
 * permissions JSON (PATCH /api/wallets/mine/:id { color }).
 */

import type { WalletRecord } from './portfolioMerge';

export type WalletBrand =
  | 'metamask'
  | 'xaman'
  | 'walletconnect'
  | 'phantom'
  | 'ledger'
  | 'turnkey'
  | 'generic-evm'
  | 'generic-xrpl'
  | 'generic';

/** Detect the provider brand from the free-form walletType + ecosystem. */
export function brandOf(walletType?: string, ecosystem?: string): WalletBrand {
  const t = (walletType ?? '').toLowerCase();
  if (t.includes('metamask')) return 'metamask';
  if (t.includes('xaman') || t.includes('xumm')) return 'xaman';
  if (t.includes('walletconnect')) return 'walletconnect';
  if (t.includes('phantom')) return 'phantom';
  if (t.includes('ledger') || t.includes('trezor')) return 'ledger';
  if (t.includes('turnkey') || t.includes('embedded')) return 'turnkey';
  if (ecosystem === 'xrpl') return 'generic-xrpl';
  if (ecosystem === 'evm' || t === 'siwe') return 'generic-evm';
  return 'generic';
}

/** The preset palette offered by the colour picker (8 tags + none). */
export const WALLET_COLOR_PRESETS = [
  '#f97316', // orange
  '#eab308', // amber
  '#22c55e', // green
  '#14b8a6', // teal
  '#38bdf8', // sky
  '#818cf8', // indigo
  '#e879f9', // fuchsia
  '#f43f5e', // rose
] as const;

/** Fallback hue per brand when the user has not tagged a colour yet — still
 *  distinguishable, never random (stable across renders and devices). */
const BRAND_FALLBACK: Record<WalletBrand, string> = {
  metamask: '#f97316',
  xaman: '#38bdf8',
  walletconnect: '#60a5fa',
  phantom: '#a78bfa',
  ledger: '#a3a3a3',
  turnkey: '#34d399',
  'generic-evm': '#9ca3af',
  'generic-xrpl': '#7dd3fc',
  generic: '#9ca3af',
};

/** The colour a wallet row/dot should use anywhere in the app. */
export function walletColor(w: Pick<WalletRecord, 'color' | 'walletType' | 'ecosystem'>): string {
  return w.color || BRAND_FALLBACK[brandOf(w.walletType, w.ecosystem)];
}

/** Build an address→colour resolver from the wallet list (case-aware like
 *  dedupeWallets: EVM compares lowercased, XRPL verbatim). */
export function walletColorResolver(
  wallets: Array<Pick<WalletRecord, 'address' | 'color' | 'walletType' | 'ecosystem'>>,
): (address: string) => string {
  const key = (a: string) => (a.startsWith('0x') ? a.toLowerCase() : a);
  const map = new Map<string, string>();
  for (const w of wallets) map.set(key(w.address), walletColor(w));
  return (address: string) => map.get(key(address)) ?? BRAND_FALLBACK.generic;
}

/* ------------------------------------------------------------------------ */
/* Personal glyph — a second, optional identity tag alongside colour.       */
/* ------------------------------------------------------------------------ */

/** The picker's glyph catalogue — a small spaceborne vocabulary that reads
 *  as "identity", not data. Slugs are what's persisted (PATCH { icon }),
 *  labels are translated at the call site with t(). Rendered by the sibling
 *  component WalletGlyphIcon (same split as WalletBrand → WalletBrandIcon). */
export const WALLET_ICON_PRESETS = [
  { slug: 'planet', label: 'Planet' },
  { slug: 'saturn', label: 'Ringed planet' },
  { slug: 'moon', label: 'Moon' },
  { slug: 'comet', label: 'Comet' },
  { slug: 'star', label: 'Star' },
  { slug: 'orbit', label: 'Orbit' },
  { slug: 'rocket', label: 'Rocket' },
  { slug: 'asteroid', label: 'Asteroid' },
  { slug: 'satellite', label: 'Satellite' },
  { slug: 'sun', label: 'Sun' },
  { slug: 'constellation', label: 'Constellation' },
  { slug: 'nebula', label: 'Nebula' },
] as const;

export type WalletIconSlug = (typeof WALLET_ICON_PRESETS)[number]['slug'];

const WALLET_ICON_SLUGS = new Set<string>(WALLET_ICON_PRESETS.map((p) => p.slug));

/** The wallet's personal glyph, validated against the catalogue — null when
 *  unset (or an unrecognised/legacy value), meaning "use the provider mark". */
export function walletIcon(w: Pick<WalletRecord, 'icon'>): WalletIconSlug | null {
  return w.icon && WALLET_ICON_SLUGS.has(w.icon) ? (w.icon as WalletIconSlug) : null;
}

/** Build an address→glyph resolver from the wallet list, same shape and
 *  case-awareness as walletColorResolver. Returns null (not a fallback
 *  glyph) so callers can fall back to the provider brand mark instead. */
export function walletIconResolver(
  wallets: Array<Pick<WalletRecord, 'address' | 'icon'>>,
): (address: string) => WalletIconSlug | null {
  const key = (a: string) => (a.startsWith('0x') ? a.toLowerCase() : a);
  const map = new Map<string, WalletIconSlug | null>();
  for (const w of wallets) map.set(key(w.address), walletIcon(w));
  return (address: string) => map.get(key(address)) ?? null;
}
