/**
 * PasskeyRelayService — porta la firma passkey del usuario y paga el gas.
 *
 * «Firma él, la transporta cualquiera»: el usuario firma un lote de calls con
 * su passkey (P256/WebAuthn); el reto que firma COMPROMETE las calls exactas
 * (`challengeForBatch` = chainid+cuenta+nonce+calls), así que este relayer NO
 * puede alterarlas — si cambia un byte, la verificación on-chain revierte. Solo
 * puede portar o dejar caer. Cero custodia: la autoridad es la firma, no el
 * remitente. El usuario nunca necesita FLR.
 *
 * QUIÉN CORRE EL RELAYER Y PAGA EL GAS (Z16): el PROVEEDOR DE INFRA. En el
 * modelo plug-and-play, ese es ASTRYUM — corre el executor para que el exchange
 * no monte nada, y lo cobra como software (licencia). `PASSKEY_RELAYER_PK` es la
 * key del que lo corre. El USUARIO jamás paga gas ni toca FLR (el punto de la
 * passkey contrafactual). Que Astryum lo corra NO viola «Astryum jamás manda»:
 * el relayer es TRANSPORTE, cero autoridad — la firma passkey compromete las
 * calls on-chain, así que solo puede portar o dejar caer, jamás alterar ni
 * decidir. Y es permissionless: si este relayer cae, cualquiera (el exchange, un
 * keeper) puede llamar `executeBatch` directo con la misma firma → comodidad, no
 * dependencia. La autoridad vive en la firma, nunca en quien la transporta.
 *
 * Gating (invariante #10): doble flag — `INSTITUTIONAL_POTES_ENABLED` +
 * `PASSKEY_RELAYER_PK` (solo env, invariante #2). Sin ambos → no-op.
 *
 * Anti-DoS: el relayer solo paga gas por calls cuyo `target` está en una
 * allowlist (FXRP + los potes + la propia cuenta). Sin esto, cualquiera podría
 * hacerle firmar-y-pagar basura hasta vaciar su saldo.
 *
 * Lazy-deploy: si la cuenta passkey aún no existe (contrafactual), el relayer
 * la despliega por el factory ANTES del `executeBatch`, en la misma petición.
 *
 * StaticCall antes de gastar (invariante #11): un lote condenado se descubre
 * sin quemar gas.
 *
 * productizer-it3 — EL GAS SE GASTABA ANTES DE MIRAR LA FIRMA. El preflight
 * `executeBatch.staticCall` es lo único que comprobaba la firma, y solo puede
 * correr sobre una cuenta con código: para una cuenta contrafactual el relayer
 * mandaba (y esperaba) `factory.create(x, y)` PRIMERO. Cualquier sesión SIWE
 * (gratis) con claves públicas inventadas y una firma basura hacía que el
 * relayer pagase un despliegue por petición — el saldo del relayer, vaciado a
 * 2000 req/15 min. Ahora, antes de CUALQUIER transacción:
 *   1. la clave pública es un punto de P-256 (si no, BAD_PUBKEY, sin red);
 *   2. el reto se recalcula EXACTAMENTE como PasskeyAccount.sol (chainid del
 *      nodo, cuenta predicha, nonce 0 si no desplegada o `nonce()` si lo está,
 *      calls) y la firma WebAuthn se verifica off-chain con node:crypto —
 *      byte-idéntico al P256VERIFY (RIP-7212) del contrato (BAD_SIG_OFFCHAIN);
 *   3. los despliegues están limitados por usuario SIWE (DEPLOY_LIMIT → 429).
 * La verificación off-chain NO sustituye a la on-chain (la autoridad sigue
 * siendo el contrato); solo impide que el relayer pague por lo que el contrato
 * iba a rechazar. Límite residual, dicho: quien genere SUS PROPIAS claves firma
 * válido — por eso existe el paso 3.
 */

import { createHash, createPublicKey, verify as cryptoVerify, type KeyObject } from 'crypto';
import { ethers } from 'ethers';

