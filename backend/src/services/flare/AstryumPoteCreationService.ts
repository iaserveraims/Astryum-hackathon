/**
 * AstryumPoteCreationService — un pote institucional nace de UNA firma del
 * consejo. Clon del patrón probado de LegacyCageCreationService, con las tres
 * diferencias de AstryumVault:
 */

import { ethers } from 'ethers';
import type { EncodedAction } from '../../connectors/protocols/IProtocolAdapter';
import { cooldownCoversQueue, queuedVenueMinCooldownSeconds } from './cooldownGuardrail';

const ASTRYUM_CAGE_PARAMS_TUPLE =
  '(address asset, string name, string symbol, bytes32 constitutionRef, uint48 cooldown, uint16 bufferFloorBps, (address target, uint8 kind)[] initialVenues)';
export const ASTRYUM_FACTORY_ABI = [
  `function create(string councilAddress, ${ASTRYUM_CAGE_PARAMS_TUPLE} p) returns (address bridge, address vault)`,
  `function predictAddresses(string councilAddress, ${ASTRYUM_CAGE_PARAMS_TUPLE} p) view returns (address bridge, address vault)`,
  'function vaultOf(bytes32) view returns (address)',
  'function bridgeOf(bytes32) view returns (address)',
];

const FXRP_APPROVE_ABI = ['function approve(address spender, uint256 amount) returns (bool)'];
const POTE_DEPOSIT_ABI = ['function deposit(uint256 assets, address receiver) returns (uint256)'];

/** AstryumVault.VenueKind — el enum del contrato, en su orden declarado. */
export const POTE_VENUE_KIND = { ERC4626: 0, COMPOUND_V2: 1, ERC4626_QUEUED: 2 } as const;

/** Cooldown medido en vivo (verify-firelight): 24h/periodo, peor caso 48h, +1 de margen. */
export const POTE_B_COOLDOWN_SECONDS = 72 * 3600;
export const MAX_COOLDOWN_SECONDS = 30 * 24 * 3600;
export const MAX_BUFFER_FLOOR_BPS = 5000;

export interface PoteVenue {
  target: string;
  kind: number;
  label: string;
}

export interface PoteCreationParams {
  name: string;
  symbol: string;
  constitutionRef: string;
  cooldownSeconds: number;
  bufferFloorBps: number;
  initialVenues: PoteVenue[];
}

export class PoteCreationError extends Error {
  constructor(
    public readonly code: string,
    detail: string
  ) {
    super(detail);
    this.name = 'PoteCreationError';
  }
}

/** Valida los params eternos ANTES de componer nada (el contrato revierte
 *  igual, pero un revert cuesta gas y un XRP de peaje FDC). */
export function validatePoteParams(p: PoteCreationParams): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(p.constitutionRef)) {
    throw new PoteCreationError('BAD_REF', 'constitutionRef debe ser 0x + 64 hex (un SHA-256 anclado en XRPL)');
  }
  if (!p.name?.trim() || !p.symbol?.trim()) {
    throw new PoteCreationError('BAD_IDENTITY', 'name y symbol del token de participaciones son obligatorios');
  }
  if (!Number.isInteger(p.cooldownSeconds) || p.cooldownSeconds < 0 || p.cooldownSeconds > MAX_COOLDOWN_SECONDS) {
    throw new PoteCreationError('BAD_COOLDOWN', `cooldownSeconds debe estar en [0, ${MAX_COOLDOWN_SECONDS}]`);
  }
  if (!Number.isInteger(p.bufferFloorBps) || p.bufferFloorBps < 0 || p.bufferFloorBps > MAX_BUFFER_FLOOR_BPS) {
    throw new PoteCreationError('BAD_BUFFER', `bufferFloorBps debe estar en [0, ${MAX_BUFFER_FLOOR_BPS}]`);
  }
  if (p.initialVenues.length === 0) {
    throw new PoteCreationError('NO_VENUES', 'se requiere al menos un venue de nacimiento');
  }
  // La regla de elegibilidad por tipo (I4): un venue encolado exige cooldown > 0
  // (eso lo fuerza el contrato). Pero cooldown>0 no basta — el ticket de salida
  // madura en `now + COOLDOWN`, y si eso es ANTES de que drene la cola del venue,
  // claimRedeem revierte (UnwindShortfall) y el depositante queda varado. El piso
  // real (72h = cola de Firelight + margen) se exige aquí, antes de gastar gas.
  const guard = cooldownCoversQueue(
    p.cooldownSeconds,
    p.initialVenues.map((v) => v.kind),
    queuedVenueMinCooldownSeconds()
  );
  if (!guard.ok) {
    throw new PoteCreationError('QUEUED_NEEDS_COOLDOWN', guard.reason ?? 'queued venue needs a longer cooldown');
  }
}

