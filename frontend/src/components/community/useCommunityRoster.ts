'use client';

/**
 * useCommunityRoster — la lista de ACTORES de la comunidad, cruzando dos
 * lecturas: la comunidad (perfiles, apoyos) y el catálogo on-chain (qué
 * bóvedas lleva cada consejo y si lleva credencial). Un actor es una cuenta
 * XRPL real que gobierna al menos una bóveda O que tiene perfil o apoyos.
 * Las bóvedas de la casa y los consejos sin resolver no son personas: fuera.
 *
 * RAPIDEZ (fundador 11-sep: «llevo dos minutos esperando la comunidad»): la
 * página NO espera al catálogo. Pinta con la comunidad (una lectura ligera),
 * añade las bóvedas cuando llega la lista PELADA compartida del catálogo (la
 * misma que usa el shell, cacheada), y las credenciales por bóveda —la parte
 * lenta: una consulta al ledger XRPL por consejo— llegan las últimas y solo
 * cambian el chip «Verificado». Nada bloquea a nada.
 */

import { useEffect, useMemo, useState } from 'react';
import { listPotes, type CommunityActor, type PoteCatalogEntry } from '../../lib/institutional/api';
import { useCommunity } from '../../lib/institutional/useCommunity';
import { managerOf } from '../managed/managerIdentity';

export interface RosterEntry {
  account: string;
  actor: CommunityActor | null;
  vaults: PoteCatalogEntry[];
  /** true = todas sus bóvedas llevan credencial; false = ninguna; 'some' = mixto; null = sin bóvedas o aún sin leer. */
  verified: boolean | 'some' | null;
}

/** Caché de módulo de la lista CON credenciales (la lenta): una por minuto, compartida entre tablón y página. */
let credCache: { entries: PoteCatalogEntry[]; at: number } | null = null;
let credInflight: Promise<PoteCatalogEntry[]> | null = null;
function loadWithCredentials(): Promise<PoteCatalogEntry[]> {
  if (credCache && Date.now() - credCache.at < 60_000) return Promise.resolve(credCache.entries);
  if (credInflight) return credInflight;
  credInflight = listPotes(true)
    .then((r) => { credCache = { entries: r, at: Date.now() }; return r; })
    .finally(() => { credInflight = null; });
  return credInflight;
}

export function useCommunityRoster() {
  const community = useCommunity();
  const [bare, setBare] = useState<PoteCatalogEntry[] | null>(null);
  const [withCred, setWithCred] = useState<PoteCatalogEntry[] | null>(null);
  const [catalogFailed, setCatalogFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    // 1 · la lista pelada, compartida y rápida: bóvedas por cuenta.
    listPotes(false)
      .then((r) => { if (alive) { setBare(r); setCatalogFailed(false); } })
      .catch(() => { if (alive) { setBare([]); setCatalogFailed(true); } });
    // 2 · con credenciales, detrás y sin bloquear: solo afina «Verificado».
    loadWithCredentials()
      .then((r) => { if (alive) setWithCred(r); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const entries = withCred ?? bare;
  const credentialsPending = withCred === null;

  const roster = useMemo<RosterEntry[]>(() => {
    const byAccount = new Map<string, RosterEntry>();
    for (const e of entries ?? []) {
      const m = managerOf(e);
      if (m.kind !== 'manager' || !m.address) continue;
      const row = byAccount.get(m.address) ?? { account: m.address, actor: null, vaults: [], verified: null };
      row.vaults.push(e);
      byAccount.set(m.address, row);
    }
    community.actors.forEach((a, account) => {
      const row = byAccount.get(account) ?? { account, actor: null, vaults: [], verified: null };
      row.actor = a;
      byAccount.set(account, row);
    });
    for (const row of byAccount.values()) {
      if (row.vaults.length === 0 || credentialsPending) { row.verified = null; continue; }
      const withC = row.vaults.filter((v) => v.credential?.issuer).length;
      row.verified = withC === row.vaults.length ? true : withC > 0 ? 'some' : false;
    }
    return [...byAccount.values()];
  }, [entries, community.actors, credentialsPending]);

  return {
    roster,
    /** Solo la comunidad bloquea el primer pintado; el catálogo llega detrás. */
    loading: community.loading,
    catalogLoading: bare === null,
    credentialsPending,
    communityFailed: community.failed,
    catalogFailed,
    refresh: community.refresh,
  };
}
