/**
 * ¿La jaula de una raíz de exchange es de OTRA vida?
 *
 * RAÍZ CON HISTORIA. Una jaula sin mesa de este exchange es una vida
 * anterior: el alta lo dice, deja la estación 1 pendiente y no avanza.
 */
export interface SetupWitness {
  /** Esta alta leyó la raíz sin jaula (un «no hay» real, no un fallo de lectura). */
  virginSeen?: boolean;
  /** Esta alta vio firmar el nacimiento de la jaula. */
  cageBornHere?: boolean;
}

export function isForeignHistory(s: { cage: boolean; existing: boolean; local: SetupWitness; appointed: boolean }): boolean {
  if (!s.cage || s.existing) return false;
  if (s.local.virginSeen || s.local.cageBornHere) return false;
  if (s.appointed) return false;
  return true;
}
