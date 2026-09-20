'use client';

/**
 * useMyManagedPositions — los potes gestionados donde el usuario tiene shares,
 * mirando TODAS sus direcciones linkeadas.
 *
 * El depósito por el carril XRP deja las participaciones en la PERSONAL ACCOUNT
 * (el Smart Account de la wallet XRPL), no en la MetaMask conectada. Mirar solo
 * la EVM activa las perdía (fundador 8-sep: «debería aparecer la posición… mira
 * todas las direcciones linkeadas»). Aquí el holder es el conjunto: cada wallet
 * EVM del usuario Y la PA de cada wallet XRPL suya, resuelta con el mismo
 * `MasterAccountController` determinista que usa todo lo demás.
 *
 * Solo LEE estado público de la cadena; Astryum no firma nada aquí.
 *
 * UN LECTOR PARA TODA LA APP (2026-09-11). Antes el shell (tickets pendientes)
 * y la estantería de Running (posiciones) hacían cada uno su pasada entera —
 * catálogo + un pote-state por pote y wallet — a la vez, y la ráfaga doble
 * contra el RPC público acababa en 429 y en «la cadena no se pudo leer».
 * Ahora la pasada es una, compartida en memoria: cada pote-state trae las
 * shares del holder Y los tickets del pote, así que posiciones y tickets
 * salen de las MISMAS lecturas. Las dos hooks son vistas de ese snapshot.
 *
 * «NO PUDE LEER» ≠ «NO TIENES», también por pote: las lecturas que fallan se
 * CUENTAN (`failed`) y la estantería lo dice, aunque la lista quede vacía.
 * Antes se tragaban una a una y una pantalla sin posiciones parecía verdad.
 */

import { useCallback, useEffect, useState } from 'react';
import { listMyWallets } from '../../services/walletLinkService';
import { resolvePersonalAccountOf } from '../wallet/paOwnership';
import { listPotes, getPoteState, invalidatePotesCatalog, type PoteCatalogEntry, type PoteState } from './api';
import { shouldRefreshManagedSnapshot } from './managedReadState';

const EVM_RE_ = /^0x[0-9a-fA-F]{40}$/;
const XRPL_RE_ = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

/** TODAS las direcciones del usuario, SIN colapsar: cada EVM (owner null) y la
 *  PA de cada XRPL (con su owner r-address). Compartido por posiciones y tickets. */
async function resolveMyHolders(): Promise<Array<{ addr: string; owner: string | null }>> {
  const wallets = await listMyWallets();
  const holders: Array<{ addr: string; owner: string | null }> = [];
  const seen = new Set<string>();
  const add = (addr: string, owner: string | null) => {
    const key = addr.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    holders.push({ addr, owner });
  };
  // PRIMERO las PAs con su dueño XRPL real. El endpoint /personal-account
  // AUTO-REGISTRA cada PA como wallet EVM 'smart-account'; si añadiéramos las
  // EVM antes, el `seen` fijaría la PA con owner=null y el ticket de esa PA se
  // quedaría SIN dueño (no casa, o casa con la wallet equivocada). Resolviendo
  // XRPL→PA antes, la PA conserva su owner XRPL (el user que depositó/redimió).
  const xrplAddrs = wallets.map((w) => w.address).filter((a) => XRPL_RE_.test(a));
  const paPairs = await Promise.all(
    xrplAddrs.map(async (x) => ({ owner: x, pa: await resolvePersonalAccountOf(x).catch(() => null) })),
  );
  for (const { owner, pa } of paPairs) if (pa && EVM_RE_.test(pa)) add(pa, owner);
  // LUEGO las EVM que NO sean una PA ya añadida (wallet EVM de verdad → sin owner).
  for (const w of wallets) if (EVM_RE_.test(w.address)) add(w.address, null);
  return holders;
}

export interface ManagedPosition {
  entry: PoteCatalogEntry;
  /** La dirección (PA o wallet EVM) que TIENE estas shares. */
  holder: string;
  /** La r-address XRPL que controla el holder si es una Personal Account; null
   *  si el holder es una wallet EVM directa. Decide cómo se firma la salida. */
  ownerXrpl: string | null;
  /** Shares de ESTE holder en este pote, base units (una posición por holder). */
  sharesBase: string;
  shareDecimals: number;
  /** Lo que esas shares valen HOY en el activo del pote, base units:
   *  shares × totalAssets ÷ totalSupply, con la proporción leída de la cadena
   *  (13-sep, el mosaico del catálogo enseña «tuyo» en activo, no en
   *  participaciones). null = el pote no dio supply legible — no se inventa. */
  assetsBase: string | null;
  assetDecimals: number;
  assetSymbol: string;
}