const PASSKEY_ACCOUNT_ABI = [
  'function nonce() view returns (uint256)',
  'function executeBatch((address target, uint256 value, bytes data)[] calls, (bytes authenticatorData, string clientDataPre, string clientDataPost, bytes32 r, bytes32 s) sig) returns (bytes[])',
];
const PASSKEY_FACTORY_ABI = [
  'function accountFor(uint256 pubKeyX, uint256 pubKeyY) view returns (address predicted, bool deployed)',
  'function create(uint256 pubKeyX, uint256 pubKeyY) returns (address account)',
];

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const HEX_RE = /^0x[0-9a-fA-F]*$/;
const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;
const UINT_RE = /^[0-9]{1,78}$/;
const UINT256_LIMIT = 1n << 256n;

export interface RelayCall {
  target: string;
  value: string; // decimal string (wei); '0' for most
  data: string; // hex calldata
}

export interface WebAuthnSigInput {
  authenticatorData: string; // hex
  clientDataPre: string;
  clientDataPost: string;
  r: string; // bytes32 hex
  s: string; // bytes32 hex
}

export interface PasskeyRelayInput {
  pubKeyX: string; // uint256 decimal or 0x hex
  pubKeyY: string;
  calls: RelayCall[];
  sig: WebAuthnSigInput;
}

export class PasskeyRelayError extends Error {
  constructor(
    public readonly code: string,
    detail: string
  ) {
    super(detail);
    this.name = 'PasskeyRelayError';
  }
}

/**
 * El status HTTP de cada rechazo — UNA definición, la que usa la ruta.
 *
 * Contrato con el navegador (frontend `passkeyRelayOutcome.ts`): 400 y 409
 * significan «el lote NUNCA se emitió» (se ofrece reintentar); cualquier otro
 * status es «resultado desconocido» (ámbar, jamás un segundo Face ID). Todo
 * rechazo nuevo que ocurra antes de gastar gas es 400 (BAD_*) — salvo
 * DEPLOY_LIMIT, que es 429: el navegador lo pinta ámbar, lo cual es aceptable
 * para un límite de ritmo (no ofrece una segunda firma que chocaría otra vez).
 */
export function passkeyRelayErrorStatus(code: string): number {
  if (code === 'WOULD_REVERT') return 409;
  if (code === 'DEPLOY_LIMIT') return 429;
  if (code.startsWith('BAD') || code.includes('BATCH') || code === 'TARGET_NOT_ALLOWED') return 400;
  return 503;
}

function rpcUrl(): string {
  return process.env.FLARE_RPC_URL || 'https://flare-api.flare.network/ext/C/rpc';
}

/** Destinos por los que el relayer está dispuesto a pagar gas — CONFIGURACIÓN. */
export function relayTargetAllowlist(): Set<string> {
  const out = new Set<string>();
  const add = (a?: string) => {
    if (a && EVM_ADDRESS_RE.test(a.trim())) out.add(a.trim().toLowerCase());
  };
  add(process.env.FXRP_TOKEN);
  add(process.env.KINETIC_KFXRP_ISO);
  add(process.env.FIRELIGHT_STXRP);
  for (const a of (process.env.RELAY_TARGET_ALLOWLIST ?? '').split(',')) add(a);
  return out;
}

/**
 * LOS POTES QUE ESTA PLATAFORMA YA CONOCE — la allowlist que nadie tiene que
 * escribir a mano.
 *
 * La lista de arriba es configuración, y con ella sola cada pote NUEVO nacía
 * con la salida de sus clientes cerrada hasta que alguien editara una variable
 * de entorno. Eso es una salida gateada por config, que es exactamente lo que
 * el invariante prohíbe («LA SALIDA JAMÁS SE GATEA»): el cliente no puede
 * redimir sus participaciones porque el relayer no reconoce SU pote.
 *
 * Así que el pote de cada exchange dado de alta aquí entra solo. No amplía la
 * superficie: son direcciones que la propia plataforma escribió al crear el
 * exchange, no algo que el firmante elija en la petición.
 *
 * Cachéado en memoria: esto se consulta una vez por salida, no por bloque.
 */
const KNOWN_POTES_TTL_MS = 60_000;
let knownPotesCache: { at: number; set: Set<string> } | null = null;

