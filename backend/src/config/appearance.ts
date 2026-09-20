/**
 * La APARIENCIA de la cuenta — la lógica pura detrás de GET /me `appearance`
 * y POST /auth/appearance (fundador 2026-09-13).
 *
 * DOS EJES, UN REGISTRO:
 *   · `skin`  — de qué MATERIAL está hecho el panel: 'astryum' (espacio y oro,
 *               lo de siempre) o 'institutional' (la lámina: tinta sobre papel
 *               de registro, bronce, serif, filetes y grabados).
 *   · `theme` — la LUZ: 'dark', 'light' o 'system'.
 *
 * POR QUÉ ESTÁ EN EL SERVIDOR Y NO EN EL NAVEGADOR. Un ajuste en localStorage
 * sigue al navegador, no a la persona: la misma cuenta abierta en un portátil
 * nuevo aparecería en oro, y el segundo correo que entrase en el mismo Chrome
 * heredaría el tema del primero. Es literalmente el bug que el fundador
 * reportó con el modo gestor («he abierto en un perfil de Brave nuevo la misma
 * cuenta y tenía el manager mode desactivado», 2026-08-30) y con las wallets y
 * los tours el 13-sep. Se resuelve igual: la verdad va en la cuenta y el
 * navegador guarda una caché de arranque.
 *
 * Cabalga `User.preferences.appearance`, el mismo raíl que `legal` y
 * `managerMode` — sin migración, preservando las claves hermanas.
 *
 * ES PURA PRESENTACIÓN: no abre ninguna capacidad, no toca permisos y no
 * decide nada sobre el dinero. Un valor forjado aquí solo consigue que el
 * panel se vea de otro color.
 */

export type Skin = 'astryum' | 'institutional';
export type AppTheme = 'dark' | 'light' | 'system';

export const SKINS: readonly Skin[] = ['astryum', 'institutional'];
export const APP_THEMES: readonly AppTheme[] = ['dark', 'light', 'system'];

export const DEFAULT_SKIN: Skin = 'astryum';
export const DEFAULT_THEME: AppTheme = 'dark';

export interface AppearanceRecord {
  skin: Skin;
  theme: AppTheme;
}

export const DEFAULT_APPEARANCE: AppearanceRecord = { skin: DEFAULT_SKIN, theme: DEFAULT_THEME };

export function isSkin(v: unknown): v is Skin {
  return typeof v === 'string' && (SKINS as readonly string[]).includes(v);
}

export function isAppTheme(v: unknown): v is AppTheme {
  return typeof v === 'string' && (APP_THEMES as readonly string[]).includes(v);
}

/**
 * Lee la apariencia de `User.preferences`, tolerante con una columna JSON
 * nula, medio escrita o de una versión anterior. FAIL-SAFE, no fail-closed:
 * lo que falte cae al tema de la casa, que es exactamente lo que la CSS ya
 * pinta sin ningún sello — un valor desconocido no puede dejar el panel a
 * medio vestir.
 */
export function readAppearance(preferences: unknown): AppearanceRecord {
  if (preferences == null || typeof preferences !== 'object' || Array.isArray(preferences)) {
    return DEFAULT_APPEARANCE;
  }
  const raw = (preferences as Record<string, unknown>).appearance;
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_APPEARANCE;
  const a = raw as Record<string, unknown>;
  return {
    skin: isSkin(a.skin) ? a.skin : DEFAULT_SKIN,
    theme: isAppTheme(a.theme) ? a.theme : DEFAULT_THEME,
  };
}

/**
 * Devuelve `preferences` con la apariencia escrita, PRESERVANDO las claves
 * hermanas (`legal`, `managerMode`, `demoTerms`…). El patrón de
 * withLegalAcceptance, y por la misma razón: esa columna la comparten varias
 * funciones y una escritura que la reemplace entera borra el consentimiento
 * legal de alguien.
 */
export function withAppearance(preferences: unknown, patch: Partial<AppearanceRecord>): Record<string, unknown> {
  const base =
    preferences != null && typeof preferences === 'object' && !Array.isArray(preferences)
      ? (preferences as Record<string, unknown>)
      : {};
  const current = readAppearance(base);
  const next: AppearanceRecord = {
    skin: isSkin(patch.skin) ? patch.skin : current.skin,
    theme: isAppTheme(patch.theme) ? patch.theme : current.theme,
  };
  return { ...base, appearance: next };
}
