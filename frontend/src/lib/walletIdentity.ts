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

/* ------------------------------------------------------------------------ */
/* Display name — ONE naming rule for every surface.                        */
/* ------------------------------------------------------------------------ */

/** Proper-cased provider name per brand — never show the raw walletType
 *  ('xaman' → 'Xaman'). null = no recognisable provider (generic rows). */
const BRAND_DISPLAY: Record<WalletBrand, string | null> = {
  metamask: 'MetaMask',
  xaman: 'Xaman',
  walletconnect: 'WalletConnect',
  phantom: 'Phantom',
  ledger: 'Ledger',
  turnkey: 'Embedded wallet',
  'generic-evm': null,
  'generic-xrpl': null,
  generic: null,
};

/** Curated names for the non-brand writers (closed set, see WalletManager's
 *  AUTO_WALLET_TYPES). English strings double as i18n keys at the call site. */
function curatedTypeLabel(walletType?: string): string | null {
  const wt = (walletType ?? '').trim();
  if (wt === 'smart-account' || wt === 'Flare Smart Account') return 'Smart Account';
  if (wt === 'Council · multisig') return 'Council';
  if (wt === 'manual') return 'Watch-only';
  return null;
}

/** Human label of the wallet's PROVIDER/type — brand name when recognised,
 *  curated label for platform writers, null when nothing presentable exists
 *  (e.g. 'siwe', 'evm' — raw plumbing values must never reach the screen). */
export function walletProviderLabel(walletType?: string, ecosystem?: string): string | null {
  const brand = BRAND_DISPLAY[brandOf(walletType, ecosystem)];
  return brand ?? curatedTypeLabel(walletType);
}

function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * The backend used to AUTO-nickname every tracked wallet "<Chain> <n>"
 * ("XRPL 1", "Flare 2"…) when the client sent none — and since the nickname
 * wins the display rule, the founder's own Xaman read "XRPL 1" everywhere
 * (founder 2026-08-08: "sigue siendo confuso"). The generator is gone from
 * the backend, but the strings already live in user rows, so the display
 * layer treats them as NOT a nickname and falls through to the provider
 * name. Only this exact machine pattern is filtered — anything a user typed
 * by hand ("XRPL fría", "Flare ahorro") is theirs and always wins.
 */
export function isAutoNickname(name?: string | null): boolean {
  return !!name && /^(XRPL|Flare) \d+$/.test(name);
}

/**
 * THE wallet display name, shared by Wallets, Summary and Portfolio (founder
 * 2026-08-08: the same Xaman wallet read "Xaman" on one screen and "XRPL 1"
 * on another). Rule: the user's nickname wins; otherwise the provider's
 * proper name; otherwise the short address — never a raw walletType value.
 * `t` translates the curated labels ('Watch-only', 'Embedded wallet'…);
 * brand names pass through it unchanged (no dict entry needed).
 */
export function walletDisplayName(
  w: { address: string; nickname?: string | null; label?: string | null; walletType?: string; ecosystem?: string },
  t: (s: string) => string = (s) => s,
): string {
  const raw = w.nickname ?? w.label;
  const name = isAutoNickname(raw) ? null : raw;
  if (name) return name;
  const provider = walletProviderLabel(w.walletType, w.ecosystem);
  return provider ? t(provider) : shortAddress(w.address);
}

/** Build an address→display-name resolver from the wallet list, same shape
 *  and case-awareness as walletColorResolver. Unknown addresses fall back to
 *  the short address — never a blank, never a raw type. */
export function walletNameResolver(
  wallets: Array<{ address: string; nickname?: string | null; label?: string | null; walletType?: string; ecosystem?: string }>,
  t: (s: string) => string = (s) => s,
): (address: string) => string {
  const key = (a: string) => (a.startsWith('0x') ? a.toLowerCase() : a);
  const map = new Map<string, string>();
  for (const w of wallets) map.set(key(w.address), walletDisplayName(w, t));
  return (address: string) => map.get(key(address)) ?? shortAddress(address);
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