export async function knownPlatformPotes(): Promise<Set<string>> {
  const now = Date.now();
  if (knownPotesCache && now - knownPotesCache.at < KNOWN_POTES_TTL_MS) return knownPotesCache.set;
  const set = new Set<string>();
  try {
    const { listRuns } = await import('../demoExchange/DemoExchangeStore');
    for (const run of await listRuns()) {
      const p = run.poteAddress;
      if (p && EVM_ADDRESS_RE.test(p.trim())) set.add(p.trim().toLowerCase());
    }
  } catch {
    // it. 22 (R2) — A FAILED READ IS NOT «THERE ARE NO POTES», AND CACHING IT
    // CLOSES A WAY OUT FOR A MINUTE. `listRuns` throws now (it. 19 made it
    // strict, so an outage stops looking like an empty table); this catch used
    // to fall through and then store the EMPTY set for the whole TTL, wiping the
    // last good one. With a configured RELAY_TARGET_ALLOWLIST that drops every
    // platform pote out of it, and the redemption a passkey account asks for is
    // refused — by a blink of our database, remembered on purpose. So: keep what
    // we last read (stale beats invented), and do not let the failure become the
    // cached answer.
    if (knownPotesCache) return knownPotesCache.set;
    return set;
  }
  knownPotesCache = { at: now, set };
  return set;
}

/**
 * it. 24 (R1 B6) — «NO PUDE LEER» CON FORMA DE «NO PERMITIDO» ERA UNA SALIDA
 * CERRADA CON LA PALABRA EQUIVOCADA.
 *
 * `knownPlatformPotes` degrada a un conjunto vacío cuando falla la lectura y no
 * hay snapshot previo — un proceso recién arrancado, exactamente el momento en
 * que la base parpadea. Con una allowlist configurada, el pote del cliente se
 * cae de ella y su redención sale como `TARGET_NOT_ALLOWED`: un 400 definitivo
 * que le dice a esa persona que su destino no vale, cuando lo que pasó es que
 * nosotros no pudimos mirar. Esta variante lo dice: `readable:false` y el
 * llamador contesta un 503 reintentable.
 */
export async function knownPlatformPotesRead(): Promise<{ potes: Set<string>; readable: boolean }> {
  const before = knownPotesCache;
  const potes = await knownPlatformPotes();
  // Un fallo sin snapshot devuelve el conjunto vacío SIN cachearlo: eso es lo
  // que distingue «no hay potes» (cacheado) de «no pude leer» (no cacheado).
  const readable = knownPotesCache !== null && (knownPotesCache !== before || potes.size > 0 || knownPotesCache.set === potes);
  return { potes, readable };
}

/** Solo para los tests: olvida el caché de potes conocidos. */
export function _resetKnownPotesCache(): void {
  knownPotesCache = null;
}

function toUint(v: string): bigint {
  const t = typeof v === 'string' ? v.trim() : '';
  let n: bigint;
  if (UINT_RE.test(t)) n = BigInt(t);
  else if (t.length > 2 && HEX_RE.test(t)) n = BigInt(t);
  else throw new PasskeyRelayError('BAD_PUBKEY', `no es un entero válido: ${v}`);
  if (n >= UINT256_LIMIT) throw new PasskeyRelayError('BAD_PUBKEY', `no cabe en uint256: ${v}`);
  return n;
}

/**
 * Valida la forma de la petición SIN red — testeable. Rechaza calls a destinos
 * fuera de la allowlist (anti-DoS) y firmas malformadas.
 */
export function validatePasskeyRelayInput(input: PasskeyRelayInput, allow: Set<string>): void {
  if (!input || !Array.isArray(input.calls) || input.calls.length === 0) {
    throw new PasskeyRelayError('EMPTY_BATCH', 'el lote no puede estar vacío');
  }
  if (input.calls.length > 8) {
    throw new PasskeyRelayError('BATCH_TOO_LARGE', 'como máximo 8 calls por lote');
  }
  // PasskeyAccount's constructor reverts ZeroKey: never pay a deploy for it.
  if (toUint(input.pubKeyX) === 0n || toUint(input.pubKeyY) === 0n) {
    throw new PasskeyRelayError('BAD_PUBKEY', 'la clave pública no puede tener coordenadas a cero');
  }
  for (const c of input.calls) {
    if (typeof c.target !== 'string' || !EVM_ADDRESS_RE.test(c.target)) {
      throw new PasskeyRelayError('BAD_TARGET', 'target inválido');
    }
    if (allow.size > 0 && !allow.has(c.target.toLowerCase())) {
      throw new PasskeyRelayError(
        'TARGET_NOT_ALLOWED',
        `el relayer no paga gas por ${c.target} — fuera de la allowlist`
      );
    }
    if (typeof c.data !== 'string' || !HEX_RE.test(c.data) || c.data.length % 2 !== 0) {
      throw new PasskeyRelayError('BAD_CALLDATA', 'data debe ser hex 0x…');
    }
    if (typeof c.value !== 'string' || !UINT_RE.test(c.value)) {
      throw new PasskeyRelayError('BAD_VALUE', 'value debe ser un entero (wei)');
    }
  }
  const s = input.sig;
  if (
    !s ||
    typeof s.authenticatorData !== 'string' ||
    !HEX_RE.test(s.authenticatorData) ||
    s.authenticatorData.length % 2 !== 0 ||
    !BYTES32_RE.test(s.r) ||
    !BYTES32_RE.test(s.s)
  ) {
    throw new PasskeyRelayError('BAD_SIG', 'firma WebAuthn malformada');
  }
  if (typeof s.clientDataPre !== 'string' || typeof s.clientDataPost !== 'string') {
    throw new PasskeyRelayError('BAD_SIG', 'clientData malformado');
  }
}

