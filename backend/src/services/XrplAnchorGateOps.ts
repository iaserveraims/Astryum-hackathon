/**
 * XrplAnchorGateOps — la puerta del ancla en VIVO: leerla y armarla.
 *
 * `XrplAnchorGateService` es puro (compone y decide sin red). Este módulo es el
 * que toca el ledger:
 */

import type { Client, Wallet } from 'xrpl';
import { xrplProvider } from '../integrations/providers/chain/XRPLProvider';
import {
  type AnchorGateArmPlan,
  type AnchorGateState,
  type GateSet,
  AnchorGateError,
  composeAuthorizeCredentials,
  composeEnableDepositAuth,
  expandGateSets,
  gateDrift,
  hexToTypeLabel,
  parseDepositPreauthObjects,
  planAnchorGateArm,
} from './XrplAnchorGateService';
import { managerGateConfig } from './ManagerCredentialGate';
import { withSourceTag } from '../config/xrplSourceTag';

/** `lsfDepositAuth` en el AccountRoot (xrpl.org, AccountRoot flags). */
export const LSF_DEPOSIT_AUTH = 0x01000000;
/** `asfDepositAuth` como ClearFlag: el mismo número que como SetFlag. */
const ASF_DEPOSIT_AUTH_CLEAR = 9;

export interface AnchorGateLiveState extends AnchorGateState {
  balanceXrp: number;
  ledgerReserveXrp: number;
  ownerCount: number;
  baseReserveXrp: number;
  ownerReserveXrp: number;
  readAtISO: string;
}

/**
 * Solo la PUERTA (flag + objetos), sin saldo ni reserva: lo que la orden del
 * gestor necesita para elegir sus `CredentialIDs` — dos lecturas, no cuatro.
 * Lanza si no se puede leer: «no pude leer» no es «no hay puerta».
 */
export async function readAnchorGateDoor(anchor: string): Promise<AnchorGateState> {
  const [flags, objects] = await Promise.all([xrplProvider.getAccountFlags(anchor), xrplProvider.getDepositPreauthObjects(anchor)]);
  const parsed = parseDepositPreauthObjects(objects);
  return { anchor, depositAuth: (flags & LSF_DEPOSIT_AUTH) !== 0, credentialSets: parsed.credentialSets, accounts: parsed.accounts };
}

/** La puerta Y el saldo/reserva (para el panel y el plan de armado). Lanza si no se puede leer. */
export async function readAnchorGateState(anchor: string): Promise<AnchorGateLiveState> {
  const [flags, objects, balance] = await Promise.all([
    xrplProvider.getAccountFlags(anchor),
    xrplProvider.getDepositPreauthObjects(anchor),
    xrplProvider.getSpendableBalance(anchor),
  ]);
  const parsed = parseDepositPreauthObjects(objects);
  const ownerReserveXrp = balance.nextObjectReserveXrp;
  const baseReserveXrp = balance.reserveXrp - balance.ownerCount * ownerReserveXrp;
  return {
    anchor,
    depositAuth: (flags & LSF_DEPOSIT_AUTH) !== 0,
    credentialSets: parsed.credentialSets,
    accounts: parsed.accounts,
    balanceXrp: balance.balanceXrp,
    ledgerReserveXrp: balance.reserveXrp,
    ownerCount: balance.ownerCount,
    baseReserveXrp: Number(baseReserveXrp.toFixed(6)),
    ownerReserveXrp,
    readAtISO: new Date().toISOString(),
  };
}

/** Los conjuntos que la config de la puerta del gestor exige — lo que el ancla tiene que publicar. */
export function configuredGateSets(): GateSet[] {
  const cfg = managerGateConfig();
  return expandGateSets(cfg.credentialTypes, cfg.issuers);
}

export interface AnchorGateConfig {
  anchor: string;
  seed: string;
}

