/**
 * XrplEscrowKeeper — el keeper de escrows propio (Ola 3 de la economía
 * agéntica; gate fundador §8.3 resuelto con la vía (a) de Legacy 2026-07-13).
 *
 * Taxonomía: EJECUTOR puro. EscrowFinish y EscrowCancel son PERMISSIONLESS en
 * XRPL — cualquiera puede enviarlos cuando el tiempo lo permite, y el ledger
 * decide a dónde va el XRP (Finish → SIEMPRE al Destination del escrow;
 * Cancel → SIEMPRE al Owner que lo creó). El keeper no puede desviar un drop:
 * dispara lo que cualquier tercero podría disparar, con SU PROPIA cuenta y su
 * propia fee (economía B — jamás capital de usuario).
 *
 * ── Frontera MiCA (leer antes de tocar) ──────────────────────────────────────
 * Este servicio FIRMA y TRANSMITE transacciones XRPL — las SUYAS. La seed de
 * XRPL_KEEPER_SEED es una cuenta operativa de Astryum (como la clave de gas
 * del executor 0xFE en Flare), JAMÁS una clave de usuario (invariante #1
 * intacto). No es "execution of orders on behalf of clients": no hay orden de
 * cliente — hay una operación permissionless cuyo resultado fija el ledger,
 * idéntico lo envíe Astryum, xrpl.services o un desconocido. La frontera
 * "Astryum never broadcasts" de MICA_BOUNDARIES §2.2 se refiere a TRANSACCIONES
 * DE USUARIO (las que mueven capital bajo autorización del usuario) y sigue
 * intacta: este módulo no toca XRPLProvider (que sigue lanzando
 * BROADCAST_FORBIDDEN) ni ningún carril prepare-only. Ver MICA_BOUNDARIES.md
 * §2 (nota del keeper) — actualizado en el mismo cambio que este archivo.
 *
 * ── Política determinista (cero discreción, reglas del ledger) ──────────────
 *   FinishAfter ≤ now < CancelAfter  y sin Condition → EscrowFinish
 *   now ≥ CancelAfter                                → EscrowCancel
 *   Condition presente                               → solo Cancel al expirar
 *     (el preimage lo custodia el consejo FUERA de Astryum — el backend no
 *     puede ni debe finalizar escrows condicionados)
 * El propio ledger hace de árbitro: Finish pasado CancelAfter y Cancel antes
 * de CancelAfter fallan con tecNO_PERMISSION.
 *
 * Config:
 *   XRPL_KEEPER_ENABLED=true         — flag (#10: nada sin flag)
 *   XRPL_KEEPER_SEED=s…              — cuenta PROPIA del keeper (paga sus fees)
 *   XRPL_KEEPER_ACCOUNTS=rA,rB       — cuentas cuyos escrows vigila
 *   XRPL_KEEPER_INTERVAL_MIN=60      — cadencia del tick
 *
 * Cada tx lleva el SourceTag de Make Waves (los builders lo estampan) → cada
 * finish/cancel del keeper cuenta para el leaderboard.
 */

import { rippleTimeToISOTime } from 'xrpl';
import {
  buildEscrowCancel,
  buildEscrowFinish,
} from '../connectors/protocols/xrpl/XrplEscrowService';
import { xrplProvider } from '../integrations/providers/chain/XRPLProvider';
import { opsAlert } from './OpsAlertService';

const SOURCE = 'xrpl-escrow-keeper';

/** tec codes that mean "ya no procede" — otro lo hizo o aún no toca. No son fallos. */
const BENIGN_TEC = new Set(['tecNO_TARGET', 'tecNO_PERMISSION', 'tecNO_ENTRY']);

export interface KeeperEscrow {
  owner: string;
  previousTxnID: string;
  finishAfter?: number; // ripple time
  cancelAfter?: number; // ripple time
  hasCondition: boolean;
}

export type KeeperAction = 'finish' | 'cancel' | null;

/**
 * La política, pura y testeable. `nowMs` en epoch ms; los tiempos del escrow
 * en ripple time (el offset lo resuelve rippleTimeToISOTime).
 */
export function decideEscrowAction(escrow: KeeperEscrow, nowMs: number): KeeperAction {
  const finishAtMs =
    escrow.finishAfter !== undefined ? Date.parse(rippleTimeToISOTime(escrow.finishAfter)) : undefined;
  const cancelAtMs =
    escrow.cancelAfter !== undefined ? Date.parse(rippleTimeToISOTime(escrow.cancelAfter)) : undefined;

  if (cancelAtMs !== undefined && nowMs >= cancelAtMs) return 'cancel';
  if (escrow.hasCondition) return null; // el preimage no vive aquí — solo cancel al expirar
  if (finishAtMs !== undefined && nowMs >= finishAtMs) return 'finish';
  return null;
}

function parseAccounts(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(s));
}

export class XrplEscrowKeeper {
  private timer: NodeJS.Timeout | null = null;
  private bootTimer: NodeJS.Timeout | null = null;
  /** Escrows ya resueltos (o descartados como benignos) en este proceso. */
  private done = new Set<string>();
  private lastRunAt: Date | null = null;
  private submitted: Array<{ action: string; owner: string; txHash: string; at: string }> = [];

