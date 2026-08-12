/**
 * LegacyCageCreationService — a Legacy's cage is born from ONE quorum signature.
 *
 * The rail is the same 0xFE machinery as the governed funding (one XRPL Payment
 * whose memo commits a userOp; the executor pays the FDC attestation; the
 * council's own Personal Account runs the committed batch). What is new is the
 * batch itself:
 *
 *   1. LegacyStackFactory.create(councilR, params)   ← msg.sender = the PA,
 *      which the factory verifies against MasterAccountController — only the
 *      council's own account can bring its cage into the world.
 *   2. FXRP.approve(predictedVault, supplyUBA)
 *   3. LegacyVault.deposit(supplyUBA)                ← the vault does not exist
 *      when the quorum signs; CREATE2 makes its address knowable anyway.
 *
 * One signature therefore creates the cage AND funds it — but does NOT direct
 * the capital into any venue: that separation stays deliberate (a signature
 * should not both lock family capital away and decide where it works).
 *
 * The ETERNAL params are assembled here, each from the authority that owns it:
 *   asset            — AssetManagerFXRP.fAsset(), read live (#invariant: never
 *                      from a doc or a chat).
 *   constitutionRef  — the SHA-256 the council ALREADY anchored on XRPL via
 *                      DIDSet. No anchor → no cage: the text precedes the code.
 *   protocolTreasury — LEGACY_PROTOCOL_TREASURY (install-level, D6).
 *   linajeFeeBps     — chosen by the quorum within the constructor's [10%,40%]
 *                      band (D5); default 3000.
 *   initialVenues    — the venues the product can actually compose orders for
 *                      (Kinetic kFXRP ISO, Firelight stXRP), from config.
 *
 * Prepare-only throughout: this module encodes bytes and reads public state.
 * It signs nothing, submits nothing, holds no key (invariants #1/#8).
 */

import { ethers } from 'ethers';
import type { EncodedAction } from '../../connectors/protocols/IProtocolAdapter';

/** The factory surface this service speaks (mirrors LegacyStackFactory.sol). */
const CAGE_PARAMS_TUPLE =
  '(address asset, bytes32 constitutionRef, address protocolTreasury, uint16 linajeFeeBps, (address target, uint8 kind)[] initialVenues)';
export const FACTORY_ABI = [
  `function create(string councilAddress, ${CAGE_PARAMS_TUPLE} p) returns (address bridge, address vault)`,
  `function predictAddresses(string councilAddress, ${CAGE_PARAMS_TUPLE} p) view returns (address bridge, address vault)`,
  'function vaultOf(bytes32) view returns (address)',
];

const FXRP_APPROVE_ABI = ['function approve(address spender, uint256 amount) returns (bool)'];
const LEGACY_VAULT_DEPOSIT_ABI = ['function deposit(uint256 amount)'];

/** LegacyVault.VenueKind — the contract enum, in its declared order. */
export const VENUE_KIND = { ERC4626: 0, COMPOUND_V2: 1 } as const;

export interface CageVenue {
  target: string;
  kind: number;
  /** Human name for the disclosure ("Kinetic", "Firelight"). */
  label: string;
}

export interface CageParams {
  asset: string;
  constitutionRef: string;
  protocolTreasury: string;
  linajeFeeBps: number;
  initialVenues: CageVenue[];
}

/** D5: the founder's decision for the birth rate; the band is the contract's. */
export const LINAJE_DEFAULT_BPS = 3000;
export const LINAJE_FLOOR_BPS = 1000;
export const LINAJE_CEIL_BPS = 4000;

/**
 * The birth venues, from configuration — ONLY venues the product already knows
 * how to read and order against (the same addresses the Earn rails use).
 * At least one is required: a cage with no venue can hold principal but not
 * work it, and adding one later costs the D1a 30-day delay.
 */
export function configuredBirthVenues(): CageVenue[] {
  // Lazy require keeps this callable from tests that set env per-case.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getProtocolAddresses } = require('../../config/protocolAddresses') as {
    getProtocolAddresses: () => {
      kinetic: { isoKFxrp?: string };
      firelight: { stXRP?: string };
    };
  };
  const addrs = getProtocolAddresses();
  const venues: CageVenue[] = [];
  if (addrs.kinetic.isoKFxrp) {
    venues.push({ target: addrs.kinetic.isoKFxrp, kind: VENUE_KIND.COMPOUND_V2, label: 'Kinetic' });
  }
  if (addrs.firelight.stXRP) {
    venues.push({ target: addrs.firelight.stXRP, kind: VENUE_KIND.ERC4626, label: 'Firelight' });
  }
  return venues;
}

/** The install's treasury for the D6 hook — refuses to default silently:
 *  address(0) would make the hook unusable in that vault FOR EVER. */
export function requiredProtocolTreasury(): string {
  const treasury = process.env.LEGACY_PROTOCOL_TREASURY;
  if (!treasury || !ethers.isAddress(treasury)) {
    throw new Error(
      'LEGACY_PROTOCOL_TREASURY missing/invalid — the cage constructor fixes the fee recipient for ever, ' +
        'so it must be set deliberately, never defaulted',
    );
  }
  return treasury;
}

/** Validate + normalize the quorum's linaje choice (D5 band, contract-enforced). */
export function normalizeLinajeFeeBps(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return LINAJE_DEFAULT_BPS;
  const bps = Number(raw);
  if (!Number.isInteger(bps) || bps < LINAJE_FLOOR_BPS || bps > LINAJE_CEIL_BPS) {
    throw new Error(
      `linajeFeeBps must be an integer in [${LINAJE_FLOOR_BPS}, ${LINAJE_CEIL_BPS}] (10%–40%), got "${raw}"`,
    );
  }
  return bps;
}