export interface MyManagedPositions {
  loading: boolean;
  positions: ManagedPosition[];
  error: string | null;
  /** Alguna lectura de pote falló: la lista puede estar incompleta. */
  partial: boolean;
  reload: () => void;
}

/** Un ticket de salida pendiente (requestRedeem) de una posición gestionada. */
export interface ManagedTicket {
  entry: PoteCatalogEntry;
  ticketId: number;
  /** La dirección (PA/EVM) receptora del ticket. */
  holder: string;
  /** La r-address que controla el holder si es una PA; null si es EVM. Decide
   *  cómo se firma el cobro (Xaman por la PA, o redeem EVM). */
  ownerXrpl: string | null;
  /** FXRP fijado del ticket, base units. */
  estFxrpBase: string;
  assetSymbol: string;
  claimable: boolean;
  claimableAtISO: string;
}

export interface MyManagedTickets {
  loading: boolean;
  tickets: ManagedTicket[];
  claimableCount: number;
  error: string | null;
  reload: () => void;
}

// ── El snapshot compartido ─────────────────────────────────────────────────

interface ManagedSnapshot {
  loading: boolean;
  positions: ManagedPosition[];
  tickets: ManagedTicket[];
  error: string | null;
  /** Lecturas de pote-state que fallaron en la última pasada. */
  failed: number;
  /** 0 = nunca leído. */
  loadedAt: number;
  /** La cuenta (token de sesión) para la que se calculó la pasada. */
  forAccount: string | null;
}

const EMPTY: ManagedSnapshot = { loading: false, positions: [], tickets: [], error: null, failed: 0, loadedAt: 0, forAccount: null };

/** La cuenta en sesión, por su token: la instantánea es SUYA, no del navegador. */
function currentAccountKey(): string | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage.getItem('auth_token') : null;
  } catch {
    return null;
  }
}
let snap: ManagedSnapshot = EMPTY;
let inflight: Promise<void> | null = null;
let seq = 0;
const listeners = new Set<(s: ManagedSnapshot) => void>();

function publish(next: ManagedSnapshot): void {
  snap = next;
  listeners.forEach((l) => l(next));
}

async function computeManaged(): Promise<Omit<ManagedSnapshot, 'loading' | 'loadedAt' | 'forAccount'>> {
  // TODAS las direcciones del usuario, sin colapsar (una wallet distinta en el
  // mismo pote = posición distinta).
  const holders = await resolveMyHolders();
  if (holders.length === 0) return { positions: [], tickets: [], error: null, failed: 0 };

  const potes = await listPotes();
  const ownerByHolder = new Map(holders.map((h) => [h.addr.toLowerCase(), h.owner]));
  const now = Date.now();
  const positions: ManagedPosition[] = [];
  const tickets: ManagedTicket[] = [];
  let failed = 0;

  // Pocos potes; en serie ENTRE potes para no saturar el RPC (mismo criterio
  // que el catálogo), y en paralelo entre los holders de un mismo pote — el
  // backend fusiona esas lecturas en una sola de cadena.
  for (const pote of potes) {
    const states = await Promise.all(
      holders.map((h) => getPoteState(pote.pote, h.addr).then((st) => st as PoteState | null).catch(() => null)),
    );
    let anyState: PoteState | null = null;
    states.forEach((st, i) => {
      if (!st) { failed += 1; return; }
      anyState = anyState ?? st;
      const h = holders[i];
      // UNA posición por (pote, holder).
      if (!st.holder?.shares || st.holder.shares === '0') return;
      // De participaciones a activo, con la proporción del pote. Sin supply
      // (o con números ilegibles) queda null: «no sé» no es «cero».
      let assetsBase: string | null = null;
      try {
        const supply = BigInt(st.totalSupply || '0');
        if (supply > BigInt(0)) assetsBase = ((BigInt(st.holder.shares) * BigInt(st.totalAssets || '0')) / supply).toString();
      } catch {
        assetsBase = null;
      }
      positions.push({
        entry: pote,
        holder: h.addr,
        ownerXrpl: h.owner,
        sharesBase: st.holder.shares,
        shareDecimals: typeof st.shareDecimals === 'number' ? st.shareDecimals : 18,
        assetsBase,
        assetDecimals: st.asset?.decimals ?? pote.asset?.decimals ?? 18,
        assetSymbol: st.asset?.symbol ?? pote.asset?.symbol ?? '',
      });
    });
    // Los tickets son del POTE (getPoteState los devuelve todos): con una
    // lectura buena basta; filtramos los que reciben nuestras direcciones.
    const withTickets = anyState as PoteState | null;
    if (!withTickets?.tickets?.length) continue;
    for (const tk of withTickets.tickets) {
      if (tk.claimed) continue;
      const owner = ownerByHolder.get(tk.receiver.toLowerCase());
      if (owner === undefined) continue; // no es un ticket de este usuario
      tickets.push({
        entry: pote,
        ticketId: tk.id,
        holder: tk.receiver,
        ownerXrpl: owner,
        estFxrpBase: tk.assets,
        assetSymbol: pote.asset?.symbol ?? 'FXRP',
        claimable: tk.maturity * 1000 <= now,
        claimableAtISO: new Date(tk.maturity * 1000).toISOString(),
      });
    }
  }
  return { positions, tickets, error: null, failed };
}

