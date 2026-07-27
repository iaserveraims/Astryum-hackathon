/**
 * XrplWatchScheduler — el vigía XRPL agentizado (Ola 1 del mapa de economía
 * agéntica, "proceder sin decisión": era `npx ts-node src/scripts/xrpl-watch.ts`
 * a mano al abrir sesión; ahora es un tick diario del backend).
 *
 * Vigía puro (taxonomía §1 de la doctrina): read-only por diseño, cero firmas,
 * cero capital. Observa y empuja por el canal común (OpsAlertService) cuando
 * un gate se DESBLOQUEA:
 *  - un amendment vigilado se activa (o su votación alcanza el threshold),
 *  - un emisor gated (RLUSD/EURØP) enciende lsfAllowTrustLineLocking,
 *  - el XRPL EVM Sidechain estrena un venue real (lending/yield),
 *  - FAssets estrena un asset manager ≠ FXRP (¿FBTC? — doc Legacy §6.3),
 * y una sola vez por hallazgo (por proceso), no cada tick.
 *
 * PMW/FCC queda fuera A PROPÓSITO: sin API pública, chequeo manual mensual
 * (doc Legacy §6.4 — no automatizar contra HTML frágil).
 */

import {
  runXrplEcosystemWatch,
  formatWatchReport,
  type XrplWatchResult,
} from '../connectors/protocols/xrpl/XrplEcosystemWatch';
import { opsAlert } from './OpsAlertService';

const SOURCE = 'xrpl-watch';

/* ── FBTC / FAssets — chequeo on-chain en Flare (doc Legacy §6.3) ─────────── */

const FLARE_RPC_DEFAULT = 'https://flare-api.flare.network/ext/C/rpc';
// FlareContractRegistry — dirección fija de mainnet (la misma del executor).
const FLARE_REGISTRY = '0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019';

export interface FAssetManagerInfo {
  manager: string;
  symbol: string;
}

/** Lista los asset managers de FAssets y el símbolo de su fAsset. Un símbolo
 *  ≠ FXRP = un asset nuevo entró al sistema (p.ej. FBTC, roadmap 2026). */
export async function fetchFAssetsManagers(rpcUrl?: string): Promise<FAssetManagerInfo[]> {
  const { ethers } = await import('ethers');
  const provider = new ethers.JsonRpcProvider(rpcUrl || process.env.FLARE_RPC_URL || FLARE_RPC_DEFAULT);
  const registry = new ethers.Contract(
    FLARE_REGISTRY,
    ['function getContractAddressByName(string) view returns (address)'],
    provider,
  );
  const controllerAddr: string = await registry.getContractAddressByName('AssetManagerController');
  if (!controllerAddr || controllerAddr === ethers.ZeroAddress) {
    throw new Error('AssetManagerController no está en el FlareContractRegistry');
  }
  const controller = new ethers.Contract(
    controllerAddr,
    ['function getAssetManagers() view returns (address[])'],
    provider,
  );
  const managers: string[] = await controller.getAssetManagers();
  return Promise.all(
    managers.map(async (manager) => {
      try {
        const am = new ethers.Contract(manager, ['function fAsset() view returns (address)'], provider);
        const fAssetAddr: string = await am.fAsset();
        const fAsset = new ethers.Contract(fAssetAddr, ['function symbol() view returns (string)'], provider);
        return { manager, symbol: (await fAsset.symbol()) as string };
      } catch {
        return { manager, symbol: '?' };
      }
    }),
  );
}

/* ── Detección de desbloqueos (pura, testeable) ───────────────────────────── */

export interface UnlockEvent {
  /** Clave estable para de-duplicar ("una alerta por hallazgo"). */
  key: string;
  message: string;
}

