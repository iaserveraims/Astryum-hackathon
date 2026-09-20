/**
 * EL CAMBIO DE TEMA, como señal (2026-09-14).
 *
 * Fundador: «al cambiar de tema se queda la página en gris bugeada… y quiero
 * alguna especie de barrido para cuando se cambia el tema». Las dos cosas
 * salen de aquí.
 *
 * Cada vez que el tema (data-skin) CAMBIA estando el panel montado, ThemeApplier
 * sube este contador de ÉPOCA. Quien lo escucha:
 *
 *   · RevealGroup / Reveal (ui/motion.tsx) — vuelven a jugar su entrada en el
 *     lenguaje del tema nuevo: la página se IMPRIME al pasar a la lámina y se
 *     POSA al volver a Astryum. Sin remontar nada (un remontaje borraría lo
 *     que el usuario estuviera escribiendo y relanzaría cada lectura): el
 *     grupo pasa un fotograma por «oculto» y vuelve a «visto». La época
 *     también cuenta como PRIMERA visita para el estilo de entrada — cambiar
 *     de material es volver a entrar.
 *   · ThemeSweep (ThemeApplier) — la luz que recorre la pantalla entera con
 *     el acento del tema nuevo, para lo que no vive en un RevealGroup (menú,
 *     cabeceras).
 *
 * Mismo material que lib/motion/veil.ts: un store mínimo sin React ni zustand,
 * legible por useSyncExternalStore. En el servidor la época es siempre 0.
 */

type Listener = () => void;

let epoch = 0;
const listeners = new Set<Listener>();

export function bumpSkinEpoch(): void {
  epoch += 1;
  listeners.forEach((l) => l());
}

export function getSkinEpoch(): number {
  return epoch;
}

export function serverSkinEpoch(): number {
  return 0;
}

export function subscribeSkinEpoch(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
