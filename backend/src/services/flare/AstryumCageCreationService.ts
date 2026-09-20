/**
 * AstryumCageCreationService — una jaula v2 nace de UNA firma de su cuenta XRPL.
 *
 * Clon del patrón de `AstryumPoteCreationService` (que a su vez clona el del
 * Legacy), con lo que cambia en la jaula v2:
 *
 *   1. La jaula NO custodia: no hay depósito génesis. Lo que nace es el mando.
 *   2. Lo que sí va en el mismo batch es la APROBACIÓN de la fee de creación de
 *      potes: cada `createPote` cobra `CREATION_FEE` del `feePayer` DIRECTO a la
 *      tesorería de Astryum, y el pagador natural es la Personal Account del
 *      consejo — que en este mismo 0xFE recibe el FXRP del carrier. Así el XRP
 *      que paga el peaje del nacimiento deja en la PA justo la gasolina para los
 *      primeros potes, sin una segunda ceremonia.
 *   3. Los parámetros eternos son otros: activo, constitución y la LISTA ETERNA
 *      de destinos (⊆ registro de Astryum — el contrato lo comprueba al nacer).
 *
 * El batch (una firma XRPL vía la Personal Account del consejo, 0xFE):
 *   1. AstryumCageFactory.create(councilR, params)   ← msg.sender = la PA
 *   2. FXRP.approve(predictedCage, feeAllowanceUBA)  ← para los createPote futuros
 *
 * Prepare-only de punta a punta: codifica bytes y lee estado público. Ni firma,
 * ni envía, ni tiene llave (invariantes #1/#8).
 */

import { ethers } from 'ethers';
import type { EncodedAction } from '../../connectors/protocols/IProtocolAdapter';

const TARGET_TUPLE = '(uint32 chainId, address target)';
const CAGE_PARAMS_TUPLE = `(address asset, bytes32 constitutionRef, ${TARGET_TUPLE}[] allowedTargets)`;

export const CAGE_FACTORY_ABI = [
  `function create(string councilAddress, ${CAGE_PARAMS_TUPLE} p) returns (address bridge, address cage)`,
  `function predictAddresses(string councilAddress, ${CAGE_PARAMS_TUPLE} p) view returns (address bridge, address cage)`,
  'function cageOf(bytes32) view returns (address)',
  'function bridgeOf(bytes32) view returns (address)',
  'function vaultOf(bytes32) view returns (address)',
  'function cageCount() view returns (uint256)',
  'function allCages(uint256) view returns (address)',
  'function CREATION_FEE() view returns (uint256)',
  'function MAX_PAYEE_BPS_ALLOWED() view returns (uint16)',
  'function FREE_POTES_PER_CAGE() view returns (uint16)',
  'function TREASURY() view returns (address)',
  'function ASTRYUM_REGISTRY() view returns (address)',
  'function POTE_DEPLOYER() view returns (address)',
];

export const CAGE_READ_ABI = [
  'function AUTHORITY() view returns (address)',
  'function ASSET() view returns (address)',
  'function REGISTRY() view returns (address)',
  'function TREASURY() view returns (address)',
  'function CREATION_FEE() view returns (uint256)',
  'function MAX_PAYEE_BPS_ALLOWED() view returns (uint16)',
  'function FREE_POTES() view returns (uint16)',
  'function freePotesLeft() view returns (uint256)',
  'function registryOnly() view returns (bool)',
  'function CHAIN_ID() view returns (uint32)',
  'function constitutionRef() view returns (bytes32)',
  'function director() view returns (address)',
  'function directorUntil() view returns (uint64)',
  `function allowedTargets() view returns (${TARGET_TUPLE}[])`,
  'function poteCount() view returns (uint256)',
  'function potes(uint256) view returns (address)',
  'function isMyPote(address) view returns (bool)',
  'function succeeded() view returns (bool)',
  'function successor() view returns (address)',
  'function successorEta() view returns (uint64)',
];

const ERC20_APPROVE_ABI = ['function approve(address spender, uint256 amount) returns (bool)'];

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const XRPL_ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;

export class CageCreationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CageCreationError';
  }
}

export interface CageTarget {
  chainId: number;
  target: string;
}

export interface CageCreationParams {
  asset: string;
  constitutionRef: string;
  /**
   * La lista ETERNA, OPCIONAL. Si viene, cada entrada tiene que estar ya en el
   * registro de Astryum y la jaula no podrá tocar nada fuera de ella jamás.
   * Vacía = la jaula sigue al registro de Astryum tal y como esté cada día
   * (decisión 27-ago: el gestor elige dentro de la whitelist desde el pote).
   */
  allowedTargets: CageTarget[];
}

