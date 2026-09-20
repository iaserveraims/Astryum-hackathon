/**
 * useCatalogPolicies — el catálogo de potes como `PolicyCard[]`, leído de la
 * CADENA, para las pantallas que nacieron con las dos direcciones de entorno.
 *
 * Antes: `availablePolicies()` = `NEXT_PUBLIC_POTE_A/B_ADDRESS`. Añadir un pote
 * exigía desplegar el frontend, y un pote abierto por un gestor no existía para
 * nadie. Ahora la lista sale de `GET /institutional/potes` (v1 + jaulas v2), en
 * orden de creación, sin ranking.
 *
 * Mientras se lee, y si la lectura falla, se enseñan las tarjetas por env (las
 * de siempre): «no pude leer» no es «no hay», y una pantalla vacía lo diría.
 * `failed` lo cuenta para que la pantalla lo diga en vez de fingir.
 */
'use client';

import { useEffect, useState } from 'react';
import { useT } from '../../i18n/LanguageProvider';
import { listPotes, type PoteCatalogEntry } from './api';
import { availablePolicies, exitSpeedLabel, type PolicyCard } from './policyCatalog';

export interface CatalogPolicyCard extends PolicyCard {
  generation?: 'v1' | 'v2';
  cage?: string | null;
  councilXrplAddress?: string | null;
  maxDepositPerUser?: string | null;
  unreadable?: boolean;
}

const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

function fmtUnits(units: string, decimals: number): string {
  const v = BigInt(units || '0');
  const div = BigInt(10) ** BigInt(decimals);
  const whole = v / div;
  const frac = (v % div).toString().padStart(decimals, '0').slice(0, 4).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole.toString();
}

/**
 * Pura: de lo que devuelve la cadena a la tarjeta. El nombre del pote es el
 * título (sin adjetivos nuestros); la frase dice quién lo lleva, cuántos
 * destinos tiene y, si lo hay, el tope por cuenta. Los potes ilegibles salen
 * con lo que se sabe: su dirección.
 */
export function policyCardsFromCatalog(entries: PoteCatalogEntry[], t: (s: string) => string): CatalogPolicyCard[] {
  return entries.map((p) => {
    const who = p.councilXrplAddress ? shortAddr(p.councilXrplAddress) : t('manager unknown');
    const venues = `${p.venues.length} ${p.venues.length === 1 ? t('destination') : t('destinations')}`;
    const cap =
      p.maxDepositPerUser && p.maxDepositPerUser !== '0' && p.asset
        ? ` · ${t('max per account')} ${fmtUnits(p.maxDepositPerUser, p.asset.decimals)} ${p.asset.symbol}`
        : '';
    const cooldown = p.cooldownSeconds ?? 0;
    return {
      key: p.pote,
      poteAddress: p.pote,
      title: p.name ?? shortAddr(p.pote),
      strategyLine: p.unreadable
        ? t('Could not read this vault right now — that says nothing about what is inside.')
        : `${t('Run by')} ${who} · ${venues}${cap}`,
      exitLine: exitSpeedLabel(cooldown),
      exitSeconds: cooldown,
      generation: p.generation,
      cage: p.cage ?? null,
      councilXrplAddress: p.councilXrplAddress,
      maxDepositPerUser: p.maxDepositPerUser ?? null,
      unreadable: p.unreadable,
    };
  });
}

export function useCatalogPolicies(): { policies: CatalogPolicyCard[]; loading: boolean; failed: boolean; source: 'chain' | 'env' } {
  const { t } = useT();
  const [chain, setChain] = useState<CatalogPolicyCard[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    listPotes(false)
      .then((entries) => {
        if (!alive) return;
        setChain(policyCardsFromCatalog(entries, t));
        setFailed(false);
      })
      .catch(() => {
        if (!alive) return;
        setChain(null);
        setFailed(true);
      });
    return () => {
      alive = false;
    };
    // `t` cambia con el idioma; re-mapear entonces es correcto y barato.
  }, [t]);

  if (chain) return { policies: chain, loading: false, failed: false, source: 'chain' };
  return { policies: availablePolicies(), loading: !failed, failed, source: 'env' };
}
