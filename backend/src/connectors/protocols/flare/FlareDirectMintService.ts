import type { Provider } from 'ethers';
import { AbiCoder } from 'ethers';
import { FLARE_CONTRACT_REGISTRY } from '../../../flare/ftso/constants';
import {
  resolvePersonalAccount,
  getNonce,
} from './FlareSmartAccountService';
import {
  computeBorrowUsdt0,
  computeTriggerPrice,
  type BorrowResult,
} from './KineticIsoMath';
import { KineticAdapter } from '../adapters/KineticAdapter';
import type { EncodedAction } from '../IProtocolAdapter';
import { withSourceTag, attributionForSigner } from '../../../config/xrplSourceTag';
import {
  isSameHandoffPreparer,
  handoffPayloadExpiryMin,
  handoffPayloadExpiresAt,
  handoffCeremonyExpiryMin,
  clampPayloadExpiryMin,
  seatWindowLedgersFor,
  seatProofFieldsFrom,
  classifySeatSignability,
  defaultSeatWindowLedgers,
  seatWindowLongPastOf,
  seatWindowLedgersOf,
  unreadableDisplaceGraceMs as seatUnreadableDisplaceGraceMs,
  DEFAULT_UNREADABLE_DISPLACE_MIN as SEAT_DEFAULT_UNREADABLE_DISPLACE_MIN,
  SEAT_SECONDS_PER_LEDGER,
  type SeatSignabilityVerdict,
} from '../../../services/flare/handoffAuthority';
import { isHandoffExitAction } from '../../../services/councilExitToken';
import type { HandoffLedgerVerdict, HandoffWindowVerdict } from '../../../services/flare/DirectMintHandoffStore';
import type { ProofRefusal } from '../../../services/identity/provenAddresses';

/**
 * E1 — FXRP entry via the `0xFE` custom instruction over FAssets DIRECT MINTING.
 *
 * Flow (verified against source + mainnet, 2026-06-24):
 *   user pays XRP → Core Vault → AssetManagerFXRP direct-mints FXRP into the
 *   Personal Account → MasterAccountController dispatches the committed userOp
 *   → PersonalAccount.executeUserOp([approve, mint(supply), enterMarket,
 *   borrow USDT0]) runs atomically. The executor/operator pays Flare gas.
 *
 * Astryum is PREPARE-ONLY: it resolves the PA + nonce, reads fees live, builds
 * the PackedUserOperation + the 42-byte memo, and assembles the UNSIGNED XRPL
 * Payment. It never signs, never pays gas, never runs the executor.
 *
 * The contract validates `keccak256(_data) == userOpHash` (memo commitment) +
 * `sender == PA` + `nonce` → the operator is zero-discretion (invariant #7).
 * `_data` decodes as OpenZeppelin `draft-IERC4337.PackedUserOperation` (canonical
 * EIP-4337 v0.7, 9 fields) — confirmed in flare-smart-accounts MemoInstructions.sol.
 */

const REGISTRY_ABI = [
  'function getContractAddressByName(string _name) view returns (address)',
];

// AssetManagerFXRP — direct-minting settings (all read live; invariant #9: a
// protocol datum, never hardcoded). UBA == XRP drops for FXRP.
const ASSET_MANAGER_ABI = [
  'function fAsset() view returns (address)',
  'function directMintingPaymentAddress() view returns (string)',
  'function getDirectMintingMinimumFeeUBA() view returns (uint256)',
  'function getDirectMintingFeeBIPS() view returns (uint256)',
  'function getDirectMintingExecutorFeeUBA() view returns (uint256)',
  'function assetMintingGranularityUBA() view returns (uint256)',
];

// IPersonalAccount.executeUserOp(Call[]) — Call { address target; uint256 value; bytes data; }
const PERSONAL_ACCOUNT_ABI = [
  'function executeUserOp((address target, uint256 value, bytes data)[] _calls) payable',
];

// OpenZeppelin draft-IERC4337 PackedUserOperation (EIP-4337 v0.7) — the exact
// tuple the controller abi.decodes `_data` into.
export const PACKED_USER_OP_TUPLE =
  'tuple(address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature)';

/**
 * El asiento de nonce ya tiene un handoff pendiente: dos userOps vivos con el
 * mismo PA+nonce son gemelos excluyentes — solo uno podrá ejecutar JAMÁS
 * (incidente 2026-07-14/16: dos rotaciones preparadas con el nonce 2; la
 * segunda murió InvalidNonce y el executor quemó fees reintentándola).
 */
export type NonceSeatCode =
  /** Un borrador sin firmar aún vivo (su ventana de ledger por delante, o dentro del TTL). */
  | 'NONCE_SEAT_TAKEN'
  /** Hay una orden FIRMADA y validada en ese asiento: solo ejecutar o aparcar la vacía. */
  | 'NONCE_SEAT_TAKEN_SIGNED'
  /** Una firma reportada que el ledger aún no ha validado (filas sin LastLedgerSequence). */
  | 'NONCE_SEAT_TAKEN_REPORTED'
  /** El ledger no se pudo leer entero: no se sabe si aquel Payment entró — y «no pude leer» nunca libera. */
  | 'NONCE_SEAT_UNREADABLE'
  /**
   * productizer-it21 §P2 2.2 — NO SE PUDO LEER LA PRUEBA, no el asiento. La
   * tienda de pruebas de direcciones no contestó, así que no sabemos si esta
   * sesión puede reclamar el asiento de esta cuenta. Sobre una SALIDA eso no
   * puede degradarse a «no lo has probado» (403 definitivo) ni componerse como
   * fila «de quien no prueba» — que además la vuelve desplazable: se contesta
   * 503 reintentable y el derecho se conserva.
   */
  | 'PROOF_STORE_UNREADABLE'
  /**
   * productizer it. 31 (agente D, 4.1) — LA MARCA DE TOMA DE POSESIÓN ESTÁ
   * ADELANTADA A NUESTRO RELOJ, así que no sirve de suelo y no sabemos si esta
   * sesión puede reclamar el asiento. Se leyó bien (no es «ilegible») y se
   * cura sola cuando el reloj pasa la marca (no es «espera un momento»): por
   * eso NO se colapsa en `PROOF_STORE_UNREADABLE`, que afirma las dos cosas
   * falsas. El refusal entero viaja en `SeatStateUnreadableError.proofRefusal`.
   */
  | 'PROOF_FLOOR_AHEAD_OF_CLOCK';

export class NonceSeatTakenError extends Error {
  /** Código máquina del asiento (productizer-it15 §K1, contrato C3) — lo que responden las rutas. */
  readonly code: NonceSeatCode;
  /** true = reintentar liberando el asiento (`supersede`) PUEDE funcionar para esta sesión. */
  readonly retryable: boolean;
  /** LastLedgerSequence del borrador que ocupa el asiento, cuando la tiene (cuenta atrás real). */
  readonly lastLedgerSequence?: number;
  /** Segundos que faltan para que el asiento se libere solo (ventana de ledger o TTL). */
  readonly secondsLeft?: number;
  /**
   * productizer-it17 (contrato C2) — el memo de la fila que BLOQUEA, y solo para
   * quien ya tiene derecho a tocarla: quien la preparó o quien prueba la cuenta.
   * Con él la pantalla puede ofrecer «libera ese asiento» en vez de un callejón;
   * a un extraño no se le confirma jamás que ese memo exista (it14 §1.2: el memo
   * en la vista pública fue la vía de los informes falsos).
   */
  readonly memoHex?: string;
  constructor(
    message?: string,
    opts?: {
      code?: NonceSeatCode;
      retryable?: boolean;
      lastLedgerSequence?: number;
      secondsLeft?: number;
      memoHex?: string;
    },
  ) {
    super(message);
    // Routes that load this module lazily match on the name, not the class.
    this.name = 'NonceSeatTakenError';
    // Sin código explícito se deduce del prefijo del mensaje: las rutas y los
    // dobles de test que construyen este error a mano siguen valiendo.
    this.code = opts?.code ?? codeFromSeatMessage(message);
    this.retryable = opts?.retryable ?? false;
    this.lastLedgerSequence = opts?.lastLedgerSequence;
    this.secondsLeft = opts?.secondsLeft;
    this.memoHex = opts?.memoHex;
  }
}

function codeFromSeatMessage(message?: string): NonceSeatCode {
  const head = typeof message === 'string' ? message : '';
  if (head.startsWith('NONCE_SEAT_TAKEN_SIGNED')) return 'NONCE_SEAT_TAKEN_SIGNED';
  if (head.startsWith('NONCE_SEAT_TAKEN_REPORTED')) return 'NONCE_SEAT_TAKEN_REPORTED';
  if (head.startsWith('NONCE_SEAT_UNREADABLE')) return 'NONCE_SEAT_UNREADABLE';
  return 'NONCE_SEAT_TAKEN';
}

/**
 * productizer-it13 §2.1 — an XRPL account Astryum OPERATES (the demo exchange
 * omnibus, the order anchors… see config/xrplSourceTag.ts) only takes the 0xFE
 * dispatches of Astryum's own server flows. `xrplAddress` is a body field on the
 * prepare routes: without this, any session could prepare against the omnibus
 * and keep the nonce seat of its Personal Account taken (or displace a
 * put-to-work the desk holds in Xaman). Refused before any chain read.
 */
export class OperationalAccountHandoffError extends Error {
  readonly code = 'OPERATIONAL_ACCOUNT_HANDOFF_REFUSED';
  constructor(message: string) {
    super(message);
    this.name = 'OperationalAccountHandoffError';
  }
}

/**
 * The `action` labels of the server flows that legitimately build a 0xFE for an
 * operational account: the demo exchange put-to-work (routes/demoExchange.ts),
 * its autopilot (services/demoExchange/DemoExchangeAutopilot.ts) and the order
 * anchor feeding (services/flare/AnchorFeedingService.ts). Routes hardcode their
 * action — it is never read from a request body.
 */
export const OPERATIONAL_HANDOFF_ACTIONS: ReadonlySet<string> = new Set([
  'demo-exchange-desk',
  'demo-exchange-autopilot',
  'anchor-feed',
]);

/**
 * productizer-it19 §M1 1.4 — EL ASIENTO NO SE CONCEDE NI SE RETIRA POR UN FALLO
 * DE LECTURA. Un prepare que no puede saber en qué estado está el asiento (la
 * tabla de handoffs ilegible, o la lista de cuentas operativas nunca leída) NO
 * compone a ciegas: refusa y dice que se reintente. Hereda de
 * `NonceSeatTakenError` — y conserva su `name` — para que las rutas que aún no
 * lo distinguen respondan 409 con un código que la pantalla ya conoce en vez de
 * un 500 mudo; las de flareDemo lo responden como 503 (esperar, no un conflicto).
 *
 * LA SALIDA NUNCA LO RECIBE: «no pude leer» jamás es permiso NI castigo sobre
 * una salida (invariante), así que un 0xFE de salida se compone igual, con su
 * `seatWarning`.
 */
export class SeatStateUnreadableError extends NonceSeatTakenError {
  /** Marca de clase para las rutas que quieran responder 503 en vez de 409. */
  readonly unreadableSeatState = true;
  /**
   * productizer it. 31 (agente D, 4.1) — EL REFUSAL DE LA TIENDA DE PRUEBAS,
   * ENTERO. Las tres puertas del asiento (`seatClaimOf` en flareDemo,
   * `seatProofFieldsFor` en institutional y xrplDefi) convertían CUALQUIER
   * refusal reintentable en un `PROOF_STORE_UNREADABLE` con frase fija: «could
   * not read … try again in a moment». Desde it. 29 hay un segundo refusal
   * reintentable, `PROOF_FLOOR_AHEAD_OF_CLOCK`, para el que las dos mitades de
   * esa frase son falsas (la fila se leyó; el instante puede ser 2099) y cuyas
   * `ways` dicen justo lo que importa («re-linking will not help», «an
   * administrator can check that date»). Todo eso se perdía en la puerta, y el
   * usuario de email con la marca adelantada veía «try again in a moment» en
   * bucle indefinido sobre su propia salida.
   *
   * Cuando está presente, el serializador de la ruta lo envía TAL CUAL (código,
   * `detail`, `retryable`, `headline`, `ways`, `retryAfterSeconds` si viene) en
   * vez de reconstruir un cuerpo a partir de `code` y `message`
   * (`forwardedProofRefusalBody`, en services/flare/handoffAuthority — puro y
   * sin importar esta clase, porque dos de los tres routers la cargan perezosa).
   */
  readonly proofRefusal?: ProofRefusal;
  constructor(
    message: string,
    opts?: { memoHex?: string; secondsLeft?: number; code?: NonceSeatCode; proofRefusal?: ProofRefusal },
  ) {
    super(message, {
      code: opts?.code ?? 'NONCE_SEAT_UNREADABLE',
      retryable: true,
      memoHex: opts?.memoHex,
      secondsLeft: opts?.secondsLeft,
    });
    // El nombre SIGUE siendo el del padre a propósito: las rutas que cargan este
    // módulo perezosamente casan por nombre (ver NonceSeatTakenError).
    this.name = 'NonceSeatTakenError';
    if (opts?.proofRefusal) this.proofRefusal = opts.proofRefusal;
  }

  /**
   * La ÚNICA forma en que una puerta del asiento convierte un refusal
   * reintentable de la tienda de pruebas en el error que la ruta responde. El
   * `message` es el `detail` del refusal — sin el código crudo delante y sin la
   * r-address dentro — y el `code` es el suyo, no un `PROOF_STORE_UNREADABLE`
   * inventado. Un `PROOF_STORE_UNREADABLE` genuino sigue saliendo como tal.
   */
  static fromProofRefusal(refusal: ProofRefusal): SeatStateUnreadableError {
    const code: NonceSeatCode =
      refusal.error === 'PROOF_FLOOR_AHEAD_OF_CLOCK' ? 'PROOF_FLOOR_AHEAD_OF_CLOCK' : 'PROOF_STORE_UNREADABLE';
    return new SeatStateUnreadableError(refusal.detail, { code, proofRefusal: refusal });
  }
}

/**
 * Server-side predicate: «is this XRPL account one Astryum operates?». Never a
 * request body. `'unknown'` = no se pudo saber (el registro de runs nunca se
 * pudo leer): NO es «no» — ver `resolveOperationalAccount`.
 */
export type OperationalAccountResolver = (address: string) => Promise<boolean | 'unknown'> | boolean | 'unknown';

let operationalAccountResolver: OperationalAccountResolver | null = null;
/**
 * ¿Ha llegado el resolver a leer su fuente alguna vez? (contrato C1 ampliado en
 * it19 §M1 1.4: `declaredOmnibusEverRead`). Sin esto, un snapshot nunca leído
 * respondía `false` y una cuenta operativa se volvía «de usuario» durante el
 * apagón — asiento del omnibus tomable por cualquiera.
 */
let operationalResolverReady: (() => boolean) | null = null;

/**
 * productizer-it17 §1.6 (contrato C1) — REGISTRA UNA SEGUNDA FUENTE DE VERDAD
 * sobre qué cuenta opera Astryum, consultada ADEMÁS de `attributionForSigner`.
 *
 * La lista de entorno (`ASTRYUM_OPERATIONAL_XRPL_ACCOUNTS`, los anchors, la
 * semilla del omnibus) no conoce el omnibus que un operador declara al crear su
 * run: siete prepares institucionales aceptan `account` del body, y con ese
 * omnibus fuera de la lista cualquiera podía componer un 0xFE contra él y
 * quedarse con el asiento de nonce de su Personal Account sin firmar nada
 * (it16 R1 1.6). El módulo que SÍ conoce las runs (routes/demoExchange.ts)
 * registra aquí su propio veredicto al arrancar:
 *
 *   setOperationalAccountResolver(async (addr) => runOmnibusExists(addr));
 *
 * Contrato: el resolver es server-side, cachea por su cuenta (se consulta en
 * cada prepare) y cualquier fallo suyo se lee como `false` — «no pude leer»
 * nunca convierte una cuenta de usuario en operativa, y nunca al revés tampoco:
 * la lista de entorno sigue mandando por sí sola. Sin registrar nada, el
 * comportamiento es exactamente el de hoy. `null` lo desregistra (tests).
 */
export function setOperationalAccountResolver(
  fn: OperationalAccountResolver | null,
  opts?: {
    /**
     * `declaredOmnibusEverRead` (it19 §M1 1.4): false = este resolver todavía no
     * ha podido leer su fuente, así que su `false` significa «no lo sé». Sin este
     * hook el comportamiento es el de it17 — un `false` es un «no».
     */
    ready?: () => boolean;
  },
): void {
  operationalAccountResolver = fn;
  operationalResolverReady = fn ? (opts?.ready ?? null) : null;
}

/**
 * ¿Opera Astryum esta cuenta XRPL? Lista de entorno, o el resolver registrado (C1).
 *
 * `'unknown'` (it19 §M1 1.4) cuando el resolver no pudo leer su fuente NI la
 * lista de entorno la reconoce: ni «sí» ni «no». Quien pregunte decide — una
 * ENTRADA se refusa (el asiento del omnibus no se regala por un apagón de BD) y
 * una SALIDA se compone igual, porque una salida no se gatea jamás.
 */
export async function resolveOperationalAccount(address: string): Promise<'yes' | 'no' | 'unknown'> {
  const account = typeof address === 'string' ? address.trim() : '';
  if (!account) return 'no';
  if (attributionForSigner(account) === 'operational') return 'yes';
  if (!operationalAccountResolver) return 'no';
  try {
    const verdict = await operationalAccountResolver(account);
    if (verdict === true) return 'yes';
    if (verdict === 'unknown') return 'unknown';
  } catch {
    return operationalResolverReady ? 'unknown' : 'no'; // un resolver que falla no crea cuentas operativas
  }
  // Un `false` de un resolver que nunca llegó a leer su fuente no es un «no».
  return operationalResolverReady && operationalResolverReady() !== true ? 'unknown' : 'no';
}

/** Forma booleana (compatibilidad): `'unknown'` se lee como «no lo es». */
export async function isOperationalXrplAccount(address: string): Promise<boolean> {
  return (await resolveOperationalAccount(address)) === 'yes';
}

/**
 * Filtra los handoffs pendientes que chocan con el asiento (mismo nonce,
 * userOp distinto). Puro: decodifica el nonce de los bytes persistidos.
 * Un hash idéntico NO es conflicto (re-prepare idempotente del mismo op).
 */