/** Lo que un consejo tiene que leer antes de firmar: nada de esto cambia jamás. */
export function validateCageParams(p: CageCreationParams): void {
  if (!EVM_ADDRESS_RE.test(p.asset)) throw new CageCreationError('BAD_ASSET', 'asset debe ser una dirección 0x válida');
  if (!BYTES32_RE.test(p.constitutionRef)) {
    throw new CageCreationError('BAD_REF', 'constitutionRef debe ser 0x + 64 hex (el SHA-256 anclado por DIDSet)');
  }
  if (!Array.isArray(p.allowedTargets)) {
    throw new CageCreationError('BAD_ALLOWLIST', 'allowedTargets debe ser una lista (vacía = la jaula sigue al registro de Astryum)');
  }
  const seen = new Set<string>();
  for (const t of p.allowedTargets) {
    if (!Number.isInteger(t.chainId) || t.chainId < 0 || t.chainId > 0xffffffff) {
      throw new CageCreationError('BAD_CHAIN', `chainId inválido: ${String(t.chainId)}`);
    }
    if (!EVM_ADDRESS_RE.test(t.target)) throw new CageCreationError('BAD_TARGET', `target inválido: ${String(t.target)}`);
    const key = `${t.chainId}:${t.target.toLowerCase()}`;
    if (seen.has(key)) throw new CageCreationError('DUPLICATE_TARGET', `destino repetido: ${key}`);
    seen.add(key);
  }
}

function toParamsTuple(p: CageCreationParams) {
  return {
    asset: ethers.getAddress(p.asset),
    constitutionRef: p.constitutionRef.toLowerCase(),
    allowedTargets: p.allowedTargets.map((t) => ({ chainId: t.chainId, target: ethers.getAddress(t.target) })),
  };
}

/**
 * El batch comprometido: crea la jaula y aprueba desde la PA la fee de los
 * potes que vendrán. Sin génesis: la jaula no guarda capital. Si
 * `feeAllowanceUBA` es 0 (fee de creación a cero, o el consejo prefiere aprobar
 * después), el batch es solo la creación.
 */
export function buildCageCreationBatch(input: {
  factoryAddress: string;
  councilR: string;
  params: CageCreationParams;
  predictedCage: string;
  feeAllowanceUBA: bigint;
}): EncodedAction[] {
  validateCageParams(input.params);
  if (!EVM_ADDRESS_RE.test(input.factoryAddress)) throw new CageCreationError('BAD_FACTORY', 'factoryAddress inválida');
  if (!XRPL_ADDRESS_RE.test(input.councilR)) throw new CageCreationError('BAD_COUNCIL', 'councilR debe ser una r-address');
  if (!EVM_ADDRESS_RE.test(input.predictedCage)) throw new CageCreationError('BAD_PREDICTED', 'predictedCage inválida');
  if (input.feeAllowanceUBA < 0n) throw new CageCreationError('BAD_ALLOWANCE', 'feeAllowanceUBA no puede ser negativa');

  const factory = new ethers.Interface(CAGE_FACTORY_ABI);
  const calls: EncodedAction[] = [
    {
      to: ethers.getAddress(input.factoryAddress),
      calldata: factory.encodeFunctionData('create', [input.councilR, toParamsTuple(input.params)]),
      value: '0',
    },
  ];
  if (input.feeAllowanceUBA > 0n) {
    const erc20 = new ethers.Interface(ERC20_APPROVE_ABI);
    calls.push({
      to: ethers.getAddress(input.params.asset),
      calldata: erc20.encodeFunctionData('approve', [ethers.getAddress(input.predictedCage), input.feeAllowanceUBA]),
      value: '0',
    });
  }
  return calls;
}

/** Dónde vivirán el bridge y la jaula de este consejo, antes de existir. */
export async function predictCageAddresses(
  provider: ethers.Provider,
  factoryAddress: string,
  councilR: string,
  params: CageCreationParams,
): Promise<{ bridge: string; cage: string }> {
  validateCageParams(params);
  const factory = new ethers.Contract(factoryAddress, CAGE_FACTORY_ABI, provider);
  const [bridge, cage] = (await factory.predictAddresses(councilR, toParamsTuple(params))) as [string, string];
  return { bridge: ethers.getAddress(bridge), cage: ethers.getAddress(cage) };
}

/**
 * La jaula de un consejo, o null si aún no la tiene. Nunca lanza: sin jaula no
 * hay nada que leer ni ordenar (mismo criterio que `resolveAstryumPote`).
 */
export async function resolveAstryumCage(
  provider: ethers.Provider,
  factoryAddress: string,
  councilR: string,
): Promise<{ bridge: string; cage: string } | null> {
  if (!EVM_ADDRESS_RE.test(factoryAddress) || !XRPL_ADDRESS_RE.test(councilR)) return null;
  try {
    const factory = new ethers.Contract(factoryAddress, CAGE_FACTORY_ABI, provider);
    const hash = ethers.keccak256(ethers.toUtf8Bytes(councilR));
    const [cage, bridge] = (await Promise.all([factory.cageOf(hash), factory.bridgeOf(hash)])) as [string, string];
    if (cage === ethers.ZeroAddress || bridge === ethers.ZeroAddress) return null;
    return { bridge: ethers.getAddress(bridge), cage: ethers.getAddress(cage) };
  } catch {
    return null;
  }
}