/** ¿Está el relayer configurado y encendido? */
export function passkeyRelayGate(): { status: number; body: { error: string; detail: string } } | null {
  if (process.env.INSTITUTIONAL_POTES_ENABLED !== 'true') {
    return { status: 503, body: { error: 'INSTITUTIONAL_DISABLED', detail: 'Módulo institucional apagado.' } };
  }
  if (!process.env.PASSKEY_RELAYER_PK) {
    return { status: 503, body: { error: 'RELAYER_UNCONFIGURED', detail: 'Sin PASSKEY_RELAYER_PK, no hay relayer.' } };
  }
  if (!process.env.ASTRYUM_PASSKEY_FACTORY) {
    return { status: 503, body: { error: 'FACTORY_UNCONFIGURED', detail: 'Falta ASTRYUM_PASSKEY_FACTORY.' } };
  }
  return null;
}

// ── la firma, verificada off-chain igual que PasskeyAccount.sol ──────────────

/**
 * El reto de un lote — EXACTAMENTE `PasskeyAccount.challengeForBatch`:
 *   keccak256(abi.encode(block.chainid, address(this), nonce, calls))
 * y byte-idéntico a `computeBatchChallenge` del frontend
 * (lib/institutional/passkey.ts), que es lo que la passkey firmó.
 */
export function computeBatchChallenge(input: {
  chainId: bigint | number;
  account: string;
  nonce: bigint | number;
  calls: RelayCall[];
}): string {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'address', 'uint256', 'tuple(address target, uint256 value, bytes data)[]'],
    [
      BigInt(input.chainId),
      ethers.getAddress(input.account),
      BigInt(input.nonce),
      input.calls.map((c) => [ethers.getAddress(c.target), BigInt(c.value), c.data]),
    ]
  );
  return ethers.keccak256(encoded);
}

function hexBytes(hex: string): Buffer {
  return Buffer.from(hex.startsWith('0x') ? hex.slice(2) : hex, 'hex');
}

function uint256Bytes(n: bigint): Buffer {
  return Buffer.from(n.toString(16).padStart(64, '0'), 'hex');
}

/**
 * La clave pública (x, y) como KeyObject P-256. node:crypto rechaza al
 * importarla un punto que no está en la curva — lo mismo que haría el
 * precompile, pero sin red y sin gas.
 */
export function p256PublicKey(x: bigint, y: bigint): KeyObject {
  try {
    return createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: uint256Bytes(x).toString('base64url'),
        y: uint256Bytes(y).toString('base64url'),
      },
      format: 'jwk',
    });
  } catch {
    throw new PasskeyRelayError('BAD_PUBKEY', 'la clave pública no es un punto de la curva P-256');
  }
}

/**
 * `PasskeyAccount._verifyAndConsume`, off-chain:
 *   authenticatorData ≥ 37 bytes y bit User-Present (flags = byte 32)
 *   clientDataJSON = pre ‖ base64url(challenge) ‖ post   (43 chars, sin padding)
 *   message = sha256(authenticatorData ‖ sha256(clientDataJSON))
 *   P256VERIFY(message, r, s, X, Y)
 * `crypto.verify('sha256', data, …)` hashea `data` una vez, así que se le da
 * `authenticatorData ‖ sha256(clientDataJSON)` y verifica sobre `message`.
 * Sin normalización low-S: RIP-7212 no la exige y node tampoco — ambos aceptan
 * las dos mitades, así que un rechazo aquí es un rechazo allí.
 */
