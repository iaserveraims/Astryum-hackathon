/**
 * xamanHues — EL COLOR DEL CUBITO, por cuenta.
 *
 * El avatar de Xaman de una cuenta (su hashicon, o la imagen que puso) llega
 * como PNG por nuestro propio dominio (api/xaman/avatar). Al cargar, el chip
 * lo pinta en un canvas de 24×24 y se queda con su color dominante — el tono
 * más presente entre los píxeles saturados. Ese hex es lo que la tarjeta usa
 * como color por defecto (walletColor), hasta que el usuario elija uno a mano.
 */

import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'astryum-xaman-hues';
const MAX_ENTRIES = 300;

const hues = new Map<string, string>();
let loaded = false;
let version = 0;
const listeners = new Set<() => void>();

function load(): void {
  if (loaded) return;
  loaded = true;
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) hues.set(k, v);
    }
  } catch {
    /* storage bloqueado o corrupto: se arranca vacío y se rellena al cargar */
  }
}

function persist(): void {
  if (typeof window === 'undefined') return;
  try {
    const obj: Record<string, string> = {};
    // Si crece de más, se queda con lo más reciente (Map conserva el orden).
    const entries = [...hues.entries()].slice(-MAX_ENTRIES);
    for (const [k, v] of entries) obj[k] = v;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    /* sin storage no hay memoria entre cargas — se recalcula la próxima vez */
  }
}

/** El color dominante ya conocido de una cuenta, o null si aún no llegó. */
export function getXamanHue(address: string): string | null {
  load();
  return hues.get(address) ?? null;
}

export function setXamanHue(address: string, hex: string): void {
  load();
  if (hues.get(address) === hex) return;
  hues.set(address, hex);
  version++;
  persist();
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
const getVersion = () => version;
const getServerVersion = () => 0;

/** Suscripción para que un componente que llama a walletColor() se repinte
 *  cuando llega el color de una cuenta. Devuelve un contador; no hace falta
 *  usarlo, solo llamar al hook. */
export function useXamanHues(): number {
  return useSyncExternalStore(subscribe, getVersion, getServerVersion);
}

/**
 * El color dominante de una imagen, a partir de sus píxeles RGBA (lo que da
 * `getImageData`). Pura: se testea a secas.
 *
 * Regla: se descartan píxeles transparentes, casi negros y grises (poca
 * saturación — el hashicon tiene sombras que no son «su color»); el resto se
 * agrupa por tono en 24 cubos, pesando cada píxel por su saturación; gana el
 * cubo con más peso y se devuelve la media RGB de SUS píxeles (un color real
 * de la imagen, no el centro teórico del cubo). Sin píxeles válidos → null.
 */
export function dominantHex(data: ArrayLike<number>): string | null {
  const bins = new Array<{ w: number; r: number; g: number; b: number; n: number }>(24);
  for (let i = 0; i < 24; i++) bins[i] = { w: 0, r: 0, g: 0, b: 0, n: 0 };
  let any = false;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 128) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max < 40) continue;
    const sat = (max - min) / max;
    if (sat < 0.25) continue;
    const d = max - min;
    let h: number;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    const bin = bins[Math.floor(h / 15) % 24];
    bin.w += sat;
    bin.r += r;
    bin.g += g;
    bin.b += b;
    bin.n += 1;
    any = true;
  }
  if (!any) return null;
  let best = bins[0];
  for (const bn of bins) if (bn.w > best.w) best = bn;
  if (best.n === 0) return null;
  const hex = (v: number) => Math.round(v / best.n).toString(16).padStart(2, '0');
  return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`;
}
