/**
 * EL ESPEJO DE CUENTAS — la parte que DECIDE, sin tocar ninguna base.
 *
 * Y por la tarde, ya
 * elegido el camino: «sincronizarlo todo, pero si hay un check que tiene la
 * cuenta marcado que en producción es de una función que no está activada,
 * ignorarlo sin más».
 */

import { productionDatabaseMarker } from '../../config/bootGuards';

// ── ¿Puede correr aquí? ──────────────────────────────────────────────────────

export type MirrorVerdict =
  | { ok: true; sourceUrl: string; everyMs: number }
  | { ok: false; reason: MirrorRefusal };

export type MirrorRefusal =
  /** Sin ACCOUNT_MIRROR_SOURCE_URL no hay espejo. Apagado por defecto. */
  | 'not_configured'
  /** La base PROPIA es la de producción: el espejo escribiría en producción. */
  | 'own_database_is_production'
  /** Origen y destino son la misma base: reflejarse a sí mismo no significa nada. */
  | 'source_is_own_database'
  /** El origen no es una URL de Postgres. */
  | 'source_url_invalid';

/** Cada cuánto pasa el espejo si no se dice otra cosa. */
export const MIRROR_DEFAULT_EVERY_MS = 10 * 60_000;

function pgHost(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/^postgres(ql)?:$/.test(u.protocol)) return null;
    return `${u.hostname}:${u.port || '5432'}`;
  } catch {
    return null;
  }
}

/**
 * ¿Puede correr el espejo en este proceso, y contra qué origen?
 *
 * Las negativas van en orden de gravedad y todas son fail-closed: ante la
 * duda, no corre. La más importante es la segunda — si este proceso es el de
 * producción, el espejo NO existe, diga lo que diga la variable.
 */
export function mirrorVerdict(env: NodeJS.ProcessEnv = process.env): MirrorVerdict {
  const sourceUrl = (env.ACCOUNT_MIRROR_SOURCE_URL ?? '').trim();
  if (!sourceUrl) return { ok: false, reason: 'not_configured' };
  if (productionDatabaseMarker(env)) return { ok: false, reason: 'own_database_is_production' };
  const sourceHost = pgHost(sourceUrl);
  if (!sourceHost) return { ok: false, reason: 'source_url_invalid' };
  const ownHost = pgHost(env.DATABASE_URL ?? '');
  if (ownHost && ownHost === sourceHost) return { ok: false, reason: 'source_is_own_database' };
  // `Number('')` es 0 — y 0 aquí significa «solo a demanda». Una variable
  // ausente tiene que caer al valor por defecto, no apagar el reloj.
  const rawText = (env.ACCOUNT_MIRROR_EVERY_MS ?? '').trim();
  const raw = rawText === '' ? NaN : Number(rawText);
  const everyMs = Number.isFinite(raw) && raw >= 0 ? raw : MIRROR_DEFAULT_EVERY_MS;
  return { ok: true, sourceUrl, everyMs };
}

// ── ¿A quién refleja? ────────────────────────────────────────────────────────

export type MirrorScope =
  /** Solo estas cuentas, por email en minúsculas. */
  | { kind: 'emails'; emails: Set<string> }
  /** TODAS las cuentas de producción — opt-in explícito con `*`. */
  | { kind: 'everyone' }
  /** Nadie: lista vacía. El espejo corre y no hace nada, y lo dice. */
  | { kind: 'nobody' };

function splitList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * A quién refleja: los fundadores (ADMIN_EMAILS) más las cuentas de prueba
 * declaradas (ACCOUNT_MIRROR_EMAILS). Producción tiene también a la GENTE de
 * verdad —jurado, beta— y copiar sus cuentas a un entorno de pruebas no es
 * algo que deba pasar por omisión: solo con `ACCOUNT_MIRROR_EMAILS=*`, escrito
 * a mano.
 */
export function mirrorScope(env: NodeJS.ProcessEnv = process.env): MirrorScope {
  const extra = splitList(env.ACCOUNT_MIRROR_EMAILS);
  if (extra.includes('*')) return { kind: 'everyone' };
  const emails = new Set([...splitList(env.ADMIN_EMAILS), ...extra]);
  return emails.size > 0 ? { kind: 'emails', emails } : { kind: 'nobody' };
}

