/**
 * FxrpOftBridgeAdapter — B6 (plan §13): pure calldata builder for bridging
 * FXRP from the user's FLARE EOA to their own address on ETHEREUM via the
 * canonical LayerZero OFT Adapter (lockbox). Founder decision 15-ago: direct
 * calldata in-app, everything disclosed before the signature — never a
 * handoff to an external site.
 *
 * Verificado ON-CHAIN y REPETIBLE: `npm run verify:fxrp-bridge`
 * (src/scripts/verify-fxrp-oft-bridge.ts) — comprueba las DOS direcciones y
 * confirma el EID de Flare contra `peers()`. Última corrida: 2026-08-17.
 * [Antes se citaba `verify-fxrp-oft-bridge.js`, que no existía.] Hechos:
 *   - adapter 0xd70659…E07E wraps the canonical FXRP ERC-20 0xAd552A…c5bE
 *   - approvalRequired() = true → finite approve leg
 *   - sharedDecimals = 6 (== local decimals: exact amounts, no dust rounding)
 *   - peers(30101) == FXRP OFT on Ethereum 0xCE6170…0110 → EID confirmed
 *   - quoteSend ≈ 98 FLR native fee — REAL money: quoted live per prepare,
 *     shown before signing, excess auto-refunds to the user.
 *
 * The user signs ON FLARE (chainId 14, their own EOA). If the FXRP sits in
 * the PersonalAccount, the PA→EOA step (`pa-withdraw-transfer`, already live)
 * comes FIRST — binding adjustment #1 of the infra review. Rail D (OFT from
 * the PA via 0xFE) is post-21-sep and is NOT this.
 */
import { Interface } from 'ethers';
import { EvmLeg } from './MorphoBlueEthAdapter';

export const FLARE_CHAIN_ID = 14;
export const ETHEREUM_EID = 30101;
/**
 * EID de LayerZero de Flare — CONFIRMADO contra la cadena, no de memoria:
 * `peers(30295)` en el OFT de Ethereum devuelve el adapter de Flare
 * (verify-fxrp-oft-bridge, 2026-08-17). Un EID equivocado en un `send` no
 * falla ruidosamente: los tokens salen del origen y no llegan a ningún sitio.
 */
export const FLARE_EID = 30295;

/** LayerZero OFT Adapter (lockbox) for FXRP on Flare. */
export const FXRP_OFT_ADAPTER_FLARE = '0xd70659a6396285BF7214d7Ea9673184e7C72E07E';
/** Canonical FXRP ERC-20 on Flare (the token the adapter locks). */
export const FXRP_FLARE_ERC20 = '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE';
/** The OFT the adapter must be peered to on Ethereum (drift-checked live). */
export const FXRP_ETH_OFT = '0xCE6170EA245dC8D1f275A710a062b70f125F0110';

const SEND_PARAM_TUPLE =
  '(uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd)';
const OFT_ABI = [
  `function send(${SEND_PARAM_TUPLE} sendParam, (uint256 nativeFee, uint256 lzTokenFee) fee, address refundAddress) payable`,
];
const ERC20_ABI = ['function approve(address spender, uint256 amount) returns (bool)'];

const oftIface = new Interface(OFT_ABI);
const erc20Iface = new Interface(ERC20_ABI);

export function addrToBytes32(addr: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    throw new Error('FxrpOftBridgeAdapter: not an address');
  }
  return '0x' + addr.toLowerCase().slice(2).padStart(64, '0');
}

/**
 * The LayerZero fee moves between quote and signature — a +5% ceiling keeps
 * the send alive through small moves, and the EXCESS AUTO-REFUNDS to the
 * refund address (the user). The ceiling, not the quote, is what the
 * disclosure shows as "max".
 */
export function feeWithBuffer(quotedNativeFee: bigint): bigint {
  return quotedNativeFee + (quotedNativeFee * 5n + 99n) / 100n;
}

