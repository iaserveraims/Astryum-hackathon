/**
 * pendingVaultImage — la imagen que el gestor eligió en el CREADOR, antes de
 * que el pote exista. La dirección del pote solo se conoce cuando la orden
 * ejecuta en Flare (minutos después, tal vez tras una recarga), así que la
 * elección espera aquí (localStorage, por cuenta) y la mesa la aplica en
 * cuanto ve aparecer un pote de esta cuenta con ese nombre y símbolo.
 * Si el gestor elige otra imagen desde Operar antes, gana la suya.
 */

import type { VaultImageKind } from './api';

export interface PendingVaultImage {
  name: string;
  symbol: string;
  kind: VaultImageKind;
  emblem?: string;
  at: number;
}

const KEY = (account: string) => `astryum:vault-image-pending:${account}`;

export function setPendingVaultImage(account: string, p: Omit<PendingVaultImage, 'at'>): void {
  try {
    window.localStorage.setItem(KEY(account), JSON.stringify({ ...p, at: Date.now() }));
  } catch {
    /* sin memoria no hay espera: el gestor la elegirá en Operar */
  }
}

export function readPendingVaultImage(account: string): PendingVaultImage | null {
  try {
    const raw = window.localStorage.getItem(KEY(account));
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingVaultImage;
    // Una espera de más de 7 días ya no es de este pote.
    if (!p || Date.now() - (p.at ?? 0) > 7 * 86_400_000) return null;
    return p;
  } catch {
    return null;
  }
}

export function clearPendingVaultImage(account: string): void {
  try { window.localStorage.removeItem(KEY(account)); } catch { /* nada */ }
}
