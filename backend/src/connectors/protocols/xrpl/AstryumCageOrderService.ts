/**
 * AstryumCageOrderService — las órdenes de una cuenta XRPL a SU jaula v2.
 *
 * Mismo raíl que las órdenes del Legacy (`XrplCouncilOrderService`): el consejo
 * firma UN pago XRPL cuyo memo compromete `keccak256(abi.encode(nonce,
 * calldata))`; el ledger lo valida; FDC lo prueba; el bridge ejecuta EXACTAMENTE
 * esos bytes contra lo que tiene atado. Lo único que cambia es el destinatario:
 * los bytes van a la JAULA (`AstryumCage`), no a un vault, y cada orden lleva el
 * pote al que se refiere como primer parámetro.
 */

import { ethers } from 'ethers';
import {
  buildOrderPaymentTx,
  legacyNetworkConfig,
  resolveOrderFee,
  type LegacyStackConfig,
  type OrderSummaryContext,
} from './XrplCouncilOrderService';
import type { XrplTxHandoff } from './XrplTxHandoff';
import { readAccountCredentials } from '../../../services/XrplCredentialVerifier';
import { AnchorGateError, decideOrderCredentialIds, type AnchorGateState } from '../../../services/XrplAnchorGateService';
import { readAnchorGateDoor } from '../../../services/XrplAnchorGateOps';
import {
  cooldownCoversQueue,
  queuedVenueMinCooldownSeconds,
  ERC4626_QUEUED_KIND,
} from '../../../services/flare/cooldownGuardrail';

/** XRPL admite como mucho 8 credenciales en un Payment. */
const MAX_PAYMENT_CREDENTIALS = 8;

/**
 * Las credenciales que este firmante PUEDE listar en `CredentialIDs`.
 *
 * El directorio de una cuenta guarda dos cosas distintas: las credenciales de
 * las que es SUJETO y las que ella EMITIÓ para otras cuentas. El ledger solo
 * admite las primeras — exige que el firmante sea el sujeto de cada una — y una
 * sola ajena tumba el pago ENTERO con `tecBAD_CREDENTIALS`, cobrando su fee de
 * red y sin ejecutar nada.
 */
export function ownCredentialIdsFor(
  account: string,
  credentials: ReadonlyArray<{ subject: string; state: string; ledgerIndex: string | null }>,
): string[] {
  return credentials
    .filter(
      (c) =>
        c.subject === account &&
        (c.state === 'valid' || c.state === 'expiring-soon') &&
        typeof c.ledgerIndex === 'string' &&
        c.ledgerIndex.length > 0,
    )
    .map((c) => c.ledgerIndex as string)
    .slice(0, MAX_PAYMENT_CREDENTIALS);
}

const VENUE_TUPLE = '(address target, uint8 kind)';
/** La ficha de nacimiento de un pote (`AstryumCage.PoteParams`), en el orden del contrato. */
export const POTE_PARAMS_TUPLE = `(string name, string symbol, uint48 cooldown, uint16 bufferFloorBps, uint16 maxPayeeBps, uint256 maxDepositPerUser, address initialGate, ${VENUE_TUPLE}[] initialVenues)`;