/** El tuple que ethers pasa por CageParams (orden = orden de los campos del struct). */
function toParamsTuple(
  p: PoteCreationParams
): [string, string, string, string, number, number, Array<[string, number]>] {
  return [
    ethers.getAddress(requireAsset()),
    p.name,
    p.symbol,
    p.constitutionRef,
    p.cooldownSeconds,
    p.bufferFloorBps,
    p.initialVenues.map((v): [string, number] => [ethers.getAddress(v.target), v.kind]),
  ];
}

function requireAsset(): string {
  const asset = process.env.FXRP_TOKEN;
  if (!asset || !ethers.isAddress(asset)) {
    throw new PoteCreationError('NO_ASSET', 'FXRP_TOKEN ausente/ inválido — el activo del pote se fija al nacer');
  }
  return asset;
}

/** Los dos potes del rodaje, de configuración — sólo venues que el producto ya
 *  sabe leer y ordenar (las mismas direcciones que usan los rails de Earn). */
export function configuredPoteVenues(): { kinetic?: PoteVenue; firelight?: PoteVenue } {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getProtocolAddresses } = require('../../config/protocolAddresses') as {
    getProtocolAddresses: () => { kinetic: { isoKFxrp?: string }; firelight: { stXRP?: string } };
  };
  const addrs = getProtocolAddresses();
  const out: { kinetic?: PoteVenue; firelight?: PoteVenue } = {};
  if (addrs.kinetic.isoKFxrp) {
    out.kinetic = { target: addrs.kinetic.isoKFxrp, kind: POTE_VENUE_KIND.COMPOUND_V2, label: 'Kinetic' };
  }
  if (addrs.firelight.stXRP) {
    out.firelight = { target: addrs.firelight.stXRP, kind: POTE_VENUE_KIND.ERC4626_QUEUED, label: 'Firelight' };
  }
  return out;
}

/** Pote A «Conservador»: Kinetic, salida inmediata. Pote B «Rendimiento»:
 *  Firelight, cooldown 72h. Ambos con constitutionRef anclada por el consejo. */
export function poteParamsFor(
  which: 'A' | 'B',
  constitutionRef: string
): PoteCreationParams {
  const venues = configuredPoteVenues();
  if (which === 'A') {
    if (!venues.kinetic) throw new PoteCreationError('NO_KINETIC', 'KINETIC_KFXRP_ISO no configurado');
    return {
      name: 'Astryum Pote A',
      symbol: 'apA-FXRP',
      constitutionRef,
      cooldownSeconds: 0,
      bufferFloorBps: 1000,
      initialVenues: [venues.kinetic],
    };
  }
  if (!venues.firelight) throw new PoteCreationError('NO_FIRELIGHT', 'FIRELIGHT_STXRP no configurado');
  // El pote B (cooldown > 0) admite AMBOS tipos: síncrono (Kinetic) y encolado
  // (Firelight). Sembrarlo con los dos deja al operador repartir el capital
  // entre dos venues distintos dentro del mismo pote — el multi-venue de la demo.
  const initialVenues: PoteVenue[] = [];
  if (venues.kinetic) initialVenues.push(venues.kinetic);
  initialVenues.push(venues.firelight);
  return {
    name: 'Astryum Pote B',
    symbol: 'apB-FXRP',
    constitutionRef,
    cooldownSeconds: POTE_B_COOLDOWN_SECONDS,
    bufferFloorBps: 1000,
    initialVenues,
  };
}