export function detectUnlockEvents(
  result: XrplWatchResult,
  fassets?: FAssetManagerInfo[],
): UnlockEvent[] {
  const events: UnlockEvent[] = [];
  for (const a of result.amendments) {
    if (a.enabled) {
      events.push({
        key: `amendment:${a.name}:enabled`,
        message: `amendment ${a.name} ACTIVADO en mainnet — la fase aparcada se desbloquea; re-planificar antes de construir`,
      });
    } else if (a.count !== undefined && a.threshold !== undefined && a.count >= a.threshold) {
      events.push({
        key: `amendment:${a.name}:majority`,
        message: `amendment ${a.name} alcanzó el threshold (${a.count}/${a.validations ?? '?'}) — cuenta atrás de activación en marcha`,
      });
    }
  }
  for (const esc of result.issuerEscrows) {
    if (esc.trustLineLockingEnabled) {
      events.push({
        key: `issuer:${esc.label}`,
        message: `${esc.label} encendió lsfAllowTrustLineLocking — ya es escrowable; re-planificar el flujo de ahorro`,
      });
    }
  }
  if (result.sidechain.hasRealVenue) {
    const names = result.sidechain.venues.map((v) => `${v.name} [${v.category}]`).join(', ');
    events.push({
      key: 'sidechain-venue',
      message: `el XRPL EVM Sidechain tiene venue real: ${names} — el flujo apalancado puede desbloquearse, verificar a mano`,
    });
  }
  for (const f of fassets ?? []) {
    if (f.symbol !== 'FXRP') {
      events.push({
        key: `fassets:${f.symbol}:${f.manager.toLowerCase()}`,
        message: `FAssets tiene un asset manager nuevo ≠ FXRP: ${f.symbol} (${f.manager}) — ¿FBTC? Revisar doc Legacy §6.3`,
      });
    }
  }
  return events;
}

/* ── El scheduler ─────────────────────────────────────────────────────────── */

export class XrplWatchScheduler {
  private timer: NodeJS.Timeout | null = null;
  private alerted = new Set<string>();
  private lastResult: XrplWatchResult | null = null;
  private lastRunAt: Date | null = null;

  start(): void {
    if (this.timer) return;
    if (process.env.XRPL_WATCH_DISABLED === 'true') {
      console.log('[xrpl-watch] deshabilitado por XRPL_WATCH_DISABLED');
      return;
    }
    const hours = Math.max(Number(process.env.XRPL_WATCH_INTERVAL_H || 24), 1);
    // Primera pasada a los 30s del arranque (no compite con el boot); luego diaria.
    setTimeout(() => void this.tick(), 30_000);
    this.timer = setInterval(() => void this.tick(), hours * 3_600_000);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    console.log(`[xrpl-watch] vigía agentizado — pasada cada ${hours}h`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    try {
      const result = await runXrplEcosystemWatch();
      this.lastResult = result;
      this.lastRunAt = new Date();
      console.log(formatWatchReport(result));

      let fassets: FAssetManagerInfo[] | undefined;
      try {
        fassets = await fetchFAssetsManagers();
      } catch (e) {
        console.error(`[xrpl-watch] chequeo FAssets/FBTC falló (se reintenta en la próxima pasada): ${(e as Error).message}`);
      }

      for (const ev of detectUnlockEvents(result, fassets)) {
        if (this.alerted.has(ev.key)) continue;
        this.alerted.add(ev.key);
        await opsAlert(SOURCE, 'warn', ev.message);
      }
      if (result.errors.length > 0) {
        console.error(`[xrpl-watch] secciones caídas (no tratar como verde): ${result.errors.join(' · ')}`);
      }
    } catch (e) {
      console.error(`[xrpl-watch] pasada fallida: ${(e as Error).message}`);
    }
  }

  status(): { lastRunAt: string | null; lastResult: XrplWatchResult | null; alerted: string[] } {
    return {
      lastRunAt: this.lastRunAt?.toISOString() ?? null,
      lastResult: this.lastResult,
      alerted: [...this.alerted],
    };
  }
}

export const xrplWatchScheduler = new XrplWatchScheduler();
