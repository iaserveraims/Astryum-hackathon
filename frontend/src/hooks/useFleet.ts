'use client';

/**
 * useFleet — TODA la flota del usuario, leída una vez: las cifras del Home y
 * la lista de sus cuentas, del mismo array.
 *
 * Fundador 2026-08-22 (quinta pasada): «el summary siempre muestra el whole
 * fleet, no pongas botón, hay que simplificar más las cosas… mostramos solo
 * las wallets (la legacy también) y no son seleccionables, pero sí clicables
 * para ir a wallets». Así que aquí ya no hay lente ni selección: hay UNA
 * lectura, la de todo, y UNA lista de filas para enseñarla desglosada. La
 * cuarta pasada dejó una lente con «toda la flota» + selección por fila; duró
 * un día — un botón de más en la pantalla que debe leerse de un vistazo.
 *
 * Las cuentas personales y las gobernadas por un consejo van en la misma
 * lista, ordenadas por valor. Una fila de Legacy se reconoce por lo que ES —su
 * glifo y su quórum— no por vivir en otra caja.
 *
 * Una propiedad que conviene no perder: el total sale de MERGEAR las mismas
 * filas que se pintan (mergeSnaps/mergeRisks, las funciones con las que
 * portfolioMerge construye el total global), así que la cifra de arriba es por
 * construcción la suma de las de abajo. No pueden discrepar.
 */

import { useMemo } from 'react';
import { useScopedFleet, useAggregatedFor } from './useFleetScope';
import { usePaFold, foldKey, isHiddenEmptyOrphanPa, type PaFoldMap } from '@/lib/wallet/paFold';
import { useEthMorphoHealth, type EthMorphoHealth } from '@/lib/earn/useEthMorphoHealth';
import { addressKey, type GovernedAuthority } from '@/lib/authority';
import { mergeRisks, mergeSnaps, normaliseSnap, type WalletRecord } from '@/lib/portfolioMerge';
import type { PortfolioSnapshot, RiskSnapshot } from '@/services/v1Api';

export interface FleetRow {
  key: string;
  address: string;
  /** La wallet registrada, cuando la fila es una cuenta con ficha propia. */
  wallet: WalletRecord | null;
  /** El consejo, cuando la fila es una estructura gobernada. */
  legacy: GovernedAuthority | null;
  snap: PortfolioSnapshot | null;
  risk: RiskSnapshot | null;
  /** null = todavía no leída. Se pinta «…», nunca un 0 que parece un saldo. */
  netWorthUSD: number | null;
  /** Dirección del Smart Account que esta fila absorbió (paFold), si lo hubo. */
  absorbedSmartAccount: string | null;
}

export interface FleetView {
  /** UNA lista: personales y gobernadas, lo grande arriba. */
  rows: FleetRow[];
  /** Total de toda la flota. null = nada leído todavía. */
  allTotal: number | null;
  /** Cuántas de las filas son estructuras gobernadas. */
  legacyCount: number;
  /** La lectura de TODA la flota — lo que pintan el héroe y los anillos. */
  snap: PortfolioSnapshot | null;
  risk: RiskSnapshot | null;
  /** Riesgo del carril de Ethereum, por wallet — el agregado no lo ve. */
  emHealth: EthMorphoHealth;
  /** Todas las direcciones de la flota (alertas, reglas). */
  addresses: string[];
  /** El agregado todavía no ha contestado para NINGUNA fila. */
  loading: boolean;
  fold: PaFoldMap;
}

/** Suma honesta: null mientras no se haya leído ni una sola fila. */
function totalOf(rows: FleetRow[]): number | null {
  const read = rows.filter((r) => r.netWorthUSD != null);
  if (read.length === 0) return null;
  return read.reduce((s, r) => s + (r.netWorthUSD as number), 0);
}

