/**
 * AstryumPoteStateService — the read layer of the institutional pote.
 *
 * Same discipline as LegacyVaultStateService, two deliberate differences:
 *
 *  1. The cage is INJECTED ({rpcUrl, pote}) — this module never touches
 *     legacyStackConfig() or any Legacy env var. The audit flagged that
 *     coupling in readVaultState; the new pote is born without it.
 *  2. The pure logic (kind decoding, pre-flight verdicts, ticket clocks)
 *     lives at top level with NO network anywhere near it, so it is testable
 *     by nature, not by mocking ("lógica pura enterrada = lógica sin red").
 *
 * Every check mirrors a REAL revert in AstryumVault — the pre-flight tells
 * the truth or it does not exist (the ORDER_WOULD_REVERT doctrine).
 */

import { ethers } from 'ethers';
import { formatBaseUnits } from './LegacyVaultStateService';

// ── Types ────────────────────────────────────────────────────────────────────

/** Contract enum order — AstryumVault.VenueKind. */
export type PoteVenueKind = 'erc4626' | 'compoundv2' | 'erc4626queued';

export interface PoteVenueState {
  id: number;
  target: string;
  kind: PoteVenueKind;
  readyAt: number;
  retired: boolean;
  /** High-water basis (base units) — feeds the harvest cut, nothing else. */
  basis: string;
  /** Live + queued value the venue holds for the pote (base units). */
  value: string;
  /** Assets sitting in the venue's withdrawal queue, ours (base units). */
  queuedTotal: string;
}

export interface PoteRedeemTicket {
  id: number;
  receiver: string;
  assets: string; // base units, fixed at request — the pote owes exactly this
  maturity: number; // unix seconds
  claimed: boolean;
}

export interface AstryumPoteState {
  pote: string;
  name: string;
  symbol: string;
  shareDecimals: number;
  asset: { address: string; symbol: string; decimals: number };
  totalAssets: string;
  totalSupply: string;
  /** Assets one whole share redeems for right now (base units of the asset). */
  sharePrice: string;
  cooldownSeconds: number;
  bufferFloorBps: number;
  /** Tope de posición por cuenta, en unidades base (V2). '0' = sin tope; null = el pote no lo expone (v1). */
  maxDepositPerUser: string | null;
  freeBalance: string;
  earmarkedAssets: string;
  totalClaimable: string;
  maxVenueBps: number;
  venues: PoteVenueState[];
  tickets: PoteRedeemTicket[];
  governance: {
    council: string;
    constitutionRef: string;
    /**
     * El director EFECTIVO. En un pote v2 el asiento del pote está vacío por
     * diseño y quien dirige es el director cedido de la JAULA: se lee de ella,
     * para que «quién puede mover esto hoy» sea una sola respuesta.
     */
    director: string;
    directorUntil: number;
    payees: Array<{ account: string; bps: number }>;
    /** La jaula que gobierna este pote (v2), o null si el consejo es un bridge directo (v1). */
    cage: string | null;
  };
}

// ── Pure logic (no RPC anywhere below this line until the reader) ────────────

export function decodePoteVenueKind(kind: number | bigint): PoteVenueKind {
  const k = Number(kind);
  if (k === 0) return 'erc4626';
  if (k === 1) return 'compoundv2';
  if (k === 2) return 'erc4626queued';
  // A newer vault could add a kind. Mis-labelling one would tell the client
  // their capital waits in a queue that does not exist — refuse to guess.
  throw new Error(`unknown VenueKind ${k}`);
}

export type PoteDirectToVerdict =
  | { ok: true }
  | {
      ok: false;
      code:
        | 'VENUE_UNKNOWN'
        | 'VENUE_RETIRED'
        | 'VENUE_NOT_READY'
        | 'ZERO_AMOUNT'
        | 'INSUFFICIENT_FREE'
        | 'BUFFER_FLOOR_CROSSED'
        | 'ENTRY_CAP_EXCEEDED';
      detail?: string;
    };

/** Mirror of AstryumVault._allocate — every branch is a real revert. */
export function checkPoteDirectTo(
  state: AstryumPoteState,
  venueId: number,
  amount: bigint,
  nowSec: number
): PoteDirectToVerdict {
  const venue = state.venues[venueId];
  if (!venue || venue.id !== venueId) return { ok: false, code: 'VENUE_UNKNOWN' };
  if (venue.retired) return { ok: false, code: 'VENUE_RETIRED' };
  if (nowSec < venue.readyAt) {
    return { ok: false, code: 'VENUE_NOT_READY', detail: `entra en vigor en ${venue.readyAt}` };
  }
  if (amount <= 0n) return { ok: false, code: 'ZERO_AMOUNT' };

  const free = BigInt(state.freeBalance);
  if (amount > free) {
    return {
      ok: false,
      code: 'INSUFFICIENT_FREE',
      detail: `libre ${formatBaseUnits(free, state.asset.decimals)}`,
    };
  }
  const totalAssets = BigInt(state.totalAssets);
  const floor = (totalAssets * BigInt(state.bufferFloorBps)) / 10_000n;
  if (free - amount < floor) {
    return {
      ok: false,
      code: 'BUFFER_FLOOR_CROSSED',
      detail: `el colchón mínimo es ${formatBaseUnits(floor, state.asset.decimals)}`,
    };
  }
  // Post-move estimate of the concentration cap (the contract checks on real
  // values after the deposit; value+amount is the honest forecast).
  const postValue = BigInt(venue.value) + amount;
  if (postValue * 10_000n > totalAssets * BigInt(state.maxVenueBps)) {
    return { ok: false, code: 'ENTRY_CAP_EXCEEDED' };
  }
  return { ok: true };
}

