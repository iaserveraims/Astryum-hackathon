/**
 * walletIdentity — provider brand + personal colour of a wallet.
 *
 * The colour is IDENTITY, not data: the user tags each wallet and the same
 * hue follows it across Wallets, Summary and Portfolio, so "which wallet is
 * this row" is answered at a glance. Stored server-side in the wallet's
 * permissions JSON (PATCH /api/wallets/mine/:id { color }).
 */

import type { WalletRecord } from './portfolioMerge';
import { getXamanHue } from './wallet/xamanHues';

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

/** XRPL classic address shape. The checksum is not verified here — this is a
 *  classifier for the UI, not a validator for a transaction. */
const XRPL_ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

/**
 * Is this row an XRPL account?
 *
 * The ADDRESS is the ground truth, not the label: `ecosystem` is absent on the
 * synthetic "Login wallet" row that `dedupeWallets` folds in for an account
 * whose login address is not registered in /api/wallets/mine — and that row
 * even carries a hardcoded `chainId: 14`. Trusting the field alone made an
 * XRPL wallet read as non-XRPL on exactly the surface where the user keeps it
 * (founder 2026-08-21: "no me aparece"). The backend already applies the same
 * rule the other way round — it derives the ecosystem from the address and
 * refuses a caller's contradicting claim.
 *
 * Lives here, exported, because two surfaces need the same answer and a copy
 * in each is how they start disagreeing.
 */
export function isXrplWallet(w: { address?: string; ecosystem?: string }): boolean {
  if (w.ecosystem === 'xrpl') return true;
  return !!w.address && XRPL_ADDRESS_RE.test(w.address);
}

/**
 * ¿Esta wallet lleva el avatar de Xaman en su chip? SOLO las de Xaman (la
 * marca, no la cadena): una watch-only o una fila de XRP Identity es XRPL pero
 * no es de Xaman, y no se pide su imagen a nadie (privacidad, 7c1aeffb).
 */
export function usesXamanAvatar(w: { address?: string; walletType?: string; ecosystem?: string }): boolean {
  return !!w.address && isXrplWallet(w) && brandOf(w.walletType, w.ecosystem) === 'xaman';
}

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
  // Imported from the user's XRP Identity profile — a hint their provider does
  // not prove, so the name says where it came from and the row stays watch-only.
  if (wt === 'xrp_identity') return 'XRP Identity';
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
 * A walletType that is already a PRESENTABLE app name — the AppKit/wagmi
 * connector name ('MetaMask', 'Rabby', 'Brave Wallet') or the injected-brand
 * detection write the readable name straight into walletType, and refusing to
 * show it would throw away exactly the identity the founder asked for
 * (2026-08-22: «el logo de la wallet en función de qué aplicación sea», y el
 * nombre con ella). Raw plumbing values ('siwe', 'manual', 'xrp_identity',
 * 'evm') stay banned: the gate is proper-casing + a plain-words shape, which
 * no plumbing value passes.
 */
function connectorProperName(walletType?: string): string | null {
  const wt = (walletType ?? '').trim();
  if (!/^[A-Z][A-Za-z0-9]*(?: [A-Z0-9][A-Za-z0-9]*){0,2}$/.test(wt)) return null;
  return wt;
}

/**
 * The last resort when nothing names the wallet — NEVER the address (founder
 * 2026-08-22: «el nombre de la wallet nunca sea el código de esta»). An
 * honest generic by ecosystem; the address survives one tap away (copy
 * button, manage panel), just not as a NAME.
 */
function genericWalletLabel(ecosystem?: string, address?: string): string {
  const eco = (ecosystem ?? '').toLowerCase();
  if (eco === 'xrpl' || (address ?? '').startsWith('r')) return 'XRPL wallet';
  if (eco === 'evm' || (address ?? '').startsWith('0x')) return 'Ethereum wallet';
  return 'Wallet';
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
  if (provider) return t(provider);
  // The connector already told us the app's name — show it before giving up.
  const connector = connectorProperName(w.walletType);
  if (connector) return connector;
  // NEVER the address (founder 2026-08-22). Generic but honest.
  return t(genericWalletLabel(w.ecosystem, w.address));
}

