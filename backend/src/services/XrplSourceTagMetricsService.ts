/**
 * XrplSourceTagMetricsService — el panel de métricas del SourceTag de Make
 * Waves (entregable §8 del T&C; plan del mes §2.5, construido 2026-08-16).
 *
 * Cuenta lo que el tag 2607090002 atribuye al proyecto, LEÍDO del ledger:
 *   · Active Users — la definición literal del T&C §6: «an XRPL address that
 *     has signed at least 1 transaction carrying your Source Tag». En una tx
 *     multisig los firmantes son los MIEMBROS (tx.Signers[]); en single-sig,
 *     la propia Account.
 *   · nº de transacciones con el tag (tesSUCCESS y validadas — nunca se
 *     cuenta un intento).
 *   · volumen XRP de los Payments con el tag (meta.delivered_amount cuando
 *     existe — lo ENTREGADO, no lo pedido; los Payments de IOUs cuentan como
 *     tx pero no suman volumen XRP).
 *
 * CÓMO se lee: XRPL no indexa por SourceTag, así que se pagina `account_tx`
 * de las cuentas que el sistema CONOCE (User.xrplAddress, wallets XRPL,
 * governed accounts, cuentas de consejo y firmantes de propuestas) y se
 * filtra por el tag. Honestidad del método:
 *   · dedupe por HASH — un Payment entre dos cuentas conocidas aparece en el
 *     account_tx de AMBAS; sin dedupe contaría doble.
 *   · las cuentas OPERATIVAS de Astryum (keeper de escrows, anchor de
 *     órdenes) se EXCLUYEN de firmantes y volumen: el carve-out del tag
 *     (xrplSourceTag.ts §7) dice que jamás lo llevan, y si apareciera sería
 *     un bug, no tracción.
 *   · páginas acotadas por cuenta: si el histórico no se alcanza entero, el
 *     snapshot lo dice (`truncated`) — un número parcial que se declara
 *     parcial, jamás un total fingido.
 *
 * Patrón Sentinel: snapshot en memoria + runPass() con guard de reentrada +
 * intervalo con .unref() + markAgentTick SIEMPRE (un agregador que solo late
 * cuando acierta es indistinguible de uno muerto). Solo LECTURAS: nada aquí
 * firma, escribe on-chain ni toca capital (invariantes #1/#8).
 */

import { prisma } from '../database/prismaClient';
import { getXrplSourceTag } from '../config/xrplSourceTag';
import { xrplJsonRpc } from './flare/DirectMintExecutorService';
import { markAgentTick } from './ops/agentHeartbeats';

const XRPL_CLASSIC_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
const RIPPLE_EPOCH_S = 946_684_800;

export interface SourceTagMetricsSnapshot {
  /** El tag que se cuenta (null = XRPL_SOURCE_TAG sin configurar — sin tag no
   *  hay atribución posible y los ceros significan «no se puede contar»). */
  tag: number | null;
  activeUsers: number;
  txCount: number;
  volumeXrp: number;
  /** Cuentas conocidas barridas en la última pasada. */
  accountsScanned: number;
  /** true = alguna cuenta agotó el tope de páginas con marker vivo — el
   *  histórico no se alcanzó entero y los totales son un SUELO, no un techo. */
  truncated: boolean;
  /** ISO de la tx con tag más antigua vista (suelo del histórico alcanzado). */
  oldestSeenISO: string | null;
  passes: number;
  lastPassAt: string | null;
  lastPassMs: number | null;
  error: string | null;
}

interface TaggedTxFacts {
  signers: string[];
  drops: bigint;
  dateISO: string | null;
}

/** Una entrada de account_tx, en las dos variantes de api_version. */
export interface AccountTxEntry {
  hash?: string;
  validated?: boolean;
  meta?: { TransactionResult?: string; delivered_amount?: unknown };
  metaData?: { TransactionResult?: string; delivered_amount?: unknown };
  tx_json?: Record<string, unknown>;
  tx?: Record<string, unknown>;
}

/**
 * El reducer puro de la pasada: entradas de account_tx → hechos por hash.
 * Aparte para que la regla de conteo sea testeable sin red. Muta y devuelve
 * `byHash` (el acumulador global de la pasada — el dedupe ES el mapa).
 */