export type RequestRedeemVerdict =
  | { ok: true; estAssets: bigint }
  | { ok: false; code: 'SYNC_POTE_USE_REDEEM' | 'ZERO_SHARES' | 'INSUFFICIENT_SHARES' };

/** Mirror of requestRedeem's gates; estAssets mirrors previewRedeem up to the
 *  virtual-offset dust (never shown as a promise, always as an estimate). */
export function checkRequestRedeem(
  state: AstryumPoteState,
  shares: bigint,
  holderShares: bigint
): RequestRedeemVerdict {
  if (state.cooldownSeconds === 0) return { ok: false, code: 'SYNC_POTE_USE_REDEEM' };
  if (shares <= 0n) return { ok: false, code: 'ZERO_SHARES' };
  if (shares > holderShares) return { ok: false, code: 'INSUFFICIENT_SHARES' };
  const supply = BigInt(state.totalSupply);
  const estAssets = supply === 0n ? 0n : (shares * BigInt(state.totalAssets)) / supply;
  return { ok: true, estAssets };
}

export type ClaimRedeemVerdict =
  | { ok: true }
  | { ok: false; code: 'TICKET_UNKNOWN' | 'ALREADY_CLAIMED' }
  | { ok: false; code: 'NOT_MATURE'; maturity: number; remainingSeconds: number };

/** Mirror of claimRedeem's gates — the exit clock the UI paints (F3). */
export function checkClaimRedeem(
  state: AstryumPoteState,
  ticketId: number,
  nowSec: number
): ClaimRedeemVerdict {
  const t = state.tickets[ticketId];
  if (!t || t.id !== ticketId) return { ok: false, code: 'TICKET_UNKNOWN' };
  if (t.claimed) return { ok: false, code: 'ALREADY_CLAIMED' };
  if (nowSec < t.maturity) {
    return { ok: false, code: 'NOT_MATURE', maturity: t.maturity, remainingSeconds: t.maturity - nowSec };
  }
  return { ok: true };
}

// ── The reader (the only part that touches the network) ─────────────────────

const POTE_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function asset() view returns (address)',
  'function totalAssets() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
  'function COOLDOWN() view returns (uint48)',
  'function BUFFER_FLOOR_BPS() view returns (uint16)',
  'function freeBalance() view returns (uint256)',
  'function earmarkedAssets() view returns (uint256)',
  'function totalClaimable() view returns (uint256)',
  'function maxVenueBps() view returns (uint16)',
  'function venueCount() view returns (uint256)',
  'function venues(uint256) view returns (address target, uint8 kind, uint64 readyAt, bool retired)',
  'function venueBasis(uint256) view returns (uint256)',
  'function venueValue(uint256) view returns (uint256)',
  'function venueQueuedTotal(uint256) view returns (uint256)',
  'function redeemTicketCount() view returns (uint256)',
  'function redeemTickets(uint256) view returns (address receiver, uint256 assets, uint48 maturity, bool claimed)',
  'function council() view returns (address)',
  'function constitutionRef() view returns (bytes32)',
  'function director() view returns (address)',
  'function directorUntil() view returns (uint64)',
  'function payeeCount() view returns (uint256)',
  'function payees(uint256) view returns (address account, uint16 bps)',
  // Solo en la generación V2 (jaula): un pote v1 no lo expone y se lee como null.
  'function maxDepositPerUser() view returns (uint256)',
];

const ERC20_META_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
];

export interface PoteReadConfig {
  rpcUrl: string;
  pote: string;
  provider?: ethers.Provider; // injectable for tests / shared providers
}

/** Las participaciones que sostiene una cuenta concreta (para el MAX honesto del formulario). */
export async function readHolderShares(cfg: PoteReadConfig, holder: string): Promise<string> {
  const provider = cfg.provider ?? new ethers.JsonRpcProvider(cfg.rpcUrl);
  const pote = new ethers.Contract(cfg.pote, ['function balanceOf(address) view returns (uint256)'], provider);
  return (await pote.balanceOf(holder)).toString();
}