/**
 * Bridge legs: finite approve (exact amount) + send with the buffered fee as
 * msg.value, destination = THE SAME user address on Ethereum, refund = user.
 * `amountBase` in FXRP base units (6 decimals; shared == local, so
 * minAmountLD can be exact — any drift means revert, never silent loss).
 */
export function buildBridgeLegs(
  user: string,
  amountBase: bigint,
  quotedNativeFee: bigint,
): EvmLeg[] {
  if (!/^0x[0-9a-fA-F]{40}$/.test(user)) {
    throw new Error('FxrpOftBridgeAdapter: user is not an address');
  }
  if (amountBase <= 0n) throw new Error('FxrpOftBridgeAdapter: amount must be > 0');
  if (quotedNativeFee <= 0n) throw new Error('FxrpOftBridgeAdapter: fee quote required');
  const maxFee = feeWithBuffer(quotedNativeFee);
  const sendParam = [
    ETHEREUM_EID,
    addrToBytes32(user),
    amountBase,
    amountBase, // minAmountLD exact — shared decimals == local decimals (verified)
    '0x',
    '0x',
    '0x',
  ];
  return [
    {
      to: FXRP_FLARE_ERC20,
      data: erc20Iface.encodeFunctionData('approve', [FXRP_OFT_ADAPTER_FLARE, amountBase]),
      value: '0x0',
      description: 'Approve FXRP to the bridge adapter (exact amount)',
    },
    {
      to: FXRP_OFT_ADAPTER_FLARE,
      data: oftIface.encodeFunctionData('send', [sendParam, [maxFee, 0n], user]),
      value: '0x' + maxFee.toString(16),
      description: 'Send FXRP to your own address on Ethereum (LayerZero)',
    },
  ];
}

/**
 * H3 — LA VUELTA: Ethereum → Flare.
 *
 * Sin esto el puente era de ida y el recorrido del runbook («repagar → sacar
 * colateral → puentear de vuelta») moría en el paso 3: el FXRP salía del
 * mercado y se quedaba varado en Ethereum.
 *
 * Dos diferencias verificadas on-chain respecto a la ida (verify-fxrp-oft-
 * bridge, 2026-08-17), y las dos importan:
 *   · en Ethereum el FXRP es un OFT NATIVO (`approvalRequired() == false`):
 *     quemas tus propios tokens, así que NO hay pata de approve. Meter un
 *     approve aquí sería una firma extra que no autoriza nada.
 *   · la comisión nativa se paga en ETH (no en FLR), y el gas de Ethereum es
 *     otro orden de magnitud — la cifra se cotiza viva y se enseña antes.
 * `sharedDecimals == 6` en los dos lados, así que minAmountLD puede ser
 * exacto: cualquier desvío revierte en vez de perder polvo en silencio.
 */
export function buildBridgeBackLegs(
  user: string,
  amountBase: bigint,
  quotedNativeFee: bigint,
): EvmLeg[] {
  if (!/^0x[0-9a-fA-F]{40}$/.test(user)) {
    throw new Error('FxrpOftBridgeAdapter: user is not an address');
  }
  if (amountBase <= 0n) throw new Error('FxrpOftBridgeAdapter: amount must be > 0');
  if (quotedNativeFee <= 0n) throw new Error('FxrpOftBridgeAdapter: fee quote required');
  const maxFee = feeWithBuffer(quotedNativeFee);
  const sendParam = [
    FLARE_EID,
    addrToBytes32(user),
    amountBase,
    amountBase,
    '0x',
    '0x',
    '0x',
  ];
  return [
    {
      to: FXRP_ETH_OFT,
      data: oftIface.encodeFunctionData('send', [sendParam, [maxFee, 0n], user]),
      value: '0x' + maxFee.toString(16),
      description: 'Send FXRP back to your own address on Flare (LayerZero)',
    },
  ];
}