/** El ancla v2 y su clave, o una negativa tipada que dice qué falta. Nunca cae al ancla del Legacy. */
export function anchorGateConfig(): AnchorGateConfig {
  const anchor = (process.env.ASTRYUM_ORDER_ANCHOR ?? '').trim();
  const legacy = (process.env.LEGACY_ORDER_ANCHOR ?? '').trim();
  const seed = (process.env.ASTRYUM_ANCHOR_SEED ?? '').trim();
  if (!anchor) throw new AnchorGateError('ANCHOR_NOT_CONFIGURED', 'ASTRYUM_ORDER_ANCHOR sin definir: la puerta solo se arma en el ancla de la jaula v2');
  if (legacy && legacy === anchor) {
    throw new AnchorGateError(
      'SHARED_ANCHOR',
      'ASTRYUM_ORDER_ANCHOR y LEGACY_ORDER_ANCHOR son la misma cuenta: armarla dejaría fuera a los consejos Legacy, que no llevan título. Dale a la v2 su propia ancla.',
    );
  }
  if (!seed) throw new AnchorGateError('SEED_NOT_CONFIGURED', 'ASTRYUM_ANCHOR_SEED sin definir: sin la clave del ancla no hay nada que firmar');
  return { anchor, seed };
}

export interface AnchorGateSubmitted {
  kind: 'DepositPreauth' | 'AccountSet';
  /** Para DepositPreauth, el conjunto (legible) que autoriza. */
  label: string;
  hash: string | null;
  result: string;
}

export interface AnchorGateArmReport {
  anchor: string;
  dryRun: boolean;
  before: AnchorGateLiveState;
  configSets: GateSet[];
  plan: AnchorGateArmPlan;
  submitted: AnchorGateSubmitted[];
  /** Estado tras el plan (solo si no era dry-run y se mandó algo). */
  after: AnchorGateLiveState | null;
  /** Por qué se paró antes de acabar, si se paró. */
  stoppedBecause: string | null;
}

function setLabel(set: GateSet): string {
  return set.map((c) => `${hexToTypeLabel(c.credentialTypeHex)}@${c.issuer.slice(0, 6)}…`).join('+');
}

async function anchorWallet(cfg: AnchorGateConfig): Promise<Wallet> {
  const { xrplWalletFromSecret } = await import('../utils/xrplSecret');
  const wallet = xrplWalletFromSecret(cfg.seed, cfg.anchor);
  if (wallet.classicAddress !== cfg.anchor) {
    throw new AnchorGateError('SEED_MISMATCH', `ASTRYUM_ANCHOR_SEED abre ${wallet.classicAddress}, que no es el ancla ${cfg.anchor}`);
  }
  return wallet;
}

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const { Client } = await import('xrpl');
  const client = new Client(process.env.XRPL_WS_URL || 'wss://xrplcluster.com', { connectionTimeout: 10_000 });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.disconnect().catch(() => undefined);
  }
}

/** Firma y manda UNA tx del ancla; devuelve hash y resultado, nunca lanza por un `tec` (se reporta). */
async function signAndSubmit(client: Client, wallet: Wallet, txjson: Record<string, unknown>): Promise<{ hash: string | null; result: string }> {
  const prepared = await client.autofill(withSourceTag(txjson, 'operational') as never);
  const signed = wallet.sign(prepared);
  const res = await client.submitAndWait(signed.tx_blob);
  const result = (res.result.meta as { TransactionResult?: string } | undefined)?.TransactionResult ?? '?';
  return { hash: res.result.hash ?? null, result };
}

/**
 * Arma la puerta del ancla v2: los DepositPreauth que faltan (uno por conjunto
 * de la config) y, si no está, el AccountSet{asfDepositAuth}. Idempotente: lo
 * que ya está no se vuelve a mandar. `dryRun` devuelve el plan sin firmar nada.
 * `objectsOnly` publica los conjuntos y deja el flag apagado: la fase 1 del
 * runbook — con los conjuntos en el ledger y sin flag, las órdenes ya eligen el
 * conjunto exacto y se puede comprobar en producción antes de cerrar la puerta.
 */