export async function readPoteState(cfg: PoteReadConfig): Promise<AstryumPoteState> {
  const provider = cfg.provider ?? new ethers.JsonRpcProvider(cfg.rpcUrl);
  const pote = new ethers.Contract(cfg.pote, POTE_ABI, provider);

  const [
    name,
    symbol,
    shareDecimals,
    assetAddr,
    totalAssets,
    totalSupply,
    cooldown,
    bufferFloorBps,
    freeBalance,
    earmarkedAssets,
    totalClaimable,
    maxVenueBps,
    venueCount,
    ticketCount,
    council,
    constitutionRef,
    director,
    directorUntil,
    payeeCount,
  ] = await Promise.all([
    pote.name(),
    pote.symbol(),
    pote.decimals(),
    pote.asset(),
    pote.totalAssets(),
    pote.totalSupply(),
    pote.COOLDOWN(),
    pote.BUFFER_FLOOR_BPS(),
    pote.freeBalance(),
    pote.earmarkedAssets(),
    pote.totalClaimable(),
    pote.maxVenueBps(),
    pote.venueCount(),
    pote.redeemTicketCount(),
    pote.council(),
    pote.constitutionRef(),
    pote.director(),
    pote.directorUntil(),
    pote.payeeCount(),
  ]);

  const assetErc = new ethers.Contract(assetAddr, ERC20_META_ABI, provider);
  const [assetSymbol, assetDecimals, sharePrice] = await Promise.all([
    assetErc.symbol(),
    assetErc.decimals(),
    pote.convertToAssets(10n ** BigInt(shareDecimals)),
  ]);

  const venues: PoteVenueState[] = await Promise.all(
    Array.from({ length: Number(venueCount) }, async (_, id) => {
      const [row, basis, value, queuedTotal] = await Promise.all([
        pote.venues(id),
        pote.venueBasis(id),
        pote.venueValue(id),
        pote.venueQueuedTotal(id),
      ]);
      return {
        id,
        target: row.target as string,
        kind: decodePoteVenueKind(row.kind),
        readyAt: Number(row.readyAt),
        retired: Boolean(row.retired),
        basis: basis.toString(),
        value: value.toString(),
        queuedTotal: queuedTotal.toString(),
      };
    })
  );

  const tickets: PoteRedeemTicket[] = await Promise.all(
    Array.from({ length: Number(ticketCount) }, async (_, id) => {
      const t = await pote.redeemTickets(id);
      return {
        id,
        receiver: t.receiver as string,
        assets: t.assets.toString(),
        maturity: Number(t.maturity),
        claimed: Boolean(t.claimed),
      };
    })
  );

  const payees = await Promise.all(
    Array.from({ length: Number(payeeCount) }, async (_, i) => {
      const p = await pote.payees(i);
      return { account: p.account as string, bps: Number(p.bps) };
    })
  );

  // El tope por cuenta existe desde la V2. Un pote v1 revierte aquí (selector
  // desconocido) y eso NO es un error del estado: es «este pote no lo tiene».
  let maxDepositPerUser: string | null = null;
  try {
    maxDepositPerUser = ((await pote.maxDepositPerUser()) as bigint).toString();
  } catch {
    maxDepositPerUser = null;
  }

  // ¿Gobierna este pote una JAULA (v2)? La jaula responde `isMyPote(pote)`; un
  // bridge v1 no tiene ese selector y revierte. Si es una jaula, el director
  // efectivo es el suyo (el del pote está vacío por diseño). Si no se pudo
  // saber, se deja lo que dice el pote: nunca se inventa una jaula.
  let cage: string | null = null;
  let effectiveDirector = director as string;
  let effectiveUntil = Number(directorUntil);
  try {
    const probe = new ethers.Contract(
      council as string,
      [
        'function isMyPote(address) view returns (bool)',
        'function director() view returns (address)',
        'function directorUntil() view returns (uint64)',
      ],
      provider,
    );
    if ((await probe.isMyPote(cfg.pote)) === true) {
      cage = ethers.getAddress(council as string);
      const [cageDirector, cageUntil] = await Promise.all([probe.director() as Promise<string>, probe.directorUntil() as Promise<bigint>]);
      effectiveDirector = cageDirector;
      effectiveUntil = Number(cageUntil);
    }
  } catch {
    cage = null;
  }

  return {
    pote: cfg.pote,
    name,
    symbol,
    shareDecimals: Number(shareDecimals),
    asset: { address: assetAddr as string, symbol: assetSymbol, decimals: Number(assetDecimals) },
    totalAssets: totalAssets.toString(),
    totalSupply: totalSupply.toString(),
    sharePrice: sharePrice.toString(),
    cooldownSeconds: Number(cooldown),
    bufferFloorBps: Number(bufferFloorBps),
    maxDepositPerUser,
    freeBalance: freeBalance.toString(),
    earmarkedAssets: earmarkedAssets.toString(),
    totalClaimable: totalClaimable.toString(),
    maxVenueBps: Number(maxVenueBps),
    venues,
    tickets,
    governance: {
      council: council as string,
      constitutionRef: constitutionRef as string,
      director: effectiveDirector,
      directorUntil: effectiveUntil,
      payees,
      cage,
    },
  };
}