/** Los términos que Astryum fijó en la factory: lo que cada jaula hereda al nacer. */
export async function readFactoryTerms(
  provider: ethers.Provider,
  factoryAddress: string,
): Promise<{ creationFee: bigint; treasury: string; registry: string; freePotesPerCage: number; maxPayeeBpsAllowed: number }> {
  const factory = new ethers.Contract(factoryAddress, CAGE_FACTORY_ABI, provider);
  const [creationFee, treasury, registry, freePotes, maxPayeeBps] = await Promise.all([
    factory.CREATION_FEE() as Promise<bigint>,
    factory.TREASURY() as Promise<string>,
    factory.ASTRYUM_REGISTRY() as Promise<string>,
    factory.FREE_POTES_PER_CAGE() as Promise<bigint>,
    factory.MAX_PAYEE_BPS_ALLOWED() as Promise<bigint>,
  ]);
  return {
    creationFee,
    treasury: ethers.getAddress(treasury),
    registry: ethers.getAddress(registry),
    freePotesPerCage: Number(freePotes),
    maxPayeeBpsAllowed: Number(maxPayeeBps),
  };
}

/** Todas las jaulas, en orden de creación. */
export async function listCages(provider: ethers.Provider, factoryAddress: string): Promise<string[]> {
  const factory = new ethers.Contract(factoryAddress, CAGE_FACTORY_ABI, provider);
  const count = Number(await factory.cageCount());
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(ethers.getAddress(await factory.allCages(i)));
  return out;
}

export interface CageSummary {
  cage: string;
  authority: string;
  asset: string;
  registry: string;
  treasury: string;
  creationFee: string;
  /** Política de Astryum: tope de payees que esta jaula puede dar a sus potes (2000 hoy). */
  maxPayeeBpsAllowed: number;
  /** Potes que nacen sin fee de creación (política de la factory: 3) y cuántos quedan. */
  freePotes: number;
  freePotesLeft: number;
  /** true ⇔ nació sin lista propia: sigue al registro de Astryum tal y como esté. */
  registryOnly: boolean;
  chainId: number;
  constitutionRef: string;
  director: string;
  directorUntil: number;
  allowedTargets: CageTarget[];
  potes: string[];
  succeeded: boolean;
  successor: string;
  successorEta: number;
}

/**
 * El estado de una jaula, entero. Devuelve null si no se pudo leer — y «no pude
 * leer» nunca es «no existe» (lección de la jaula sin registrar, 22-ago): el
 * que llama decide cómo pintarlo, nunca como cero.
 */
export async function readCageSummary(provider: ethers.Provider, cage: string): Promise<CageSummary | null> {
  if (!EVM_ADDRESS_RE.test(cage)) return null;
  try {
    const c = new ethers.Contract(cage, CAGE_READ_ABI, provider);
    const settled = await Promise.allSettled([
      c.AUTHORITY() as Promise<string>,
      c.ASSET() as Promise<string>,
      c.REGISTRY() as Promise<string>,
      c.TREASURY() as Promise<string>,
      c.CREATION_FEE() as Promise<bigint>,
      c.CHAIN_ID() as Promise<bigint>,
      c.constitutionRef() as Promise<string>,
      c.director() as Promise<string>,
      c.directorUntil() as Promise<bigint>,
      c.allowedTargets() as Promise<Array<{ chainId: bigint; target: string }>>,
      c.poteCount() as Promise<bigint>,
      c.succeeded() as Promise<boolean>,
      c.successor() as Promise<string>,
      c.successorEta() as Promise<bigint>,
      c.MAX_PAYEE_BPS_ALLOWED() as Promise<bigint>,
      c.FREE_POTES() as Promise<bigint>,
      c.freePotesLeft() as Promise<bigint>,
      c.registryOnly() as Promise<boolean>,
    ]);
    if (settled.some((r) => r.status === 'rejected')) return null;
    const v = settled.map((r) => (r as PromiseFulfilledResult<unknown>).value);

    const poteCount = Number(v[10] as bigint);
    const potes: string[] = [];
    for (let i = 0; i < poteCount; i++) {
      try {
        potes.push(ethers.getAddress(await c.potes(i)));
      } catch {
        // Un pote ilegible no invalida la jaula; se omite ese y sigue.
      }
    }

    return {
      cage: ethers.getAddress(cage),
      authority: ethers.getAddress(v[0] as string),
      asset: ethers.getAddress(v[1] as string),
      registry: ethers.getAddress(v[2] as string),
      treasury: ethers.getAddress(v[3] as string),
      creationFee: (v[4] as bigint).toString(),
      chainId: Number(v[5] as bigint),
      constitutionRef: String(v[6]).toLowerCase(),
      director: ethers.getAddress(v[7] as string),
      directorUntil: Number(v[8] as bigint),
      allowedTargets: (v[9] as Array<{ chainId: bigint; target: string }>).map((t) => ({
        chainId: Number(t.chainId),
        target: ethers.getAddress(t.target),
      })),
      potes,
      succeeded: Boolean(v[11]),
      successor: ethers.getAddress(v[12] as string),
      successorEta: Number(v[13] as bigint),
      maxPayeeBpsAllowed: Number(v[14] as bigint),
      freePotes: Number(v[15] as bigint),
      freePotesLeft: Number(v[16] as bigint),
      registryOnly: Boolean(v[17]),
    };
  } catch {
    return null;
  }
}
