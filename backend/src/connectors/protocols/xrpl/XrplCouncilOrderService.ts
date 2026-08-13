/**
 * XrplCouncilOrderService — compose the UNSIGNED council order (roadmap Pieza 1).
 *
 * A council order is a 1-drop XRPL Payment whose first Memo commits
 * keccak256(orderData), where orderData = abi.encode(uint64 nonce, bytes
 * vaultCalldata). The council's QUORUM signs it through the existing multisig
 * coordinator; FDC attests the validated tx; the XrplCouncilBridge on Flare
 * verifies the proof and executes EXACTLY those bytes against the LegacyVault.
 *
 * This module is prepare-only (invariants #1/#8): it encodes bytes and reads
 * public chain state (bridge nonce, vault constitutionRef). It signs nothing,
 * submits nothing, holds no key. The 0xFE rail proved this memo-commitment
 * pattern on mainnet (FlareDirectMintService); this is the governance twin.
 */

import { ethers } from 'ethers';
import { isValidClassicAddress, validate, xrpToDrops } from 'xrpl';
import { withSourceTag } from '../../../config/xrplSourceTag';
import type { XrplTxHandoff } from './XrplTxHandoff';

// ── Network config (Coston2 demo / Flare mainnet) ───────────────────────────

export interface LegacyNetwork {
  chain: 'coston2' | 'flare';
  rpcUrl: string;
  /** FDC source id for XRPL on this network. */
  sourceId: 'testXRP' | 'XRP';
  explorerTx: string;
}

export const LEGACY_NETWORKS: Record<'coston2' | 'flare', LegacyNetwork> = {
  coston2: {
    chain: 'coston2',
    rpcUrl: process.env.COSTON2_RPC_URL || 'https://coston2-api.flare.network/ext/C/rpc',
    sourceId: 'testXRP',
    explorerTx: 'https://coston2-explorer.flare.network/tx/',
  },
  flare: {
    chain: 'flare',
    rpcUrl: process.env.FLARE_RPC_URL || 'https://flare-api.flare.network/ext/C/rpc',
    sourceId: 'XRP',
    explorerTx: 'https://flare-explorer.flare.network/tx/',
  },
};

export interface LegacyStackConfig extends LegacyNetwork {
  bridge: string;
  vault: string;
  /** XRPL account that receives the 1-drop order Payments (any account —
   *  authority comes from the SOURCE + memo, never the destination). */
  orderAnchor: string;
}

/**
 * The network and the order anchor, WITHOUT requiring a deployed stack.
 *
 * Cages are per-Legacy now (LegacyCageResolver): the network is a property of
 * the install, but which bridge/vault a council has is a property of that
 * council. This is what the resolver builds a cage on top of.
 */
export function legacyNetworkConfig(): LegacyNetwork & { orderAnchor: string } {
  // Default is MAINNET: an unset LEGACY_CHAIN in production must never silently
  // aim council orders at a testnet. Test rigs opt into coston2 explicitly.
  const chain = (process.env.LEGACY_CHAIN || 'flare') as 'coston2' | 'flare';
  const net = LEGACY_NETWORKS[chain];
  if (!net) throw new Error(`LEGACY_CHAIN must be coston2|flare, got "${chain}"`);
  const orderAnchor = process.env.LEGACY_ORDER_ANCHOR;
  if (!orderAnchor || !isValidClassicAddress(orderAnchor)) {
    throw new Error('LEGACY_ORDER_ANCHOR missing/invalid (an XRPL r-address)');
  }
  return { ...net, orderAnchor };
}