/** La superficie de la jaula que una orden de consejo puede tocar. Ni una más. */
export const CAGE_AUTHORITY_ABI = [
  `function createPote(${POTE_PARAMS_TUPLE} p, bytes32 ref, address feePayer) returns (address)`,
  // Adoptar un pote tras una sucesión es GOBIERNO, no conserjería (759051a4): un
  // extraño con un contrato que respondiera «me esperas» brickeaba la jaula.
  'function acceptPote(address pote)',
  'function proposeVenue(address pote, address target, uint8 kind, bytes32 ref)',
  'function retireVenue(address pote, uint256 venueId, bytes32 ref)',
  'function evacuate(address pote, uint256 venueId, bytes32 ref)',
  'function setMaxVenueBps(address pote, uint16 bps, bytes32 ref)',
  'function setPayees(address pote, address[] accounts, uint16[] bps, bytes32 ref)',
  'function setUserGate(address pote, address gate, bytes32 ref)',
  'function setMaxDepositPerUser(address pote, uint256 cap, bytes32 ref)',
  'function directTo(address pote, uint256 venueId, uint256 amount, bytes32 ref)',
  'function recall(address pote, uint256 venueId, uint256 amount, bytes32 ref)',
  'function moveToVenue(address pote, uint256 fromId, uint256 toId, uint256 amount, bytes32 ref)',
  'function cede(address director, uint64 until, bytes32 ref)',
  'function endCession(bytes32 ref)',
  'function setConstitutionRef(bytes32 newRef, bytes32 oldRef)',
  'function registerRemoteWallet(uint32 chainId, bytes32 walletId, bytes32 ref)',
  'function registerRemotePote(uint32 chainId, address pote, bytes32 ref)',
  'function proposeSuccessor(address newCage, bytes32 ref)',
  'function cancelSuccessor(bytes32 ref)',
  'function executeSuccession(bytes32 ref)',
];
const CAGE_IFACE = new ethers.Interface(CAGE_AUTHORITY_ABI);

const CAGE_READ_ABI = [
  'function constitutionRef() view returns (bytes32)',
  'function AUTHORITY() view returns (address)',
  'function isMyPote(address) view returns (bool)',
  'function succeeded() view returns (bool)',
];
const BRIDGE_ABI = ['function nextNonce() view returns (uint64)', 'function vault() view returns (address)'];

export type CageOrderAction =
  | 'create-pote'
  | 'accept-pote'
  | 'propose-venue'
  | 'retire-venue'
  | 'evacuate'
  | 'set-max-venue-bps'
  | 'set-payees'
  | 'set-user-gate'
  | 'set-max-deposit'
  | 'direct-to'
  | 'recall'
  | 'move'
  | 'cede'
  | 'end-cession'
  | 'set-constitution-ref'
  | 'register-remote-wallet'
  | 'register-remote-pote'
  | 'propose-successor'
  | 'cancel-successor'
  | 'execute-succession';

export type CageOrderParams = Record<string, unknown>;

/** Las órdenes que hablan de UN pote: llevan `pote` y se comprueba que es de la jaula. */
const POTE_SCOPED: ReadonlySet<CageOrderAction> = new Set([
  'propose-venue',
  'retire-venue',
  'evacuate',
  'set-max-venue-bps',
  'set-payees',
  'set-user-gate',
  'set-max-deposit',
  'direct-to',
  'recall',
  'move',
]);

const ADDR = (v: unknown, what: string): string => {
  const s = String(v ?? '');
  if (!ethers.isAddress(s)) throw new Error(`${what} must be an EVM address`);
  return ethers.getAddress(s);
};
const UINT = (v: unknown, what: string): bigint => {
  const s = String(v ?? '');
  if (!/^[0-9]{1,78}$/.test(s)) throw new Error(`${what} must be a non-negative integer (base units)`);
  return BigInt(s);
};
const NUM = (v: unknown, what: string, max = Number.MAX_SAFE_INTEGER): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > max) throw new Error(`${what} must be an integer in [0, ${max}]`);
  return n;
};
const REF = (v: unknown, what: string): string => {
  const s = String(v ?? '');
  if (!/^0x[0-9a-fA-F]{64}$/.test(s)) throw new Error(`${what} must be 0x + 64 hex`);
  return s.toLowerCase();
};

/** 'erc4626' | 'compoundv2' | 'erc4626queued' | 0 | 1 | 2 → el enum del contrato. */
export function venueKindOf(v: unknown): number {
  if (v === 0 || v === 1 || v === 2) return v;
  const s = String(v ?? '').toLowerCase();
  if (s === 'erc4626' || s === '0') return 0;
  if (s === 'compoundv2' || s === '1') return 1;
  if (s === 'erc4626queued' || s === '2') return 2;
  throw new Error(`unknown venue kind: ${String(v)}`);
}

