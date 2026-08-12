/**
 * agentHeartbeats — el «sigo vivo» de los agentes que no publican salud.
 *
 * El executor 0xFE tiene su `health()`, así que el Sentinel podía preguntarle.
 * Los demás lazos periódicos (automatización, triggers, sincronización de
 * actividad, keeper de escrows, vigía XRPL) no exponían NADA: si su
 * `setInterval` dejaba de correr — una excepción que mata el ciclo, un
 * `clearInterval` de un apagado a medias, un tick que tarda más que su propio
 * intervalo — se apagaban en silencio y todo seguía pareciendo normal.
 *
 * Aquí cada uno deja su latido: cuándo fue el último tick, si salió bien y cada
 * cuánto DEBERÍA latir. El probe `agentes` del Sentinel compara esas tres cosas
 * y avisa cuando uno se calla o falla repetidamente.
 *
 * En memoria a propósito: un reinicio limpia el registro y cada agente vuelve a
 * anunciarse en su primer tick. Un agente que nunca se registra sencillamente
 * no se vigila — no se puede echar de menos lo que nunca dijo estar (evita
 * falsos positivos con carriles apagados por flag).
 */

export interface AgentTick {
  id: string;
  title: string;
  /** unix ms del último tick registrado. */
  atMs: number;
  ok: boolean;
  detail?: string;
  /** Cada cuánto se espera un latido; el probe tolera 3× esto. */
  everyMs: number;
  /** Ticks fallidos seguidos (0 = el último salió bien). */
  failures: number;
}

const ticks = new Map<string, AgentTick>();

/**
 * Registra un latido. Llamar SIEMPRE al terminar el tick, salga bien o mal:
 * un agente que solo late cuando acierta es indistinguible de uno muerto justo
 * cuando más importa.
 */
export function markAgentTick(
  id: string,
  opts: { title: string; everyMs: number; ok?: boolean; detail?: string; now?: number },
): void {
  const prev = ticks.get(id);
  const ok = opts.ok !== false;
  ticks.set(id, {
    id,
    title: opts.title,
    atMs: opts.now ?? Date.now(),
    ok,
    ...(opts.detail ? { detail: opts.detail.slice(0, 300) } : {}),
    everyMs: opts.everyMs,
    failures: ok ? 0 : (prev?.failures ?? 0) + 1,
  });
}

export function agentTicks(): AgentTick[] {
  return [...ticks.values()];
}

/** Solo tests. */
export function _resetAgentTicksForTests(): void {
  ticks.clear();
}