  start(): void {
    if (this.timer) return;
    if (process.env.XRPL_KEEPER_ENABLED !== 'true') {
      console.log('[xrpl-escrow-keeper] apagado (XRPL_KEEPER_ENABLED != true)');
      return;
    }
    if (!process.env.XRPL_KEEPER_SEED) {
      console.error('[xrpl-escrow-keeper] XRPL_KEEPER_ENABLED=true pero falta XRPL_KEEPER_SEED — no arranca');
      return;
    }
    if (parseAccounts(process.env.XRPL_KEEPER_ACCOUNTS).length === 0) {
      console.error('[xrpl-escrow-keeper] sin XRPL_KEEPER_ACCOUNTS válidas — no arranca');
      return;
    }
    const minutes = Math.max(Number(process.env.XRPL_KEEPER_INTERVAL_MIN || 60), 5);
    this.bootTimer = setTimeout(() => void this.tick(), 45_000); // no compite con el boot
    if (typeof this.bootTimer.unref === 'function') this.bootTimer.unref();
    this.timer = setInterval(() => void this.tick(), minutes * 60_000);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    console.log(`[xrpl-escrow-keeper] keeper permissionless en marcha — tick cada ${minutes}min`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.bootTimer) clearTimeout(this.bootTimer);
    this.timer = null;
    this.bootTimer = null;
  }

  async tick(): Promise<void> {
    this.lastRunAt = new Date();
    const accounts = parseAccounts(process.env.XRPL_KEEPER_ACCOUNTS);
    for (const account of accounts) {
      try {
        await this.sweepAccount(account);
      } catch (e) {
        console.error(`[xrpl-escrow-keeper] sweep de ${account} falló: ${(e as Error).message}`);
      }
    }
  }

  private async sweepAccount(account: string): Promise<void> {
    const positions = await xrplProvider.getDeFiPositions(account);
    const now = Date.now();
    for (const p of positions) {
      if (p.type !== 'escrow') continue;
      const d = p.details as {
        owner?: string;
        previousTxnID?: string;
        finishAfter?: number;
        cancelAfter?: number;
        hasCondition?: boolean;
      };
      if (!d.owner || !d.previousTxnID || this.done.has(d.previousTxnID)) continue;
      const escrow: KeeperEscrow = {
        owner: d.owner,
        previousTxnID: d.previousTxnID,
        finishAfter: d.finishAfter,
        cancelAfter: d.cancelAfter,
        hasCondition: d.hasCondition === true,
      };
      const action = decideEscrowAction(escrow, now);
      if (!action) continue;
      await this.execute(action, escrow);
    }
  }

  /** Firma con la cuenta PROPIA del keeper y transmite. Nunca claves de usuario. */
  private async execute(action: 'finish' | 'cancel', escrow: KeeperEscrow): Promise<void> {
    const seed = process.env.XRPL_KEEPER_SEED;
    if (!seed) return; // start() ya lo exige; guard por si el env cambió en caliente

    const offerSequence = await xrplProvider.getEscrowCreateSequence(escrow.previousTxnID);
    if (offerSequence === null) {
      this.done.add(escrow.previousTxnID); // sin secuencia no hay tx que componer
      return;
    }

    const { Client, Wallet } = await import('xrpl');
    const wallet = Wallet.fromSeed(seed);
    const build = action === 'finish' ? buildEscrowFinish : buildEscrowCancel;
    const { xrplTx } = build({ account: wallet.classicAddress, owner: escrow.owner, offerSequence });

    const client = new Client(process.env.XRPL_WS_URL || 'wss://xrplcluster.com', {
      connectionTimeout: 10_000,
    });
    try {
      await client.connect();
      const prepared = await client.autofill(xrplTx as never);
      const signed = wallet.sign(prepared);
      const res = await client.submitAndWait(signed.tx_blob);
      const result = (res.result.meta as { TransactionResult?: string })?.TransactionResult ?? '?';
      if (result === 'tesSUCCESS') {
        this.done.add(escrow.previousTxnID);
        this.submitted.push({
          action,
          owner: escrow.owner,
          txHash: res.result.hash,
          at: new Date().toISOString(),
        });
        await opsAlert(
          SOURCE,
          'info',
          `Escrow${action === 'finish' ? ' liberado (Finish → Destination)' : ' cancelado (Cancel → Owner)'} de ${escrow.owner} — tx ${res.result.hash}`,
        );
      } else if (BENIGN_TEC.has(result)) {
        // Otro keeper llegó antes o la ventana aún no abre en el reloj del
        // ledger — permissionless significa exactamente esto. No es un fallo.
        this.done.add(escrow.previousTxnID);
        console.log(`[xrpl-escrow-keeper] ${action} de ${escrow.previousTxnID} → ${result} (benigno, se descarta)`);
      } else {
        await opsAlert(
          SOURCE,
          'warn',
          `${action} del escrow ${escrow.previousTxnID} devolvió ${result} — revisar (se reintenta en el próximo tick)`,
        );
      }
    } finally {
      await client.disconnect().catch(() => undefined);
    }
  }

  status(): {
    lastRunAt: string | null;
    resolvedCount: number;
    submitted: Array<{ action: string; owner: string; txHash: string; at: string }>;
  } {
    return {
      lastRunAt: this.lastRunAt?.toISOString() ?? null,
      resolvedCount: this.done.size,
      submitted: [...this.submitted],
    };
  }
}

export const xrplEscrowKeeper = new XrplEscrowKeeper();