/**
 * Numbered display names for a LIST of wallets — «MetaMask», «MetaMask 2»
 * (founder 2026-08-22: the auto name must identify; two unnamed MetaMasks
 * must not read as one). Numbering is assigned in address order, so it is
 * stable across renders, devices and re-sorts; the first of a duplicate set
 * keeps the bare name. A user nickname never gets a number — it is theirs.
 * Case-aware key like every resolver here (EVM lowercased, XRPL verbatim).
 */
export function walletDisplayNameMap(
  wallets: Array<{ address: string; nickname?: string | null; label?: string | null; walletType?: string; ecosystem?: string }>,
  t: (s: string) => string = (s) => s,
): Map<string, string> {
  const key = (a: string) => (a.startsWith('0x') ? a.toLowerCase() : a);
  const sorted = [...wallets].sort((a, b) => key(a.address).localeCompare(key(b.address)));
  const counts = new Map<string, number>();
  for (const w of sorted) {
    const raw = w.nickname ?? w.label;
    const hasOwnName = !!raw && !isAutoNickname(raw);
    const base = walletDisplayName(w, t);
    if (hasOwnName) continue; // nicknames never share, never number
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  for (const w of sorted) {
    const raw = w.nickname ?? w.label;
    const hasOwnName = !!raw && !isAutoNickname(raw);
    const base = walletDisplayName(w, t);
    if (hasOwnName || (counts.get(base) ?? 0) < 2) {
      out.set(key(w.address), base);
      continue;
    }
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.set(key(w.address), n === 1 ? base : `${base} ${n}`);
  }
  return out;
}

/**
 * Nombre de una Smart Account con su DUEÑA al lado (fundador 2026-08-22: con
 * varias FSA «no se sabe cuál es cuál»). Una PA no tiene identidad propia — es
 * el lado Flare de una cuenta XRPL — así que su nombre lleva SIEMPRE el de su
 * dueña: «Smart Account · <apodo de la Xaman>». Sin dueña resoluble (huérfana),
 * cae a la dirección corta: decir menos es mejor que señalar a la dueña
 * equivocada. Vive aquí porque es LA regla de nombres — una copia por superficie
 * es como empezaron a discrepar los nombres en agosto.
 */
export function smartAccountDisplayName(
  pa: { address: string },
  owner:
    | { address: string; nickname?: string | null; label?: string | null; walletType?: string; ecosystem?: string }
    | null
    | undefined,
  t: (s: string) => string = (s) => s,
): string {
  const base = t('Smart Account');
  if (!owner) return `${base} · ${shortAddress(pa.address)}`;
  return `${base} · ${walletDisplayName(owner, t)}`;
}

/** Build an address→display-name resolver from the wallet list, same shape
 *  and case-awareness as walletColorResolver. Unknown addresses fall back to
 *  the short address — never a blank, never a raw type. */
export function walletNameResolver(
  wallets: Array<{ address: string; nickname?: string | null; label?: string | null; walletType?: string; ecosystem?: string }>,
  t: (s: string) => string = (s) => s,
): (address: string) => string {
  const key = (a: string) => (a.startsWith('0x') ? a.toLowerCase() : a);
  const map = walletDisplayNameMap(wallets, t);
  return (address: string) => map.get(key(address)) ?? shortAddress(address);
}

/** The preset palette offered by the colour picker (12 tags + none).
 *  Ampliada el 2026-08-29 (fundador: «el color de xaman, un azul más oscuro,
 *  no está puesto»): entra el azul profundo de Xaman y, con él, tres huecos
 *  más del espectro que faltaban (lima, violeta, plata) — la paleta cubre la
 *  rueda sin duplicar tonos vecinos. */
export const WALLET_COLOR_PRESETS = [
  '#f97316', // orange
  '#eab308', // amber
  '#84cc16', // lime
  '#22c55e', // green
  '#14b8a6', // teal
  '#38bdf8', // sky
  '#2f5cff', // deep blue — the Xaman blue
  '#818cf8', // indigo
  '#7c3aed', // violet
  '#e879f9', // fuchsia
  '#f43f5e', // rose
  '#94a3b8', // slate
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

/** Council-governed rows, by walletType (the synthetic council row's type). */
/** El `walletType` que marca a una cuenta como consejo. Era un literal
 *  repetido en cada sintetizador, y ahí nació la deriva: la fila del
 *  Portfolio se creaba sin él y la misma cuenta se veía como «XRPL wallet»
 *  en un sitio y como placa índigo en otro (2026-09-07). */
export const COUNCIL_WALLET_TYPE = 'Council \u00b7 multisig';

export function isCouncilType(walletType?: string): boolean {
  return (walletType ?? '').trim() === COUNCIL_WALLET_TYPE;
}

/** The Legacy indigo — the product token, NOT a user colour: a governed
 *  account wears it on every surface so «esto es un Legacy» reads at a
 *  glance (founder 2026-08-22), and personalization never overrides it. */
export const LEGACY_WALLET_COLOR = 'hsl(var(--product-legacy))';

/**
 * EL COLOR POR DEFECTO SE DERIVA DE LA DIRECCIÓN, NO DE LA MARCA (fundador
 * 2026-09-13: «quiero la X de Xaman, pero con un distintivo para cada wallet
 * de Xaman que se conecte»).
 *
 * Antes, sin color elegido a mano, TODAS las wallets de una misma marca caían
 * en el mismo tono (BRAND_FALLBACK): dos cuentas de Xaman salían idénticas en
 * todas partes. El color ya era el distintivo de la casa — solo que el reparto
 * por defecto lo anulaba justo donde más falta hace, entre cuentas del mismo
 * proveedor.
 *
 * Ahora el tono sale de la propia dirección: estable entre renders, entre
 * sesiones y entre dispositivos (misma dirección → mismo color, siempre), sin
 * pedir nada a nadie — a diferencia del avatar remoto que se retiró en
 * 7c1aeffb. El color que el usuario elige a mano sigue ganando, y un consejo
 * conserva su índigo: la personalización nunca pisa al producto.
 *
 * FNV-1a de 32 bits: una línea, sin dependencias y bien repartido para esto.
 * Con doce tonos, dos wallets pueden coincidir; el usuario siempre puede
 * separarlas con la etiqueta de color de «Gestionar».
 */
function hueFromAddress(address: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < address.length; i++) {
    h ^= address.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return WALLET_COLOR_PRESETS[(h >>> 0) % WALLET_COLOR_PRESETS.length];
}

/**
 * The colour a wallet row/dot should use anywhere in the app.
 *
 * Precedencia: consejo (índigo del producto) → color elegido a mano → EL
 * COLOR DEL CUBITO de Xaman si es una wallet de Xaman y ya se leyó
 * (fundador 2026-09-13: «que los colores de cada cubito se vean reflejados
 * en la propia card», la opción «seguir el avatar» de Gestionar, activa por
 * defecto) → tono derivado de la dirección → tono de la marca.
 */
export function walletColor(
  w: Pick<WalletRecord, 'color' | 'walletType' | 'ecosystem'> & { address?: string },
): string {
  if (isCouncilType(w.walletType)) return LEGACY_WALLET_COLOR;
  if (w.color) return w.color;
  if (w.address) {
    if (usesXamanAvatar(w)) {
      const hue = getXamanHue(w.address);
      if (hue) return hue;
    }
    return hueFromAddress(w.address);
  }
  // Sin dirección no hay derivación posible (filas sintéticas a medio hacer):
  // queda el tono de la marca de siempre.
  return BRAND_FALLBACK[brandOf(w.walletType, w.ecosystem)];
}

/**
 * The whole-box wash (founder 2026-08-22: «no solo el iconito, sino todo el
 * recuadro»). ONE recipe for every surface that frames a wallet: the box
 * borrows the wallet's colour at the house's subtle alphas — 7% ground, 30%
 * hairline — so six wallets read as six identities, not as a rainbow. The
 * 18-20% + inset-ring mix stays reserved for the small icon chip. Works with
 * hex colours and with hsl(var(--…)) tokens alike (color-mix resolves both).
 */
export function walletWash(color: string): { background: string; borderColor: string } {
  return {
    background: `color-mix(in srgb, ${color} 7%, transparent)`,
    borderColor: `color-mix(in srgb, ${color} 30%, transparent)`,
  };
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