/** Resolve the deployed stack from env. Throws a readable error when unset. */
export function legacyStackConfig(): LegacyStackConfig {
  const chain = (process.env.LEGACY_CHAIN || 'flare') as 'coston2' | 'flare';
  const net = LEGACY_NETWORKS[chain];
  if (!net) throw new Error(`LEGACY_CHAIN must be coston2|flare, got "${chain}"`);
  const bridge = process.env.LEGACY_BRIDGE_ADDRESS;
  const vault = process.env.LEGACY_VAULT_ADDRESS;
  const orderAnchor = process.env.LEGACY_ORDER_ANCHOR;
  if (!bridge || !ethers.isAddress(bridge)) throw new Error('LEGACY_BRIDGE_ADDRESS missing/invalid — deploy the stack first');
  if (!vault || !ethers.isAddress(vault)) throw new Error('LEGACY_VAULT_ADDRESS missing/invalid — deploy the stack first');
  if (!orderAnchor || !isValidClassicAddress(orderAnchor)) throw new Error('LEGACY_ORDER_ANCHOR missing/invalid (an XRPL r-address)');
  return { ...net, bridge, vault, orderAnchor };
}

// ── The action catalog (the vault's council surface, v1) ────────────────────

/** Human-readable ABI of every callable the bridge may forward (LegacyVault). */
export const VAULT_COUNCIL_ABI = [
  'function directTo(uint256 venueId, uint256 amount, bytes32 ref)',
  'function recall(uint256 venueId, uint256 amount, bytes32 ref)',
  'function moveToVenue(uint256 fromId, uint256 toId, uint256 amount, bytes32 ref)',
  'function evacuate(uint256 venueId, bytes32 ref)',
  'function proposeVenue(address target, uint8 kind, bytes32 ref)',
  'function retireVenue(uint256 venueId, bytes32 ref)',
  'function setMaxVenueBps(uint16 bps, bytes32 ref)',
  'function setLinajeFeeBps(uint16 bps, bytes32 ref)',
  'function setPayees(address[] accounts, uint16[] bps, bytes32 ref)',
  'function cede(address director, uint64 until, bytes32 ref)',
  'function endCession(bytes32 ref)',
  'function setConstitutionRef(bytes32 newRef, bytes32 oldRef)',
];
const VAULT_IFACE = new ethers.Interface(VAULT_COUNCIL_ABI);

const BRIDGE_ABI = [
  'function nextNonce() view returns (uint64)',
  'function consumedTxId(bytes32) view returns (bool)',
  'function vault() view returns (address)',
];
const VAULT_READ_ABI = [
  'function constitutionRef() view returns (bytes32)',
  'function council() view returns (address)',
];

/**
 * The binding must hold in BOTH directions or the ceremony burns for nothing.
 *
 * `bridge.vault() == vault` was already checked. The converse —
 * `vault.council() == bridge` — was not, and it is the one that decides whether
 * the vault will actually OBEY. If they ever diverge (a redeployed bridge, a
 * second bridge, a `transferCouncil` whose `acceptCouncil` landed elsewhere)
 * everything upstream still succeeds: the order composes, the quorum signs, the
 * FDC round runs and is paid for (~20 FLR) — and only then does the vault revert
 * with NotCouncil(). That is the unearned-success shape exactly: a ceremony that
 * looks right until the last inch. Today the deployment is correct (verified
 * on-chain 2026-07-28); this makes sure nobody finds out the hard way if it
 * stops being.
 */
export function assertCouncilBinding(vaultCouncil: string, bridge: string): void {
  if (vaultCouncil.toLowerCase() !== bridge.toLowerCase()) {
    throw new Error(
      `the vault obeys ${vaultCouncil}, not the configured bridge ${bridge} — an order signed by the quorum ` +
        'would revert with NotCouncil() after the FDC round was already paid for. Check LEGACY_BRIDGE_ADDRESS.',
    );
  }
}

export type CouncilOrderAction =
  | 'direct-to'
  | 'recall'
  | 'move'
  | 'evacuate'
  | 'propose-venue'
  | 'retire-venue'
  | 'set-max-venue-bps'
  | 'set-linaje-fee-bps'
  | 'set-payees'
  | 'cede'
  | 'end-cession'
  | 'set-constitution-ref';

