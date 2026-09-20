/**
 * managedReadState — what the «Managed by a third party» shelf may say.
 *
 * Why this exists (reviewer, 14-sep): with a failed read the shelf printed the
 * headline «You have no managed vaults» and tucked the failure into a footnote.
 * The headline is what gets read. «Could not read» is never «you have none»:
 * a failed or partial read with no positions gets its own headline and a Retry.
 */

export type ManagedShelfView =
  /** No pass has answered yet. */
  | 'loading'
  /** Positions found, every read answered. */
  | 'list'
  /** Positions found, but some read failed: the list may be incomplete. */
  | 'list-incomplete'
  /** Nothing found AND some read failed: unknown, never «none». */
  | 'unreadable'
  /** Nothing found and every read answered: truly empty. */
  | 'empty';

export function managedShelfView(input: {
  loading: boolean;
  positionsCount: number;
  error: string | null;
  partial: boolean;
}): ManagedShelfView {
  const failed = !!input.error || input.partial;
  if (input.positionsCount > 0) return failed ? 'list-incomplete' : 'list';
  if (input.loading) return 'loading';
  return failed ? 'unreadable' : 'empty';
}


/** Una pasada de posiciones gestionadas sirve ~un minuto: el gestor puede haber
 *  movido el capital, o la persona haber entrado/salido desde otra pantalla. */
export const MANAGED_SNAPSHOT_MAX_AGE_MS = 60_000;

/**
 * ¿Hay que releer las posiciones gestionadas al montar la estantería?
 *
 * Fundador 2026-09-17: «me he vuelto a cambiar de cuenta… y no me aparecen».
 * La instantánea compartida vivía a nivel de módulo y solo se releía si nunca
 * se había leído o si la última pasada falló: al cambiar de cuenta sin
 * recargar la página, la estantería de la cuenta nueva enseñaba la pasada de
 * la anterior (los registros del 17-sep lo muestran: tras el login de la
 * cuenta que tenía las participaciones no hubo NINGUNA lectura de pote-state).
 * Reglas: nunca leída · con error · de OTRA cuenta · o más vieja de un minuto.
 */
export function shouldRefreshManagedSnapshot(input: {
  loadedAt: number;
  error: string | null;
  /** Para qué cuenta (token de sesión) se calculó la pasada; null = sin sesión. */
  forAccount: string | null;
  currentAccount: string | null;
  inflight: boolean;
  now: number;
  maxAgeMs?: number;
}): boolean {
  if (input.inflight) return false;
  if (input.loadedAt === 0) return true;
  if (input.error) return true;
  if (input.forAccount !== input.currentAccount) return true;
  return input.now - input.loadedAt > (input.maxAgeMs ?? MANAGED_SNAPSHOT_MAX_AGE_MS);
}
