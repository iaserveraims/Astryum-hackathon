/**
 * EL CAMBIO DE TEMA, como señal.
 *
 * Las dos cosas
 * salen de aquí.
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
