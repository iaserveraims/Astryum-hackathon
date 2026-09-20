/**
 * PoteCatalogRead — LA LECTURA DEL CATÁLOGO ENTERO, en un solo sitio, y el
 * CALENTADOR que la mantiene viva.
 */

import { ethers } from 'ethers';
import { swr, swrPeek } from './swrCache';
import { flareReadProvider } from './flareProvider';
import { listCagePotes, listPotes, seedCageCouncils, type PoteSummary } from './AstryumPoteCatalogService';
import { astryumCageFactoryAddress } from './LegacyCageResolver';

/** El nodo público conocido-bueno (mismo literal que rutas/institutional.ts). */
const PUBLIC_FLARE_RPC = 'https://flare-api.flare.network/ext/C/rpc';
/** Fresco 45 s; pasado hasta 30 min se sirve YA y se recalcula por detrás. */
export const CATALOG_SWR = { freshMs: 45_000, staleMs: 30 * 60_000 };
const WARM_EVERY_MS = 20 * 60_000;

function rpcUrl(): string {
  return process.env.FLARE_RPC_URL || PUBLIC_FLARE_RPC;
}

export interface CatalogConfig {
  factoryAddress: string | null;
  cageFactory: string | null;
  catalogRpc: string;
  fromBlock: number | undefined;
  cageFromBlock: number | undefined;
}

/** Las dos factories y los bloques de origen, leídos del entorno (con el
 *  `fromBlock` opcional de la petición por encima). */
export function catalogConfig(fromBlockOverride = ''): CatalogConfig {
  const v1Raw = process.env.ASTRYUM_FACTORY_ADDRESS;
  const factoryAddress = v1Raw && ethers.isAddress(v1Raw) ? ethers.getAddress(v1Raw) : null;
  const cageFactory = astryumCageFactoryAddress();
  // RPC PROPIO del catálogo, aislado del que usan el executor/mint/FDC (dinero).
  // Solo LEE eventos públicos: puede ir por un endpoint que admita rangos
  // grandes de getLogs (Ankr público = 1000 bloques; dRPC con clave = 10k; el
  // nodo público topa en 30). Cae a FLARE_RPC_URL y de ahí al público.
  const catalogRpc = (process.env.ASTRYUM_CATALOG_RPC_URL ?? process.env.FLARE_RPC_URL ?? '').trim() || rpcUrl();
  const override = fromBlockOverride.trim();
  const fromBlockRaw = (override || process.env.ASTRYUM_FACTORY_FROM_BLOCK || '').trim();
  const fromBlock = /^[0-9]+$/.test(fromBlockRaw) ? Number(fromBlockRaw) : undefined;
  // La factory de JAULAS (v2) nació mucho después que la v1: su propio
  // fromBlock acota el escaneo a su vida real.
  const cageFromBlockRaw = (override || process.env.ASTRYUM_CAGE_FACTORY_FROM_BLOCK || process.env.ASTRYUM_FACTORY_FROM_BLOCK || '').trim();
  const cageFromBlock = /^[0-9]+$/.test(cageFromBlockRaw) ? Number(cageFromBlockRaw) : undefined;
  return { factoryAddress, cageFactory, catalogRpc, fromBlock, cageFromBlock };
}

/**
 * El catálogo entero, de caché (swr) — en serie las dos factories, la v1
 * primero porque nació antes (no es ranking). Si el RPC del catálogo se cae
 * ENTERO, reintenta por el público cableado antes de fallar.
 * Lanza `FACTORY_UNCONFIGURED` si no hay ninguna factory.
 */
function catalogKey(cfg: CatalogConfig): string {
  return `potes:${cfg.catalogRpc}:${cfg.fromBlock ?? ''}:${cfg.cageFromBlock ?? ''}`;
}

/** ¿Hay catálogo servible ya? Y si no, ¿se está leyendo? Para que la ruta
 *  responda 202 «calentando» en vez de colgar al cliente minutos. */
export function peekPoteCatalog(fromBlockOverride = ''): { potes: PoteSummary[] | undefined; computing: boolean } {
  const cfg = catalogConfig(fromBlockOverride);
  const p = swrPeek<PoteSummary[]>(catalogKey(cfg));
  return { potes: p.value, computing: p.computing };
}