/** Untyped param bag — the route validates with zod; this module re-checks
 *  structurally while encoding (ethers throws on malformed values). */
export type CouncilOrderParams = Record<string, unknown>;

/**
 * What the summary needs to speak like a person instead of like a contract.
 *
 * The disclosure line is what a quorum READS before signing, and it was saying
 * "Direct 100000 base units of principal into venue #0" — the contract's own
 * integers. With the cage's decimals and the venue's name it says "0.1 FXRP"
 * and "Kinetic". Optional on purpose: if the chain read fails, the order still
 * composes and the summary falls back to base units (never blocks a signature
 * over cosmetics).
 */
export interface OrderSummaryContext {
  decimals: number;
  symbol: string;
  /** venueId → human label ("Kinetic", "Firelight"…). */
  venueLabels?: Record<number, string>;
}

/** Amount in base units → "0.1 FXRP", or the raw integer without context. */
function humanAmount(raw: unknown, ctx?: OrderSummaryContext): string {
  if (!ctx) return `${raw} base units`;
  try {
    const v = BigInt(String(raw));
    const base = BigInt(10) ** BigInt(ctx.decimals);
    const whole = v / base;
    const frac = (v % base).toString().padStart(ctx.decimals, '0').replace(/0+$/, '');
    return `${whole}${frac ? `.${frac}` : ''} ${ctx.symbol}`;
  } catch {
    return `${raw} base units`;
  }
}

/** Venue id → "Kinetic" when known, else the honest "venue #0". */
function venueName(id: unknown, ctx?: OrderSummaryContext): string {
  const label = ctx?.venueLabels?.[Number(id)];
  return label ? `${label} (venue #${id})` : `venue #${id}`;
}

interface ActionSpec {
  /** Build the ethers args array. `ref` is the CURRENT constitutionRef. */
  args: (p: CouncilOrderParams, ref: string) => unknown[];
  fn: string;
  /** One-line human summary for the disclosure (#6). */
  summary: (p: CouncilOrderParams, ctx?: OrderSummaryContext) => string;
}

const UBA = (v: unknown): bigint => {
  const b = BigInt(String(v));
  if (b <= 0n) throw new Error('amount must be a positive integer in base units');
  return b;
};
const NUM = (v: unknown): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error('expected a non-negative integer');
  return n;
};