function fmt(amount: bigint, ctx?: OrderSummaryContext): string {
  if (!ctx) return `${amount} base units`;
  return `${ethers.formatUnits(amount, ctx.decimals)} ${ctx.symbol}`;
}
function venueName(id: number, ctx?: OrderSummaryContext): string {
  return ctx?.venueLabels?.[id] ?? `venue #${id}`;
}

interface ActionSpec {
  fn: string;
  args: (p: CageOrderParams, ref: string) => unknown[];
  summary: (p: CageOrderParams, ctx?: OrderSummaryContext) => string;
}

const ACTIONS: Record<CageOrderAction, ActionSpec> = {
  'create-pote': {
    fn: 'createPote',
    args: (p, ref) => {
      const name = String(p.name ?? '').trim();
      const symbol = String(p.symbol ?? '').trim();
      if (!name || !symbol) throw new Error('name and symbol are required');
      const venues = (Array.isArray(p.initialVenues) ? p.initialVenues : []) as Array<{ target: unknown; kind: unknown }>;
      const cooldownSeconds = NUM(p.cooldownSeconds ?? 0, 'cooldownSeconds', 30 * 24 * 3600);
      const kinds = venues.map((v) => venueKindOf(v.kind));
      // El cooldown debe cubrir la cola de salida del venue encolado: un pote que
      // nace con Firelight y un cooldown corto acuña tickets que maduran antes de
      // que drene la cola → claimRedeem revierte. Se rechaza antes de firmar.
      const guard = cooldownCoversQueue(cooldownSeconds, kinds, queuedVenueMinCooldownSeconds());
      if (!guard.ok) throw new Error(guard.reason ?? 'queued venue needs a longer cooldown');
      return [
        {
          name,
          symbol,
          cooldown: BigInt(cooldownSeconds),
          bufferFloorBps: NUM(p.bufferFloorBps ?? 1000, 'bufferFloorBps', 5000),
          maxPayeeBps: NUM(p.maxPayeeBps ?? 2000, 'maxPayeeBps', 10_000),
          // 0 = sin tope de posición por cuenta. Lo aplica el propio ERC-4626 del pote.
          maxDepositPerUser: UINT(p.maxDepositPerUser ?? '0', 'maxDepositPerUser'),
          initialGate: p.initialGate ? ADDR(p.initialGate, 'initialGate') : ethers.ZeroAddress,
          initialVenues: venues.map((v, i) => ({ target: ADDR(v.target, 'initialVenues[].target'), kind: kinds[i] })),
        },
        ref,
        ADDR(p.feePayer, 'feePayer'),
      ];
    },
    summary: (p, ctx) => {
      const cap = UINT(p.maxDepositPerUser ?? '0', 'maxDepositPerUser');
      return `Open pote "${String(p.name)}" (${String(p.symbol)}): cooldown ${String(p.cooldownSeconds ?? 0)}s, buffer floor ${String(p.bufferFloorBps ?? 1000)} bps, payees ≤ ${String(p.maxPayeeBps ?? 2000)} bps${p.initialGate ? ', gated' : ', open'}${cap === 0n ? ', no per-account cap' : `, max ${fmt(cap, ctx)} per account`}; if this cage has used its free potes, the creation fee is paid by ${String(p.feePayer)} straight to the treasury`;
    },
  },
  'accept-pote': {
    fn: 'acceptPote',
    args: (p) => [ADDR(p.pote, 'pote')],
    summary: (p) => `Adopt pote ${String(p.pote)} handed over by the previous cage (it must already name this cage as pendingCouncil)`,
  },
  'propose-venue': {
    fn: 'proposeVenue',
    args: (p, ref) => [ADDR(p.pote, 'pote'), ADDR(p.target, 'target'), venueKindOf(p.kind), ref],
    summary: (p) => `Propose ${String(p.target)} as a venue of pote ${String(p.pote)} (30-day wait; must be in Astryum's registry — and in this cage's own list, if it was born with one)`,
  },
  'retire-venue': {
    fn: 'retireVenue',
    args: (p, ref) => [ADDR(p.pote, 'pote'), BigInt(NUM(p.venueId, 'venueId')), ref],
    summary: (p, ctx) => `Retire ${venueName(NUM(p.venueId, 'venueId'), ctx)} of pote ${String(p.pote)} (no new entries; exits always work)`,
  },
  evacuate: {
    fn: 'evacuate',
    args: (p, ref) => [ADDR(p.pote, 'pote'), BigInt(NUM(p.venueId, 'venueId')), ref],
    summary: (p, ctx) => `Evacuate ${venueName(NUM(p.venueId, 'venueId'), ctx)} of pote ${String(p.pote)}: everything recoverable back to the buffer`,
  },
  'set-max-venue-bps': {
    fn: 'setMaxVenueBps',
    args: (p, ref) => [ADDR(p.pote, 'pote'), NUM(p.bps, 'bps', 10_000), ref],
    summary: (p) => `Cap any single venue of pote ${String(p.pote)} at ${String(p.bps)} bps of its assets`,
  },
  'set-payees': {
    fn: 'setPayees',
    args: (p, ref) => {
      const list = p.payees as Array<{ account: unknown; bps: unknown }>;
      if (!Array.isArray(list)) throw new Error('payees must be an array');
      return [
        ADDR(p.pote, 'pote'),
        list.map((x) => ADDR(x.account, 'payees[].account')),
        list.map((x) => NUM(x.bps, 'payees[].bps', 10_000)),
        ref,
      ];
    },
    summary: (p) =>
      `Set the yield payees of pote ${String(p.pote)}: ${(p.payees as Array<{ account: string; bps: number }>)
        .map((x) => `${x.account} (${x.bps} bps)`)
        .join(', ') || 'none (everything capitalizes)'} — the pote's own cap applies`,
  },
  'set-user-gate': {
    fn: 'setUserGate',
    args: (p, ref) => [ADDR(p.pote, 'pote'), p.gate ? ADDR(p.gate, 'gate') : ethers.ZeroAddress, ref],
    summary: (p) => (p.gate ? `Point pote ${String(p.pote)} at entry gate ${String(p.gate)}` : `Open pote ${String(p.pote)} to everyone (a private pote refuses this)`),
  },
  'set-max-deposit': {
    fn: 'setMaxDepositPerUser',
    args: (p, ref) => [ADDR(p.pote, 'pote'), UINT(p.cap ?? '0', 'cap'), ref],
    summary: (p, ctx) => {
      const cap = UINT(p.cap ?? '0', 'cap');
      return cap === 0n
        ? `Remove the per-account cap of pote ${String(p.pote)}`
        : `Cap each account's position in pote ${String(p.pote)} at ${fmt(cap, ctx)} (entries only — exits are never blocked)`;
    },
  },
  'direct-to': {
    fn: 'directTo',
    args: (p, ref) => [ADDR(p.pote, 'pote'), BigInt(NUM(p.venueId, 'venueId')), UINT(p.amount, 'amount'), ref],
    summary: (p, ctx) => `Direct ${fmt(UINT(p.amount, 'amount'), ctx)} of pote ${String(p.pote)} into ${venueName(NUM(p.venueId, 'venueId'), ctx)}`,
  },
  recall: {
    fn: 'recall',
    args: (p, ref) => [ADDR(p.pote, 'pote'), BigInt(NUM(p.venueId, 'venueId')), UINT(p.amount, 'amount'), ref],
    summary: (p, ctx) => `Recall ${fmt(UINT(p.amount, 'amount'), ctx)} from ${venueName(NUM(p.venueId, 'venueId'), ctx)} back to the buffer of pote ${String(p.pote)}`,
  },
  move: {
    fn: 'moveToVenue',
    args: (p, ref) => [
      ADDR(p.pote, 'pote'),
      BigInt(NUM(p.fromId, 'fromId')),
      BigInt(NUM(p.toId, 'toId')),
      UINT(p.amount, 'amount'),
      ref,
    ],
    summary: (p, ctx) =>
      `Move ${fmt(UINT(p.amount, 'amount'), ctx)} of pote ${String(p.pote)} from ${venueName(NUM(p.fromId, 'fromId'), ctx)} to ${venueName(NUM(p.toId, 'toId'), ctx)}`,
  },
  cede: {
    fn: 'cede',
    args: (p, ref) => {
      const until = Math.floor(Date.parse(String(p.untilISO)) / 1000);
      if (!Number.isFinite(until) || until <= Date.now() / 1000) throw new Error('untilISO must be a future date');
      return [ADDR(p.director, 'director'), BigInt(until), ref];
    },
    summary: (p) => `Grant the day-to-day (direct/recall/move) to ${String(p.director)} until ${String(p.untilISO)} — never the catalogue, never the payees, never the assets`,
  },
  'end-cession': {
    fn: 'endCession',
    args: (_p, ref) => [ref],
    summary: () => 'End the current cession immediately',
  },
  'set-constitution-ref': {
    fn: 'setConstitutionRef',
    args: (p, ref) => [REF(p.newRefHex, 'newRefHex'), ref],
    summary: (p) => `Point the cage AND every pote at constitution ${String(p.newRefHex).slice(0, 18)}… (already anchored via DIDSet)`,
  },
  'register-remote-wallet': {
    fn: 'registerRemoteWallet',
    args: (p, ref) => [NUM(p.chainId, 'chainId', 0xffffffff), REF(p.walletIdHex, 'walletIdHex'), ref],
    summary: (p) => `Register PMW-managed wallet ${String(p.walletIdHex).slice(0, 18)}… on chain ${String(p.chainId)} (keys born inside the TEE, never imported)`,
  },
  'register-remote-pote': {
    fn: 'registerRemotePote',
    args: (p, ref) => [NUM(p.chainId, 'chainId', 0xffffffff), ADDR(p.pote, 'pote'), ref],
    summary: (p) => `Register remote pote ${String(p.pote)} on chain ${String(p.chainId)} (must be an allowed target there)`,
  },
  'propose-successor': {
    fn: 'proposeSuccessor',
    args: (p, ref) => [ADDR(p.newCage, 'newCage'), ref],
    summary: (p) => `Propose ${String(p.newCage)} as the successor cage (30-day wait; same authority, approved code, never a wider list, same constitution)`,
  },
  'cancel-successor': {
    fn: 'cancelSuccessor',
    args: (_p, ref) => [ref],
    summary: () => 'Cancel the proposed successor',
  },
  'execute-succession': {
    fn: 'executeSuccession',
    args: (_p, ref) => [ref],
    summary: () => 'Execute the succession: every pote is handed to the successor and the bridge re-binds to it; this cage commands nothing more',
  },
};