export function findNonceSeatConflicts<T extends { userOpData: string; userOpHash: string }>(
  rows: T[],
  nonce: bigint,
  newUserOpHash: string,
): T[] {
  const abi = AbiCoder.defaultAbiCoder();
  return rows.filter((r) => {
    if (r.userOpHash.toLowerCase() === newUserOpHash.toLowerCase()) return false;
    try {
      const op = abi.decode([PACKED_USER_OP_TUPLE], r.userOpData)[0];
      return BigInt(op.nonce) === nonce;
    } catch {
      return false; // fila corrupta — no puede reclamar el asiento
    }
  });
}

/** Default protection window (minutes) for a signature a client REPORTED but the ledger has not validated yet. */
export const DEFAULT_REPORTED_SIGNATURE_WINDOW_MIN = 15;

/**
 * What a fresh-node lookup said about the tx hash(es) a client reported for a
 * queued handoff (productizer-it13 §1.1):
 *   'validated'  — a VALIDATED Payment from the handoff account with its memo:
 *                  the seat is consumed, the row is signed;
 *   'pending'    — a node answered: not validated yet;
 *   'not-found'  — a node answered txnNotFound;
 *   'unreadable' — the ledger could not be read: never grounds to retire a seat;
 *   'mismatch'   — every reported hash is somebody else's tx: the report is ignored.
 */
export type SeatReportVerdict = 'validated' | 'failed' | 'pending' | 'not-found' | 'unreadable' | 'mismatch';

export interface SeatConflictClassification<T> {
  /** Unsigned drafts past the TTL and not protected by a young report: invalidated without error. */
  stale: T[];
  /** Everything that still holds the seat — includes `signed` and `reportedInFlight`. */
  fresh: T[];
  /** Signed (`signedAt`) or proven signed now by a reported hash: never TTL, release or supersede. */
  signed: T[];
  /** Subset of `signed` proven by a reported hash in this pass: the caller marks them. */
  validatedByLedger: T[];
  /** Reported signed, not validated yet (or the ledger unreadable): fresh and NEVER supersedable. */
  reportedInFlight: T[];
  /**
   * Validated with a FAILING result (tec*): the Payment entered a ledger but
   * delivered no XRP, so FAssets can never direct-mint it. The seat is free —
   * the caller marks the row ledger-failed (never «signed»).
   */
  ledgerFailed: T[];
  /** Unsigned with its LastLedgerSequence still ahead of the validated ledger: it can STILL land — no clock retires it. */
  aheadOfLls: T[];
  /** Subset of `aheadOfLls` whose window could not be read: never displaced, and never on a clock either. */
  aheadUnverified: T[];
  /** Rows with an LLS the ledger could not decide (no validated ledger, or the past-LLS window unreadable). */
  unreadable: T[];
  /** Unsigned, unreported drafts with NO LastLedgerSequence: the old TTL rule decides them. */
  drafts: T[];
}

/** Fields the seat classifier reads off a queued handoff row. */
export interface SeatConflictRow {
  createdAt?: Date;
  signedAt?: string | null;
  signedLedgerResult?: string | null;
  reportedAt?: string | null;
  lastLedgerSequence?: number | null;
  composedLedgerIndex?: number | null;
}

