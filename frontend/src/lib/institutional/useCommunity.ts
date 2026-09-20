'use client';

/**
 * useCommunity — UNA lectura de la comunidad para toda la pantalla.
 *
 * El catálogo, la ficha, el perfil y la página de comunidad quieren lo mismo:
 * el perfil público de cada consejo (nombre, foto, persona/agente), el recuento
 * de apoyos y la imagen elegida de cada pote. Pedirlo por componente sería una
 * petición por carta. Aquí se pide una vez, se comparte en memoria y se
 * refresca cuando alguien escribe.
 *
 * ROBUSTEZ (revisión 10-sep):
 *  · Cada lectura lleva un número de secuencia: una respuesta LENTA de una
 *    lectura vieja jamás pisa una más nueva (antes, votar y que llegara tarde
 *    la lectura inicial deshacía el voto en pantalla).
 *  · Un fallo NO es pegajoso: el siguiente montaje vuelve a intentarlo.
 *  · Las escrituras que ya devuelven el dato (apoyos, imagen) PARCHEAN el
 *    snapshot en sitio en vez de re-descargar la comunidad entera (con fotos
 *    en data URL eran megabytes por clic).
 *
 * «No pude leer» deja los mapas vacíos y `failed` a true: las cartas caen a la
 * identidad determinista (dirección + dos letras), que es lo que había antes —
 * nunca se inventa un nombre ni una foto.
 */

import { useEffect, useState } from 'react';
import { readCommunity, type CommunityActor, type VaultImageRecord } from './api';

interface Snapshot {
  actors: Map<string, CommunityActor>;
  images: Map<string, VaultImageRecord>;
  loading: boolean;
  failed: boolean;
}

const EMPTY: Snapshot = { actors: new Map(), images: new Map(), loading: true, failed: false };
let snap: Snapshot = EMPTY;
let inflight: Promise<void> | null = null;
let seq = 0;
const listeners = new Set<(s: Snapshot) => void>();

function publish(next: Snapshot) {
  snap = next;
  listeners.forEach((l) => l(next));
}

function load(): Promise<void> {
  if (inflight) return inflight;
  const mine = ++seq;
  const p = readCommunity()
    .then((r) => {
      if (mine !== seq) return; // una lectura más nueva ya mandó
      const actors = new Map<string, CommunityActor>();
      for (const a of r.actors) actors.set(a.account, a);
      const images = new Map<string, VaultImageRecord>();
      for (const v of r.vaultImages) images.set(v.pote.toLowerCase(), v);
      publish({ actors, images, loading: false, failed: false });
    })
    .catch(() => {
      if (mine !== seq) return;
      publish({ ...snap, loading: false, failed: true });
    })
    .finally(() => {
      if (inflight === p) inflight = null;
    });
  inflight = p;
  return p;
}

/** Relee entera (perfil editado, imagen de otro…): todas las vistas se enteran. */
export function invalidateCommunity(): Promise<void> {
  inflight = null; // la nueva lectura gana por secuencia; la vieja, si llega, se descarta
  return load();
}

/** Parche en sitio tras un voto: lo que el servidor devolvió, sin re-descargar. */
export function patchActorEndorsement(account: string, endorsements: number, endorsedByMe: boolean): void {
  const actors = new Map(snap.actors);
  const prev = actors.get(account) ?? { account, profile: null, endorsements: 0, endorsedByMe: false };
  actors.set(account, { ...prev, endorsements, endorsedByMe });
  publish({ ...snap, actors });
}

/** Parche en sitio tras elegir la imagen de un pote. */
export function patchVaultImage(record: VaultImageRecord): void {
  const images = new Map(snap.images);
  images.set(record.pote.toLowerCase(), record);
  publish({ ...snap, images });
}

export function useCommunity(): Snapshot & { refresh: () => Promise<void> } {
  const [state, setState] = useState<Snapshot>(snap);
  useEffect(() => {
    listeners.add(setState);
    setState(snap);
    // Primera vez, o un fallo anterior: se (re)intenta. Un fallo no es para siempre.
    if (snap.loading || (snap.failed && !inflight)) void load();
    return () => { listeners.delete(setState); };
  }, []);
  return { ...state, refresh: invalidateCommunity };
}

/** La imagen de un pote, SOLO si la puso el consejo que el catálogo dice que lo gobierna. */
export function vaultImageFor(
  images: Map<string, VaultImageRecord>,
  entry: { pote: string; councilXrplAddress: string | null },
): VaultImageRecord | null {
  const row = images.get(entry.pote.toLowerCase());
  if (!row) return null;
  if (!entry.councilXrplAddress || row.account !== entry.councilXrplAddress) return null;
  return row;
}