// ── Codificación pura (testable sin RPC) ─────────────────────────────────────

export interface EncodedCageOrder {
  action: CageOrderAction;
  cageCalldata: string;
  /** abi.encode(uint64 nonce, bytes cageCalldata) — los bytes comprometidos. */
  orderData: string;
  /** keccak256(orderData) — lo que lleva el memo. */
  orderHash: string;
  /** El memo en hex mayúsculas, como lo espera XRPL. */
  memoHex: string;
  nonce: number;
  summary: string;
}

export function encodeCageOrder(
  action: CageOrderAction,
  params: CageOrderParams,
  constitutionRef: string,
  nonce: number,
  summaryCtx?: OrderSummaryContext,
): EncodedCageOrder {
  const spec = ACTIONS[action];
  if (!spec) throw new Error(`unknown cage order action: ${String(action)}`);
  if (!/^0x[0-9a-fA-F]{64}$/.test(constitutionRef)) throw new Error('constitutionRef must be bytes32 hex');
  if (!Number.isInteger(nonce) || nonce < 0) throw new Error('nonce must be a non-negative integer');

  const cageCalldata = CAGE_IFACE.encodeFunctionData(spec.fn, spec.args(params, constitutionRef));
  const orderData = ethers.AbiCoder.defaultAbiCoder().encode(['uint64', 'bytes'], [nonce, cageCalldata]);
  const orderHash = ethers.keccak256(orderData);
  return {
    action,
    cageCalldata,
    orderData,
    orderHash,
    memoHex: orderHash.slice(2).toUpperCase(),
    nonce,
    summary: spec.summary(params, summaryCtx),
  };
}