/** Un entero positivo, o null (una LLS/ledger corrupta jamás decide un asiento). */
export function positiveLedgerIndex(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Un resultado validado tec*: entró en el ledger y falló. */
function isFailedLedgerResult(result: unknown): boolean {
  return typeof result === 'string' && /^tec/i.test(result);
}

/**
 * Un handoff preparado y NUNCA firmado es un asiento abandonado — no debe
 * tapiar al usuario para siempre (2026-07: el fundador lo golpeó preparando y
 * no firmando durante una prueba). Parte los conflictos por edad: los más
 * viejos que el TTL se invalidan SOLOS (el usuario cerró/no firmó a tiempo);
 * solo uno FRESCO — que podría estar firmado y en vuelo — hace esperar. Puro.
 * Sin `createdAt` → tratado como fresco (defecto seguro: preserva el guard).
 *
 * productizer-it13 §1.1 — A REPORTED SIGNATURE IS NOT A DRAFT. `/handoff/signed`
 * answers PENDING_LEDGER while the Payment validates, and the only other marker
 * is the executor sweep: with the executor stopped or slow past the TTL, the
 * next prepare invalidated a signed 0xFE and composed its twin on the same nonce
 * (the 2026-08-21 incident, back). The caller looks the reported hash up on a
 * fresh node and injects the verdict (`reports.verdictOf`), so this stays pure:
 *   validated → signed · unreadable → fresh, never supersedable ·
 *   pending / not-found → fresh, never supersedable while the report is younger
 *   than `reports.windowMs` (a bound, so a report cannot hold a seat forever),
 *   then the normal TTL · mismatch or no report → the normal TTL.
 */
export function classifySeatConflicts<T extends SeatConflictRow>(
  conflicts: T[],
  ttlMs: number,
  nowMs: number,
  reports?: { verdictOf: (conflict: T) => SeatReportVerdict | undefined; windowMs: number },
  ledger?: { validatedLedgerIndex: number | null; windowOf: (conflict: T) => HandoffWindowVerdict | undefined },
): SeatConflictClassification<T> {
  const out: SeatConflictClassification<T> = {
    stale: [],
    fresh: [],
    signed: [],
    validatedByLedger: [],
    reportedInFlight: [],
    ledgerFailed: [],
    aheadOfLls: [],
    aheadUnverified: [],
    unreadable: [],
    drafts: [],
  };
  for (const c of conflicts) {
    // Una orden FIRMADA jamás caduca por TTL (incidente 2026-08-21): «vieja»
    // no significa «abandonada» cuando el executor va lento — significa dinero
    // comprometido esperando. El TTL solo entierra borradores sin firma.
    if (typeof c.signedAt === 'string' && c.signedAt) {
      // …salvo que el ledger diga que aquel Payment FALLÓ (tec*): entró, no
      // entregó XRP y el direct minting no puede ejecutarlo jamás. Eso no es
      // dinero esperando, es una lápida — y su asiento está libre (it15 §K1).
      if (isFailedLedgerResult(c.signedLedgerResult)) out.ledgerFailed.push(c);
      else {
        out.fresh.push(c);
        out.signed.push(c);
      }
      continue;
    }

    // ── LA FÍSICA DEL LEDGER manda sobre cualquier reloj (productizer-it15 §K1) ──
    // Un borrador con LastLedgerSequence solo puede entrar hasta ese ledger; hasta
    // entonces NO caduca (el TTL de 5 min era más corto que la ventana de la mesa
    // y el gemelo se firmaba en el mismo nonce), y pasado, solo se sustituye si la
    // ventana entera de la cuenta se leyó SIN su memo.
    const lls = positiveLedgerIndex(c.lastLedgerSequence);
    if (lls !== null) {
      const window = ledger?.windowOf(c);
      if (window?.state === 'signed') {
        out.fresh.push(c);
        out.signed.push(c);
        out.validatedByLedger.push(c);
        continue;
      }
      if (window?.state === 'failed') {
        out.ledgerFailed.push(c);
        continue;
      }
      const validated = ledger?.validatedLedgerIndex ?? null;
      if (validated === null) {
        out.fresh.push(c);
        out.unreadable.push(c);
        continue;
      }
      if (validated <= lls) {
        out.fresh.push(c);
        out.aheadOfLls.push(c);
        // Sin la ventana leída no se puede afirmar que NO esté firmado: sigue
        // ocupando el asiento y nadie lo desplaza, pero tampoco hay reloj.
        if (window?.state !== 'absent') out.aheadUnverified.push(c);
        continue;
      }
      if (window?.state === 'absent') {
        out.stale.push(c); // ventana pasada y leída entera sin su memo: no puede entrar jamás
        continue;
      }
      out.fresh.push(c);
      out.unreadable.push(c);
      continue;
    }

    // ── Filas SIN LastLedgerSequence (anteriores a it15, o el ledger estaba
    //    ilegible al componer): rige la regla antigua — TTL + informes verificados.
    const verdict = reports?.verdictOf(c);
    if (verdict === 'failed') {
      out.ledgerFailed.push(c);
      continue;
    }
    if (verdict === 'validated') {
      out.fresh.push(c);
      out.signed.push(c);
      out.validatedByLedger.push(c);
      continue;
    }
    if (verdict === 'unreadable') {
      out.fresh.push(c);
      out.reportedInFlight.push(c);
      continue;
    }
    if (verdict === 'pending' || verdict === 'not-found') {
      const reportedMs = typeof c.reportedAt === 'string' ? Date.parse(c.reportedAt) : NaN;
      // A report without a readable time counts from the row itself (it cannot be older).
      const sinceMs = Number.isFinite(reportedMs) ? reportedMs : c.createdAt?.getTime();
      if (sinceMs === undefined || nowMs - sinceMs < (reports?.windowMs ?? 0)) {
        out.fresh.push(c);
        out.reportedInFlight.push(c);
        continue;
      }
    }
    const age = c.createdAt ? nowMs - c.createdAt.getTime() : 0;
    if (age >= ttlMs) {
      out.stale.push(c);
    } else {
      out.fresh.push(c);
      out.drafts.push(c);
    }
  }
  return out;
}

/**
 * Looks each reported hash up with the injected verifier (the store's
 * `verifyHandoffPaymentOnLedger`, fresh node) and folds the answers into one
 * `SeatReportVerdict`: the first VALIDATED hash wins; a hash that is somebody
 * else's tx is ignored; any unreadable answer (or a verifier that throws) makes
 * the verdict unreadable — a seat is never retired on «could not read».
 */
export async function resolveReportedSignature(
  record: { xrplAddress: string; memoHex: string },
  txHashes: readonly string[],
  verify: (record: { xrplAddress: string; memoHex: string }, txHash: string) => Promise<HandoffLedgerVerdict>,
): Promise<{ verdict: SeatReportVerdict; txHash?: string; ledgerResult?: string }> {
  let unreadable = false;
  let pending = false;
  let notFound = false;
  let failed: { txHash: string; ledgerResult: string } | null = null;
  for (const txHash of txHashes) {
    let v: HandoffLedgerVerdict;
    try {
      v = await verify(record, txHash);
    } catch {
      unreadable = true;
      continue;
    }
    if (v.state === 'validated') {
      // productizer-it15 §K1 — un tec* validado NO es una firma que ocupe el
      // asiento: entró en el ledger y no entregó XRP, así que ese dispatch no
      // puede ejecutar nunca. Se sigue leyendo: un tesSUCCESS con el mismo memo
      // (el usuario firmó dos veces) mandaría sobre él.
      if (/^tec/i.test(v.result)) {
        failed = failed ?? { txHash, ledgerResult: v.result };
        continue;
      }
      return { verdict: 'validated', txHash, ledgerResult: v.result };
    }
    if (v.state === 'mismatch') continue;
    if (v.unreadable) unreadable = true;
    else if (/txnNotFound/i.test(v.detail)) notFound = true;
    else pending = true;
  }
  // Cualquier respuesta que aún podría convertirse en una firma viva manda sobre
  // el tec: liberar un asiento cuyo gemelo sigue en vuelo es el pago doble.
  if (unreadable) return { verdict: 'unreadable' };
  if (pending) return { verdict: 'pending' };
  if (notFound) return { verdict: 'not-found' };
  if (failed) return { verdict: 'failed', ...failed };
  return { verdict: 'mismatch' };
}

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
const ZERO_BYTES32 =
  '0x0000000000000000000000000000000000000000000000000000000000000000';

/** Default safety buffer (bips) shaved off the net mint so a fee/round drift of a
 *  few drops between read and execution can't make supply exceed the FXRP that
 *  actually landed (which would revert the whole batch). */
const DEFAULT_SUPPLY_BUFFER_BIPS = 10n; // 0.10%

let cachedAssetManager: string | null = null;
let cachedFxrpToken: string | null = null;
let cachedMinRedeemUBA: bigint | null = null;

export function _resetAssetManagerCache(): void {
  cachedAssetManager = null;
  cachedFxrpToken = null;
  cachedMinRedeemUBA = null;
}

/**
 * FAssets redemption minimum (UBA), best-effort + cached. The mint disclosures
 * (E1/E3/vault, PA rail) say at ENTRY time that the road back to native XRP has
 * a protocol minimum — read live, never hardcoded (invariant #9; 5 XRP on
 * mainnet, 2026-07-24). Returns null if unreadable: the copy degrades to the
 * qualitative warning and the prepare NEVER fails because of this read.
 */
export async function readMinimumRedeemAmountUBA(provider: Provider): Promise<bigint | null> {
  if (cachedMinRedeemUBA != null) return cachedMinRedeemUBA;
  try {
    const { ethers } = await import('ethers');
    const am = new ethers.Contract(
      await resolveAssetManagerFxrp(provider),
      ['function minimumRedeemAmountUBA() view returns (uint256)'],
      provider,
    );
    cachedMinRedeemUBA = BigInt(await am.minimumRedeemAmountUBA());
    return cachedMinRedeemUBA;
  } catch {
    return null;
  }
}

// ── FAssets redemption fee (productizer-it9 §3.4 · exact anchors it13 §4.3) ──
//
// The unmint disclosures said «minus the protocol redemption fee» without a
// figure, and the frontend showed «unavailable (not zero)». The figure is a
// live protocol datum: `IAssetManager.getSettings()` → `AssetManagerSettings.Data`
// field `redemptionFeeBIPS` (uint16, field #25). Field NAME confirmed by the Flare
// Dev Hub (Operational Parameters: «Redemption fee — redemptionFee»); declaration
// ORDER and types from flare-foundation/fassets
// contracts/userInterfaces/data/AssetManagerSettings.sol (main, re-read 2026-09-14).
// The value read live from AssetManagerFXRP on mainnet that day: 18 BIPS (0.18%).
//
// No AssetManager ABI ships in this repo, so the reader walks the ABI encoding by
// hand. The struct carries dynamic members (`poolTokenSuffix` string #5, two
// uint256[] #49/#50), so it is encoded as a dynamic tuple: word 0 is the tuple
// offset, every field takes ONE head word (dynamic ones as offsets relative to
// the tuple) and the dynamic data follows the head in declaration order. The fee
// is answered only when EVERY anchor holds (live mainnet shape: 71 words,
// #5 = 1920, #49 = 1984, #50 = 2112, #11 = #12 = 6, #25 = 18):
//   1. word 0 is exactly 0x20 — one tuple, nothing before it;
//   2. the head is exactly 60 words and the tail is exactly what it declares:
//      #5 points right past the head, #49 right past the string, #50 right past
//      the first array, both arrays have the same length (governance sets them
//      together) and the return data ends right after the second array;
//   3. every static head word fits its declared Solidity type;
//   4. values the FAssets protocol itself enforces (SettingsInitializer.sol,
//      SettingsManagementFacet.sol, SettingsValidators.sol): assetDecimals =
//      assetMintingDecimals = 6 (FXRP, immutable), collateralReservationFeeBIPS
//      < 100%, redemptionFeeBIPS < 100%, redemptionDefaultFactorVaultCollateralBIPS
//      > 100%, vaultCollateralBuyForFlareFactorBIPS ≥ 100%, every liquidation
//      collateral factor > 100%.
// A field inserted or removed changes (2). An insertion and a removal that cancel
// out around #25 slide a neighbour into #25 or #26 and break (4): e.g. #24
// underlyingSecondsForPayment (900) landing on #25 pushes the fee (18) onto #26,
// which must exceed 100%. A settings struct that moved under us answers null
// («could not read»), NEVER a different field.

/** `AssetManagerSettings.Data` field types, in declaration order (flare-foundation/fassets main, 2026-09-14). */
export const SETTINGS_FIELD_TYPES: readonly string[] = [
  'address', 'address', 'address', 'address', 'address', 'string', 'address', 'address', 'address', 'address', // 0-9
  'address', 'uint8', 'uint8', 'bytes32', 'uint32', 'uint32', 'uint16', 'uint64', 'uint64', 'uint64', // 10-19
  'uint16', 'bool', 'uint64', 'uint64', 'uint64', 'uint16', 'uint32', 'uint32', 'uint64', 'uint128', // 20-29
  'uint16', 'uint16', 'uint128', 'uint64', 'uint64', 'uint64', 'uint64', 'uint64', 'uint64', 'uint64', // 30-39
  'uint64', 'uint32', 'uint64', 'uint64', 'uint64', 'uint64', 'uint64', 'uint32', 'uint64', 'uint256[]', // 40-49
  'uint256[]', 'uint64', 'uint64', 'uint64', 'uint64', 'uint16', 'uint64', 'uint64', 'uint32', 'uint32', // 50-59
];
export const SETTINGS_FIELD_COUNT = 60;
export const SETTINGS_REDEMPTION_FEE_BIPS_INDEX = 25;
const SETTINGS_POOL_TOKEN_SUFFIX_INDEX = 5; // string — dynamic
const SETTINGS_ASSET_DECIMALS_INDEX = 11; // uint8
const SETTINGS_ASSET_MINTING_DECIMALS_INDEX = 12; // uint8
const SETTINGS_COLLATERAL_RESERVATION_FEE_BIPS_INDEX = 16; // uint16
const SETTINGS_REDEMPTION_DEFAULT_FACTOR_VAULT_BIPS_INDEX = 26; // uint32
const SETTINGS_BUY_FOR_FLARE_FACTOR_BIPS_INDEX = 41; // uint32
const SETTINGS_LIQUIDATION_FACTORS_INDEX = 49; // uint256[] — dynamic
const SETTINGS_LIQUIDATION_VAULT_FACTORS_INDEX = 50; // uint256[] — dynamic
const FXRP_DECIMALS = 6n;
const SETTINGS_MAX_BIPS = 10_000n;
const MAX_POOL_TOKEN_SUFFIX_BYTES = 64n;
const MAX_LIQUIDATION_STEPS = 16n;
const SETTINGS_UINT_BITS: Readonly<Record<string, bigint>> = {
  address: 160n,
  uint8: 8n,
  uint16: 16n,
  uint32: 32n,
  uint64: 64n,
  uint128: 128n,
};
const REDEMPTION_FEE_CACHE_MS = 10 * 60_000;
let cachedRedemptionFee: { bips: number; atMs: number } | null = null;

export function _resetRedemptionFeeCache(): void {
  cachedRedemptionFee = null;
}

/** Pure: `redemptionFeeBIPS` out of the raw `getSettings()` return data, or null unless every anchor holds. */
export function decodeRedemptionFeeBipsFromSettings(raw: string): number | null {
  const hex = typeof raw === 'string' ? raw.replace(/^0x/i, '') : '';
  if (!hex || hex.length % 64 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) return null;
  const words = hex.length / 64;
  const word = (i: number): bigint | null =>
    Number.isSafeInteger(i) && i >= 0 && i < words ? BigInt('0x' + hex.slice(i * 64, i * 64 + 64)) : null;

  // (1) One dynamic tuple, and nothing before it.
  if (word(0) !== 32n) return null;
  const base = 1;
  const at = (offsetBytes: bigint): number => base + Number(offsetBytes / 32n);
  const headBytes = BigInt(SETTINGS_FIELD_COUNT * 32);

  // (2) The head is exactly 60 words and the tail is exactly what it declares.
  if (word(base + SETTINGS_POOL_TOKEN_SUFFIX_INDEX) !== headBytes) return null;
  const suffixBytes = word(at(headBytes));
  if (suffixBytes === null || suffixBytes > MAX_POOL_TOKEN_SUFFIX_BYTES) return null;
  const liquidationOffset = headBytes + 32n * (1n + (suffixBytes + 31n) / 32n);
  if (word(base + SETTINGS_LIQUIDATION_FACTORS_INDEX) !== liquidationOffset) return null;
  const steps = word(at(liquidationOffset));
  if (steps === null || steps < 1n || steps > MAX_LIQUIDATION_STEPS) return null;
  const vaultOffset = liquidationOffset + 32n * (1n + steps);
  if (word(base + SETTINGS_LIQUIDATION_VAULT_FACTORS_INDEX) !== vaultOffset) return null;
  if (word(at(vaultOffset)) !== steps) return null;
  if (words !== at(vaultOffset) + 1 + Number(steps)) return null;

  // (3) Every static head word fits its declared type (all 60 exist: the string
  //     length word right after the head was read above).
  const head = (i: number): bigint => word(base + i) as bigint;
  for (let i = 0; i < SETTINGS_FIELD_COUNT; i++) {
    const type = SETTINGS_FIELD_TYPES[i];
    if (type === 'bool') {
      if (head(i) > 1n) return null;
    } else if (type in SETTINGS_UINT_BITS) {
      if (head(i) >> SETTINGS_UINT_BITS[type] !== 0n) return null;
    }
  }

  // (4) Values the FAssets protocol itself enforces.
  if (head(SETTINGS_ASSET_DECIMALS_INDEX) !== FXRP_DECIMALS) return null;
  if (head(SETTINGS_ASSET_MINTING_DECIMALS_INDEX) !== FXRP_DECIMALS) return null;
  if (head(SETTINGS_COLLATERAL_RESERVATION_FEE_BIPS_INDEX) >= SETTINGS_MAX_BIPS) return null;
  if (head(SETTINGS_REDEMPTION_DEFAULT_FACTOR_VAULT_BIPS_INDEX) <= SETTINGS_MAX_BIPS) return null;
  if (head(SETTINGS_BUY_FOR_FLARE_FACTOR_BIPS_INDEX) < SETTINGS_MAX_BIPS) return null;
  for (let k = 1; k <= Number(steps); k++) {
    if ((word(at(liquidationOffset) + k) as bigint) <= SETTINGS_MAX_BIPS) return null;
  }
  const bips = head(SETTINGS_REDEMPTION_FEE_BIPS_INDEX);
  if (bips >= SETTINGS_MAX_BIPS) return null;
  return Number(bips);
}

/**
 * The FAssets redemption fee in BIPS, read live from AssetManagerFXRP, cached
 * 10 min (governance cannot change it faster than `minUpdateRepeatTime`, 1 day
 * on mainnet). null when unreadable — the disclosure then says so; it must
 * never render as 0 (invariant #6).
 */
export async function readRedemptionFeeBips(provider: Provider): Promise<number | null> {
  const now = Date.now();
  if (cachedRedemptionFee && now - cachedRedemptionFee.atMs < REDEMPTION_FEE_CACHE_MS) {
    return cachedRedemptionFee.bips;
  }
  try {
    const { ethers } = await import('ethers');
    const to = await resolveAssetManagerFxrp(provider);
    const raw = await provider.call({ to, data: ethers.id('getSettings()').slice(0, 10) });
    const bips = decodeRedemptionFeeBipsFromSettings(raw);
    if (bips == null) return null;
    cachedRedemptionFee = { bips, atMs: now };
    return bips;
  } catch {
    return null;
  }
}

/**
 * Estimated fee on a redemption of `amountUBA` (FXRP base units, 6 dec): the
 * protocol deducts `amount × bips / 10000` from the XRP the agent pays. An
 * ESTIMATE — a partially fulfilled request is charged on what it redeems.
 */
export function estimateRedemptionFee(
  amountUBA: bigint,
  bips: number | null,
): { redemptionFeeBips: number | null; redemptionFeeFxrp: number | null } {
  if (bips == null || !Number.isInteger(bips) || bips < 0) {
    return { redemptionFeeBips: null, redemptionFeeFxrp: null };
  }
  const feeUBA = (amountUBA * BigInt(bips)) / 10_000n;
  return { redemptionFeeBips: bips, redemptionFeeFxrp: Number(feeUBA) / 1_000_000 };
}

/**
 * The disclosure sentence for an `estimateRedemptionFee` result — the figure, or
 * a line that says it could not be read and is NOT zero (invariant #6). Shared by
 * every prepare that redeems FXRP to XRP so the wording never drifts.
 */
export function redemptionFeeDisclosureLine(fee: { redemptionFeeBips: number | null; redemptionFeeFxrp: number | null }): string {
  return fee.redemptionFeeBips != null
    ? `FAssets redemption fee (current protocol setting on AssetManagerFXRP): ${fee.redemptionFeeBips / 100}% of the amount — about ${fee.redemptionFeeFxrp} FXRP, deducted by the protocol from the XRP the agent pays (an estimate: a partially fulfilled request is charged on what it actually redeems).`
    : 'FAssets redemption fee: the current figure could not be read from AssetManagerFXRP right now. It is NOT zero — the protocol deducts it from the XRP the agent pays.';
}

export async function resolveAssetManagerFxrp(provider: Provider): Promise<string> {
  if (cachedAssetManager) return cachedAssetManager;
  const { ethers } = await import('ethers');
  const registry = new ethers.Contract(FLARE_CONTRACT_REGISTRY, REGISTRY_ABI, provider);
  const addr: string = await registry.getContractAddressByName('AssetManagerFXRP');
  if (!addr || addr === ZERO_ADDR || !ADDRESS_RE.test(addr)) {
    throw new Error('FXRP_ASSET_MANAGER_UNRESOLVED: registry returned no AssetManagerFXRP');
  }
  cachedAssetManager = ethers.getAddress(addr);
  return cachedAssetManager;
}

/**
 * Camino de VUELTA (unmint): AssetManagerFXRP.redeemAmount — sub-lote (no exige
 * lotes enteros; mínimo on-chain = minimumRedeemAmountUBA). El burn del FXRP es
 * inmediato al ejecutar; el XRP lo paga un agente FAssets DESPUÉS, menos la fee
 * de redención del protocolo. Fulfilment parcial emite RedemptionAmountIncomplete.
 */
const ASSET_MANAGER_REDEEM_ABI = [
  'function redeemAmount(uint256 _amountUBA, string _redeemerUnderlyingAddressString, address _executor) returns (uint256)',
  // Simetría con la entrada: igual que el XRP ENTRA con destination tag, puede
  // SALIR hacia uno. FAssets `redeemWithTag` (verificado on-chain:
  // redeemWithTagSupported()==true en FXRP mainnet) entrega el XRP al omnibus del
  // exchange CON el tag del user → atribución automática. Tag uint256 (cabe en 32 bits).
  'function redeemWithTag(uint256 _amountUBA, string _redeemerUnderlyingAddressString, address _executor, uint256 _destinationTag) returns (uint256)',
];

/** Un destination tag XRPL es un uint32 (0 … 2^32−1). */
const XRPL_DEST_TAG_MAX = 4294967295n;

/**
 * Executor de la REDENCIÓN: la dirección del executor 0xFE de Astryum cuando
 * hay clave configurada. FAssets deja ejecutar `redemptionPaymentDefault` al
 * redeemer O al executor registrado — y en el carril PA el redeemer es el
 * propio Personal Account (msg.sender del batch): sin executor, reclamar un
 * default exigiría OTRA firma del usuario con proof FDC de impago. La fee del
 * executor de redención viaja en msg.value y va a 0 a propósito (el PA no
 * lleva FLR); nuestro executor rescata por deber, no por incentivo. Sin clave
 * → address(0), exactamente como el camino EVM (allí el redeemer es la wallet
 * del usuario y puede reclamar el default por sí misma).
 */
export async function resolveRedemptionExecutor(): Promise<string> {
  const pk = process.env.FLARE_EXECUTOR_PK;
  if (!pk) return ZERO_ADDR;
  try {
    const { ethers } = await import('ethers');
    return new ethers.Wallet(pk).address;
  } catch {
    return ZERO_ADDR;
  }
}

/**
 * Call de redención para un batch 0xFE: quema `amountUBA` de FXRP del PA
 * (msg.sender del executeUserOp) y pide el pago en XRP nativo a
 * `xrplDestination`. Astryum solo CONSTRUYE la call — la autoriza la firma
 * del Payment en Xaman, como todo lo demás del dispatch (invariantes #1/#8).
 */
export async function buildRedeemToXrplCall(
  provider: Provider,
  input: { amountUBA: bigint; xrplDestination: string; destinationTag?: number | bigint },
): Promise<EncodedAction> {
  if (input.amountUBA <= 0n) throw new Error('REDEEM_BAD_AMOUNT: amountUBA must be > 0');
  const { ethers } = await import('ethers');
  const assetManager = await resolveAssetManagerFxrp(provider);
  const iface = new ethers.Interface(ASSET_MANAGER_REDEEM_ABI);
  const executor = await resolveRedemptionExecutor();

  // Con tag → redeemWithTag (custodial: al omnibus del exchange con el tag del
  // user). Sin tag → redeemAmount (a una r-address soberana). El tag debe caber
  // en 32 bits; 0 es un tag válido, así que solo se usa el carril con-tag cuando
  // se pasa explícitamente.
  if (input.destinationTag !== undefined && input.destinationTag !== null) {
    const tag = BigInt(input.destinationTag);
    if (tag < 0n || tag > XRPL_DEST_TAG_MAX) throw new Error('REDEEM_BAD_TAG: destinationTag must fit in 32 bits');
    return {
      to: assetManager,
      value: '0',
      calldata: iface.encodeFunctionData('redeemWithTag', [input.amountUBA, input.xrplDestination, executor, tag]),
    };
  }

  return {
    to: assetManager,
    value: '0',
    calldata: iface.encodeFunctionData('redeemAmount', [input.amountUBA, input.xrplDestination, executor]),
  };
}

/** Saldo FXRP LIBRE de una cuenta (UBA) — lo redimible sin tocar posiciones. */
export async function readFxrpBalance(provider: Provider, holder: string): Promise<bigint> {
  const { ethers } = await import('ethers');
  const erc20 = new ethers.Contract(
    await resolveFxrpToken(provider),
    ['function balanceOf(address) view returns (uint256)'],
    provider,
  );
  return BigInt(await erc20.balanceOf(holder));
}

/** FXRP ERC-20 address, resolved live via AssetManagerFXRP.fAsset() (invariant #9). */
export async function resolveFxrpToken(provider: Provider): Promise<string> {
  if (cachedFxrpToken) return cachedFxrpToken;
  const { ethers } = await import('ethers');
  const am = new ethers.Contract(await resolveAssetManagerFxrp(provider), ASSET_MANAGER_ABI, provider);
  const addr: string = await am.fAsset();
  if (!addr || addr === ZERO_ADDR || !ADDRESS_RE.test(addr)) {
    throw new Error('FXRP_TOKEN_UNRESOLVED: AssetManagerFXRP returned no fAsset');
  }
  cachedFxrpToken = ethers.getAddress(addr);
  return cachedFxrpToken;
}

export interface DirectMintParams {
  fxrpToken: string;
  /** Core Vault XRPL address — the Payment Destination. */
  paymentAddress: string;
  minFeeUBA: bigint;
  feeBIPS: bigint;
  executorFeeUBA: bigint;
  granularityUBA: bigint;
}

/** Read all direct-minting settings live from AssetManagerFXRP. */
export async function readDirectMintParams(provider: Provider): Promise<DirectMintParams> {
  const { ethers } = await import('ethers');
  const am = new ethers.Contract(await resolveAssetManagerFxrp(provider), ASSET_MANAGER_ABI, provider);
  const [fxrpToken, paymentAddress, minFeeUBA, feeBIPS, executorFeeUBA, granularityUBA] =
    await Promise.all([
      am.fAsset(),
      am.directMintingPaymentAddress(),
      am.getDirectMintingMinimumFeeUBA(),
      am.getDirectMintingFeeBIPS(),
      am.getDirectMintingExecutorFeeUBA(),
      am.assetMintingGranularityUBA(),
    ]);
  return {
    fxrpToken: ethers.getAddress(fxrpToken),
    paymentAddress,
    minFeeUBA: BigInt(minFeeUBA),
    feeBIPS: BigInt(feeBIPS),
    executorFeeUBA: BigInt(executorFeeUBA),
    granularityUBA: BigInt(granularityUBA) || 1n,
  };
}

export interface NetMintBreakdown {
  grossUBA: bigint;
  mintingFeeUBA: bigint;
  executorFeeUBA: bigint;
  /** FXRP that actually lands in the Personal Account (gross − fees). */
  netToPersonalAccountUBA: bigint;
  bufferUBA: bigint;
  /** Amount the batch should supply as collateral: net − buffer, floored to granularity. */
  supplyUBA: bigint;
}

/**
 * Post-fee accounting (decision #4). The batch must supply the FXRP that REALLY
 * minted (gross − minting fee − executor fee), minus a small buffer, floored to
 * minting granularity. Supplying the gross would revert the batch on insufficient
 * FXRP. Throws if nothing is left after fees.
 */
export function computeNetMint(
  grossUBA: bigint,
  p: Pick<DirectMintParams, 'minFeeUBA' | 'feeBIPS' | 'executorFeeUBA' | 'granularityUBA'>,
  bufferBips: bigint = DEFAULT_SUPPLY_BUFFER_BIPS,
): NetMintBreakdown {
  if (grossUBA <= 0n) throw new Error('DIRECT_MINT_BAD_AMOUNT: grossUBA must be > 0');
  const pctFee = (grossUBA * p.feeBIPS) / 10_000n;
  const mintingFeeUBA = pctFee > p.minFeeUBA ? pctFee : p.minFeeUBA;
  const netToPersonalAccountUBA = grossUBA - mintingFeeUBA - p.executorFeeUBA;
  if (netToPersonalAccountUBA <= 0n) {
    throw new Error(
      `DIRECT_MINT_INSUFFICIENT: gross ${grossUBA} ≤ fees (mint ${mintingFeeUBA} + exec ${p.executorFeeUBA})`,
    );
  }
  const bufferUBA = (netToPersonalAccountUBA * bufferBips) / 10_000n;
  const beforeFloor = netToPersonalAccountUBA - bufferUBA;
  const gran = p.granularityUBA > 0n ? p.granularityUBA : 1n;
  const supplyUBA = (beforeFloor / gran) * gran; // floor to granularity
  if (supplyUBA <= 0n) {
    throw new Error('DIRECT_MINT_INSUFFICIENT: nothing left to supply after buffer/granularity');
  }
  return {
    grossUBA,
    mintingFeeUBA,
    executorFeeUBA: p.executorFeeUBA,
    netToPersonalAccountUBA,
    bufferUBA,
    supplyUBA,
  };
}

/**
 * Invariant #6 — the fees a mint-coupled 0xFE dispatch charges out of the XRP
 * paid, serialized for the prepare disclosure. EVERY XRPL-rail response built
 * from a direct-mint handoff must spread this in: the executor's fee is real
 * money and the user sees it before signing, on every surface.
 */
export function mintFeeDisclosure(
  net: Pick<NetMintBreakdown, 'mintingFeeUBA' | 'executorFeeUBA'>,
): { mintingFeeXrp: number; executorFeeXrp: number } {
  const DROPS = 1_000_000;
  return {
    mintingFeeXrp: Number(net.mintingFeeUBA) / DROPS,
    executorFeeXrp: Number(net.executorFeeUBA) / DROPS,
  };
}

/** Encode IPersonalAccount.executeUserOp(Call[]) calldata from the inner batch. */
export async function buildExecuteUserOpCallData(actions: EncodedAction[]): Promise<string> {
  if (!actions.length) throw new Error('DIRECT_MINT_EMPTY_BATCH');
  const { ethers } = await import('ethers');
  const calls = actions.map((a) => {
    if (!ADDRESS_RE.test(a.to)) throw new Error(`DIRECT_MINT_BAD_TARGET: ${a.to}`);
    return { target: a.to, value: BigInt(a.value || '0'), data: a.calldata };
  });
  const iface = new ethers.Interface(PERSONAL_ACCOUNT_ABI);
  return iface.encodeFunctionData('executeUserOp', [calls]);
}

export interface PackedUserOp {
  /** ABI-encoded PackedUserOperation = the `_data` delivered off-chain to the executor. */
  dataHex: string;
  /** keccak256(dataHex) — committed in the 42-byte memo. */
  userOpHash: string;
}

/**
 * Build `_data = abi.encode(PackedUserOperation)` + its hash. Only sender, nonce,
 * callData are meaningful on-chain; the rest are empty (not validated).
 */
export async function buildPackedUserOp(input: {
  sender: string;
  nonce: bigint;
  callData: string;
}): Promise<PackedUserOp> {
  const { ethers } = await import('ethers');
  const userOp = {
    sender: ethers.getAddress(input.sender),
    nonce: input.nonce,
    initCode: '0x',
    callData: input.callData,
    accountGasLimits: ZERO_BYTES32,
    preVerificationGas: 0n,
    gasFees: ZERO_BYTES32,
    paymasterAndData: '0x',
    signature: '0x',
  };
  const dataHex = ethers.AbiCoder.defaultAbiCoder().encode(
    [PACKED_USER_OP_TUPLE],
    [userOp],
  );
  return { dataHex, userOpHash: ethers.keccak256(dataHex) };
}

/** Build the 42-byte `0xFE` memo via the official encoder (uppercase hex, no 0x). */
export async function build0xFEMemo(input: {
  walletId: number;
  executorFeeUBA: bigint;
  userOpHash: string;
}): Promise<string> {
  const { UserOpCustomInstruction } = await import('@flarenetwork/smart-accounts-encoder');
  const encoded = new UserOpCustomInstruction({
    walletId: input.walletId,
    executorFeeUBA: input.executorFeeUBA,
    userOperationHash: input.userOpHash as `0x${string}`,
  }).encode();
  return encoded.replace(/^0x/i, '').toUpperCase();
}

export interface DirectMintHandoff {
  personalAccount: string;
  fxrpToken: string;
  net: NetMintBreakdown;
  /** Off-chain payload delivered to the executor (ABI-encoded PackedUserOperation). */
  userOpData: string;
  userOpHash: string;
  /** XRPL memo (hex, uppercase, no 0x) — goes in Payment.Memos[0].Memo.MemoData. */
  memoHex: string;
  /**
   * productizer-it15 §K1 — el ledger hasta el que este Payment puede entrar
   * (`LastLedgerSequence` = ledger validado + ventana). Es lo que hace el asiento
   * de nonce decidible por física y no por reloj. null = el ledger validado no se
   * pudo leer al componer: el Payment sale SIN LastLedgerSequence (Xaman pondrá
   * la suya) y ese asiento se rige por el TTL antiguo.
   */
  lastLedgerSequence: number | null;
  /** Ledger validado en el momento de componer — el suelo de la ventana de búsqueda. */
  composedLedgerIndex: number | null;
  /**
   * productizer-it17 (contrato C3) — ISO en que el payload de Xaman de ESTE
   * dispatch deja de poder firmarse (`HANDOFF_PAYLOAD_EXPIRY_MIN`, 5 min por
   * defecto). El frontend pone ese mismo `expire` en el payload; el registro lo
   * guarda porque es lo que decide cuándo su asiento puede soltarse.
   */
  payloadExpiresAt: string;
  /** Minutos de vida del payload — lo que el cliente debe pasar a Xaman como `expire`. */
  payloadExpiryMin: number;
  /**
   * productizer it. 31 (§5) — ¿LEYÓ EL SERVIDOR EL SignerList DE ESTA CUENTA?
   *
   * `payloadExpiryMin` dice cuánto vive el payload; NO dice por qué. Una ventana
   * ordinaria sale igual de una lectura que dijo «firma sola» que de un timeout de
   * 6 s del nodo, de una cuenta operativa o de una ruta que nunca preguntó — y el
   * navegador (it. 29 §5) tomaba esa ventana por un veredicto «firma sola» y
   * dejaba de mirar el SignerList: una cuenta con quórum cuyo SignerList no se
   * pudo leer acababa en un payload de firma simple con la `Sequence`
   * autorrellenada. Esto es la mitad que faltaba: `'single'` y `'quorum'` son
   * lecturas; `'unknown'` es «no lo sé» y el navegador vuelve a preguntar.
   */
  signerListRead: SignerListRead;
  /**
   * productizer-it17 §1.3 — aviso EXPLÍCITO cuando este dispatch se compuso
   * desplazando un borrador cuya ventana no se pudo leer en ningún nodo y cuya
   * LLS quedó muy atrás. No es un error: es lo que hay que enseñar al usuario
   * antes de firmar, porque en el caso remoto de que aquel Payment hubiera
   * entrado, uno de los dos moriría InvalidNonce.
   */
  seatWarning?: string;
  /** UNSIGNED XRPL Payment for Xaman. No DestinationTag (would misroute the mint). */
  xrplPayment: {
    TransactionType: 'Payment';
    /** Pinned signer (incidente 2026-07-14: sin Account, Xaman firma con la
     *  cuenta ACTIVA — dos Payments salieron de la cuenta equivocada y sus
     *  bytes quedaron inejecutables). Con Account, Xaman exige firmar con
     *  EXACTAMENTE la cuenta para la que se construyó el userOp. */
    Account: string;
    Destination: string;
    Amount: string;
    Memos: Array<{ Memo: { MemoData: string } }>;
    /** Make Waves project tag (XRPL_SOURCE_TAG). Unlike a DestinationTag it does
     *  not affect FAssets routing — it labels the sender side on-ledger. */
    SourceTag?: number;
    /** Ventana de firma (it15 §K1): pasado este ledger el Payment ya no puede entrar. */
    LastLedgerSequence?: number;
  };
}

export interface BuildDirectMintInput {
  xrplAddress: string;
  /** Gross XRP the user pays, in drops (== FXRP UBA). */
  grossXrpDrops: bigint;
  /** Inner batch to run after the mint (e.g. approve+mint+enterMarket+borrow). */
  innerCalls: EncodedAction[];
  /** Operator-assigned wallet id; 0 if unassigned. */
  walletId?: number;
  bufferBips?: bigint;
  /**
   * true = invalida (supersede) los handoffs pendientes que ocupan el mismo
   * PA+nonce en vez de abortar con NonceSeatTakenError. Úsalo SOLO si aquel
   * Payment no llegó a firmarse — si se firmó, espera a que ejecute.
   */
  supersedePendingNonce?: boolean;
  /**
   * productizer-it13 §2.1 — the Astryum user id of the session preparing this
   * dispatch (null: no session, CLI, server job). Persisted on the handoff row:
   * that same user may release or supersede their own unsigned draft.
   */
  preparedByUserId?: string | null;
  /**
   * productizer-it13 §2.1 — true ONLY when the caller proved, server-side, that
   * the session may act on `xrplAddress` (proven address or verified founder —
   * services/flare/handoffAuthority.ts). With it, `supersedePendingNonce` may
   * displace a fresh unsigned draft prepared by somebody else; without it, only
   * the draft's own preparer may. Never derived from a request body.
   */
  supersedeAuthorized?: boolean;
  /**
   * productizer-it15 §K1 (contrato C2) — true si la sesión que prepara PRUEBA la
   * cuenta XRPL, se pida supersede o no. Viaja al registro: un borrador preparado
   * por quien NO prueba la cuenta lo puede desplazar el dueño probado (nadie más
   * que el dueño puede firmarlo, y el dueño no lo preparó), y sirve para decir a
   * la UI si reintentar liberando el asiento tiene alguna posibilidad.
   */
  preparedByProven?: boolean;
  /**
   * productizer-it21 §P1 1.1/1.4 (contrato del agente E, `seatProofFromVerdict`)
   * — true si la tienda de pruebas NO SE PUDO LEER al preparar. Es la mitad que
   * faltaba: `preparedByProven: false` significaba a la vez «esta sesión no tiene
   * la cuenta» y «no pude preguntar», y con lo segundo la fila quedaba marcada
   * como borrador de un extraño — desplazable. Un parpadeo de base de datos no
   * puede convertir la fila de nadie en asiento libre, así que una fila con esta
   * marca NO se aparta sola ni la desplaza un supersede ajeno.
   */
  preparedByProofUnreadable?: boolean;
  /**
   * productizer-it19 (contrato C1) — true si ESTE 0xFE lo compone un flujo
   * servidor de Astryum para una cuenta operativa suya (el put-to-work de la
   * mesa, el autopilot, la alimentación de anchors). Esas filas no tienen sesión
   * que pruebe nada, así que sin esta marca se leían como «borrador de un
   * extraño» y otro flujo servidor las apartaba en silencio con el payload aún
   * firmable (it18 R1 1.1). Una fila marcada no se desplaza sola JAMÁS.
   *
   * Se deduce además de la etiqueta de acción (`OPERATIONAL_HANDOFF_ACTIONS`
   * sobre una cuenta operativa), que es lo más seguro: las filas compuestas antes
   * de esta iteración quedan cubiertas sin tocar la base de datos, y un llamador
   * que olvide pasarla no vuelve a abrir el agujero.
   */
  serverComposed?: boolean;
  /**
   * productizer-it23 §Q1 1.3 — CUÁNTO VIVE DE VERDAD EL PAYLOAD QUE LLEVARÁ ESTE
   * 0xFE, en minutos. Por defecto, el de una firma simple
   * (`HANDOFF_PAYLOAD_EXPIRY_MIN`, 5). Una CEREMONIA multifirma crea sus payloads
   * de Xaman con `expire: 1440` porque un quórum firma a velocidad humana: si el
   * servidor compone ese dispatch con la ventana de una firma simple, a los seis
   * minutos el asiento se da por libre y —lo que mata la salida— el
   * `LastLedgerSequence` queda atrás, así que el consejo acaba firmando bytes que
   * ya no pueden entrar (it22 Q1 1.3: «la salida institucional multifirma no
   * puede completarse»).
   *
   * Declararlo aquí estira las DOS cosas a la vez: la caducidad del payload y la
   * ventana de ledger que la cubre. No se puede arreglar después: la
   * `LastLedgerSequence` va DENTRO de los bytes que se firman, así que sellar la
   * caducidad más tarde (`/handoff/payload-opened`) no salva una ceremonia lenta.
   *
   * REGLA DE USO: lo declara la RUTA que compone, en código
   * (`handoffCeremonyExpiryMin()` para una ceremonia) — **jamás** se toma del
   * cuerpo de la petición: alargar el payload alarga el asiento de nonce de esa
   * cuenta, y eso en manos de un extraño es tapiar el nonce ajeno. El servidor lo
   * acota igual a [1 min, 24 h] (`clampPayloadExpiryMin`).
   */
  payloadExpiryMin?: number;
  /**
   * productizer-it23 §Q1 1.3 — atajo de lo anterior: «a esto lo firma un quórum».
   * Equivale a `payloadExpiryMin: handoffCeremonyExpiryMin()` y es lo que una
   * ruta de consejo debería pasar, para no repetir el número por el repo.
   */
  signingCeremony?: boolean;
  /**
   * productizer it. 31 (§5) — lo que `signingCeremonyFor` LEYÓ, para que viaje
   * hasta la respuesta del prepare junto a la ventana que decidió. Opcional: una
   * ruta que declara la ceremonia en código sin leer nada declara `'quorum'` por
   * `signingCeremony`; el resto de silencios son `'unknown'`, nunca `'single'`.
   */
  signerListRead?: SignerListRead;
  /**
   * Ledgers que este Payment sigue siendo firmable (`LastLedgerSequence` = ledger
   * validado + ventana). Por defecto `HANDOFF_LLS_WINDOW` o, sin ella, la que
   * cubre la vida del payload de Xaman + 1 min (`defaultLastLedgerWindow`, ~90
   * ledgers ≈ 6 min con la caducidad por defecto de 5 min — it17 §L1). La mesa
   * del exchange pasa la suya, que sigue mandando sobre todo lo demás.
   */
  lastLedgerWindow?: number;
  /**
   * Which prepare route is building this dispatch ('e1', 'pa-repay',
   * 'vault-withdraw:firelight'…). Persisted on the handoff row as a LABEL only
   * — the admin unstick modal tags entrante/saliente with it. Never read by
   * the execution path.
   */
  action?: string;
  /**
   * Who signs the XRPL Payment — decides whether the Make Waves SourceTag goes
   * on it (see config/xrplSourceTag.ts). 'user' (default) = the owner signs in
   * their wallet. 'operational' = one of Astryum's own seeds signs it (anchor
   * feeding, the demo exchange omnibus): the tag must NEVER ride on those, or
   * our own scripted account counts as project activity (Make Waves T&C §7).
   */
  attribution?: 'user' | 'operational';
}

/**
 * Ventana plana anterior a it17 (~10 min): la que se estampaba sin mirar cuánto
 * vivía el payload. Se conserva como suelo histórico y referencia de los
 * llamadores que aún la fijan a mano; el defecto vivo es `defaultLastLedgerWindow`.
 */
export const DEFAULT_LAST_LEDGER_WINDOW = 150;
/** Techo de la ventana — y suelo de búsqueda de una fila sin `composedLedgerIndex`. */
export const MAX_LAST_LEDGER_WINDOW = 1000;
/** Suelo de la ventana: por debajo de esto un Payment no llega a entrar. */
export const MIN_LAST_LEDGER_WINDOW = 10;
/** Segundos que tarda en cerrar un ledger validado de XRPL (~3-4 s; 4 redondea al alza). */
const SECONDS_PER_LEDGER = SEAT_SECONDS_PER_LEDGER;

/**
 * productizer-it17 §L1 — LA VENTANA SE MIDE CONTRA EL PAYLOAD, NO CONTRA UN
 * NÚMERO REDONDO. La ventana plana de 150 ledgers (~10 min) era casi el doble de
 * lo que el payload de Xaman vive (5 min por defecto): cada composición
 * abandonada congelaba el asiento del omnibus ~6,7 min para todos los clientes
 * de la mesa (it16 R1 1.5) sin que nadie pudiera ya firmar nada desde el minuto
 * 5. Ahora la ventana es «lo que vive el payload + un minuto»: ~90 ledgers (6
 * min) con la caducidad por defecto. Sigue cubriendo entera la vida del payload
 * — que es lo que impide el gemelo — y ni un minuto más.
 */
export function defaultLastLedgerWindow(): number {
  // La fórmula vive con la caducidad del payload (handoffAuthority): son la misma
  // decisión, y separarlas fue lo que las dejó discrepar (it16 R1 1.1/1.5).
  return Math.min(Math.max(defaultSeatWindowLedgers(), MIN_LAST_LEDGER_WINDOW), MAX_LAST_LEDGER_WINDOW);
}

/**
 * La ventana pedida, la del entorno o la de defecto — siempre dentro de [10, 1000].
 *
 * productizer-it23 §Q1 1.3 — …Y NUNCA MÁS CORTA QUE LA VIDA DEL PAYLOAD. Si el
 * payload vive más que la ventana, pasan las dos cosas malas a la vez: el asiento
 * se declara libre con el payload aún firmable (el gemelo) y, sobre todo, lo que
 * se firme al final ya no puede entrar en el ledger — que es exactamente cómo una
 * ceremonia multifirma de 24 h se quedaba sin salida. Con una vida declarada, el
 * techo sube para cubrirla: un payload de 24 h necesita ~21 600 ledgers, y
 * acotarlo a 1000 sería volver a firmar bytes muertos.
 */
export function resolveLastLedgerWindow(requested?: number, opts?: { payloadExpiryMin?: number | null }): number {
  const asked = positiveLedgerIndex(requested) ?? positiveLedgerIndex(process.env.HANDOFF_LLS_WINDOW) ?? defaultLastLedgerWindow();
  const life = opts?.payloadExpiryMin;
  // Sin vida declarada, el comportamiento es exactamente el de it17.
  if (life === undefined || life === null) {
    return Math.min(Math.max(asked, MIN_LAST_LEDGER_WINDOW), MAX_LAST_LEDGER_WINDOW);
  }
  const floor = seatWindowLedgersFor(life); // los ledgers que cubren ese payload
  const ceiling = Math.max(MAX_LAST_LEDGER_WINDOW, floor);
  return Math.min(Math.max(Math.max(asked, floor), MIN_LAST_LEDGER_WINDOW), ceiling);
}

/**
 * productizer-it23 §Q1 1.3 — los minutos que vive el payload de ESTE dispatch.
 *
 * Orden: lo que declaró la ruta que compone (`payloadExpiryMin`, o el atajo
 * `signingCeremony`) manda; si no declaró nada y el autodetect está encendido, se
 * pregunta al ledger si esa cuenta firma por quórum (SignerList). Cualquier fallo
 * de lectura deja el defecto de siempre: «no pude leer» no estira ningún asiento.
 */
async function resolvePayloadExpiryMin(
  input: Pick<BuildDirectMintInput, 'payloadExpiryMin' | 'signingCeremony' | 'xrplAddress'>,
  readSignerQuorum?: (address: string) => Promise<'quorum' | 'single' | 'unknown'>,
  ctx?: { operationalAccount?: boolean },
): Promise<number> {
  if (input.payloadExpiryMin !== undefined && input.payloadExpiryMin !== null) {
    return clampPayloadExpiryMin(input.payloadExpiryMin);
  }
  if (input.signingCeremony === true) return handoffCeremonyExpiryMin();
  // productizer-it25 §2.1 — EL AUTODETECT NO ESTIRA EL ASIENTO DEL OMNIBUS. Una
  // cuenta que Astryum OPERA firma con su propia semilla o su relé, en el mismo
  // segundo: no hay quórum humano que espere. Su SignerList (el omnibus de la
  // mesa lleva una designación) habría estirado su asiento de nonce a 24 h — y
  // ese asiento sirve a TODOS los clientes de esa run. Una ruta que declare la
  // ceremonia en código sigue mandando: eso es una decisión, no una conjetura.
  if (ctx?.operationalAccount === true) return handoffPayloadExpiryMin();
  const autodetect = readSignerQuorum ?? (process.env.HANDOFF_QUORUM_AUTODETECT === 'true' ? defaultSignerQuorumReader : null);
  if (!autodetect) return handoffPayloadExpiryMin();
  try {
    const state = await autodetect(input.xrplAddress);
    if (state === 'quorum') {
      console.log(`[0xFE-handoff] ${input.xrplAddress} signs by quorum: composing with the ceremony window`);
      return handoffCeremonyExpiryMin();
    }
  } catch {
    /* un fallo de lectura jamás estira un asiento */
  }
  return handoffPayloadExpiryMin();
}

/** Lector por defecto del SignerList — perezoso, para no cargar el store sin necesidad. */
async function defaultSignerQuorumReader(address: string): Promise<'quorum' | 'single' | 'unknown'> {
  const store = await import('../../../services/flare/DirectMintHandoffStore');
  return store.readXrplSignerQuorum(address);
}

/**
 * productizer it. 31 (§5) — qué declara la fila sobre el SignerList de su cuenta.
 * Pura. `'single'` SOLO si quien compone lo leyó y lo dijo; una ceremonia declarada
 * en código cuenta como `'quorum'` (es una decisión, y el navegador la respeta ya
 * por la ventana); todo lo demás es `'unknown'`.
 */
export function signerListReadOf(
  input: Pick<BuildDirectMintInput, 'signerListRead' | 'signingCeremony'>,
): SignerListRead {
  const declared = input.signerListRead;
  if (declared === 'single' || declared === 'quorum' || declared === 'unknown') return declared;
  return input.signingCeremony === true ? 'quorum' : 'unknown';
}

/**
 * productizer-it25 §2.1 — LO QUE UNA RUTA QUE COMPONE UN 0xFE LE PASA AL BUILDER
 * CUANDO ESA CUENTA FIRMA POR QUÓRUM. **El fallo que esto cierra: `signingCeremony`
 * no tenía NI UN llamador.**
 *
 * El arreglo de it23 existía entero y nadie lo usaba: `grep signingCeremony` daba
 * cero fuera del servicio y sus tests, y `HANDOFF_QUORUM_AUTODETECT` no estaba
 * declarada en ningún entorno. Así que una salida institucional de un pote con
 * consejo seguía naciendo con el asiento de una firma simple (~6 min) mientras
 * cada miembro del quórum firmaba un payload de 24 h (`councilSigning.ts`:
 * `expire: 1440`): a los seis minutos la `LastLedgerSequence` quedaba atrás y el
 * consejo acababa firmando bytes que el ledger ya no admite. La salida multifirma
 * no podía completarse. Probar el builder no probaba la cadena.
 *
 * CÓMO SE SABE, Y CÓMO NO. No se adivina por la forma de la ruta: el mismo
 * `/pote-exit` lo usa un pote PERSONAL (manager == usuario, firma simple) y uno de
 * consejo. Se LEE el SignerList de la cuenta (`readXrplSignerQuorum` →
 * `account_info … signer_lists: true`, cacheado y con su propio timeout), que es
 * la única fuente que distingue las dos.
 *
 * Y LAS DOS REGLAS QUE NO SE TOCAN:
 *   · «no pude leer» JAMÁS estira una ventana. `'unknown'` — un nodo caído, un
 *     timeout, una respuesta ilegible — devuelve `{}`, es decir el comportamiento
 *     exacto de antes de esta iteración. Estirar a 24 h el asiento de nonce de
 *     una cuenta normal por un fallo nuestro sería tapiarle el nonce un día;
 *   · una cuenta que Astryum OPERA nunca se estira (ver `resolvePayloadExpiryMin`):
 *     su 0xFE lo firma nuestra semilla en el acto, y su asiento sirve a todos los
 *     clientes de la run.
 *
 * Nunca lanza: una ruta que compone una salida no puede caerse porque un nodo XRPL
 * no conteste.
 */
/**
 * productizer it. 31 (§5) — LO QUE EL SERVIDOR LEYÓ, DICHO APARTE DE LO QUE DECIDIÓ.
 *
 *   'quorum'  — se leyó el SignerList y lo hay: la ventana es la de la ceremonia;
 *   'single'  — se leyó y NO lo hay: la ventana ordinaria es un VEREDICTO;
 *   'unknown' — no se leyó (nodo caído, timeout, cuenta operativa, ruta que no
 *               preguntó): la ventana ordinaria es solo el defecto, y el
 *               navegador tiene que volver a mirar el SignerList antes de firmar.
 *
 * Es la distinción que it. 29 §5 dio por hecha sin que existiera: «a row composed
 * with a single signature's window IS a row it read this account for» — falso
 * para `'unknown'`, que también devuelve la ventana ordinaria.
 */
export type SignerListRead = 'single' | 'quorum' | 'unknown';

export async function signingCeremonyFor(
  xrplAddress: string,
  opts?: {
    readSignerQuorum?: (address: string) => Promise<'quorum' | 'single' | 'unknown'>;
    readOperationalAccount?: (address: string) => Promise<'yes' | 'no' | 'unknown'>;
  },
): Promise<{ signingCeremony?: true; signerListRead: SignerListRead }> {
  const account = typeof xrplAddress === 'string' ? xrplAddress.trim() : '';
  if (!account) return { signerListRead: 'unknown' };
  try {
    const operational = await (opts?.readOperationalAccount ?? resolveOperationalAccount)(account);
    // it. 31 (§5): una cuenta operativa no se estira Y no se lee — su SignerList
    // (la designación del omnibus) no decide cómo firma su 0xFE. Se declara
    // `'unknown'`, no `'single'`: nadie miró.
    if (operational === 'yes') return { signerListRead: 'unknown' };
  } catch {
    return { signerListRead: 'unknown' }; // sin saber si es nuestra, no se estira nada
  }
  try {
    const read = opts?.readSignerQuorum ?? defaultSignerQuorumReader;
    const state = await read(account);
    if (state === 'quorum') {
      console.log(`[0xFE-handoff] ${account} signs by quorum (SignerList): composing with the ceremony window`);
      return { signingCeremony: true, signerListRead: 'quorum' };
    }
    if (state === 'single') return { signerListRead: 'single' };
  } catch {
    /* un fallo de lectura jamás estira un asiento */
  }
  return { signerListRead: 'unknown' };
}

/** El «por qué» legible de una ventana ilegible — el usuario merece el motivo, no un código. */
function unreadableDetailOf<T extends { userOpHash: string }>(
  rows: T[],
  windows: Map<string, HandoffWindowVerdict>,
): string {
  for (const r of rows) {
    const w = windows.get(r.userOpHash);
    if (w?.state === 'unreadable') return `(${w.detail})`;
  }
  return '(the validated ledger could not be read)';
}

/** Minutos de más allá de su ventana que un asiento ilegible debe llevar para poder desplazarse (it17 §1.3). */
export const DEFAULT_UNREADABLE_DISPLACE_MIN = SEAT_DEFAULT_UNREADABLE_DISPLACE_MIN;

/** `HANDOFF_UNREADABLE_DISPLACE_MIN` en ms, con suelo de 5 min: nunca un desplazamiento «rápido». */
export function unreadableDisplaceGraceMs(): number {
  return seatUnreadableDisplaceGraceMs();
}

/**
 * productizer-it17 §1.3 — ¿la ventana de esta fila quedó MUY atrás? Se mide por
 * tiempo porque este caso es justo aquel en que el ledger no se puede leer: la
 * fila lleva viva más que su propia ventana (LLS − ledger de composición, a ~4 s
 * por ledger; sin esos datos, la ventana por defecto) MÁS el margen. Sin
 * `createdAt` no se puede fechar nada y la respuesta es no.
 */
export function seatWindowLongPast(
  row: { createdAt?: Date; lastLedgerSequence?: number | null; composedLedgerIndex?: number | null },
  nowMs: number,
): boolean {
  // Delegado en handoffAuthority (it19 §M1 1.2): la misma cuenta la usa el
  // release del store, y dos copias de esta regla es como se separaron antes.
  return seatWindowLongPastOf(row, nowMs, defaultLastLedgerWindow());
}

/**
 * productizer-it21 §P2 2.3 — CUÁNDO DEJA DE SER UN MURO. Segundos que faltan
 * para que un asiento ILEGIBLE pueda desplazarlo quien PRUEBA la cuenta (su
 * ventana + `HANDOFF_UNREADABLE_DISPLACE_MIN`). El 409 decía «vuelve a
 * intentarlo» sin decir cuándo, así que sobre una salida se leía como una espera
 * de 30 minutos a ciegas; con esta cifra la pantalla cuenta atrás de verdad.
 * `undefined` cuando la fila no se puede fechar, o cuando ya se puede desplazar.
 */
export function seatUnreadableDisplaceInSeconds(
  rows: Array<{ createdAt?: Date; lastLedgerSequence?: number | null; composedLedgerIndex?: number | null }>,
  nowMs: number,
): number | undefined {
  const waits: number[] = [];
  for (const row of rows) {
    const created = row.createdAt instanceof Date ? row.createdAt.getTime() : NaN;
    if (!Number.isFinite(created)) continue;
    const ledgers = seatWindowLedgersOf(row, defaultLastLedgerWindow());
    const readyAt = created + ledgers * SEAT_SECONDS_PER_LEDGER * 1000 + unreadableDisplaceGraceMs();
    if (readyAt > nowMs) waits.push(Math.ceil((readyAt - nowMs) / 1000));
  }
  return waits.length > 0 ? Math.max(...waits) : undefined;
}

/**
 * Cuánto falta para que el asiento se libere SOLO: lo que quede de ventana de
 * ledger (por física) o de TTL (filas sin ventana). Para la cuenta atrás de la
 * UI — it14 R5 §1.2: «Back» dejaba la reserva minutos sin decir cuántos.
 */
function seatSecondsLeft<T extends SeatConflictRow>(
  seat: SeatConflictClassification<T>,
  holders: T[],
  validatedLedgerIndex: number | null,
  ttlMs: number,
  nowMs: number,
): number | undefined {
  const seconds: number[] = [];
  if (validatedLedgerIndex !== null) {
    for (const c of holders) {
      const lls = positiveLedgerIndex(c.lastLedgerSequence);
      if (lls !== null && lls >= validatedLedgerIndex) seconds.push((lls - validatedLedgerIndex + 1) * SECONDS_PER_LEDGER);
    }
  }
  for (const c of holders) {
    if (!seat.drafts.includes(c)) continue;
    const age = c.createdAt ? nowMs - c.createdAt.getTime() : 0;
    seconds.push(Math.max(0, Math.ceil((ttlMs - age) / 1000)));
  }
  return seconds.length > 0 ? Math.max(...seconds) : undefined;
}

/**
 * Assemble the complete UNSIGNED `0xFE` direct-mint hand-off. Reads PA + nonce +
 * fees + Core Vault live, computes post-fee net, wraps the batch in a userOp, and
 * returns the XRPL Payment (for Xaman) plus the off-chain userOp bytes for the
 * executor. Astryum signs nothing.
 *
 * NOTE: `innerCalls` (the Kinetic ISO approve+mint+enterMarket+borrow batch) are
 * produced by the F3 wiring and passed in here; the supply amount must use
 * `net.supplyUBA`. This builder is the `0xFE` machinery; F3 fills the batch.
 */
export async function buildDirectMintHandoff(
  provider: Provider,
  input: BuildDirectMintInput,
  opts?: {
    params?: DirectMintParams;
    readValidatedLedgerIndex?: () => Promise<number | null>;
    /**
     * it23 §Q1 1.3 — ¿firma esta cuenta XRPL por quórum? Inyectable para los
     * tests; por defecto la lee el store (y solo con `HANDOFF_QUORUM_AUTODETECT`).
     */
    readSignerQuorum?: (address: string) => Promise<'quorum' | 'single' | 'unknown'>;
  },
): Promise<DirectMintHandoff> {
  // productizer-it13 §2.1 — an account Astryum operates only takes the 0xFE of
  // its own server flows; checked before any chain read or seat logic.
  //
  // productizer-it15 §3.4 (contrato C4) — …y sus SALIDAS. Un consejo operado por
  // Astryum que estuviera en la lista de entorno recibía 403 en `pote-exit` o
  // `pa-unmint`: una salida gateada por una lista nuestra, que es exactamente lo
  // que no puede pasar. Una etiqueta de salida pasa cuando la sesión prueba la
  // cuenta (o el fundador verificado); un extraño sigue sin poder tomar el asiento.
  //
  // productizer-it17 §1.6 (contrato C1) — la pregunta «¿opera Astryum esta
  // cuenta?» ya no la contesta solo la lista de entorno: el resolver registrado
  // (el omnibus declarado por una run de la mesa) cuenta igual.
  const isExit = isHandoffExitAction(input.action);
  const exitByOwner = isExit && (input.supersedeAuthorized === true || input.preparedByProven === true);
  const operationalState = await resolveOperationalAccount(input.xrplAddress);
  const operationalAccount = operationalState === 'yes';
  const serverFlowAction = OPERATIONAL_HANDOFF_ACTIONS.has(input.action ?? '');
  const ownServerFlow = operationalAccount && serverFlowAction;
  if (operationalAccount && !serverFlowAction && !exitByOwner) {
    throw new OperationalAccountHandoffError(
      `OPERATIONAL_ACCOUNT_HANDOFF_REFUSED: ${input.xrplAddress} is an XRPL account Astryum operates; it only takes the 0xFE ` +
        `dispatches of Astryum's own server flows (or an EXIT prepared by a session that proved the account), not ` +
        `'${input.action ?? 'unlabelled'}'.`,
    );
  }
  // productizer-it19 §M1 1.4 — «NO PUDE LEER» NO CONCEDE EL ASIENTO DEL OMNIBUS.
  // Con el registro de runs nunca leído, una cuenta operativa se leía como cuenta
  // de usuario y cualquiera podía componer contra ella y quedarse su asiento de
  // nonce (it18 R1 1.4). Mientras no se sepa, una ENTRADA ajena espera. La salida
  // pasa siempre: «no pude leer» jamás es castigo sobre una salida.
  //
  // productizer-it21 §P1 1.6 — …Y UNA ETIQUETA DE SALIDA NO ES UNA PRUEBA. Hasta
  // aquí bastaba `isExit` para pasar, pero `action` la fija la ruta y
  // `xrplAddress` viene del CUERPO: cualquiera podía escribir el omnibus de la
  // mesa en un `/pa-unmint/prepare` y, con el registro de runs ilegible, componer
  // contra el asiento que sirve a todos los clientes de esa run (it20 N1 1.6).
  // La salida sigue sin gatearse: no recibe un «no» — recibe el MISMO 503
  // reintentable, que es lo que «no pude leer» significa. Y para pasarlo basta
  // probar la cuenta (`exitByOwner`), que es lo que el dueño de verdad puede hacer.
  if (operationalState === 'unknown' && !serverFlowAction && !exitByOwner) {
    throw new SeatStateUnreadableError(
      `SEAT_STATE_UNREADABLE: Astryum cannot tell right now whether ${input.xrplAddress} is an account it operates (the run ` +
        `register could not be read), and composing a 0xFE against an operational account would take its nonce seat. ` +
        `Nothing moved and nothing was signed — try again in a minute` +
        (isExit
          ? `. If this account is yours, signing in with it (or binding it) proves it and this exit composes straight away.`
          : `.`),
    );
  }
  const params = opts?.params ?? (await readDirectMintParams(provider));
  const net = computeNetMint(input.grossXrpDrops, params, input.bufferBips);

  const personalAccount = await resolvePersonalAccount(provider, input.xrplAddress);
  const nonce = await getNonce(provider, personalAccount);

  const callData = await buildExecuteUserOpCallData(input.innerCalls);
  const { dataHex, userOpHash } = await buildPackedUserOp({
    sender: personalAccount,
    nonce,
    callData,
  });
  // Executor fee committed in the memo = the live direct-minting executor fee (decision #3).
  const memoHex = await build0xFEMemo({
    walletId: input.walletId ?? 0,
    executorFeeUBA: params.executorFeeUBA,
    userOpHash,
  });

  // ── LA VENTANA DE LEDGER DE ESTE PAYMENT (productizer-it15 §K1) ────────────
  // Todo 0xFE sale con LastLedgerSequence: pasado ese ledger el Payment ya no
  // puede entrar, y eso — no un reloj de 5 min — es lo que decide cuándo su
  // asiento de nonce queda libre. Si el ledger validado no se puede leer, se
  // compone SIN ella (Xaman pondrá la suya) y esa fila se rige por el TTL
  // antiguo: «no pude leer» nunca inventa una ventana.
  const readValidatedLedger =
    opts?.readValidatedLedgerIndex ??
    (async () => {
      const store = await import('../../../services/flare/DirectMintHandoffStore');
      return store.readValidatedLedgerIndex();
    });
  let composedLedgerIndex: number | null = null;
  try {
    composedLedgerIndex = positiveLedgerIndex(await readValidatedLedger());
  } catch {
    composedLedgerIndex = null; // sin DB/nodo (scripts CLI) — se compone sin ventana
  }
  // ── CUÁNTO VIVE EL PAYLOAD DE ESTE 0xFE (productizer-it23 §Q1 1.3) ─────────
  // Una firma simple vive 5 min; una CEREMONIA multifirma, 24 h (`expire: 1440`),
  // porque un quórum firma a velocidad humana. Componer una ceremonia con la
  // ventana de una firma simple soltaba su asiento a los 6 min y dejaba su
  // `LastLedgerSequence` atrás: el consejo firmaba bytes que ya no pueden entrar
  // y la salida institucional multifirma no podía completarse (it22 Q1 1.3).
  //
  // Se decide AQUÍ, al componer, porque la `LastLedgerSequence` va dentro de los
  // bytes firmados: no hay forma de alargarla después. La ruta que compone para
  // un consejo lo declara (`signingCeremony` / `payloadExpiryMin`); si no declaró
  // nada, se puede preguntar al ledger si esa cuenta tiene SignerList — pero solo
  // con `HANDOFF_QUORUM_AUTODETECT=true`, y un «no pude leer» NUNCA estira nada
  // (estirar a 24 h el asiento de una cuenta normal sería tapiar su nonce un día).
  const payloadExpiryMin = await resolvePayloadExpiryMin(input, opts?.readSignerQuorum, { operationalAccount });
  // El suelo de ventana solo se impone cuando este payload vive MÁS que uno
  // normal: con la vida de siempre, la ventana la deciden exactamente quien la
  // pide y `HANDOFF_LLS_WINDOW`, como en it17 — nada cambia para una firma simple.
  const longerThanUsual = payloadExpiryMin > handoffPayloadExpiryMin() ? payloadExpiryMin : null;
  const lastLedgerSequence =
    composedLedgerIndex !== null
      ? composedLedgerIndex + resolveLastLedgerWindow(input.lastLedgerWindow, { payloadExpiryMin: longerThanUsual })
      : null;
  // productizer-it17 (contrato C3) — la OTRA caducidad: la del payload de Xaman.
  // Viaja en el registro porque es la que decide cuándo el asiento puede
  // soltarse (mientras el payload pueda firmarse, soltarlo es crear el gemelo).
  const payloadExpiresAt = handoffPayloadExpiresAt(Date.now(), payloadExpiryMin);

  // productizer-it17 §1.4 — ¿ES ESTE PREPARE DE LA PROPIA CUENTA? Una sesión que
  // PRUEBA la cuenta XRPL (o el fundador verificado), o el flujo servidor de una
  // cuenta que Astryum opera. Solo eso desplaza sin ceremonia un borrador que
  // nadie probado preparó: nadie más que el dueño puede firmar aquel payload, y
  // el dueño no lo preparó (it16 R1 1.4: el extraño tapiaba una salida ajena).
  const requesterOwnsAccount =
    input.preparedByProven === true || input.supersedeAuthorized === true || ownServerFlow === true;

  // Aviso que viaja con el handoff cuando este prepare desplazó un asiento que
  // nadie pudo leer (it17 §1.3). Vive fuera del try: el guard puede llenarlo.
  let seatWarning: string | undefined;

  // Asiento de nonce único (incidente 2026-07-14/16): si ya hay un handoff
  // pendiente con este PA+nonce y OTRO userOp, son excluyentes — abortar (o
  // invalidar el viejo con supersedePendingNonce). Best-effort: sin DB
  // (scripts CLI) no hay filas que consultar y el guard no aplica.
  try {
    const store = await import('../../../services/flare/DirectMintHandoffStore');
    const { findQueuedHandoffsByPersonalAccount, markHandoffsSuperseded, listParked0xFe } = store;
    const queued = await findQueuedHandoffsByPersonalAccount(personalAccount);
    // Un dispatch APARCADO no ejecuta (cero reintentos): su asiento está muerto y
    // NO debe tapiar el nonce a un prepare nuevo. Cross-referenciamos por memoHex
    // con el store de aparcados y los excluimos — además del markHandoffParked de
    // parkTx. Así un dispatch YA-aparcado (o parkeado antes de ese fix) tampoco
    // bloquea (incidente 12-sep: el re-claim moría en NONCE_SEAT_TAKEN_SIGNED aunque
    // el viejo estuviera parked). Aparcar = «esto está muerto, déjame seguir».
    //
    // productizer-it21 §P1 1.4 — …Y ESTA LISTA SE LEE EN ESTRICTO. Con `kvList`
    // un parpadeo de BD la dejaba vacía, así que las filas APARCADAS volvían a
    // contar como ocupantes y una SALIDA moría en `NONCE_SEAT_TAKEN_SIGNED`, no
    // reintentable, por un fallo nuestro (it20 N1 1.4 — el incidente del 12-sep).
    // Ahora el fallo sube como `SEAT_STATE_UNREADABLE` y lo decide el catch de
    // abajo con la regla de siempre: la entrada espera, la salida se compone con
    // su aviso. Los lectores de panel siguen con la lectura blanda a propósito.
    let parked: Awaited<ReturnType<typeof listParked0xFe>>;
    try {
      parked = await listParked0xFe({ strict: true });
    } catch (e) {
      const { HandoffSeatStateUnreadableError } = store;
      throw new HandoffSeatStateUnreadableError(
        `the parked 0xFE dispatches of ${personalAccount} could not be read: ${(e as Error)?.message ?? String(e)}`,
      );
    }
    const parkedMemos = new Set(parked.map((r) => (r.memoHex ?? '').toLowerCase()).filter((m) => m.length > 0));
    const liveQueued = queued.filter((h) => !parkedMemos.has((h.memoHex ?? '').toLowerCase()));
    const conflicts = findNonceSeatConflicts(liveQueued, nonce, userOpHash);
    if (conflicts.length > 0) {
      const ttlMs = Math.max(Number(process.env.HANDOFF_SEAT_TTL_MIN || 5), 1) * 60_000;
      const windowMs =
        Math.max(Number(process.env.HANDOFF_REPORTED_SIGNATURE_WINDOW_MIN || DEFAULT_REPORTED_SIGNATURE_WINDOW_MIN), 1) *
        60_000;
      // productizer-it13 §1.1 — a client-reported signature is checked against
      // the ledger (fresh node) BEFORE the TTL may retire the seat. Only unsigned
      // rows WITHOUT a ledger window carry reports that decide anything: con
      // LastLedgerSequence manda la lectura de la ventana, no la palabra de nadie.
      const lookups = new Map<string, Awaited<ReturnType<typeof resolveReportedSignature>>>();
      const windows = new Map<string, HandoffWindowVerdict>();
      for (const c of conflicts) {
        if (typeof c.signedAt === 'string' && c.signedAt) continue;
        const lls = positiveLedgerIndex(c.lastLedgerSequence);
        if (lls === null) {
          const hashes = store.reportedTxHashesOf(c);
          if (hashes.length === 0) continue;
          lookups.set(c.userOpHash, await resolveReportedSignature(c, hashes, store.verifyHandoffPaymentOnLedger));
          continue;
        }
        if (composedLedgerIndex === null) continue; // sin ledger validado no hay ventana que leer
        // Suelo de la búsqueda: el ledger en que se compuso (ningún Payment con
        // ese memo puede existir antes). Filas sin él → la ventana máxima.
        const from = positiveLedgerIndex(c.composedLedgerIndex) ?? Math.max(1, lls - MAX_LAST_LEDGER_WINDOW);
        const to = Math.min(composedLedgerIndex, lls);
        if (to < from) {
          windows.set(c.userOpHash, { state: 'absent', rowsRead: 0 }); // aún no ha cerrado ningún ledger de su ventana
          continue;
        }
        windows.set(
          c.userOpHash,
          typeof store.readHandoffMemoWindow === 'function'
            ? await store.readHandoffMemoWindow(c, { ledgerIndexMin: from, ledgerIndexMax: to })
            : { state: 'unreadable', detail: 'this build cannot read the handoff window' },
        );
      }
      const nowMs = Date.now();
      const seat = classifySeatConflicts(
        conflicts,
        ttlMs,
        nowMs,
        { verdictOf: (c) => lookups.get(c.userOpHash)?.verdict, windowMs },
        { validatedLedgerIndex: composedLedgerIndex, windowOf: (c) => windows.get(c.userOpHash) },
      );
      for (const c of seat.validatedByLedger) {
        const win = windows.get(c.userOpHash);
        const hit = lookups.get(c.userOpHash);
        const txHash = win?.state === 'signed' ? win.txHash : hit?.txHash;
        const result = win?.state === 'signed' ? win.ledgerResult : hit?.ledgerResult;
        if (txHash) await store.markHandoffSignedByMemo(c.memoHex, txHash, result ?? null);
      }
      // Un Payment que entró en el ledger y FALLÓ (tec*) no entregó XRP al Core
      // Vault: FAssets exige `status == PAYMENT_SUCCESS` para ejecutar el direct
      // minting, así que ese dispatch está muerto y su asiento queda libre —
      // jamás marcado «firmado» (it14 §1.4: bloqueaba el nonce para siempre).
      for (const c of seat.ledgerFailed) {
        const win = windows.get(c.userOpHash);
        const hit = lookups.get(c.userOpHash);
        const txHash =
          win?.state === 'failed' ? win.txHash : (hit?.txHash ?? (typeof c.signedTxHash === 'string' ? c.signedTxHash : ''));
        const result =
          win?.state === 'failed'
            ? win.ledgerResult
            : (hit?.ledgerResult ?? (typeof c.signedLedgerResult === 'string' ? c.signedLedgerResult : 'tec'));
        if (typeof store.markHandoffLedgerFailedByMemo === 'function') {
          await store.markHandoffLedgerFailedByMemo(c.memoHex, txHash ?? '', result ?? 'tec');
        }
      }
      // productizer-it19 §M1 1.1 (contrato C1) — LA FILA QUE COMPUSO NUESTRO
      // PROPIO SERVIDOR NO SE APARTA SOLA JAMÁS. La mesa compone su put-to-work
      // sin `preparedByProven` (no hay sesión que pruebe nada: firma una semilla
      // nuestra), así que la regla de it17 la leía como «borrador de un extraño»
      // y el autopilot — `ownServerFlow` de la misma cuenta — la superseded en
      // silencio mientras el fundador aún podía firmarla: dos Payments vivos en
      // el mismo nonce con el XRP del cliente ya en el Core Vault (it18 R1 1.1).
      // Se reconoce por la marca nueva Y por la etiqueta de acción, que las filas
      // compuestas antes de este arreglo sí llevan.
      const serverComposedRow = (c: (typeof conflicts)[number]): boolean =>
        c.serverComposed === true || OPERATIONAL_HANDOFF_ACTIONS.has(c.action ?? '');
      // productizer-it19 §M1 1.2/1.3 (contrato C2) — EL PREDICADO ÚNICO. La misma
      // pregunta que contesta `/handoff/release`: ¿puede todavía firmarse este
      // payload, y dice la ventana leída que su Payment no entró? Release,
      // supersede y desplazamiento automático no pueden volver a discrepar.
      const seatVerdictOf = (c: (typeof conflicts)[number]): SeatSignabilityVerdict =>
        classifySeatSignability(c, {
          nowMs,
          validatedLedgerIndex: composedLedgerIndex,
          // Un informe que este guard YA descartó (la excepción it14 §1.3: hash
          // que el ledger nunca vio, de quien no prueba) no vuelve a contar aquí;
          // uno que no se ha descartado frena el reloj, pero no gatea por sí solo.
          reportedUnverified: !seat.reportedInFlight.includes(c) && store.reportedTxHashesOf(c).length > 0,
          windowState: windows.get(c.userOpHash)?.state ?? null,
          // it23 §Q1 1.3 — la ventana por defecto de ESTA fila: una ceremonia sin
          // sus dos índices no se mide con los 6 min de una firma simple.
          fallbackWindowLedgers: defaultSeatWindowLedgers(c.payloadExpiryMin ?? null),
        });
      /**
       * ¿Está PROBADO que ese payload ya no puede firmarse ni entrar? Solo lo
       * dice una fila CON ventana de ledger: la que no la lleva se rige por el
       * TTL de it13 (y `classifySeatConflicts` ya enterró las caducadas), así que
       * «sin ventana» no es prueba de nada — es la ausencia de la prueba.
       */
      const seatIsFree = (c: (typeof conflicts)[number]): boolean =>
        positiveLedgerIndex(c.lastLedgerSequence) !== null && seatVerdictOf(c).unsignable;
      // El asiento se libera SOLO: borradores abandonados sin ventana (más viejos
      // que el TTL, nunca firmados ni reportados a tiempo) y borradores cuya
      // ventana de ledger pasó y se leyó ENTERA sin su memo — no pueden entrar jamás.
      //
      // productizer-it21 §P1 1.5 — …Y ESTA PUERTA TAMBIÉN PASA POR EL PREDICADO.
      // Era la única de las cuatro que la it. 19 no unificó: enterraba por reloj
      // (`classifySeatConflicts`) sin preguntar si el payload seguía firmable y
      // sin mirar `serverComposed`, así que una fila de la mesa SIN ventana de
      // ledger — la que compone un nodo que no se pudo leer — caducaba a los 5
      // min mientras el fundador aún la tenía abierta en Xaman (it20 N1 1.5).
      // Ahora se aparta lo que las DOS reglas dan por muerto, y nada del servidor.
      const staleDisplaceable = seat.stale.filter((c) => !serverComposedRow(c) && seatVerdictOf(c).unsignable);
      if (staleDisplaceable.length > 0) {
        await markHandoffsSuperseded(staleDisplaceable.map((c) => c.userOpHash));
      }
      const staleHeld = seat.stale.filter((c) => !staleDisplaceable.includes(c));
      if (staleHeld.length > 0) {
        console.warn(
          `[0xFE-handoff] stale rows kept: PA ${personalAccount} nonce ${nonce} — ` +
            `${staleHeld.map((c) => `${c.userOpHash.slice(0, 10)}:${serverComposedRow(c) ? 'server-composed' : seatVerdictOf(c).reason}`).join(', ')}`,
        );
      }
      // Lo FIRMADO manda incluso sobre el supersede explícito (incidente
      // 2026-08-21: el gemelo con nonce 19): dos userOps vivos con el mismo
      // asiento son excluyentes, y firmar el segundo condena uno de los dos
      // — con su carrier — a morir InvalidNonce. Un asiento firmado solo lo
      // vacía ejecutar o aparcar desde el panel.
      // productizer-it17 (contrato C2) — el memo de la fila que bloquea SOLO para
      // quien ya puede tocarla (la preparó, o prueba la cuenta). Con él la
      // pantalla ofrece liberar ese asiento; al extraño no se le confirma nada.
      const mayKnowRow = (c: (typeof conflicts)[number]): boolean =>
        requesterOwnsAccount || isSameHandoffPreparer(input.preparedByUserId, c.preparedByUserId);
      // productizer-it19 (contrato C3) — el memo de la fila que bloquea viaja SOLO
      // si esta sesión podría liberarla de verdad: un borrador sin firmar, suyo o
      // de su cuenta probada. Sobre una fila FIRMADA (o con informe vivo, o con la
      // ventana ilegible) la pantalla ofrecía «Free the seat» y el release
      // contestaba que no — mentirle a quien ya firmó (it18 R4 3.3).
      const releasableMemoOf = (rows: typeof conflicts): string | undefined => {
        const known = rows.find((c) => {
          if (!mayKnowRow(c) || typeof c.memoHex !== 'string' || c.memoHex.length === 0) return false;
          const reason = seatVerdictOf(c).reason;
          return reason !== 'signed' && reason !== 'reported' && reason !== 'window-unreadable';
        });
        return known?.memoHex;
      };
      /**
       * productizer-it21 §P2 2.3 (contrato C3) — EL ASIENTO QUE NO SE PUDO LEER,
       * DICHO COMO LO QUE ES.
       *
       * Viajaba `retryable: false` mientras su propia prosa decía «vuelve a
       * intentarlo en un minuto» — una contradicción que la pantalla resolvía
       * como callejón: ni «Free the seat» (correcto: sobre una fila ilegible el
       * release se negaría) ni «Prepare it again», y sobre una SALIDA eso es un
       * muro de hasta 30 min por un fallo de lectura NUESTRO (it20 N2 2.3).
       *
       * Lo que sale ahora, y por qué:
       *  · `retryable: true` — es literalmente lo que hay que hacer, y para este
       *    código la pantalla no ofrece liberar nada (`seatRefusal`: la clase
       *    `unreadable` no está entre las liberables), así que no puede volverse
       *    un bucle de «Retry» sobre el borrador de otro;
       *  · `secondsLeft` — cuándo deja de ser un muro: el instante en que quien
       *    PRUEBA la cuenta puede desplazarlo (ventana + margen). El camino
       *    existe, y ahora tiene fecha;
       *  · sobre una SALIDA, **503** en vez de 409 (`SeatStateUnreadableError`):
       *    no hay conflicto probado, hay una lectura que falló — y una salida no
       *    se contesta con un conflicto definitivo por un fallo nuestro.
       * La espera de 30 min NO se acorta por ser salida: desplazar una fila cuyo
       * Payment quizá aterrizó es el gemelo, venga de donde venga.
       */
      const unreadableSeatRefusal = (
        rows: typeof conflicts,
        opts: { message: string; memoHex?: string; nowMs: number },
      ): NonceSeatTakenError => {
        const secondsLeft = seatUnreadableDisplaceInSeconds(rows, opts.nowMs);
        // productizer-it23 §Q1 §3.7 — EN INGLÉS, como toda la superficie. Esta
        // frase se compone aquí y acaba en el `detail` de una pantalla de salida
        // escrita en inglés; el filtro del frontend (`serverDetailIfEnglish`) la
        // tiraba entera por venir en castellano, así que el usuario recibía el
        // muro sin el motivo NI la fecha en que deja de serlo (it22 Q3 3.7).
        const tail = requesterOwnsAccount
          ? ` Try again in a minute${secondsLeft !== undefined ? `; if no node answers, in about ${secondsLeft} s this seat can be displaced` : ', or displace it now: its window closed long ago'}.`
          : ` Try again in a minute${secondsLeft !== undefined ? `; in about ${secondsLeft} s it can be displaced by whoever proves this XRPL account` : '; it can already be displaced by whoever proves this XRPL account'}.`;
        const message = `${opts.message}${tail}`;
        if (isExit) return new SeatStateUnreadableError(message, { memoHex: opts.memoHex, secondsLeft });
        return new NonceSeatTakenError(message, {
          code: 'NONCE_SEAT_UNREADABLE',
          retryable: true,
          memoHex: opts.memoHex,
          secondsLeft,
        });
      };
      if (seat.signed.length > 0) {
        throw new NonceSeatTakenError(
          `NONCE_SEAT_TAKEN_SIGNED: the Personal Account ${personalAccount} already has a SIGNED 0xFE order waiting to execute on ` +
            `nonce ${nonce} (${seat.signed.map((c) => c.userOpHash.slice(0, 10)).join(', ')}). Signing another one now would create a ` +
            `doomed twin that loses its carrier. Wait for it to execute — or have an operator park it if its executor will not run.`,
          { code: 'NONCE_SEAT_TAKEN_SIGNED', retryable: false, memoHex: releasableMemoOf(seat.signed) },
        );
      }
      // El ledger no se pudo leer entero: no se sabe si aquel Payment entró. No
      // hay escape por tiempo (it14 §1.4) y tampoco lo hay por supersede: «no
      // pude leer» jamás libera un asiento DENTRO de su ventana.
      //
      // productizer-it17 §1.3 — LA ÚNICA PUERTA: un asiento cuya LLS quedó MUY
      // atrás (su ventana + margen; `HANDOFF_UNREADABLE_DISPLACE_MIN`, 30 min) y
      // que ningún nodo puede leer no puede tapiar para siempre la salida de su
      // dueño. Lo desplaza solo quien PRUEBA la cuenta (o el propio flujo
      // servidor de una cuenta operativa) — jamás un extraño, jamás el
      // preparador sin prueba — y se lo lleva escrito: si aquel Payment hubiera
      // entrado, uno de los dos moriría InvalidNonce.
      if (seat.unreadable.length > 0) {
        const displaceable = seat.unreadable.filter((c) => seatWindowLongPast(c, nowMs));
        if (requesterOwnsAccount && displaceable.length === seat.unreadable.length) {
          await markHandoffsSuperseded(seat.unreadable.map((c) => c.userOpHash));
          seatWarning =
            `The previous dispatch on this nonce (${seat.unreadable.map((c) => c.userOpHash.slice(0, 10)).join(', ')}) could not be ` +
            `checked on any XRPL node ${unreadableDetailOf(seat.unreadable, windows)}, and the ledger it could last enter passed ` +
            `over ${Math.round(unreadableDisplaceGraceMs() / 60_000)} minutes ago. Its seat was freed so this one could be composed. ` +
            `If that old Payment did land after all, only one of the two can execute — check that account's history before signing.`;
          console.warn(`[0xFE-handoff] seat displaced unread: PA ${personalAccount} nonce ${nonce} — ${seatWarning}`);
        } else {
          throw unreadableSeatRefusal(seat.unreadable, {
            message:
              `NONCE_SEAT_UNREADABLE: the Personal Account ${personalAccount} has a 0xFE order with a ledger window on nonce ${nonce} ` +
              `(${seat.unreadable.map((c) => c.userOpHash.slice(0, 10)).join(', ')}) and the XRP Ledger could not be read in full just ` +
              `now ${unreadableDetailOf(seat.unreadable, windows)}. Until we know whether that Payment landed, composing another one ` +
              `on the same seat could create a doomed duplicate.`,
            memoHex: releasableMemoOf(seat.unreadable),
            nowMs,
          });
        }
      }
      // Reported signed and not validated yet (or the ledger unreadable): that
      // Payment may still validate, so no prepare may compose its twin. La
      // excepción (it14 §1.3): un informe de quien NO prueba la cuenta sobre SU
      // propio borrador, cuyo hash el ledger no conoce, no puede gatear al dueño
      // probado — era el bloqueo indefinido de una salida por un extraño.
      //
      // productizer-it17 §1.4 — …y ya no hace falta pedir supersede para eso: un
      // borrador que nadie probado preparó ni reportó NUNCA bloquea a la propia
      // cuenta. Pedir la ceremonia era el DoS: el extraño componía, el dueño veía
      // 409 y tenía que adivinar que debía reintentar «liberando el asiento».
      const reportedBlocking = seat.reportedInFlight.filter((c) => {
        const strangerDraft = c.preparedByProven !== true && c.reportedByProven !== true;
        const ledgerNeverSawIt = lookups.get(c.userOpHash)?.verdict === 'not-found';
        return !(strangerDraft && ledgerNeverSawIt && requesterOwnsAccount);
      });
      if (reportedBlocking.length > 0) {
        throw new NonceSeatTakenError(
          `NONCE_SEAT_TAKEN_REPORTED: the Personal Account ${personalAccount} has a 0xFE order on nonce ${nonce} whose signature was ` +
            `reported and the ledger has not validated yet, or could not be read just now ` +
            `(${reportedBlocking.map((c) => c.userOpHash.slice(0, 10)).join(', ')}). Signing another one now would create a doomed twin ` +
            `that loses its carrier: wait for it to validate. If that Payment does not appear in the ledger within ` +
            `${Math.round(windowMs / 60_000)} min, the seat goes back to its normal expiry.`,
          { code: 'NONCE_SEAT_TAKEN_REPORTED', retryable: false, memoHex: releasableMemoOf(reportedBlocking) },
        );
      }
      // Lo que queda ocupa el asiento sin firma probada: borradores sin ventana
      // (TTL), borradores cuya ventana sigue por delante, y los informes que la
      // excepción de arriba dejó pasar. `supersede` los desplaza solo con derecho.
      //
      // productizer-it21 §P1 1.5 — …Y LO QUE EL RELOJ DIO POR MUERTO PERO EL
      // PREDICADO NO. `staleHeld` son las filas que `classifySeatConflicts`
      // enterraba por TTL y que aquí ya no se apartan (las compuso el servidor, o
      // su payload sigue firmable): si se quedaran fuera de esta lista nadie las
      // miraría y el prepare compondría el gemelo encima. Ocupan asiento, como lo
      // que son.
      const seated = [
        ...seat.drafts,
        ...seat.aheadOfLls,
        ...seat.reportedInFlight.filter((c) => !reportedBlocking.includes(c)),
        ...staleHeld,
      ];
      // productizer-it17 §1.4 — EL BORRADOR DE QUIEN NO PRUEBA LA CUENTA NO
      // BLOQUEA A LA CUENTA. Nadie más que el dueño puede firmar ese payload, y el
      // dueño no lo preparó: cuando quien pide PRUEBA la cuenta (o es el flujo
      // servidor de una cuenta operativa), esa fila se aparta SOLA, sin pedir
      // supersede y sin 409. Excepción intacta: si su ventana no se pudo leer,
      // nadie la desplaza a ciegas. Para su PROPIO preparador sin prueba sigue
      // ocupando el asiento — repetir no es tener derecho a dos asientos.
      //
      // productizer-it21 §P1 1.1/1.4 — …Y «NO PUDE LEER LA PRUEBA» NO ES «NO LA
      // PROBÓ». Con la tienda de pruebas caída, toda fila nueva se guardaba con
      // `preparedByProven: false` y quedaba clasificada como borrador de un
      // extraño: desplazable. El parpadeo de base de datos entregaba el asiento.
      // `preparedByProofUnreadable` es la mitad que faltaba (contrato del agente
      // E, `seatProofFromVerdict`): una fila así no la aparta nadie por no estar
      // probada — porque nunca se llegó a preguntar.
      const unprovenRow = (c: (typeof seated)[number]): boolean =>
        c.preparedByProven !== true && c.reportedByProven !== true && c.preparedByProofUnreadable !== true;
      // productizer-it19 §M1 1.1/1.5 — CUÁNDO SE APARTA UNA FILA SOLA. Nunca una
      // que compuso el servidor, nunca una probada, nunca una con la ventana
      // ilegible. Y de las que quedan (borradores de quien no prueba nada, que
      // solo el dueño de la cuenta podría firmar):
      //   · si el predicado dice que YA no puede firmarse, la aparta cualquiera;
      //   · si sigue viva, SOLO quien PRUEBA la cuenta (nadie más puede firmarla,
      //     y él dice que no la preparó) o el propio flujo servidor.
      //
      // productizer-it21 §P1 1.1 — UNA ETIQUETA DE SALIDA NO ES AUTORIDAD SOBRE
      // LA CUENTA DE OTRO. Aquí terminaba en `requesterOwnsAccount || isExit`, y
      // las dos mitades de ese `isExit` vienen de fuera: la etiqueta la fija la
      // RUTA y `xrplAddress` viene del CUERPO. Un extraño llamaba
      // `/pa-unmint/prepare` con la dirección de la víctima y le apartaba su
      // borrador VIVO — dos payloads firmables en el mismo nonce, y el aviso que
      // recibía la víctima decía literalmente «sign only ONE of the two».
      // Griefing repetible, y pago doble si firmaba los dos (it20 N1 1.1).
      //
      // La intención de it18 §1.5 se conserva entera, pero por la mitad honesta:
      // el borrador de un extraño no tapia a nadie cuando YA NO PUEDE FIRMARSE
      // (`seatIsFree`, que es cuando apartarlo no crea ningún gemelo), y el dueño
      // de verdad lo aparta PROBANDO la cuenta — que es lo que solo él puede
      // hacer. Quien no prueba y no puede probar recibe el 409/503 con su camino
      // escrito, no la llave de la cuenta ajena.
      const mayAutoDisplace = (c: (typeof seated)[number]): boolean => {
        if (serverComposedRow(c) || !unprovenRow(c) || seat.aheadUnverified.includes(c)) return false;
        if (seatIsFree(c)) return true;
        return requesterOwnsAccount;
      };
      const autoDisplaced = seated.filter(mayAutoDisplace);
      if (autoDisplaced.length > 0) {
        await markHandoffsSuperseded(autoDisplaced.map((c) => c.userOpHash));
        // Si alguna seguía firmable, el usuario tiene que saberlo antes de firmar.
        const live = autoDisplaced.filter((c) => !seatIsFree(c));
        if (live.length > 0) {
          seatWarning =
            (seatWarning ? `${seatWarning} ` : '') +
            `A previously prepared order on this nonce (${live.map((c) => c.userOpHash.slice(0, 10)).join(', ')}) was set aside so ` +
            `this one could be composed. Nobody proved that account when it was prepared, so only its owner could ever sign it — ` +
            `but if it is still open in a wallet, sign only ONE of the two: the second would die InvalidNonce with its XRP already paid.`;
          console.warn(`[0xFE-handoff] live unproven seat displaced: PA ${personalAccount} nonce ${nonce} — ${seatWarning}`);
        }
      }
      const holders = seated.filter((c) => !autoDisplaced.includes(c));
      if (holders.length > 0) {
        const mayDisplaceRow = (c: (typeof holders)[number], authorized: boolean): boolean => {
          const samePreparer = isSameHandoffPreparer(input.preparedByUserId, c.preparedByUserId);
          // Ni el servidor ni nadie desplaza lo que el propio servidor compuso (C1).
          if (serverComposedRow(c)) return false;
          if (positiveLedgerIndex(c.lastLedgerSequence) !== null) {
            // (a) El dueño probado desplaza el borrador de quien no prueba la
            //     cuenta: nadie más que él puede firmarlo, y él no lo preparó.
            // it21 §P1 1.4 — …salvo que aquel «no probada» fuera un «no pude
            // preguntar»: ahí no hay nada que sostenga el desplazamiento.
            if (
              authorized &&
              c.preparedByProven !== true &&
              c.reportedByProven !== true &&
              c.preparedByProofUnreadable !== true
            ) {
              return true;
            }
            // (b) …o su propio preparador dice que no lo firmó, y nadie lo ha
            //     reportado — Y el payload ya no puede firmarse. productizer-it19
            //     §M1 1.2: decir «no la firmé» desde un botón no borra el payload
            //     del móvil, así que esta rama esperaba menos que `/handoff/release`
            //     y creaba por la otra puerta el gemelo que aquella impide.
            return samePreparer && store.reportedTxHashesOf(c).length === 0 && seatIsFree(c);
          }
          return authorized || samePreparer; // filas sin ventana: la regla de it13
        };
        const unverified = holders.filter((c) => seat.aheadUnverified.includes(c));
        const allEligible = (authorized: boolean) => holders.every((c) => mayDisplaceRow(c, authorized));
        const mayDisplace =
          input.supersedePendingNonce === true && unverified.length === 0 && allEligible(input.supersedeAuthorized === true);
        if (!mayDisplace) {
          if (input.supersedePendingNonce === true && unverified.length > 0 && allEligible(input.supersedeAuthorized === true)) {
            // productizer-it21 §P2 2.3 — mismo trato que la otra puerta ilegible:
            // reintentable de verdad, con cuándo deja de ser un muro, y 503 (no
            // 409) sobre una salida: aquí no hay conflicto probado, hay una
            // lectura que falló.
            throw unreadableSeatRefusal(unverified, {
              message:
                `NONCE_SEAT_UNREADABLE: the Personal Account ${personalAccount} has a draft with a ledger window on nonce ${nonce} ` +
                `(${unverified.map((c) => c.userOpHash.slice(0, 10)).join(', ')}) and its window could not be read to tell whether it ` +
                `was already signed ${unreadableDetailOf(unverified, windows)}. Nothing is replaced blind.`,
              memoHex: releasableMemoOf(unverified),
              nowMs,
            });
          }
          const ahead = holders
            .map((c) => positiveLedgerIndex(c.lastLedgerSequence))
            .filter((n): n is number => n !== null);
          const maxLls = ahead.length > 0 ? Math.max(...ahead) : undefined;
          const secondsLeft = seatSecondsLeft(seat, holders, composedLedgerIndex, ttlMs, nowMs);
          throw new NonceSeatTakenError(
            `NONCE_SEAT_TAKEN: the Personal Account ${personalAccount} has a recent 0xFE order that has not executed on nonce ` +
              `${nonce} (${holders.map((c) => c.userOpHash.slice(0, 10)).join(', ')}). If you signed it, give it a few seconds to ` +
              `execute. ` +
              (maxLls !== undefined && composedLedgerIndex !== null
                ? `That Payment can only enter up to ledger ${maxLls} (validated now: ${composedLedgerIndex}): the seat frees itself ` +
                  `when that ledger passes without it${secondsLeft !== undefined ? `, about ${secondsLeft} s` : ''} — not before.`
                : `Otherwise the seat frees itself as soon as whoever prepared it, or the owning account, cancels it; if nobody ` +
                  `cancels it, it frees itself in ${Math.round(ttlMs / 60_000)} min.`) +
              (input.supersedePendingNonce === true
                ? ` Replacing it requires having prepared it yourself, or having proven the XRPL account ${input.xrplAddress}.`
                : ''),
            {
              code: 'NONCE_SEAT_TAKEN',
              // Reintentar liberando el asiento solo se ofrece si ESTA sesión
              // podría hacerlo (it14 R5 §1.6: el bucle de «Retry» sobre el
              // borrador de otro). Si ya vino con supersede y se denegó, no.
              retryable: input.supersedePendingNonce !== true && allEligible(input.preparedByProven === true),
              lastLedgerSequence: maxLls,
              secondsLeft,
              memoHex: releasableMemoOf(holders),
            },
          );
        }
        await markHandoffsSuperseded(holders.map((c) => c.userOpHash));
      }
    }
  } catch (e) {
    if (e instanceof NonceSeatTakenError) throw e;
    // productizer-it19 §M1 1.4 — UNA TABLA DE ASIENTOS ILEGIBLE NO ES «NO HAY
    // ASIENTO». Hasta it18 este catch se tragaba el fallo de BD y el prepare
    // componía como si el nonce estuviera libre: el gemelo por la puerta de
    // atrás. Una ENTRADA espera; una SALIDA se compone igual y se lo lleva
    // escrito, porque «no pude leer» jamás es castigo sobre una salida.
    if ((e as { code?: string } | null)?.code === 'SEAT_STATE_UNREADABLE') {
      if (!isExit) {
        throw new SeatStateUnreadableError(
          `SEAT_STATE_UNREADABLE: Astryum could not read the 0xFE orders already queued for ${personalAccount} ` +
            `(${(e as Error).message}). Composing another one without knowing could put two orders on the same nonce, ` +
            `so nothing was composed: nothing moved, nothing was signed — try again in a minute.`,
        );
      }
      seatWarning =
        'The 0xFE orders already queued for this account could not be read just now, so this exit was composed without ' +
        'checking them: an exit is never blocked by a reading failure. If another order was already waiting on the same ' +
        'nonce, only one of the two can execute — check this account before signing a second one.';
      console.warn(`[0xFE-handoff] seat state unreadable on an EXIT: PA ${personalAccount} — ${(e as Error).message}`);
    }
    /* sin DB (scripts CLI) — el guard no aplica; el log de abajo sigue siendo la traza */
  }

  // Registro de recuperación (lección de la tx 7BFCF65F…, 2026-07-12): el memo
  // solo publica el hash; si estos bytes se pierden, ningún executor puede
  // ejecutar el mint y el XRP queda aparcado en el Core Vault. Este log es la
  // copia server-side mínima que hace todo handoff 0xFE re-ejecutable
  // (rescate: scripts/execute-direct-mint.ts).
  const handoffRecord = {
    xrplAddress: input.xrplAddress,
    personalAccount,
    userOpHash,
    memoHex,
    grossXrpDrops: input.grossXrpDrops.toString(),
    supplyUBA: net.supplyUBA.toString(),
    executorFeeUBA: net.executorFeeUBA.toString(),
    walletId: input.walletId ?? 0,
    userOpData: dataHex,
    action: input.action ?? null,
    preparedByUserId: input.preparedByUserId ?? null,
    // productizer-it15 §K1 — la ventana de ledger viaja CON el registro: sin ella
    // en la fila, el guard del asiento vuelve a decidir por reloj (it14 §1.1: la
    // mesa la estampaba después, y el registro no la conocía).
    // it21 §P1 1.1/1.4 — …y si esa respuesta fue «no pude leer», la fila lo dice:
    // sin esta marca, `preparedByProven: false` la volvía desplazable por error.
    //
    // productizer-it23 §Q1 1.1 — EL BUILDER SE NIEGA A ESCRIBIR UNA FILA QUE NO
    // SABE DECIR CUÁL DE LOS DOS ESTADOS ES. `preparedByProven: false` +
    // `preparedByProofUnreadable: false` es una FRASE: «pregunté, y esta sesión no
    // tiene esa cuenta» — y es la frase que hace la fila desplazable por el dueño
    // probado. Un llamador que se olvida de la segunda marca la escribía sin
    // haberla dicho, así que un parpadeo de BD paría una salida desplazable y el
    // propio dueño, al reintentar cuando la BD sanaba, apartaba su borrador VIVO
    // (it22 Q1 1.1, cuatro revisores sobre `institutional.ts` y `xrplDefi.ts`).
    // Aquí el defecto pasa al lado seguro: sin la marca, el estado es DESCONOCIDO
    // y esta fila no la aparta nadie. Quien quiera una fila desplazable tiene que
    // haber preguntado de verdad y decirlo — `seatProofFieldsFrom` lo hace en un
    // solo sitio (services/flare/handoffAuthority).
    ...seatProofFieldsFrom(
      input.preparedByProven === true
        ? true
        : { preparedByProven: false, preparedByProofUnreadable: input.preparedByProofUnreadable },
    ),
    // contrato C1 — quién compuso esta fila: el servidor de Astryum para una
    // cuenta que opera, o una sesión. Sin esto, el flujo servidor siguiente
    // apartaba en silencio un payload que el fundador aún podía firmar.
    serverComposed: input.serverComposed === true || ownServerFlow === true,
    lastLedgerSequence,
    composedLedgerIndex,
    // contrato C3 — la caducidad del payload viaja con la fila: sin ella, liberar
    // el asiento vuelve a decidirse a ojo (it16 R1 1.1).
    payloadExpiresAt,
    // it23 §Q1 1.3 — …y CUÁNTO vive, para que el release y el sello midan esta
    // fila con SU payload (una ceremonia, 24 h) y no con el de una firma simple.
    payloadExpiryMin,
  };
  console.log(`[0xFE-handoff] ${JSON.stringify(handoffRecord)}`);
  // Persistencia para el executor automático (DirectMintExecutorService): la
  // fila por userOpHash es lo que hace el mint ejecutable sin reconstrucción.
  // Import perezoso + best-effort: este builder también corre en scripts CLI
  // sin DATABASE_URL, y un fallo de DB nunca debe romper el prepare (el store
  // ya deja traza ruidosa del fallo).
  try {
    const { saveHandoffRecord } = await import('../../../services/flare/DirectMintHandoffStore');
    await saveHandoffRecord(handoffRecord);
  } catch {
    /* sin DB (scripts CLI) — el log de arriba sigue siendo la copia mínima */
  }

  return {
    personalAccount,
    fxrpToken: params.fxrpToken,
    net,
    userOpData: dataHex,
    userOpHash,
    memoHex,
    lastLedgerSequence,
    composedLedgerIndex,
    payloadExpiresAt,
    // it23 §Q1 1.2/1.3 — la vida REAL del payload de ESTE dispatch (una ceremonia
    // declara la suya): es el `expire` que el frontend debe poner en Xaman, y el
    // número con el que el servidor mide este asiento. Una sola cifra para las dos.
    payloadExpiryMin,
    // it. 31 (§5) — …y si esa cifra es una LECTURA o un defecto. Lo que declaró
    // quien compone (`signingCeremonyFor`) manda; una ceremonia declarada en
    // código es un `'quorum'` decidido, no leído; y el silencio es `'unknown'`,
    // jamás `'single'`: el navegador vuelve a mirar el SignerList en ese caso.
    signerListRead: signerListReadOf(input),
    ...(seatWarning ? { seatWarning } : {}),
    xrplPayment: withSourceTag({
      TransactionType: 'Payment' as const,
      Account: input.xrplAddress, // pin del firmante — Xaman rechaza otra cuenta
      Destination: params.paymentAddress, // Core Vault — NOT the operator wallet
      Amount: input.grossXrpDrops.toString(), // drops
      Memos: [{ Memo: { MemoData: memoHex } }],
      // La ventana de firma (it15 §K1): pasado este ledger el Payment no puede
      // entrar, y por eso el asiento de nonce se puede liberar SIN adivinar.
      ...(lastLedgerSequence !== null ? { LastLedgerSequence: lastLedgerSequence } : {}),
      // No DestinationTag by design (a tag misroutes FAssets direct minting).
      // SourceTag (when configured) is safe: it never affects routing.
    }, input.attribution ?? 'user'),
  };
}

export interface E1HandoffInput {
  xrplAddress: string;
  /** Gross XRP the user pays, in drops. */
  grossXrpDrops: bigint;
  /** User-chosen borrow ratio (fraction of max capacity, 0..1). NOT hardcoded. */
  borrowRatio: number;
  /** HF level A1 will defend at — used to precompute the trigger price now. */
  targetHF: number;
  /** Live FTSO XRP/USD (read by the caller, disclosed to the user — invariant #6/#9). */
  fxrpPriceUSD: number;
  /** Live collateral factor of kFXRP ISO from markets() (read by the caller). */
  collateralFactor: number;
  usdt0PriceUSD?: number;
  walletId?: number;
  bufferBips?: bigint;
  /** Ver BuildDirectMintInput.supersedePendingNonce (guard de asiento de nonce). */
  supersedePendingNonce?: boolean;
  /** Ver BuildDirectMintInput.preparedByUserId. */
  preparedByUserId?: string | null;
  /** Ver BuildDirectMintInput.supersedeAuthorized. */
  supersedeAuthorized?: boolean;
  /** Ver BuildDirectMintInput.preparedByProven. */
  preparedByProven?: boolean;
  /** Ver BuildDirectMintInput.preparedByProofUnreadable. */
  preparedByProofUnreadable?: boolean;
  /** Ver BuildDirectMintInput.lastLedgerWindow. */
  lastLedgerWindow?: number;
  /**
   * it27 §2 — Ver BuildDirectMintInput.signingCeremony. Lo decide la RUTA que
   * compone (`seatClaimOf` → `signingCeremonyFor`), nunca el cuerpo. Sin
   * reenviarlo, estos cuatro envoltorios componían con la ventana de una firma
   * simple aunque la ruta ya hubiera leído el SignerList de la cuenta.
   */
  signingCeremony?: boolean;
}

export interface E1Handoff {
  handoff: DirectMintHandoff;
  borrow: BorrowResult;
  /** Precomputed A1 inputs — F4 must reuse these EXACT values, not recompute. */
  a1: {
    triggerPriceUSD: number;
    targetHF: number;
    borrowRatio: number;
    collateralFactor: number;
    fxrpPriceUSD: number;
    supplyUBA: string;
    borrowUsdt0Base: string;
  };
}

/**
 * Close E1 end-to-end (UNSIGNED): FXRP direct-mint → supply → borrow USDT0, plus
 * the precomputed A1 trigger price from the SAME (net FXRP, CF, ratio) so the
 * stop-loss defends exactly the position that was opened. Astryum signs nothing.
 *
 * Live oracle/CF values are inputs (the caller reads FTSO XRP/USD + markets()
 * and discloses them before the user signs); this keeps the composition
 * deterministic and testable. The supply uses post-fee net FXRP; the borrow uses
 * net·CF·ratio (KineticIsoMath, shared with A1).
 */
export async function buildE1Handoff(
  provider: Provider,
  input: E1HandoffInput,
): Promise<E1Handoff> {
  const params = await readDirectMintParams(provider);
  const net = computeNetMint(input.grossXrpDrops, params, input.bufferBips);

  const borrow = computeBorrowUsdt0({
    supplyUBA: net.supplyUBA,
    fxrpPriceUSD: input.fxrpPriceUSD,
    collateralFactor: input.collateralFactor,
    borrowRatio: input.borrowRatio,
    usdt0PriceUSD: input.usdt0PriceUSD,
  });

  const innerCalls = await new KineticAdapter().buildIsoSupplyBorrowBatch({
    supplyUBA: net.supplyUBA,
    borrowUsdt0: borrow.borrowUsdt0Base,
  });

  const handoff = await buildDirectMintHandoff(
    provider,
    {
      xrplAddress: input.xrplAddress,
      grossXrpDrops: input.grossXrpDrops,
      innerCalls,
      walletId: input.walletId,
      bufferBips: input.bufferBips,
      supersedePendingNonce: input.supersedePendingNonce,
      preparedByUserId: input.preparedByUserId,
      supersedeAuthorized: input.supersedeAuthorized,
      preparedByProven: input.preparedByProven,
      preparedByProofUnreadable: input.preparedByProofUnreadable,
      lastLedgerWindow: input.lastLedgerWindow,
      signingCeremony: input.signingCeremony,
      action: 'e1',
    },
    { params }, // reuse the already-read params → one RPC read, consistent net
  );

  const trigger = computeTriggerPrice({
    supplyUBA: net.supplyUBA,
    borrowUsdt0Base: borrow.borrowUsdt0Base,
    collateralFactor: input.collateralFactor,
    targetHF: input.targetHF,
    usdt0PriceUSD: input.usdt0PriceUSD,
  });

  return {
    handoff,
    borrow,
    a1: {
      triggerPriceUSD: trigger.triggerPriceUSD,
      targetHF: input.targetHF,
      borrowRatio: input.borrowRatio,
      collateralFactor: input.collateralFactor,
      fxrpPriceUSD: input.fxrpPriceUSD,
      supplyUBA: net.supplyUBA.toString(),
      borrowUsdt0Base: borrow.borrowUsdt0Base.toString(),
    },
  };
}

export interface E3HandoffInput {
  xrplAddress: string;
  /** Gross XRP the user pays, in drops. */
  grossXrpDrops: bigint;
  walletId?: number;
  bufferBips?: bigint;
  /** Ver BuildDirectMintInput.supersedePendingNonce (guard de asiento de nonce). */
  supersedePendingNonce?: boolean;
  /** Ver BuildDirectMintInput.preparedByUserId. */
  preparedByUserId?: string | null;
  /** Ver BuildDirectMintInput.supersedeAuthorized. */
  supersedeAuthorized?: boolean;
  /** Ver BuildDirectMintInput.preparedByProven. */
  preparedByProven?: boolean;
  /** Ver BuildDirectMintInput.preparedByProofUnreadable. */
  preparedByProofUnreadable?: boolean;
  /** Ver BuildDirectMintInput.lastLedgerWindow. */
  lastLedgerWindow?: number;
  /**
   * it27 §2 — Ver BuildDirectMintInput.signingCeremony. Lo decide la RUTA que
   * compone (`seatClaimOf` → `signingCeremonyFor`), nunca el cuerpo. Sin
   * reenviarlo, estos cuatro envoltorios componían con la ventana de una firma
   * simple aunque la ruta ya hubiera leído el SignerList de la cuenta.
   */
  signingCeremony?: boolean;
}

export interface E3Handoff {
  handoff: DirectMintHandoff;
}

/**
 * Close the lend-only entry (E3) end-to-end (UNSIGNED): FXRP direct-mint → supply,
 * NO borrow, NO stop-loss. The safest entry in the set — zero debt, zero
 * liquidation, nothing to defend. Reuses the EXACT `0xFE` machinery as E1
 * (buildDirectMintHandoff); the only difference is the inner batch, which is
 * `buildIsoSupplyFxrpBatch` ([approve, mint]) instead of the supply+borrow batch.
 * The supply uses the post-fee net FXRP. Astryum signs nothing.
 */
export async function buildE3Handoff(
  provider: Provider,
  input: E3HandoffInput,
): Promise<E3Handoff> {
  const params = await readDirectMintParams(provider);
  const net = computeNetMint(input.grossXrpDrops, params, input.bufferBips);

  const innerCalls = await new KineticAdapter().buildIsoSupplyFxrpBatch({
    supplyUBA: net.supplyUBA,
  });

  const handoff = await buildDirectMintHandoff(
    provider,
    {
      xrplAddress: input.xrplAddress,
      grossXrpDrops: input.grossXrpDrops,
      innerCalls,
      walletId: input.walletId,
      bufferBips: input.bufferBips,
      supersedePendingNonce: input.supersedePendingNonce,
      preparedByUserId: input.preparedByUserId,
      supersedeAuthorized: input.supersedeAuthorized,
      preparedByProven: input.preparedByProven,
      preparedByProofUnreadable: input.preparedByProofUnreadable,
      lastLedgerWindow: input.lastLedgerWindow,
      signingCeremony: input.signingCeremony,
      action: 'e3',
    },
    { params }, // reuse the already-read params → one RPC read, consistent net
  );

  return { handoff };
}

export type VaultEntryKind = 'firelight' | 'earnxrp' | 'monarq';

export interface VaultEntryHandoffInput {
  xrplAddress: string;
  /** Gross XRP the user pays, in drops. */
  grossXrpDrops: bigint;
  /** Which partner vault receives the minted FXRP. */
  vault: VaultEntryKind;
  walletId?: number;
  bufferBips?: bigint;
  /** Ver BuildDirectMintInput.supersedePendingNonce (guard de asiento de nonce). */
  supersedePendingNonce?: boolean;
  /** Ver BuildDirectMintInput.preparedByUserId. */
  preparedByUserId?: string | null;
  /** Ver BuildDirectMintInput.supersedeAuthorized. */
  supersedeAuthorized?: boolean;
  /** Ver BuildDirectMintInput.preparedByProven. */
  preparedByProven?: boolean;
  /** Ver BuildDirectMintInput.preparedByProofUnreadable. */
  preparedByProofUnreadable?: boolean;
  /** Ver BuildDirectMintInput.lastLedgerWindow. */
  lastLedgerWindow?: number;
  /**
   * it27 §2 — Ver BuildDirectMintInput.signingCeremony. Lo decide la RUTA que
   * compone (`seatClaimOf` → `signingCeremonyFor`), nunca el cuerpo. Sin
   * reenviarlo, estos cuatro envoltorios componían con la ventana de una firma
   * simple aunque la ruta ya hubiera leído el SignerList de la cuenta.
   */
  signingCeremony?: boolean;
}

export interface VaultEntryHandoff {
  handoff: DirectMintHandoff;
}

/**
 * Close a partner-vault entry end-to-end (UNSIGNED): FXRP direct-mint →
 * deposit into the chosen vault. Zero debt, zero liquidation — the same `0xFE`
 * machinery as E3 (buildDirectMintHandoff); the only difference is the inner
 * batch:
 *   firelight → FirelightAdapter.buildStakeBatch  ([approve, 4626 deposit])
 *   earnxrp / monarq → UpshiftVaultAdapter.buildDepositBatch
 *                      ([approve, deposit(FXRP, amount, PA)])
 *
 * The deposit receiver is the resolved Personal Account (the userOp sender),
 * so the vault shares land on the user's smart account. The deposit uses the
 * post-fee net FXRP. Astryum signs nothing.
 */
export async function buildVaultEntryHandoff(
  provider: Provider,
  input: VaultEntryHandoffInput,
): Promise<VaultEntryHandoff> {
  const params = await readDirectMintParams(provider);
  const net = computeNetMint(input.grossXrpDrops, params, input.bufferBips);

  // The 4626/Upshift deposit needs an explicit receiver — resolve the PA first
  // (buildDirectMintHandoff re-resolves internally; reads are cheap + cached).
  const personalAccount = await resolvePersonalAccount(provider, input.xrplAddress);

  let innerCalls: EncodedAction[];
  if (input.vault === 'firelight') {
    const { FirelightAdapter } = await import('../adapters/FirelightAdapter');
    innerCalls = await new FirelightAdapter().buildStakeBatch({
      supplyUBA: net.supplyUBA,
      receiver: personalAccount,
    });
  } else {
    const { UpshiftVaultAdapter } = await import('../adapters/UpshiftVaultAdapter');
    innerCalls = await new UpshiftVaultAdapter().buildDepositBatch({
      vaultKey: input.vault,
      supplyUBA: net.supplyUBA,
      receiver: personalAccount,
    });
  }

  const handoff = await buildDirectMintHandoff(
    provider,
    {
      xrplAddress: input.xrplAddress,
      grossXrpDrops: input.grossXrpDrops,
      innerCalls,
      walletId: input.walletId,
      bufferBips: input.bufferBips,
      supersedePendingNonce: input.supersedePendingNonce,
      preparedByUserId: input.preparedByUserId,
      supersedeAuthorized: input.supersedeAuthorized,
      preparedByProven: input.preparedByProven,
      preparedByProofUnreadable: input.preparedByProofUnreadable,
      lastLedgerWindow: input.lastLedgerWindow,
      signingCeremony: input.signingCeremony,
      action: `vault:${input.vault}`,
    },
    { params }, // reuse the already-read params → one RPC read, consistent net
  );

  return { handoff };
}

export interface VaultRotateHandoffInput {
  xrplAddress: string;
  /** Gross XRP the user pays for the ONE mint-coupled dispatch, in drops. */
  grossXrpDrops: bigint;
  /** Vault being exited (its shares burn from the Personal Account). */
  fromVault: VaultEntryKind;
  /** Vault being entered (its shares land on the Personal Account). */
  toVault: VaultEntryKind;
  /** LP shares of `fromVault` to redeem (6-dec base units). */
  sharesUBA: bigint;
  /** FXRP expected out of the redeem AFTER the exit fee and the rotation
   *  buffer (computed + disclosed by the route). The deposit into `toVault`
   *  is this plus the dispatch's own net mint — see below. */
  redeemDepositUBA: bigint;
  walletId?: number;
  bufferBips?: bigint;
  /** Ver BuildDirectMintInput.supersedePendingNonce (guard de asiento de nonce). */
  supersedePendingNonce?: boolean;
  /** Ver BuildDirectMintInput.preparedByUserId. */
  preparedByUserId?: string | null;
  /** Ver BuildDirectMintInput.supersedeAuthorized. */
  supersedeAuthorized?: boolean;
  /** Ver BuildDirectMintInput.preparedByProven. */
  preparedByProven?: boolean;
  /** Ver BuildDirectMintInput.preparedByProofUnreadable. */
  preparedByProofUnreadable?: boolean;
  /** Ver BuildDirectMintInput.lastLedgerWindow. */
  lastLedgerWindow?: number;
  /**
   * it27 §2 — Ver BuildDirectMintInput.signingCeremony. Lo decide la RUTA que
   * compone (`seatClaimOf` → `signingCeremonyFor`), nunca el cuerpo. Sin
   * reenviarlo, estos cuatro envoltorios componían con la ventana de una firma
   * simple aunque la ruta ya hubiera leído el SignerList de la cuenta.
   */
  signingCeremony?: boolean;
}

export interface VaultRotateHandoff {
  handoff: DirectMintHandoff;
  /** FXRP the batch deposits into `toVault` = redeemDepositUBA + net.supplyUBA. */
  depositUBA: bigint;
}

/**
 * Close a vault ROTATION end-to-end (UNSIGNED): exit `fromVault` and enter
 * `toVault` inside ONE `0xFE` dispatch instead of two. The XRPL rail is
 * mint-coupled — every Personal Account dispatch rides a Payment that mints a
 * small FXRP — so a naive rotation (withdraw, then deposit) pays that toll
 * twice. Fusing both legs into a single userOp batch pays it once:
 *
 *   [ redeem(shares, PA)              — fromVault shares → FXRP into the PA
 *     approve(FXRP → toVault)         — for redeemDeposit + this mint's net
 *     deposit(FXRP, amount, PA) ]     — toVault shares → the PA
 *
 * The deposit amount adds the dispatch's own net mint (net.supplyUBA) to the
 * redeem output, so the mint-coupled FXRP joins the new position instead of
 * sitting loose in the PA. Vault rotations never touch FAssets redemption:
 * the FXRP stays on Flare throughout. Astryum signs nothing.
 */
export async function buildVaultRotateHandoff(
  provider: Provider,
  input: VaultRotateHandoffInput,
): Promise<VaultRotateHandoff> {
  if (input.fromVault === input.toVault) {
    throw new Error('VAULT_ROTATE_SAME_VAULT: fromVault and toVault must differ');
  }
  if (input.sharesUBA <= 0n) throw new Error('VAULT_ROTATE_BAD_SHARES: must be > 0');
  if (input.redeemDepositUBA < 0n) throw new Error('VAULT_ROTATE_BAD_DEPOSIT: must be ≥ 0');

  const params = await readDirectMintParams(provider);
  const net = computeNetMint(input.grossXrpDrops, params, input.bufferBips);
  const personalAccount = await resolvePersonalAccount(provider, input.xrplAddress);
  const depositUBA = input.redeemDepositUBA + net.supplyUBA;

  let redeemCalls: EncodedAction[];
  if (input.fromVault === 'firelight') {
    const { FirelightAdapter } = await import('../adapters/FirelightAdapter');
    redeemCalls = await new FirelightAdapter().buildRedeemBatch({
      sharesUBA: input.sharesUBA,
      receiver: personalAccount,
      owner: personalAccount,
    });
  } else {
    const { UpshiftVaultAdapter } = await import('../adapters/UpshiftVaultAdapter');
    redeemCalls = await new UpshiftVaultAdapter().buildInstantRedeemBatch({
      vaultKey: input.fromVault,
      sharesUBA: input.sharesUBA,
      receiver: personalAccount,
    });
  }

  let depositCalls: EncodedAction[];
  if (input.toVault === 'firelight') {
    const { FirelightAdapter } = await import('../adapters/FirelightAdapter');
    depositCalls = await new FirelightAdapter().buildStakeBatch({
      supplyUBA: depositUBA,
      receiver: personalAccount,
    });
  } else {
    const { UpshiftVaultAdapter } = await import('../adapters/UpshiftVaultAdapter');
    depositCalls = await new UpshiftVaultAdapter().buildDepositBatch({
      vaultKey: input.toVault,
      supplyUBA: depositUBA,
      receiver: personalAccount,
    });
  }

  const handoff = await buildDirectMintHandoff(
    provider,
    {
      xrplAddress: input.xrplAddress,
      grossXrpDrops: input.grossXrpDrops,
      innerCalls: [...redeemCalls, ...depositCalls],
      walletId: input.walletId,
      bufferBips: input.bufferBips,
      supersedePendingNonce: input.supersedePendingNonce,
      preparedByUserId: input.preparedByUserId,
      supersedeAuthorized: input.supersedeAuthorized,
      preparedByProven: input.preparedByProven,
      preparedByProofUnreadable: input.preparedByProofUnreadable,
      lastLedgerWindow: input.lastLedgerWindow,
      signingCeremony: input.signingCeremony,
      action: `vault-rotate:${input.fromVault}->${input.toVault}`,
    },
    { params }, // reuse the already-read params → one RPC read, consistent net
  );

  return { handoff, depositUBA };
}