const ACTIONS: Record<CouncilOrderAction, ActionSpec> = {
  'direct-to': {
    fn: 'directTo',
    args: (p, ref) => [NUM(p.venueId), UBA(p.amount), ref],
    summary: (p, c) => `Put ${humanAmount(p.amount, c)} of the principal to work in ${venueName(p.venueId, c)}`,
  },
  recall: {
    fn: 'recall',
    args: (p, ref) => [NUM(p.venueId), UBA(p.amount), ref],
    summary: (p, c) => `Bring ${humanAmount(p.amount, c)} back from ${venueName(p.venueId, c)} into the vault`,
  },
  move: {
    fn: 'moveToVenue',
    args: (p, ref) => [NUM(p.fromId), NUM(p.toId), UBA(p.amount), ref],
    summary: (p, c) =>
      `Move ${humanAmount(p.amount, c)} from ${venueName(p.fromId, c)} to ${venueName(p.toId, c)} (rescue)`,
  },
  evacuate: {
    fn: 'evacuate',
    args: (p, ref) => [NUM(p.venueId), ref],
    summary: (p, c) => `Evacuate EVERYTHING from ${venueName(p.venueId, c)} back to the vault (emergency)`,
  },
  'propose-venue': {
    fn: 'proposeVenue',
    args: (p, ref) => [String(p.target), NUM(p.kind), ref],
    summary: (p) => `Propose venue ${p.target} (kind ${p.kind}) — entry opens after the 30-day delay`,
  },
  'retire-venue': {
    fn: 'retireVenue',
    args: (p, ref) => [NUM(p.venueId), ref],
    summary: (p, c) => `Retire ${venueName(p.venueId, c)} (closed to new entries; exits keep working)`,
  },
  'set-max-venue-bps': {
    fn: 'setMaxVenueBps',
    args: (p, ref) => [NUM(p.bps), ref],
    summary: (p) => `Set the per-venue entry cap to ${p.bps} bps`,
  },
  'set-linaje-fee-bps': {
    fn: 'setLinajeFeeBps',
    args: (p, ref) => [NUM(p.bps), ref],
    summary: (p) => `Set the linaje cut to ${p.bps} bps (floor 1000 / ceil 4000)`,
  },
  'set-payees': {
    fn: 'setPayees',
    args: (p, ref) => {
      const list = p.payees as Array<{ account: string; bps: number }>;
      if (!Array.isArray(list)) throw new Error('payees must be an array');
      return [list.map((x) => String(x.account)), list.map((x) => NUM(x.bps)), ref];
    },
    summary: (p) =>
      `Set the fruit payees: ${(p.payees as Array<{ account: string; bps: number }>)
        .map((x) => `${x.account} (${x.bps} bps)`)
        .join(', ') || 'none (everything capitalizes)'}`,
  },
  cede: {
    fn: 'cede',
    args: (p, ref) => {
      const until = Math.floor(Date.parse(String(p.untilISO)) / 1000);
      if (!Number.isFinite(until) || until <= Date.now() / 1000) throw new Error('untilISO must be a future date');
      return [String(p.director), BigInt(until), ref];
    },
    summary: (p) => `Grant direction to ${p.director} until ${p.untilISO} (never the assets)`,
  },
  'end-cession': {
    fn: 'endCession',
    args: (_p, ref) => [ref],
    summary: () => 'End the current cession immediately',
  },
  'set-constitution-ref': {
    fn: 'setConstitutionRef',
    args: (p, ref) => {
      const newRef = String(p.newRefHex);
      if (!/^0x[0-9a-fA-F]{64}$/.test(newRef)) throw new Error('newRefHex must be 0x + 64 hex (a SHA-256)');
      return [newRef, ref];
    },
    summary: (p) => `Point the vault at constitution version ${String(p.newRefHex).slice(0, 18)}… (already anchored via DIDSet)`,
  },
};

// ── Pure encoding (unit-tested; no RPC) ──────────────────────────────────────

export interface EncodedCouncilOrder {
  action: CouncilOrderAction;
  vaultCalldata: string;
  /** abi.encode(uint64 nonce, bytes vaultCalldata) — the committed bytes. */
  orderData: string;
  /** keccak256(orderData) — what the memo carries. */
  orderHash: string;
  /** MemoData hex (no 0x, uppercase) for the XRPL Payment. */
  memoHex: string;
  nonce: number;
  summary: string;
}

export function encodeCouncilOrder(
  action: CouncilOrderAction,
  params: CouncilOrderParams,
  constitutionRef: string,
  nonce: number,
  /** Only decorates the SUMMARY — never the bytes. Omit and it reads in base units. */
  summaryCtx?: OrderSummaryContext,
): EncodedCouncilOrder {
  const spec = ACTIONS[action];
  if (!spec) throw new Error(`unknown council order action: ${action}`);
  if (!/^0x[0-9a-fA-F]{64}$/.test(constitutionRef)) throw new Error('constitutionRef must be bytes32 hex');
  if (!Number.isInteger(nonce) || nonce < 0) throw new Error('nonce must be a non-negative integer');

  const vaultCalldata = VAULT_IFACE.encodeFunctionData(spec.fn, spec.args(params, constitutionRef));
  const orderData = ethers.AbiCoder.defaultAbiCoder().encode(['uint64', 'bytes'], [nonce, vaultCalldata]);
  const orderHash = ethers.keccak256(orderData);
  return {
    action,
    vaultCalldata,
    orderData,
    orderHash,
    memoHex: orderHash.slice(2).toUpperCase(),
    nonce,
    summary: spec.summary(params, summaryCtx),
  };
}