export function reduceTaggedEntries(
  entries: AccountTxEntry[],
  tag: number,
  excluded: Set<string>,
  byHash: Map<string, TaggedTxFacts> = new Map(),
): Map<string, TaggedTxFacts> {
  for (const entry of entries) {
    const tx = entry.tx_json ?? entry.tx;
    if (!tx) continue;
    if (entry.validated === false) continue; // nunca contar lo no validado
    const meta = entry.meta ?? entry.metaData;
    if (meta?.TransactionResult !== 'tesSUCCESS') continue;
    if ((tx.SourceTag as number | undefined) !== tag) continue;
    const hash = String(entry.hash ?? tx.hash ?? '');
    if (!hash || byHash.has(hash)) continue; // dedupe entre cuentas

    // ¿Quién FIRMÓ? Multisig: los miembros listados en Signers[]. Single-sig:
    // la Account. Las cuentas operativas de Astryum quedan fuera — su firma
    // es nuestra, no tracción de usuario (carve-out §7).
    const signerRows = tx.Signers as Array<{ Signer?: { Account?: string } }> | undefined;
    const signers = (
      Array.isArray(signerRows) && signerRows.length > 0
        ? signerRows.map((s) => String(s.Signer?.Account ?? ''))
        : [String(tx.Account ?? '')]
    ).filter((a) => XRPL_CLASSIC_RE.test(a) && !excluded.has(a));
    if (signers.length === 0) continue; // solo firmas operativas ⇒ no cuenta

    // Volumen: SOLO Payments en XRP nativo, y lo ENTREGADO (delivered_amount)
    // antes que lo pedido — un Payment parcial o convertido mentiría.
    let drops = 0n;
    if (tx.TransactionType === 'Payment') {
      const delivered = meta?.delivered_amount;
      const raw = typeof delivered === 'string' ? delivered : typeof tx.Amount === 'string' ? tx.Amount : null;
      if (raw && /^\d+$/.test(raw)) drops = BigInt(raw);
    }
    const dateS = tx.date as number | undefined;
    byHash.set(hash, {
      signers,
      drops,
      dateISO: typeof dateS === 'number' ? new Date((dateS + RIPPLE_EPOCH_S) * 1000).toISOString() : null,
    });
  }
  return byHash;
}

/** Las cuentas que el sistema conoce — las 5 fuentes, deduplicadas. */
async function knownXrplAccounts(): Promise<string[]> {
  const out = new Set<string>();
  const add = (a: unknown) => {
    const s = String(a ?? '');
    if (XRPL_CLASSIC_RE.test(s)) out.add(s);
  };
  const [users, wallets, governed, proposals, signatures] = await Promise.all([
    prisma.user.findMany({ where: { xrplAddress: { not: null } }, select: { xrplAddress: true } }),
    prisma.wallet.findMany({ where: { ecosystem: 'xrpl' }, select: { address: true } }),
    prisma.governedAccount.findMany({ where: { removedAt: null }, select: { address: true } }),
    prisma.councilProposal.findMany({ select: { account: true }, distinct: ['account'] }),
    prisma.councilProposalSignature.findMany({ select: { signerAccount: true }, distinct: ['signerAccount'] }),
  ]);
  for (const u of users) add(u.xrplAddress);
  for (const w of wallets) add(w.address);
  for (const g of governed) add(g.address);
  for (const p of proposals) add(p.account);
  for (const s of signatures) add(s.signerAccount);
  return [...out];
}

/** Las cuentas OPERATIVAS de Astryum (firmamos nosotros — jamás tracción). */
async function operationalAccounts(): Promise<Set<string>> {
  const out = new Set<string>();
  const anchor = String(process.env.LEGACY_ORDER_ANCHOR ?? '');
  if (XRPL_CLASSIC_RE.test(anchor)) out.add(anchor);
  const seed = process.env.XRPL_KEEPER_SEED;
  if (seed) {
    try {
      const { xrplWalletFromSecret } = await import('../utils/xrplSecret');
      out.add(xrplWalletFromSecret(seed).classicAddress);
    } catch {
      /* seed ilegible — el keeper tampoco arrancaría con ella */
    }
  }
  return out;
}

const MAX_PAGES_PER_ACCOUNT = 3; // 3×200 txs por cuenta y pasada — un suelo declarado

