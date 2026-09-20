'use client';

/**
 * The active authority — WHICH account the whole app operates as (ADR-009/011).
 *
 * ⚠️ 2026-08-22, cuarta pasada del fundador: «el legacy simplemente sea una
 * wallet más… no que sea seleccionable como producto distinto, porque no lo
 * es». `productMode` DEJA DE SER UNA ELECCIÓN. Ya no lo mueve activar una
 * cuenta ni un interruptor: lo pone la PANTALLA en la que estás (AppShell
 * sincroniza 'legacy' mientras la ruta es /app/legacy, 'astryum' fuera). El
 * tema índigo y la travesía siguen existiendo — pero como vestimenta de una
 * superficie, no como un producto que el usuario elige y en el que se queda
 * atrapado sin saber por qué la mitad de su dinero desapareció de la lista.
 *
 * Only the selection persists here; the authority list itself is derived live
 * (wallets from /api/wallets/mine, councils from /api/governed-accounts + the
 * ledger) in useAuthorities. Persisting just the id means a stale selection
 * degrades safely: if the authority disappears, consumers fall back to the
 * overview instead of operating a ghost account.
 *
 * `lastGovernedId` (2026-07-18 union with the product-toggle line): the last
 * governed account operated — the "predefined Legacy" the Summary toggle
 * re-enters. The toggle and the sidebar switcher write THIS same state, so
 * they can never disagree.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { OVERVIEW_AUTHORITY_ID } from '../lib/authority';

interface AuthorityState {
  activeAuthorityId: string;
  /** The last governed authority id operated as — the toggle's re-entry door. */
  lastGovernedId: string | null;
  /**
   * La ROPA que lleva el shell, derivada de la superficie abierta — no una
   * elección del usuario. Sólo la escribe el sincronizador de ruta de
   * AppShell: 'legacy' mientras estás dentro de /app/legacy (gobernar,
   * constituir, reforzar, la bandeja del consejo), 'astryum' en cuanto sales.
   * NUNCA la escribe activar una cuenta: una cuenta del consejo es una wallet
   * más, y elegirla para leerla no puede repintar la aplicación entera.
   */
  productMode: 'astryum' | 'legacy';
  setActiveAuthority: (id: string) => void;
  /** Lo llama el sincronizador de ruta de AppShell. No es un interruptor. */
  setProductMode: (mode: 'astryum' | 'legacy') => void;
  resetAuthority: () => void;
}

export const useAuthorityStore = create<AuthorityState>()(
  persist(
    (set) => ({
      activeAuthorityId: OVERVIEW_AUTHORITY_ID,
      lastGovernedId: null,
      productMode: 'astryum',
      // Activar una autoridad NO toca el producto (2026-08-22): abrir la
      // cuenta de un consejo para mirarla es lo mismo que abrir cualquier otra
      // wallet. El índigo lo pone la pantalla de Legacy, no esta línea.
      setActiveAuthority: (id) =>
        set((s) => ({
          activeAuthorityId: id,
          lastGovernedId: id.startsWith('governed:') ? id : s.lastGovernedId,
        })),
      setProductMode: (mode) => set({ productMode: mode }),
      resetAuthority: () =>
        set({ activeAuthorityId: OVERVIEW_AUTHORITY_ID, lastGovernedId: null, productMode: 'astryum' }),
    }),
    {
      name: 'astryum:active-authority',
      // El producto NO se restaura de disco (2026-08-22): era exactamente el
      // fallo de comprensión — recargar te devolvía a un shell índigo que
      // nadie había pedido en esta sesión, con media flota fuera de la lista.
      // Arranca siempre en 'astryum'; si la ruta es /app/legacy, el
      // sincronizador de AppShell lo vuelve a poner en el primer render.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AuthorityState>;
        return { ...current, ...p, productMode: 'astryum' };
      },
    },
  ),
);