export async function armAnchorGate(opts: { dryRun: boolean; objectsOnly?: boolean }): Promise<AnchorGateArmReport> {
  const cfg = anchorGateConfig();
  const configSets = configuredGateSets();
  if (configSets.length === 0) {
    throw new AnchorGateError('NO_GATE_CONFIG', 'MANAGER_CREDENTIAL_TYPE / MANAGER_CREDENTIAL_ISSUERS no definen ningún conjunto: no hay puerta que publicar');
  }
  const before = await readAnchorGateState(cfg.anchor);
  const plan = planAnchorGateArm({
    state: before,
    configSets,
    balanceXrp: before.balanceXrp,
    ownerCount: before.ownerCount,
    baseReserveXrp: before.baseReserveXrp,
    ownerReserveXrp: before.ownerReserveXrp,
  });
  if (opts.objectsOnly) {
    plan.setFlag = false;
    plan.alreadyArmed = plan.toAuthorize.length === 0;
  }
  const report: AnchorGateArmReport = {
    anchor: cfg.anchor,
    dryRun: opts.dryRun,
    before,
    configSets,
    plan,
    submitted: [],
    after: null,
    stoppedBecause: null,
  };
  if (plan.alreadyArmed) return report;
  if (plan.shortfallXrp > 0) {
    report.stoppedBecause = `al ancla le faltan ${plan.shortfallXrp} XRP para sostener la reserva de ${plan.reserveAfterXrp} XRP tras el plan`;
    return report;
  }
  if (opts.dryRun) return report;

  const wallet = await anchorWallet(cfg);
  await withClient(async (client) => {
    for (const set of plan.toAuthorize) {
      const tx = composeAuthorizeCredentials(
        cfg.anchor,
        set.map((c) => ({ issuer: c.issuer, credentialType: c.credentialTypeHex })),
      );
      const out = await signAndSubmit(client, wallet, tx);
      report.submitted.push({ kind: 'DepositPreauth', label: setLabel(set), ...out });
      if (out.result !== 'tesSUCCESS') {
        report.stoppedBecause = `DepositPreauth ${setLabel(set)} no asentó (${out.result}); la puerta NO se encendió`;
        return;
      }
    }
    if (plan.setFlag) {
      const out = await signAndSubmit(client, wallet, composeEnableDepositAuth(cfg.anchor));
      report.submitted.push({ kind: 'AccountSet', label: 'SetFlag asfDepositAuth', ...out });
      if (out.result !== 'tesSUCCESS') report.stoppedBecause = `AccountSet asfDepositAuth no asentó (${out.result})`;
    }
  });
  report.after = await readAnchorGateState(cfg.anchor);
  return report;
}

/** Apaga el flag (los objetos se quedan). El kill-switch de la puerta: una firma. */
export async function disarmAnchorGate(opts: { dryRun: boolean }): Promise<AnchorGateArmReport> {
  const cfg = anchorGateConfig();
  const configSets = configuredGateSets();
  const before = await readAnchorGateState(cfg.anchor);
  const plan: AnchorGateArmPlan = {
    toAuthorize: [],
    setFlag: false,
    reserveAfterXrp: before.ledgerReserveXrp,
    shortfallXrp: 0,
    alreadyArmed: before.depositAuth,
  };
  const report: AnchorGateArmReport = { anchor: cfg.anchor, dryRun: opts.dryRun, before, configSets, plan, submitted: [], after: null, stoppedBecause: null };
  if (!before.depositAuth || opts.dryRun) return report;
  const wallet = await anchorWallet(cfg);
  await withClient(async (client) => {
    const tx = { TransactionType: 'AccountSet', Account: cfg.anchor, ClearFlag: ASF_DEPOSIT_AUTH_CLEAR };
    const out = await signAndSubmit(client, wallet, tx);
    report.submitted.push({ kind: 'AccountSet', label: 'ClearFlag asfDepositAuth', ...out });
    if (out.result !== 'tesSUCCESS') report.stoppedBecause = `AccountSet ClearFlag no asentó (${out.result})`;
  });
  report.after = await readAnchorGateState(cfg.anchor);
  return report;
}

/** Config vs ledger para el panel: qué falta y qué sobra, sin firmar nada. */
export function anchorGateDrift(state: AnchorGateState): { missing: GateSet[]; extra: GateSet[] } {
  return gateDrift(configuredGateSets(), state.credentialSets);
}