// ── The service fee (FIXED — "never charity", roadmap Ola 2) ─────────────────
//
// A council order is a Payment; XRPL forbids a 0-value one, so it carries at
// least 1 drop to the anchor. When the executor-as-service fee is ON, that
// amount becomes `1 drop + LEGACY_ORDER_FEE_XRP`, a FIXED price that lands at
// the same anchor and funds the relaying costs (FDC attestation + gas + the
// XRP→FXRP→FLR conversion friction). Fixed, not market-priced: council orders
// are rare and over large capital — legibility beats penny-efficiency, and
// reading an oracle at prepare adds a moving part for no real gain. The bridge
// NEVER checks the amount (authority = source + memo), so this is purely
// economic. Sized conservatively to cover the worst realistic loaded cost and
// retuned via env if the market regime shifts. OFF by default (a founder's own
// vessel pays no fee); disclosed before signing (invariant #6).

export interface OrderFee {
  enabled: boolean;
  /** The fixed fee in XRP ("0" when disabled). */
  feeXrp: string;
  /** Payment Amount in drops: "1" when disabled, else String(1 + feeDrops). */
  amountDrops: string;
}

/**
 * Resolve the fixed order fee from env (pure — unit-tested; no RPC, no oracle).
 *
 * Modelo del fundador (2026-07-28): el executor es un servicio del producto y se
 * cobra al MISMO precio que el executor de Flare (el mint) — fijo, 0,2 XRP (la
 * `executorFeeUBA` de FAssets). Se pone en `LEGACY_ORDER_FEE_XRP=0.2`. Fijo, no
 * dinámico: "si el del executor de Flare es siempre fijo, igual".
 */
export function resolveOrderFee(): OrderFee {
  if (process.env.LEGACY_ORDER_FEE_ENABLED !== 'true') {
    return { enabled: false, feeXrp: '0', amountDrops: '1' };
  }
  const feeXrp = (process.env.LEGACY_ORDER_FEE_XRP || '').trim();
  if (!/^\d+(\.\d{1,6})?$/.test(feeXrp) || Number(feeXrp) <= 0) {
    throw new Error(
      'LEGACY_ORDER_FEE_ENABLED=true but LEGACY_ORDER_FEE_XRP is not a positive XRP amount ' +
        '(max 6 decimals) — set the fixed service fee (e.g. 0.2, same as the Flare executor) before enabling',
    );
  }
  const feeDrops = BigInt(xrpToDrops(feeXrp)); // xrpl validates the drops conversion
  return { enabled: true, feeXrp, amountDrops: (1n + feeDrops).toString() };
}

/** The order Payment (pure — unit-tested). The amount is ceremonial-plus-fee:
 *  the AUTHORITY is the SOURCE account + the memo commitment, never the value;
 *  the value above 1 drop is the disclosed fixed service fee (resolveOrderFee). */
export function buildOrderPaymentTx(
  council: string,
  orderAnchor: string,
  memoHex: string,
  amountDrops = '1',
): Record<string, unknown> {
  if (!isValidClassicAddress(council)) throw new Error(`council is not a valid XRPL address: ${council}`);
  if (!isValidClassicAddress(orderAnchor)) throw new Error(`order anchor is not a valid XRPL address: ${orderAnchor}`);
  if (council === orderAnchor) throw new Error('order anchor must differ from the council account (XRPL forbids self-payment)');
  if (!/^[0-9A-F]{64}$/.test(memoHex)) throw new Error('memoHex must be 32 bytes (64 uppercase hex)');
  if (!/^[1-9]\d*$/.test(amountDrops)) throw new Error('amountDrops must be a positive integer drops string (≥ 1)');
  const tx = withSourceTag({
    TransactionType: 'Payment' as const,
    Account: council,
    Destination: orderAnchor,
    Amount: amountDrops,
    Memos: [{ Memo: { MemoData: memoHex } }],
  });
  validate(tx as never); // xrpl.js validates the Payment shape
  return tx;
}