export async function readFullPoteCatalog(opts: { fromBlockOverride?: string } = {}): Promise<PoteSummary[]> {
  const cfg = catalogConfig(opts.fromBlockOverride);
  if (!cfg.factoryAddress && !cfg.cageFactory) throw new Error('FACTORY_UNCONFIGURED');
  const readCatalog = async (rpc: string) => {
    const provider = flareReadProvider(rpc);
    // El escaneo de consejos va POR DETRÁS: el catálogo sale en
    // segundos con lo que la caché ya sabe y los consejos que falten llegan
    // en la siguiente lectura (fresco 45 s), mientras el escaneo avanza a su
    // ritmo contra el rate-limit del RPC y guarda su progreso.
    return [
      ...(cfg.factoryAddress ? await listPotes(provider, cfg.factoryAddress, { fromBlock: cfg.fromBlock, deferCouncilScan: true }) : []),
      ...(cfg.cageFactory ? await listCagePotes(provider, cfg.cageFactory, { fromBlock: cfg.cageFromBlock, deferCouncilScan: true }) : []),
    ];
  };
  return swr(catalogKey(cfg), CATALOG_SWR, async () => {
    let potes: PoteSummary[];
    let rpc = cfg.catalogRpc;
    try {
      potes = await readCatalog(cfg.catalogRpc);
    } catch (primaryErr) {
      if (cfg.catalogRpc === PUBLIC_FLARE_RPC) throw primaryErr;
      rpc = PUBLIC_FLARE_RPC;
      potes = await readCatalog(PUBLIC_FLARE_RPC);
    }
    if (cfg.cageFactory) await fillCouncilsFromKnownRoots(rpc, cfg.cageFactory, potes);
    return potes;
  });
}

const XRPL_ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
const CAGE_OF_ABI = ['function cageOf(bytes32) view returns (address)'];

/**
 * LOS CONSEJOS QUE LA APP YA CONOCE. El bridge solo guarda el hash de
 * la r-address, así que el nombre del consejo de una jaula solo sale de los
 * eventos… o de probar candidatos: la app tiene r-addresses de raíces (los
 * perfiles públicos de gestor y los runs del exchange), y `cageOf(keccak(r))`
 * es una llamada barata por candidato. Se rellenan los potes que falten y se
 * SIEMBRA la caché de consejos, con lo que el escaneo de eventos suele poder
 * ni arrancar. Sin BD (local, tests) no hay candidatos y no pasa nada.
 */
async function fillCouncilsFromKnownRoots(rpc: string, cageFactory: string, potes: PoteSummary[]): Promise<void> {
  const missing = potes.filter((p) => p.cage && !p.councilXrplAddress);
  if (missing.length === 0) return;
  const candidates = new Set<string>();
  try {
    const { prisma } = await import('../../database/prismaClient');
    const rows = await prisma.managerPublicProfile.findMany({ select: { account: true }, take: 500 });
    for (const r of rows) if (XRPL_ADDRESS_RE.test(r.account)) candidates.add(r.account);
  } catch {
    /* sin BD, sin perfiles */
  }
  try {
    const { kvList } = await import('../persistence/backgroundJobKv');
    const { DEMO_RUN_JOB_TYPE } = await import('../demoExchange/DemoExchangeStore');
    for (const run of await kvList(DEMO_RUN_JOB_TYPE, 200)) {
      const c = run.councilAddress;
      if (typeof c === 'string' && XRPL_ADDRESS_RE.test(c)) candidates.add(c);
    }
  } catch {
    /* sin runs */
  }
  if (candidates.size === 0) return;
  try {
    const factory = new ethers.Contract(cageFactory, CAGE_OF_ABI, flareReadProvider(rpc));
    const list = [...candidates];
    const cages = await Promise.all(list.map((r) => (factory.cageOf(ethers.keccak256(ethers.toUtf8Bytes(r))) as Promise<string>).catch(() => ethers.ZeroAddress)));
    const byCage = new Map<string, string>();
    cages.forEach((cage, i) => { if (cage && cage !== ethers.ZeroAddress) byCage.set(cage.toLowerCase(), list[i]); });
    if (byCage.size === 0) return;
    seedCageCouncils(cageFactory, [...byCage.entries()]);
    for (const p of missing) {
      const council = byCage.get(String(p.cage).toLowerCase());
      if (council) p.councilXrplAddress = council;
    }
  } catch {
    /* la factory no contestó: los nombres llegarán por el escaneo */
  }
}

let warmTimer: ReturnType<typeof setInterval> | null = null;

/** Una pasada del calentador: lee (o recalienta) el catálogo y lo anota. */
export async function warmPoteCatalog(reason: string): Promise<void> {
  const cfg = catalogConfig();
  if (!cfg.factoryAddress && !cfg.cageFactory) return;
  const t0 = Date.now();
  try {
    const potes = await readFullPoteCatalog();
    const unresolved = potes.filter((p) => !p.councilXrplAddress).length;
    console.log(`[catalog-warm] ${reason}: ${potes.length} potes en ${Date.now() - t0} ms (rpc ${cfg.catalogRpc})${unresolved ? ` · ${unresolved} sin consejo aún (escaneo por detrás)` : ''}`);
  } catch (e) {
    console.error(`[catalog-warm] ${reason}: falló tras ${Date.now() - t0} ms — ${(e as Error).message}`);
  }
}

/** Arranque: una lectura en segundo plano a los pocos segundos y otra cada 20
 *  minutos. Idempotente. Se salta en tests (jest). */
export function startPoteCatalogWarmup(): void {
  if (warmTimer || process.env.JEST_WORKER_ID) return;
  setTimeout(() => void warmPoteCatalog('boot'), 4_000);
  warmTimer = setInterval(() => void warmPoteCatalog('tick'), WARM_EVERY_MS);
  if (typeof warmTimer.unref === 'function') warmTimer.unref();
}
