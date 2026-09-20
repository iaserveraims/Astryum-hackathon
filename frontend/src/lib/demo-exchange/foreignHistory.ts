/**
 * ¿La jaula de una raíz de exchange es de OTRA vida?
 *
 * RAÍZ CON HISTORIA (fundador 12-sep, captura: la raíz era la cuenta del
 * gestor, y constitución/jaula/pote salían verdes porque el ledger los tiene
 * hechos PARA ESA CUENTA). Una jaula sin mesa de este exchange es una vida
 * anterior: el alta lo dice, deja la estación 1 pendiente y no avanza.
 *
 * PERO LA JAULA DE ESTA VIDA TAMBIÉN ES «JAULA SIN MESA» (fundador 18-sep,
 * captura: raíz fundada ese mismo día, aviso de «otra vida» en la estación 7).
 * La jaula nace en la estación 4 y la mesa en la 7, así que `jaula && !mesa`
 * era verdad en TODA alta legítima entre medias, y el aviso mandaba abandonar
 * la raíz recién montada. Es de esta vida si algo lo prueba:
 *   · esta alta leyó la raíz SIN jaula, o vio firmar su nacimiento (memoria
 *     de este dispositivo, por raíz);
 *   · la raíz designó a ESTE omnibus (`OMNIBUS` emitida por ella, leída del
 *     ledger): un acto que solo compone el alta del exchange, y que vale en
 *     cualquier dispositivo.
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
