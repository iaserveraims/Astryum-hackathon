/**
 * LA APARIENCIA — la parte PURA (sin React, sin zustand, sin 'use client'),
 * para que la puedan importar tanto el store del cliente
 * (stores/themeStore.ts) como el script pre-pintado que inyecta el layout de
 * SERVIDOR (lib/theme/prepaint.ts). Importar una constante desde un módulo
 * 'use client' en un componente de servidor devuelve una referencia, no el
 * valor — por eso esto vive aparte. Es la misma partición que
 * lib/motion/level.ts, y por la misma razón.
 */

export type Skin = 'astryum' | 'institutional';

/** 'system' sigue al dispositivo en vivo (prefers-color-scheme). */
export type AppTheme = 'dark' | 'light' | 'system';

export const SKINS: readonly Skin[] = ['astryum', 'institutional'];
export const APP_THEMES: readonly AppTheme[] = ['dark', 'light', 'system'];

export const DEFAULT_SKIN: Skin = 'astryum';
export const DEFAULT_THEME: AppTheme = 'dark';

/** La clave de localStorage (zustand/persist) — la comparten store y script. */
export const APPEARANCE_STORAGE_KEY = 'astryum-theme';
/** Los atributos que se estampan en <html> y que lee globals.css. */
export const SKIN_ATTRIBUTE = 'data-skin';
export const THEME_ATTRIBUTE = 'data-theme';

export function isSkin(v: unknown): v is Skin {
  return typeof v === 'string' && (SKINS as readonly string[]).includes(v);
}

export function isAppTheme(v: unknown): v is AppTheme {
  return typeof v === 'string' && (APP_THEMES as readonly string[]).includes(v);
}

/** La LUZ efectiva: 'system' se resuelve contra el dispositivo. Lo que se
 *  estampa en data-theme nunca es 'system' — globals.css solo entiende los
 *  dos extremos. */
export function resolveTheme(theme: AppTheme, osPrefersLight: boolean): 'dark' | 'light' {
  if (theme === 'system') return osPrefersLight ? 'light' : 'dark';
  return theme;
}

/**
 * LA APARIENCIA VIVE EN EL PANEL, NO EN LA WEB PÚBLICA. La landing, el login
 * y las páginas legales tienen su propio aspecto fijo y no lo negocian con
 * nadie: un juez que abre astryum.xyz tiene que ver la marca, no la
 * preferencia de quien usó ese navegador la última vez. Esta es la MISMA
 * frontera que ThemeApplier ha defendido siempre montándose solo en
 * /app/layout.tsx; aquí se escribe una vez para que el script pre-pintado
 * aplique exactamente la misma regla antes del primer frame.
 */
export const DASHBOARD_PREFIX = '/app';

export function pathWearsAppearance(pathname: string): boolean {
  return pathname === DASHBOARD_PREFIX || pathname.startsWith(DASHBOARD_PREFIX + '/');
}

/** Lo que se guarda en la cuenta (User.preferences.appearance). Un registro
 *  parcial es válido: lo que falte cae al valor por defecto. */
export interface AppearanceRecord {
  skin: Skin;
  theme: AppTheme;
}

export const DEFAULT_APPEARANCE: AppearanceRecord = { skin: DEFAULT_SKIN, theme: DEFAULT_THEME };

/** Lee un registro de apariencia venga de donde venga (servidor, storage,
 *  una columna JSON medio escrita) sin colar jamás un valor inventado. */
export function readAppearance(raw: unknown): AppearanceRecord {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_APPEARANCE;
  const r = raw as Record<string, unknown>;
  return {
    skin: isSkin(r.skin) ? r.skin : DEFAULT_SKIN,
    theme: isAppTheme(r.theme) ? r.theme : DEFAULT_THEME,
  };
}