export function useFleet(): FleetView {
  // El universo: TODAS las cuentas (personales + cada Legacy con sus dos patas).
  const fleet = useScopedFleet('all');
  const { data: aggregated } = useAggregatedFor(fleet.addresses);
  // El pliegue visual: un Smart Account cuya dueña está en la lista no es una
  // fila, es capital de su dueña (paFold, 2026-08-17).
  const fold = usePaFold(fleet.personal.map((w) => w.address));

  // La cartera agregada NO tiene adapter para morpho-blue: la deuda de
  // Ethereum nunca entra en snap.debtUSD. Sin esta lectura la fila decía
  // «Sana — sin deuda abierta» sobre un carry apalancado VIVO.
  const emAddrs = useMemo(
    () => [...new Set(fleet.addresses.filter((a) => /^0x[a-fA-F0-9]{40}$/.test(a ?? '')))],
    [fleet.addresses],
  );
  const emHealthAll = useEthMorphoHealth(emAddrs);

  const sliceByKey = useMemo(() => {
    const m = new Map<string, { snap: PortfolioSnapshot; risk: RiskSnapshot | null; pa: string | null }>();
    for (const pw of aggregated?.perWallet ?? []) {
      if (!pw?.snap) continue;
      m.set(addressKey(pw.address), {
        snap: pw.snap as PortfolioSnapshot,
        risk: (pw.risk ?? null) as RiskSnapshot | null,
        pa: pw.absorbedSmartAccount ?? null,
      });
    }
    return m;
  }, [aggregated]);

  const rows = useMemo<FleetRow[]>(() => {
    const listed = new Set(fleet.personal.map((w) => foldKey(w.address)));
    const personalRows: FleetRow[] = fleet.personal
      .filter((w) => {
        // Absorbida por su dueña: su valor ya viaja en la fila de arriba.
        const owner = fold.ownerByPa.get(foldKey(w.address));
        if (owner && listed.has(foldKey(owner))) return false;
        // Fundador 2026-09-11: una Smart Account NUNCA es fila propia en el
        // Home («debe quedarse escondida la FSA»). Su valor no se pierde: el
        // patrimonio de arriba lo suma desde el snapshot agregado, y con su
        // dueña en la lista viaja plegado en la fila de esa dueña. Sustituye
        // a la regla del 19-ago (huérfana con valor visible) SOLO en esta
        // banda — en Wallets la cuenta sigue apareciendo y gestionándose.
        if ((w.walletType ?? '').toLowerCase() === 'smart-account') return false;
        return !isHiddenEmptyOrphanPa(w.walletType, sliceByKey.get(addressKey(w.address))?.snap.netWorthUSD);
      })
      .map((w) => {
        const key = addressKey(w.address);
        const slice = sliceByKey.get(key);
        return {
          key,
          address: w.address,
          wallet: w,
          legacy: null,
          snap: slice?.snap ?? null,
          risk: slice?.risk ?? null,
          netWorthUSD: slice ? slice.snap.netWorthUSD ?? 0 : null,
          absorbedSmartAccount: slice?.pa ?? fold.paByOwner.get(foldKey(w.address)) ?? null,
        };
      });

    const legacyRows: FleetRow[] = fleet.legacies.map((f) => {
      const key = addressKey(f.legacy.address);
      // UNA búsqueda es toda la estructura: el agregado ya plegó el Smart
      // Account dentro de la cuenta del consejo, así que su snap trae las dos
      // patas.
      const slice = sliceByKey.get(key);
      return {
        key,
        address: f.legacy.address,
        wallet: null,
        legacy: f.legacy,
        snap: slice?.snap ?? null,
        risk: slice?.risk ?? null,
        netWorthUSD: slice ? slice.snap.netWorthUSD ?? 0 : null,
        absorbedSmartAccount: slice?.pa ?? f.pa,
      };
    });

    // UNA lista, ordenada por valor. Una cuenta gobernada no va al final por
    // ser gobernada: va donde la pone su dinero, como cualquier otra. El
    // de-dupe cubre el caso de un consejo que además esté dado de alta como
    // wallet: se queda con la fila que trae el consejo (más rica).
    const legacyKeys = new Set(legacyRows.map((r) => r.key));
    return [...legacyRows, ...personalRows.filter((r) => !legacyKeys.has(r.key))].sort(
      (a, b) => (b.netWorthUSD ?? -1) - (a.netWorthUSD ?? -1),
    );
  }, [fleet.personal, fleet.legacies, fold, sliceByKey]);

  return useMemo(() => {
    const snaps = rows.map((r) => r.snap).filter((s): s is PortfolioSnapshot => s != null);
    const merged = mergeSnaps(snaps);
    const risks = rows.map((r) => r.risk).filter((r): r is RiskSnapshot => r != null);
    const addresses = rows.flatMap((r) =>
      r.absorbedSmartAccount ? [r.address, r.absorbedSmartAccount] : [r.address],
    );

    return {
      rows,
      allTotal: totalOf(rows),
      legacyCount: rows.filter((r) => r.legacy).length,
      snap: merged ? normaliseSnap(merged) : null,
      risk: mergeRisks(risks),
      emHealth: emHealthAll,
      addresses,
      loading: aggregated == null && fleet.addresses.length > 0,
      fold,
    };
  }, [rows, emHealthAll, aggregated, fleet.addresses.length, fold]);
}