export class XrplSourceTagMetricsService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private passing = false;
  private snap: SourceTagMetricsSnapshot = {
    tag: null,
    activeUsers: 0,
    txCount: 0,
    volumeXrp: 0,
    accountsScanned: 0,
    truncated: false,
    oldestSeenISO: null,
    passes: 0,
    lastPassAt: null,
    lastPassMs: null,
    error: null,
  };

  snapshot(): SourceTagMetricsSnapshot {
    return { ...this.snap };
  }

  private intervalMs(): number {
    const min = Number(process.env.SOURCETAG_METRICS_INTERVAL_MIN ?? 30);
    return (Number.isFinite(min) && min >= 5 ? min : 30) * 60_000;
  }

  start(): void {
    if (this.timer || process.env.SOURCETAG_METRICS_DISABLED === 'true') return;
    // 60 s de gracia al arrancar: la primera pasada no compite con el boot.
    this.bootTimer = setTimeout(() => void this.runPass(), 60_000);
    this.bootTimer.unref?.();
    this.timer = setInterval(() => void this.runPass(), this.intervalMs());
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.bootTimer) clearTimeout(this.bootTimer);
    this.timer = null;
    this.bootTimer = null;
  }

  async runPass(): Promise<SourceTagMetricsSnapshot> {
    if (this.passing) return this.snapshot();
    this.passing = true;
    const started = Date.now();
    const tag = getXrplSourceTag() ?? null;
    try {
      if (tag === null) {
        // Sin tag no hay atribución que contar — y decirlo es el dato.
        this.snap = {
          ...this.snap,
          tag: null,
          passes: this.snap.passes + 1,
          lastPassAt: new Date().toISOString(),
          lastPassMs: Date.now() - started,
          error: 'XRPL_SOURCE_TAG sin configurar — las txs salen sin tag y no se pueden atribuir',
        };
        return this.snapshot();
      }
      const [accounts, excluded] = await Promise.all([knownXrplAccounts(), operationalAccounts()]);
      const byHash = new Map<string, TaggedTxFacts>();
      let truncated = false;
      for (const account of accounts) {
        if (excluded.has(account)) continue;
        let marker: unknown;
        for (let page = 0; page < MAX_PAGES_PER_ACCOUNT; page++) {
          const params: Record<string, unknown> = {
            account,
            ledger_index_min: -1,
            ledger_index_max: -1,
            limit: 200,
            forward: false,
          };
          if (marker !== undefined) params.marker = marker;
          let result: Record<string, unknown>;
          try {
            result = (await xrplJsonRpc('account_tx', params, undefined, { requireFresh: true })) as unknown as Record<string, unknown>;
          } catch {
            break; // esta cuenta no se pudo leer entera — la pasada sigue
          }
          reduceTaggedEntries((result.transactions as AccountTxEntry[]) ?? [], tag, excluded, byHash);
          marker = result.marker;
          if (!marker) break;
          if (page === MAX_PAGES_PER_ACCOUNT - 1) truncated = true;
        }
      }
      const signers = new Set<string>();
      let drops = 0n;
      let oldest: string | null = null;
      for (const f of byHash.values()) {
        for (const s of f.signers) signers.add(s);
        drops += f.drops;
        if (f.dateISO && (oldest === null || f.dateISO < oldest)) oldest = f.dateISO;
      }
      this.snap = {
        tag,
        activeUsers: signers.size,
        txCount: byHash.size,
        volumeXrp: Number(drops) / 1_000_000,
        accountsScanned: accounts.length,
        truncated,
        oldestSeenISO: oldest,
        passes: this.snap.passes + 1,
        lastPassAt: new Date().toISOString(),
        lastPassMs: Date.now() - started,
        error: null,
      };
      return this.snapshot();
    } catch (e) {
      this.snap = {
        ...this.snap,
        passes: this.snap.passes + 1,
        lastPassAt: new Date().toISOString(),
        lastPassMs: Date.now() - started,
        error: (e as Error).message,
      };
      return this.snapshot();
    } finally {
      this.passing = false;
      markAgentTick('sourcetag-metrics', {
        title: 'Métricas SourceTag (Make Waves)',
        everyMs: this.intervalMs(),
        ok: this.snap.error === null,
        ...(this.snap.error ? { detail: this.snap.error } : {}),
      });
    }
  }
}

let instance: XrplSourceTagMetricsService | null = null;
export function getSourceTagMetrics(): XrplSourceTagMetricsService {
  if (!instance) instance = new XrplSourceTagMetricsService();
  return instance;
}
