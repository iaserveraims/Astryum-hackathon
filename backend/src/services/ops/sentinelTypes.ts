/**
 * Tipos del Sentinel — el vocabulario que comparten el motor y los probes.
 *
 * Un `Probe` es una pregunta operativa con respuesta accionable: "¿hay algún
 * 0xFE pillado?", "¿el executor sigue barriendo?", "¿queda combustible?".
 * Devuelve `ProbeFinding[]`: uno por OBJETO afectado (una tx, una orden, un
 * provider), porque el operador no arregla "el executor", arregla la tx
 * 7BFC…65F — y esa identidad (`key`) es la que el motor usa para no repetir
 * el mismo aviso ni perder de vista cuál se resolvió.
 */

export type ProbeLevel = 'ok' | 'info' | 'warn' | 'critical';
export type IssueLevel = Exclude<ProbeLevel, 'ok'>;

export type ProbeFacts = Record<string, string | number | boolean | null | undefined>;

export interface ProbeFinding {
  /** Identidad del objeto afectado dentro del probe (hash, id, dirección).
   *  Vacío = el probe habla de sí mismo como un todo. */
  key?: string;
  level: ProbeLevel;
  /** Qué pasa, en una frase que se entienda en el móvil sin contexto. */
  message: string;
  /** QUÉ HACER. Sin esto, un aviso es solo ruido con reloj. */
  runbook?: string;
  /** Datos que el operador querrá leer o copiar. */
  facts?: ProbeFacts;
}

/** Contexto compartido por todos los probes de UNA pasada: lecturas caras
 *  (salud del executor, lista de atascados) se hacen una vez y se reparten. */
export interface ProbeCtx {
  now: number;
  /** Salud del watcher 0xFE — null si el carril está apagado o falló la lectura. */
  executorHealth: () => Promise<import('../flare/DirectMintExecutorService').ExecutorHealth | null>;
  /** Radiografía de pendientes + aparcados — null si el carril está apagado. */
  stuck: () => Promise<import('../flare/DirectMintExecutorService').StuckSnapshot | null>;
}

export interface Probe {
  id: string;
  /** Nombre humano — encabeza la tarjeta del panel. */
  title: string;
  /** false = este carril no aplica en este entorno (flag apagado): se salta,
   *  y el panel lo dice, en vez de fingir un verde que nadie ha comprobado. */
  applies?: () => boolean;
  run: (ctx: ProbeCtx) => Promise<ProbeFinding | ProbeFinding[] | null>;
}