function load(): Promise<void> {
  if (inflight) return inflight;
  const mine = ++seq;
  const forAccount = currentAccountKey();
  publish({ ...snap, loading: true, error: null });
  const p = computeManaged()
    .then((r) => {
      if (mine !== seq) return; // una pasada más nueva ya mandó
      publish({ ...r, loading: false, loadedAt: Date.now(), forAccount });
    })
    .catch((e: unknown) => {
      if (mine !== seq) return;
      // El fallo entero (wallets o catálogo) deja lo último bueno a la vista y lo dice.
      publish({ ...snap, loading: false, error: e instanceof Error ? e.message : String(e) });
    })
    .finally(() => {
      if (inflight === p) inflight = null;
    });
  inflight = p;
  return p;
}

/** Relee todo tras una escritura (entrar, salir, cobrar): catálogo incluido. */
export function reloadManagedReads(): Promise<void> {
  invalidatePotesCatalog();
  inflight = null; // la nueva pasada gana por secuencia
  return load();
}

/**
 * OLVIDA la instantánea: al salir o cambiar de cuenta (authStore). La pasada
 * anterior era de OTRA persona; una en vuelo, si la hay, no manda (secuencia).
 */
export function resetManagedReads(): void {
  seq += 1;
  inflight = null;
  publish(EMPTY);
}

function useManagedSnapshot(enabled: boolean): ManagedSnapshot {
  const [state, setState] = useState<ManagedSnapshot>(snap);
  useEffect(() => {
    if (!enabled) return;
    listeners.add(setState);
    setState(snap);
    // Primera vez, un fallo anterior, OTRA cuenta, o una pasada vieja: se
    // (re)lee. Regla pura en managedReadState (fundador 17-sep: al cambiar de
    // cuenta la estantería enseñaba la pasada de la cuenta anterior).
    if (
      shouldRefreshManagedSnapshot({
        loadedAt: snap.loadedAt,
        error: snap.error,
        forAccount: snap.forAccount,
        currentAccount: currentAccountKey(),
        inflight: !!inflight,
        now: Date.now(),
      })
    ) void load();
    return () => { listeners.delete(setState); };
  }, [enabled]);
  return state;
}

export function useMyManagedPositions(enabled = true): MyManagedPositions {
  const s = useManagedSnapshot(enabled);
  const reload = useCallback(() => { void reloadManagedReads(); }, []);
  // Mientras no haya habido NINGUNA pasada, es espera (no «no tienes»).
  const loading = s.loading || (enabled && s.loadedAt === 0 && !s.error);
  return { loading, positions: s.positions, error: s.error, partial: s.failed > 0, reload };
}

/**
 * Los tickets de salida PENDIENTES del usuario en potes de cola (requestRedeem
 * abre un ticket que madura). Mira todas las direcciones linkeadas (EVM + PAs).
 * Es lo que alimenta «pending to withdraw» en el menú: qué está en camino, cuánto
 * y cuándo se puede cobrar. Solo lee estado público; Astryum no firma.
 */
export function useMyManagedTickets(enabled = true): MyManagedTickets {
  const s = useManagedSnapshot(enabled);
  const reload = useCallback(() => { void reloadManagedReads(); }, []);
  return {
    loading: s.loading,
    tickets: s.tickets,
    claimableCount: s.tickets.filter((t) => t.claimable).length,
    error: s.error,
    reload,
  };
}
