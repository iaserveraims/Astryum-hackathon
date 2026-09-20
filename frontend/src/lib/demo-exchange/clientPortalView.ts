/**
 * ¿Qué enseña el portal del cliente del exchange? Pura: la llave ya se resolvió
 * (`GET /runs/for-account`) y aquí solo se decide la pantalla.
 *
 * 18-sep — CLIENTE POR EXCHANGE (fundador: «cuando crea una cuenta a un exchange
 * es al que ha pedido acceso y le han dado la verificación, sino no está dentro
 * de ese exchange»). Antes una passkey era cliente de UN exchange para siempre:
 * «Crear una cuenta de cliente» con una llave que ya era cliente de otro
 * exchange te metía en ESA cuenta sin una palabra, y el alta del nuevo no
 * aparecía nunca. Ahora:
 *   · ENTRAR → a tu cuenta; con varias (una por exchange), eliges entre las TUYAS.
 *   · CREAR  → los exchanges abiertos a los que esta llave aún puede pedir
 *     acceso; si ya estás en todos, se dice dónde está la tuya.
 */
import type { RunSummary } from './api';

export interface PortalMembership {
  runId: string;
  exchangeLabel: string;
  client?: { label: string; tag: number };
}

export interface PortalData {
  memberships: PortalMembership[];
  joinable: RunSummary[];
  heldElsewhere?: { exchange: RunSummary; reclaimRequired: boolean };
}

export type PortalView =
  /** Abre ESTE exchange: la cuenta que ya tienes, o el alta si aún no la tienes. */
  | { kind: 'run'; runId: string }
  /** Varias cuentas tuyas, una por exchange: eliges a cuál entrar. */
  | { kind: 'pick-mine' }
  /** Exchanges a los que puedes pedir acceso (y, si las hay, dónde están las tuyas). */
  | { kind: 'pick-join' }
  /** Viniste a crear y ya tienes cuenta en todos los exchanges abiertos. */
  | { kind: 'already-everywhere' }
  /** La llave tiene ficha, pero de otra sesión de Astryum (14-sep). */
  | { kind: 'held-elsewhere' }
  /** Viniste a entrar y esta llave no tiene cuenta en ningún exchange. */
  | { kind: 'no-account-yet' }
  /** Viniste a crear y no hay ningún exchange abierto a cuentas nuevas. */
  | { kind: 'none-open' };

export function portalView(input: { mode: 'enter' | 'create'; data: PortalData; chosen: string | null }): PortalView {
  const { mode, data, chosen } = input;
  if (chosen) return { kind: 'run', runId: chosen };
  const mine = data.memberships;
  if (mode === 'enter') {
    if (mine.length === 1) return { kind: 'run', runId: mine[0].runId };
    if (mine.length > 1) return { kind: 'pick-mine' };
    if (data.heldElsewhere) return { kind: 'held-elsewhere' };
    return { kind: 'no-account-yet' };
  }
  if (data.joinable.length === 0) {
    if (mine.length > 0) return { kind: 'already-everywhere' };
    if (data.heldElsewhere) return { kind: 'held-elsewhere' };
    return { kind: 'none-open' };
  }
  // Un solo exchange al que pedir acceso y nada más que contar: directo a su alta.
  if (data.joinable.length === 1 && mine.length === 0 && !data.heldElsewhere) return { kind: 'run', runId: data.joinable[0].runId };
  return { kind: 'pick-join' };
}

/**
 * La respuesta de `for-account`, en la forma del portal. Tolera un backend
 * anterior al 18-sep (sin `memberships` ni `joinable`): con cuenta, sin nada que
 * unir (se dice dónde está la tuya); sin cuenta, los abiertos salvo el de la
 * ficha ajena, como antes.
 */
export function portalDataFrom(
  r:
    | { found: true; runId: string; exchange: RunSummary; client: { label: string; tag: number }; memberships?: Array<{ runId: string; exchange: RunSummary; client: { label: string; tag: number } }>; joinable?: RunSummary[] }
    | { found: false; exchanges: RunSummary[]; joinable?: RunSummary[]; heldElsewhere?: { exchange: RunSummary; reclaimRequired: boolean } },
): PortalData {
  if (r.found) {
    const list = r.memberships?.length ? r.memberships : [{ runId: r.runId, exchange: r.exchange, client: r.client }];
    return {
      memberships: list.map((m) => ({ runId: m.runId, exchangeLabel: m.exchange.label, client: m.client ? { label: m.client.label, tag: m.client.tag } : undefined })),
      joinable: r.joinable ?? [],
    };
  }
  const held = r.heldElsewhere?.exchange.runId;
  return {
    memberships: [],
    joinable: r.joinable ?? r.exchanges.filter((x) => x.status === 'open' && x.runId !== held),
    ...(r.heldElsewhere ? { heldElsewhere: r.heldElsewhere } : {}),
  };
}