/** Dónde vivirá el pote de este consejo — preguntado a la propia factory
 *  (CREATE2), así un desajuste con el despliegue es imposible por construcción. */
export async function predictPoteAddresses(
  provider: ethers.Provider,
  factoryAddress: string,
  councilR: string,
  params: PoteCreationParams
): Promise<{ bridge: string; vault: string }> {
  validatePoteParams(params);
  const factory = new ethers.Contract(factoryAddress, ASTRYUM_FACTORY_ABI, provider);
  const [bridge, vault] = (await factory.predictAddresses(councilR, toParamsTuple(params))) as [string, string];
  return { bridge, vault };
}

/**
 * El pote de un consejo, resuelto de la factory nueva (Z8: factory propia, un
 * consejo un pote). Devuelve null si el consejo aún no tiene pote — igual que
 * `cageForCouncil` de Legacy, nunca lanza: sin pote no hay nada que leer ni
 * ordenar. Lo consumen las órdenes de gobierno del pote (cede, setPayees,
 * proposeVenue), que viajan XRPL→FDC→bridge como en Legacy.
 */
export async function resolveAstryumPote(
  provider: ethers.Provider,
  factoryAddress: string,
  councilR: string
): Promise<{ vault: string; bridge: string } | null> {
  if (!ethers.isAddress(factoryAddress) || !/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(councilR)) return null;
  try {
    const factory = new ethers.Contract(factoryAddress, ASTRYUM_FACTORY_ABI, provider);
    const hash = ethers.keccak256(ethers.toUtf8Bytes(councilR));
    const [vault, bridge] = (await Promise.all([factory.vaultOf(hash), factory.bridgeOf(hash)])) as [string, string];
    if (vault === ethers.ZeroAddress || bridge === ethers.ZeroAddress) return null;
    return { vault, bridge };
  } catch {
    return null;
  }
}

/**
 * El batch comprometido: crea el pote, luego mete el FXRP génesis dentro con
 * el consejo como receiver de las shares (Z10 anti-inflación). El génesis NO
 * dirige a ningún venue — esa separación es deliberada.
 *
 * `genesisUBA` debe ser la cifra post-fee del mint (lo que de verdad llega);
 * aprobar de más revierte el userOp entero tras gastar el XRP.
 */
export function buildPoteCreationBatch(input: {
  factoryAddress: string;
  councilR: string;
  councilPersonalAccount: string; // la PA es el receiver del génesis
  params: PoteCreationParams;
  predictedVault: string;
  genesisUBA: bigint;
}): EncodedAction[] {
  validatePoteParams(input.params);
  if (input.genesisUBA <= 0n) {
    throw new PoteCreationError('BAD_AMOUNT', 'genesisUBA debe ser > 0 (el depósito génesis defiende contra inflación)');
  }
  if (!ethers.isAddress(input.councilPersonalAccount)) {
    throw new PoteCreationError('BAD_PA', 'councilPersonalAccount debe ser una dirección válida');
  }
  const factory = new ethers.Interface(ASTRYUM_FACTORY_ABI);
  const erc20 = new ethers.Interface(FXRP_APPROVE_ABI);
  const pote = new ethers.Interface(POTE_DEPOSIT_ABI);
  return [
    {
      to: ethers.getAddress(input.factoryAddress),
      calldata: factory.encodeFunctionData('create', [input.councilR, toParamsTuple(input.params)]),
      value: '0',
    },
    {
      to: ethers.getAddress(requireAsset()),
      calldata: erc20.encodeFunctionData('approve', [ethers.getAddress(input.predictedVault), input.genesisUBA]),
      value: '0',
    },
    {
      to: ethers.getAddress(input.predictedVault),
      calldata: pote.encodeFunctionData('deposit', [
        input.genesisUBA,
        ethers.getAddress(input.councilPersonalAccount),
      ]),
      value: '0',
    },
  ];
}