export function isPoteScoped(action: CageOrderAction): boolean {
  return POTE_SCOPED.has(action);
}

// ── El handoff: comprobar, componer, entregar sin firmar ─────────────────────

export interface CageOrderHandoff extends XrplTxHandoff<Record<string, unknown>> {
  order: EncodedCageOrder & { bridge: string; cage: string; chain: string; constitutionRef: string };
}

/**
 * Compone la orden de ESTA cuenta a SU jaula. `cage` viene del resolver
 * (`cageForCouncil`, cuarto registro): `bridge` + `vault` (= la jaula). Todo lo
 * que se comprueba aquí reventaría en `bridge.execute` después de firmar y de
 * pagar la ronda FDC — por eso se comprueba antes.
 */
export async function buildCageOrderHandoff(input: {
  council: string;
  action: CageOrderAction;
  params: CageOrderParams;
  cage: LegacyStackConfig;
  summaryCtx?: OrderSummaryContext;
}): Promise<CageOrderHandoff> {
  const cfg = input.cage;
  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
  const bridge = new ethers.Contract(cfg.bridge, BRIDGE_ABI, provider);
  const cage = new ethers.Contract(cfg.vault, CAGE_READ_ABI, provider);

  const [nonceBig, constitutionRef, boundVault, authority, succeeded] = await Promise.all([
    bridge.nextNonce() as Promise<bigint>,
    cage.constitutionRef() as Promise<string>,
    bridge.vault() as Promise<string>,
    cage.AUTHORITY() as Promise<string>,
    cage.succeeded() as Promise<boolean>,
  ]);

  if (boundVault.toLowerCase() !== cfg.vault.toLowerCase()) {
    throw new Error(`the bridge is bound to ${boundVault}, not to this cage ${cfg.vault} — the order would never reach it`);
  }
  if (authority.toLowerCase() !== cfg.bridge.toLowerCase()) {
    throw new Error(`the cage obeys ${authority}, not the bridge ${cfg.bridge} — an order would revert with NotAuthority() after the FDC round was paid for`);
  }
  if (succeeded) {
    throw new Error('this cage already handed over to its successor — it commands nothing more; order the successor instead');
  }
  if (isPoteScoped(input.action)) {
    const pote = String(input.params.pote ?? '');
    if (!ethers.isAddress(pote)) throw new Error('pote must be an EVM address');
    if (!(await cage.isMyPote(pote))) {
      throw new Error(`pote ${pote} was not born from this cage — the order would revert with NotMyPote() after the FDC round was paid for`);
    }
    // Añadir un venue ENCOLADO (Firelight) a un pote cuyo COOLDOWN no cubre la
    // cola de salida es un footgun: una salida futura maduraría antes de que
    // drene la cola y claimRedeem revertiría (UnwindShortfall). El COOLDOWN es
    // inmutable (se fijó al nacer), así que esto no se puede arreglar después —
    // se rechaza antes de firmar. El contrato solo exige cooldown > 0.
    if (input.action === 'propose-venue' && venueKindOf(input.params.kind) === ERC4626_QUEUED_KIND) {
      const poteRead = new ethers.Contract(pote, ['function COOLDOWN() view returns (uint48)'], provider);
      const cooldownSeconds = Number((await poteRead.COOLDOWN()) as bigint);
      const minSeconds = queuedVenueMinCooldownSeconds();
      if (cooldownSeconds < minSeconds) {
        const h = (s: number) => Math.round(s / 3600);
        throw new Error(
          `pote ${pote} has a ${h(cooldownSeconds)}h cooldown; a queued venue (Firelight) needs ≥ ${h(minSeconds)}h ` +
            `to cover its withdrawal queue, or a matured redeem ticket can't be paid (claimRedeem reverts). This ` +
            `pote's cooldown is fixed at birth and cannot be raised — use a pote born with a ≥ ${h(minSeconds)}h cooldown for queued venues.`
        );
      }
    }
  }

  const encoded = encodeCageOrder(input.action, input.params, constitutionRef, Number(nonceBig), input.summaryCtx);
  const fee = resolveOrderFee();

  // El título del gestor viaja con la orden: si su cuenta sostiene
  // credenciales XLS-70 VÁLIDAS (aceptadas, no caducadas), sus IDs van en
  // `CredentialIDs`. Con el ancla convertida en puerta (DepositAuth +
  // AuthorizeCredentials) es lo único que hace que el pago entre; sin puerta, el
  // ledger los ignora. Solo las válidas: una caducada haría tecBAD_CREDENTIALS y
  // el gestor pagaría una firma por nada. «No pude leer» = sin campo, no error.
  let credentialIds: string[] = [];
  try {
    const held = await readAccountCredentials(input.council);
    let gate: AnchorGateState | null = null;
    try {
      gate = await readAnchorGateDoor(cfg.orderAnchor);
    } catch {
      gate = null; // «no pude leer el ancla» = se adjunta lo propio, y el ledger decide
    }
    credentialIds = decideOrderCredentialIds(input.council, gate, held.credentials).credentialIds;
  } catch (e) {
    if (e instanceof AnchorGateError) throw e; // NO_MATCHING_TITLE: la orden no se compone
    credentialIds = [];
  }

  const xrplTx = buildOrderPaymentTx(input.council, cfg.orderAnchor, encoded.memoHex, fee.amountDrops, credentialIds);
  const feeNote = fee.enabled
    ? ` This order carries a fixed service fee of ${fee.feeXrp} XRP (it funds the FDC attestation, gas and settlement of your order); the fee is the Payment amount, disclosed here before you sign.`
    : '';

  return {
    xrplTx,
    order: { ...encoded, bridge: cfg.bridge, cage: cfg.vault, chain: cfg.chain, constitutionRef },
    disclosure: {
      disclosedToUser: true,
      astryumSigns: false,
      note:
        'Astryum builds this unsigned XRPL Payment; your account signs it. Its memo commits the EXACT ' +
        'order below (keccak256 of the bytes): after the ledger validates it, the FDC proves it on Flare ' +
        'and the bridge executes only that order against your cage — nothing else can be executed with ' +
        'this signature, and the same signature can never execute twice. The cage rules what the order ' +
        'may do: only listed destinations, never the principal of anyone. Astryum never signs and never ' +
        'executes with discretion; the relayer that carries the proof has zero authority.' +
        feeNote,
      facts: {
        order: encoded.summary,
        action: encoded.action,
        orderNonce: encoded.nonce,
        orderHash: encoded.orderHash,
        serviceFee: fee.enabled ? `${fee.feeXrp} XRP` : 'none',
        cage: cfg.vault,
        bridge: cfg.bridge,
        network: `XRPL → Flare (${legacyNetworkConfig().chain})`,
      },
    },
  };
}