// ── The beta cap on caged capital (founder, 2026-08-06) ─────────────────────
//
// The cage is a ONE-WAY door for principal: it can work, come back idle, or
// migrate — it can never be paid out to an address. During the beta, someone
// who does not yet understand that could lock capital they will want back.
// The vault contract is immutable and its deposit() is permissionless, so the
// cap lives where our product composes: the prepare routes refuse to build a
// mint/deposit that would push a cage's TOTAL above the cap. Someone calling
// the contract by hand is outside the product and outside the cap — the cap
// protects users of our rails, which is exactly its job.
//
// Exemptions reuse the demo-cap lists (DEMO_CAP_EXEMPT_EMAILS / _ADDRESSES):
// one place to whitelist the founder's accounts, not two.

/** Total principal a cage may hold via our rails, in UBA. Env-tunable
 *  (LEGACY_CAGE_MAX_TOTAL_XRP, default 5); '0' or 'off' disables. */
export function cageCapUBA(): bigint | null {
  const raw = (process.env.LEGACY_CAGE_MAX_TOTAL_XRP ?? '').trim();
  if (raw === '0' || raw.toLowerCase() === 'off') return null;
  const n = Number(raw || 5);
  const capXrp = Number.isFinite(n) && n > 0 ? n : 5;
  return BigInt(Math.round(capXrp * 1e6));
}

export function cageCapXrp(): number | null {
  const cap = cageCapUBA();
  return cap === null ? null : Number(cap) / 1e6;
}

/**
 * Would this addition push the cage over the beta cap? Pure arithmetic — the
 * caller resolves exemptions (account/address) BEFORE asking, and reads the
 * cage's live total so the cap covers the SUM, not just this transaction.
 */
// The `?: undefined` counter-fields keep property access typeable without
// narrowing — this repo compiles with strict off, where boolean-discriminant
// narrowing is unavailable (same trick as CouncilProposalOutcome).
export type CageCapVerdict =
  | { ok: true; capXrp?: undefined; detail?: undefined }
  | { ok: false; capXrp: number; detail: string };

export function checkCageCap(input: { currentUBA: bigint; addUBA: bigint }): CageCapVerdict {
  const cap = cageCapUBA();
  if (cap === null) return { ok: true };
  const after = input.currentUBA + input.addUBA;
  if (after <= cap) return { ok: true };
  const capXrp = Number(cap) / 1e6;
  const currentXrp = (Number(input.currentUBA) / 1e6).toFixed(2);
  const addXrp = (Number(input.addUBA) / 1e6).toFixed(2);
  return {
    ok: false,
    capXrp,
    detail:
      `Beta limit: a cage may hold at most ${capXrp} XRP in total through Astryum. This cage holds ${currentXrp} ` +
      `and this would add ${addXrp}. The limit exists because caged principal NEVER comes back out to an address — ` +
      'only its yield does — and during the beta nobody should lock more than they can afford to leave locked. ' +
      'Nothing was composed and no capital has moved.',
  };
}

/** The tuple ethers passes for CageParams (order = the struct's field order). */
function toParamsTuple(p: CageParams): [string, string, string, number, Array<[string, number]>] {
  return [
    ethers.getAddress(p.asset),
    p.constitutionRef,
    ethers.getAddress(p.protocolTreasury),
    p.linajeFeeBps,
    p.initialVenues.map((v): [string, number] => [ethers.getAddress(v.target), v.kind]),
  ];
}

/** Where this council's cage WILL live — asked of the factory itself (CREATE2),
 *  so a mismatch with the deployment is impossible by construction. */
export async function predictCageAddresses(
  provider: ethers.Provider,
  factoryAddress: string,
  councilR: string,
  params: CageParams,
): Promise<{ bridge: string; vault: string }> {
  const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, provider);
  const [bridge, vault] = (await factory.predictAddresses(councilR, toParamsTuple(params))) as [
    string,
    string,
  ];
  return { bridge, vault };
}

/**
 * The committed batch: create the cage, then put the minted FXRP inside it.
 * `supplyUBA` must be the mint's post-fee figure (`net.supplyUBA`) — approving
 * more than actually arrives reverts the whole userOp after the XRP is spent.
 */
export function buildCageCreationBatch(input: {
  factoryAddress: string;
  councilR: string;
  params: CageParams;
  predictedVault: string;
  supplyUBA: bigint;
}): EncodedAction[] {
  if (input.supplyUBA <= 0n) throw new Error('CAGE_CREATE_BAD_AMOUNT: supplyUBA must be > 0');
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.params.constitutionRef)) {
    throw new Error('CAGE_CREATE_BAD_REF: constitutionRef must be 0x + 64 hex (a SHA-256)');
  }
  if (input.params.initialVenues.length === 0) {
    throw new Error('CAGE_CREATE_NO_VENUES: at least one birth venue is required');
  }
  const factory = new ethers.Interface(FACTORY_ABI);
  const erc20 = new ethers.Interface(FXRP_APPROVE_ABI);
  const vault = new ethers.Interface(LEGACY_VAULT_DEPOSIT_ABI);
  return [
    {
      to: ethers.getAddress(input.factoryAddress),
      calldata: factory.encodeFunctionData('create', [input.councilR, toParamsTuple(input.params)]),
      value: '0',
    },
    {
      to: ethers.getAddress(input.params.asset),
      calldata: erc20.encodeFunctionData('approve', [
        ethers.getAddress(input.predictedVault),
        input.supplyUBA,
      ]),
      value: '0',
    },
    {
      to: ethers.getAddress(input.predictedVault),
      calldata: vault.encodeFunctionData('deposit', [input.supplyUBA]),
      value: '0',
    },
  ];
}
