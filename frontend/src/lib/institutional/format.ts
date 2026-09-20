/**
 * format — los DOS formateos que toda la superficie de managed vaults repetía
 * a mano en trece ficheros (revisión 10-sep): la dirección abreviada y la
 * ventana de salida. Una sola regla, para que la misma cuenta no se trunque a
 * tres anchuras distintas y un plazo de 10 minutos no salga como «0 h».
 */

/** `rNyrefquhQfqFYwHojT8aHwVPmKtqYZtg8` → `rNyref…Ztg8` (también 0x…). */
export function shortAddr(a: string | null | undefined): string {
  if (!a) return '—';
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/**
 * La ventana de salida en humano. `null` = no se sabe (nunca «inmediata»).
 * Menos de una hora se dice en minutos; menos de dos días, en horas; el
 * resto, en días.
 */
export function fmtExitWindow(seconds: number | null | undefined, t: (s: string) => string): string {
  if (seconds == null) return '—';
  if (seconds === 0) return t('immediate');
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min`;
  const h = seconds / 3600;
  return h >= 48 ? `${Math.round(h / 24)} d` : `${Math.round(h)} h`;
}

/** El texto de una negativa tipada del backend, siempre igual. */
export function refusalText(r: { error: string; detail?: string }): string {
  return `${r.error}${r.detail ? ` — ${r.detail}` : ''}`;
}