// ── The full prepare (reads chain state, returns the handoff) ────────────────

export interface CouncilOrderHandoff extends XrplTxHandoff<Record<string, unknown>> {
  order: EncodedCouncilOrder & { bridge: string; vault: string; chain: string; constitutionRef: string };
}

export async function buildCouncilOrderHandoff(input: {
  council: string;
  action: CouncilOrderAction;
  params: CouncilOrderParams;
  /** THIS council's cage (LegacyCageResolver). The env stack is nobody's cage
   *  until an account claims it, so callers that touch capital resolve it by
   *  account and pass it in; omitting it keeps the old env behaviour for
   *  scripts and rehearsals that run against the configured stack. */
  cage?: LegacyStackConfig;
  /** Units + venue names for the human summary. The route passes the vault
   *  state it already read for the pre-flight; without it the summary falls
   *  back to base units and everything else is identical. */
  summaryCtx?: OrderSummaryContext;
}): Promise<CouncilOrderHandoff> {
  const cfg = input.cage ?? legacyStackConfig();
  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
  const bridge = new ethers.Contract(cfg.bridge, BRIDGE_ABI, provider);
  const vault = new ethers.Contract(cfg.vault, VAULT_READ_ABI, provider);

  const [nonceBig, constitutionRef, boundVault, vaultCouncil] = await Promise.all([
    bridge.nextNonce() as Promise<bigint>,
    vault.constitutionRef() as Promise<string>,
    bridge.vault() as Promise<string>,
    vault.council() as Promise<string>,
  ]);
  if (boundVault.toLowerCase() !== cfg.vault.toLowerCase()) {
    throw new Error(`bridge is bound to ${boundVault}, not LEGACY_VAULT_ADDRESS ${cfg.vault} — check the env`);
  }
  assertCouncilBinding(vaultCouncil, cfg.bridge);

  const encoded = encodeCouncilOrder(
    input.action,
    input.params,
    constitutionRef,
    Number(nonceBig),
    input.summaryCtx,
  );
  const fee = resolveOrderFee();
  const xrplTx = buildOrderPaymentTx(input.council, cfg.orderAnchor, encoded.memoHex, fee.amountDrops);

  const feeNote = fee.enabled
    ? ` This order carries a fixed service fee of ${fee.feeXrp} XRP (it funds the FDC attestation, ` +
      'gas and settlement of your order); the fee is the Payment amount, disclosed here before you sign.'
    : '';

  return {
    xrplTx,
    order: { ...encoded, bridge: cfg.bridge, vault: cfg.vault, chain: cfg.chain, constitutionRef },
    disclosure: {
      disclosedToUser: true,
      astryumSigns: false,
      note:
        'Astryum builds this unsigned XRPL Payment; your council quorum signs it. Its memo ' +
        'commits the EXACT order below (keccak256 of the bytes): after the ledger validates it, the ' +
        'FDC proves it on Flare and the XrplCouncilBridge executes only that order against the ' +
        'LegacyVault — nothing else can be executed with this signature, and the same signature can ' +
        'never execute twice (consumed txId + sequential nonce). The vault’s cage still rules what ' +
        'the order may do: no order can extract the principal. Astryum never signs and never ' +
        'executes with discretion; the relayer that carries the proof has zero authority.' +
        feeNote,
      facts: {
        order: encoded.summary,
        action: encoded.action,
        orderNonce: encoded.nonce,
        orderHash: encoded.orderHash,
        serviceFee: fee.enabled ? `${fee.feeXrp} XRP` : 'none',
        vault: cfg.vault,
        bridge: cfg.bridge,
        network: `XRPL → Flare (${cfg.chain})`,
        constitutionRef,
        settlementLatency: '~2-5 min (FDC round) after the XRPL signature',
      },
    },
  };
}