export function verifyWebAuthnSigOffchain(input: {
  key: KeyObject;
  challenge: string;
  sig: WebAuthnSigInput;
}): boolean {
  const authData = hexBytes(input.sig.authenticatorData);
  if (authData.length < 37 || (authData[32] & 0x01) !== 0x01) return false;
  const clientDataJSON = Buffer.concat([
    Buffer.from(input.sig.clientDataPre, 'utf8'),
    Buffer.from(hexBytes(input.challenge).toString('base64url'), 'utf8'),
    Buffer.from(input.sig.clientDataPost, 'utf8'),
  ]);
  const signed = Buffer.concat([authData, createHash('sha256').update(clientDataJSON).digest()]);
  const rs = Buffer.concat([hexBytes(input.sig.r), hexBytes(input.sig.s)]);
  try {
    return cryptoVerify('sha256', signed, { key: input.key, dsaEncoding: 'ieee-p1363' }, rs);
  } catch {
    return false; // r/s fuera de rango, etc. — no verifica, igual que on-chain
  }
}

// ── límite de despliegues por usuario ────────────────────────────────────────

/**
 * Cada cuenta nueva la despliega el relayer con SU gas, y una clave P-256
 * propia firma válido — la verificación off-chain no frena a quien genera
 * claves en bucle. Así que los despliegues se cuentan por usuario SIWE en una
 * ventana móvil de 24 h (`PASSKEY_RELAY_MAX_DEPLOYS_PER_DAY`, por defecto 3).
 *
 * SUPUESTO DE UNA SOLA INSTANCIA: el contador vive en memoria del proceso. Con
 * N réplicas el techo efectivo es N×límite, y un reinicio lo pone a cero. Para
 * el volumen de hoy (una réplica en Railway) basta; si se escala, pasa a la BD.
 * El hueco residual de fondo (una wallet nueva = una sesión SIWE nueva) queda
 * dicho: esto acota el coste por sesión, no por persona.
 */
const DEPLOY_WINDOW_MS = 24 * 60 * 60 * 1000;
const deploysByUser = new Map<string, number[]>();

function maxDeploysPerDay(): number {
  const raw = process.env.PASSKEY_RELAY_MAX_DEPLOYS_PER_DAY;
  if (raw === undefined || raw.trim() === '') return 3;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 3;
}

/**
 * Reserva el asiento ANTES de mandar el `create`. Síncrono de punta a punta
 * (sin await entre comprobar y apuntar), así que dos peticiones simultáneas
 * del mismo usuario no pueden colarse las dos por el último hueco. Un `create`
 * que después falle no devuelve el asiento — se yerra hacia pagar menos.
 */
function reserveDeploySlot(userId: string): void {
  const now = Date.now();
  // Barrido de todas las entradas caducadas: el mapa no crece sin fin.
  for (const [k, stamps] of deploysByUser) {
    const fresh = stamps.filter((t) => now - t < DEPLOY_WINDOW_MS);
    if (fresh.length === 0) deploysByUser.delete(k);
    else deploysByUser.set(k, fresh);
  }
  const mine = deploysByUser.get(userId) ?? [];
  const max = maxDeploysPerDay();
  if (mine.length >= max) {
    throw new PasskeyRelayError(
      'DEPLOY_LIMIT',
      `esta sesión ya desplegó ${mine.length} cuenta(s) passkey en las últimas 24 h (máximo ${max}); ` +
        'no se ha enviado nada — inténtalo más tarde'
    );
  }
  mine.push(now);
  deploysByUser.set(userId, mine);
}

/** Test-only: el contador es estado del módulo. */
export function __resetPasskeyRelayLimits(): void {
  deploysByUser.clear();
  warnedEmptyAllowlist = false;
}

let warnedEmptyAllowlist = false;

export interface RelayResult {
  account: string;
  deployedNow: boolean;
  deployTxHash?: string;
  execTxHash: string;
}

/**
 * Porta el lote firmado: verifica la firma off-chain, despliega la cuenta si
 * hace falta (dentro del límite del usuario), hace staticCall de preflight, y
 * envía `executeBatch`. El relayer firma con su PK (paga gas); la AUTORIDAD del
 * contenido es la passkey del usuario.
 */