export function inScope(scope: MirrorScope, email: string | null | undefined): boolean {
  if (scope.kind === 'everyone') return true;
  if (scope.kind === 'nobody') return false;
  return !!email && scope.emails.has(email.trim().toLowerCase());
}

// ── ¿En qué fila del destino aterriza la cuenta? ────────────────────────────

export interface UserIdentity {
  id: string;
  email: string | null;
  oauthSub: string | null;
  xrplAddress: string | null;
}

export type TargetResolution =
  /** No hay fila en el destino: se crea, con el MISMO id que en producción. */
  | { kind: 'create'; id: string }
  /**
   * El destino ya tiene esta persona (mismo id, o mismo email / oauthSub /
   * xrplAddress bajo otro id). Se ADOPTA esa fila: conserva su id —y con él su
   * perfil de gestor, sus imágenes, sus apoyos, todo lo que cuelga de ese id—
   * y recibe encima los campos de producción. Nada se borra.
   */
  | { kind: 'adopt'; id: string; sameId: boolean };

const lower = (s: string | null) => (s ? s.trim().toLowerCase() : null);

/**
 * Decide la fila destino. `local` son las filas del destino que comparten
 * ALGÚN identificador único con la de producción. Prioridad: mismo id, luego
 * email, luego oauthSub, luego xrplAddress — el email es la identidad que la
 * persona reconoce; el resto son enganches.
 */
export function resolveTarget(prod: UserIdentity, local: readonly UserIdentity[]): TargetResolution {
  if (local.length === 0) return { kind: 'create', id: prod.id };
  const byId = local.find((l) => l.id === prod.id);
  if (byId) return { kind: 'adopt', id: byId.id, sameId: true };
  const byEmail = prod.email ? local.find((l) => lower(l.email) === lower(prod.email)) : undefined;
  const bySub = prod.oauthSub ? local.find((l) => l.oauthSub === prod.oauthSub) : undefined;
  const byXrpl = prod.xrplAddress ? local.find((l) => l.xrplAddress === prod.xrplAddress) : undefined;
  const hit = byEmail ?? bySub ?? byXrpl ?? local[0];
  return { kind: 'adopt', id: hit.id, sameId: false };
}

// ── Las preferencias: producción manda, pero no borra lo que no conoce ──────

/**
 * Funde las preferencias de la cuenta. Las claves de producción ganan (la
 * firma legal, la seguridad, la apariencia…); las que producción NO tiene se
 * quedan como estaban en el destino — ahí viven los checks de funciones que
 * producción no ha activado (`managerMode`). Ese es el «ignorarlo sin más».
 */
export function mergePreferences(
  local: unknown,
  prod: unknown,
): Record<string, unknown> | null {
  const l = local && typeof local === 'object' && !Array.isArray(local) ? (local as Record<string, unknown>) : null;
  const p = prod && typeof prod === 'object' && !Array.isArray(prod) ? (prod as Record<string, unknown>) : null;
  if (!l && !p) return null;
  return { ...(l ?? {}), ...(p ?? {}) };
}

// ── El informe de una pasada ────────────────────────────────────────────────

export interface MirrorReport {
  startedAt: string;
  finishedAt: string;
  ms: number;
  scope: MirrorScope['kind'];
  /** Cuentas de producción que entraban en el ámbito. */
  candidates: number;
  /** Cuentas escritas (creadas o actualizadas) en el destino. */
  users: number;
  /** Cuentas del destino ADOPTADAS bajo otro id (la misma persona, otra fila). */
  adopted: number;
  wallets: number;
  bindings: number;
  governed: number;
  passkeys: number;
  stepUp: number;
  managerProfiles: number;
  /** Filas del destino retiradas en modo `prune` (solo a demanda). */
  pruned: number;
  /** Lo que falló, por cuenta, sin tumbar la pasada. */
  failures: Array<{ email: string | null; id: string; error: string }>;
}