export async function relayPasskeyBatch(input: PasskeyRelayInput, userId: string): Promise<RelayResult> {
  const gate = passkeyRelayGate();
  if (gate) throw new PasskeyRelayError(gate.body.error, gate.body.detail);
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new PasskeyRelayError('BAD_SESSION', 'sin sesión no se porta ningún lote');
  }
  const allow = relayTargetAllowlist();
  if (allow.size > 0) {
    // Los potes de la propia plataforma SIEMPRE cuentan: sin esto, el cliente
    // de un exchange recién creado no podía redimir sus participaciones.
    const known = await knownPlatformPotesRead();
    if (!known.readable) {
      // it. 24 (R1 B6): sin esta lista no sabemos si el destino es un pote
      // nuestro, así que negarlo sería llamar «no permitido» a nuestro propio
      // fallo de lectura — sobre una redención. Se dice, y se reintenta.
      throw new PasskeyRelayError(
        'PLATFORM_POTES_UNREADABLE',
        'we could not read which potes belong to this deployment, so we cannot tell whether this destination is one of ' +
          'them — that is a failure of ours, not a verdict about your redemption. Nothing was signed or paid. Try again.',
      );
    }
    for (const p of known.potes) allow.add(p);
  }
  if (allow.size === 0 && !warnedEmptyAllowlist) {
    // Comportamiento conservado a propósito: cerrarlo sin la lista de potes
    // rompería las salidas de los clientes (decisión de config/fundador).
    warnedEmptyAllowlist = true;
    console.warn(
      '[passkey-relay] allowlist de destinos VACÍA: el relayer paga gas por cualquier target. ' +
        'Configura FXRP_TOKEN / RELAY_TARGET_ALLOWLIST.'
    );
  }
  validatePasskeyRelayInput(input, allow);

  const x = toUint(input.pubKeyX);
  const y = toUint(input.pubKeyY);
  // (1) Punto de la curva — antes de tocar la red.
  const key = p256PublicKey(x, y);

  const provider = new ethers.JsonRpcProvider(rpcUrl());
  const relayer = new ethers.Wallet(process.env.PASSKEY_RELAYER_PK as string, provider);
  const factory = new ethers.Contract(
    process.env.ASTRYUM_PASSKEY_FACTORY as string,
    PASSKEY_FACTORY_ABI,
    relayer
  );

  const [predicted, deployed] = (await factory.accountFor(x, y)) as [string, boolean];
  const account = new ethers.Contract(predicted, PASSKEY_ACCOUNT_ABI, relayer);

  // (2) El reto que el contrato va a reconstruir, con el chainid del nodo al que
  // se va a enviar (block.chainid) y el nonce que va a leer: 0 en una cuenta
  // contrafactual (su storage nace a cero), `nonce()` en una desplegada.
  const { chainId } = await provider.getNetwork();
  const nonce = deployed ? BigInt(await account.nonce()) : 0n;
  const challenge = computeBatchChallenge({ chainId, account: predicted, nonce, calls: input.calls });
  if (!verifyWebAuthnSigOffchain({ key, challenge, sig: input.sig })) {
    throw new PasskeyRelayError(
      'BAD_SIG_OFFCHAIN',
      'la firma passkey no corresponde a este lote, esta cuenta y su nonce actual — no se ha enviado nada'
    );
  }

  let deployTxHash: string | undefined;
  if (!deployed) {
    // (3) Solo ahora, con una firma que el contrato aceptará, se gasta gas.
    reserveDeploySlot(userId);
    const dtx = await factory.create(x, y);
    const dr = await dtx.wait();
    deployTxHash = dr?.hash;
  }

  const calls = input.calls.map((c) => [ethers.getAddress(c.target), BigInt(c.value), c.data]);
  const sig = [input.sig.authenticatorData, input.sig.clientDataPre, input.sig.clientDataPost, input.sig.r, input.sig.s];

  // Preflight: un lote condenado (un leg que revierte) se descubre AQUÍ, sin
  // quemar gas (invariante #11).
  try {
    await account.executeBatch.staticCall(calls, sig);
  } catch (e) {
    throw new PasskeyRelayError('WOULD_REVERT', (e as Error).message);
  }

  const tx = await account.executeBatch(calls, sig);
  const rec = await tx.wait();
  return { account: predicted, deployedNow: !deployed, deployTxHash, execTxHash: rec?.hash ?? tx.hash };
}
