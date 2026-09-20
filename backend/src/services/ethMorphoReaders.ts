/**
 * ethMorphoReaders — los lectores on-chain del carril FXRP/RLUSD, en UN sitio.
 *
 * Vivían dentro de `routes/ethMorpho.ts`, privados del módulo. Eso estaba bien
 * mientras la ruta era el único que componía, pero deja de estarlo en cuanto
 * algo más quiere ejercitar el carril: el ensayo en seco
 * (`scripts/dryrun-eth-morpho.ts`) tendría que copiarlos, y una copia que
 * diverge de producción es peor que no tener ensayo — verificaría un carril que
 * no es el que el usuario firma.
 *
 * Aquí no hay lógica de decisión: solo lecturas. Quién puede llamar (flag,
 * geofence, auth, KWYH) sigue siendo asunto de la ruta.
 *
 * NOTA VAULT V2 (leído de mainnet el 17-ago-2026): la bóveda de Sentora es
 * Morpho Vault V2, cuyos `max*` son STUBS que devuelven 0 siempre. Se exponen
 * igual —el servicio sabe ignorarlos— pero las lecturas que dicen la verdad son
 * `balanceOf` + `previewRedeem` (lo que vale tu posición) y el saldo del activo
 * en la bóveda (lo que puede pagarte hoy).
 */
import { ethers, Interface } from 'ethers';
import { makeEthersMorphoReader, type MorphoChainReader } from './EthMorphoMarketService';
import type {
  SentoraVaultReader,
  FxrpBridgeReader,
  FxrpBridgeBackReader,
} from './EthMorphoPrepareService';
import { getRpcForChain } from '../utils/rpcForChain';
import { quoteFillExactOutput } from './flare/SwapFillService';
import { ethereumSwapVenue, type FillQuoteFn } from './EthMorphoPrepareService';
import { SENTORA_RLUSD_VAULT } from '../connectors/protocols/adapters/SentoraRlusdVaultAdapter';
import {
  FXRP_OFT_ADAPTER_FLARE,
  FXRP_ETH_OFT,
  ETHEREUM_EID,
  FLARE_EID,
} from '../connectors/protocols/adapters/FxrpOftBridgeAdapter';

export const VAULT_READ_ABI = [
  'function asset() view returns (address)',
  'function totalAssets() view returns (uint256)',
  'function maxWithdraw(address owner) view returns (uint256)',
  'function maxDeposit(address owner) view returns (uint256)',
  // Las que SÍ dicen la verdad en Morpho Vault V2 (los max* son stubs a 0).
  'function balanceOf(address owner) view returns (uint256)',
  'function previewRedeem(uint256 shares) view returns (uint256)',
];
export const DEC_ABI = ['function decimals() view returns (uint8)'];
export const BAL_ABI = ['function balanceOf(address) view returns (uint256)'];

export const OFT_READ_ABI = [
  'function token() view returns (address)',
  'function sharedDecimals() view returns (uint8)',
  'function peers(uint32 eid) view returns (bytes32)',
  'function quoteSend((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) sendParam, bool payInLzToken) view returns ((uint256 nativeFee, uint256 lzTokenFee) fee)',
];

/**
 * El mercado Morpho Blue en Ethereum. Lanza UNSUPPORTED_CHAIN cuando no hay RPC
 * de Ethereum configurado (ETHEREUM_RPC_URL o ALCHEMY_API_KEY); la ruta lo
 * traduce a 503.
 */
export function makeMorphoReader(): MorphoChainReader {
  return makeEthersMorphoReader(getRpcForChain(1));
}

/** La bóveda de Sentora (pata lend-only). */
export function makeSentoraReader(): SentoraVaultReader {
  const provider = getRpcForChain(1);
  const vault = new ethers.Contract(SENTORA_RLUSD_VAULT, new Interface(VAULT_READ_ABI), provider);
  return {
    asset: async () => String(await vault.asset()),
    totalAssets: async () => BigInt(await vault.totalAssets()),
    maxWithdraw: async (owner: string) => BigInt(await vault.maxWithdraw(owner)),
    assetDecimals: async () => {
      const asset = String(await vault.asset());
      const erc20 = new ethers.Contract(asset, new Interface(DEC_ABI), provider);
      return Number(await erc20.decimals());
    },
    // H7 — los dos «no» que antes solo se descubrían tras firmar y pagar gas.
    assetBalanceOf: async (owner: string) => {
      const asset = String(await vault.asset());
      const erc20 = new ethers.Contract(asset, new Interface(BAL_ABI), provider);
      return BigInt(await erc20.balanceOf(owner));
    },
    maxDeposit: async (owner: string) => BigInt(await vault.maxDeposit(owner)),
    sharesOf: async (owner: string) => BigInt(await vault.balanceOf(owner)),
    previewRedeem: async (shares: bigint) => BigInt(await vault.previewRedeem(shares)),
    // Lo que la bóveda puede pagar AHORA: su saldo líquido del activo. Es lo
    // que hace verdadera la promesa «against the vault's live liquidity».
    //
    // Y es un techo DURO, no una cota conservadora: leído de mainnet el 17-ago,
    // esta bóveda tiene `liquidityAdapter() == address(0)`, así que el camino
    // de `withdraw` NO puede desasignar de los mercados al vuelo — paga del
    // saldo propio y nada más (idle 17,5M sobre 319,8M totales ≈ 5,5%). Si
    // algún día se le pone un liquidity adapter, este check se vuelve
    // conservador, que es el lado seguro por el que equivocarse.
    idleAssets: async () => {
      const asset = String(await vault.asset());
      const erc20 = new ethers.Contract(asset, new Interface(BAL_ABI), provider);
      return BigInt(await erc20.balanceOf(SENTORA_RLUSD_VAULT));
    },
  };
}

/** La IDA del puente: se FIRMA EN FLARE, así que lee del RPC de Flare. */
export function makeBridgeReader(): FxrpBridgeReader {
  const provider = getRpcForChain(14);
  const oft = new ethers.Contract(FXRP_OFT_ADAPTER_FLARE, new Interface(OFT_READ_ABI), provider);
  return {
    underlyingToken: async () => String(await oft.token()),
    peerOf: async (eid: number) => String(await oft.peers(eid)),
    sharedDecimals: async () => Number(await oft.sharedDecimals()),
    quoteSendNative: async (user: string, amountBase: bigint) => {
      const to = '0x' + user.toLowerCase().slice(2).padStart(64, '0');
      const fee = await oft.quoteSend(
        [ETHEREUM_EID, to, amountBase, amountBase, '0x', '0x', '0x'],
        false,
      );
      return BigInt(fee.nativeFee);
    },
    fxrpBalanceOf: async (user: string) => {
      const token = String(await oft.token());
      const erc20 = new ethers.Contract(token, new Interface(BAL_ABI), provider);
      return BigInt(await erc20.balanceOf(user));
    },
    flrBalanceOf: async (user: string) => BigInt(await provider.getBalance(user)),
  };
}

/**
 * H3 — la VUELTA: el lado de Ethereum es un OFT NATIVO (el token ES el OFT),
 * así que no hay pata de approve y la comisión de entrega se paga en ETH.
 */
export function makeBridgeBackReader(): FxrpBridgeBackReader {
  const provider = getRpcForChain(1);
  const oft = new ethers.Contract(FXRP_ETH_OFT, new Interface(OFT_READ_ABI), provider);
  return {
    peerOf: async (eid: number) => String(await oft.peers(eid)),
    sharedDecimals: async () => Number(await oft.sharedDecimals()),
    quoteSendNative: async (user: string, amountBase: bigint) => {
      const to = '0x' + user.toLowerCase().slice(2).padStart(64, '0');
      const fee = await oft.quoteSend([FLARE_EID, to, amountBase, amountBase, '0x', '0x', '0x'], false);
      return BigInt(fee.nativeFee);
    },
    fxrpBalanceOf: async (user: string) => {
      const erc20 = new ethers.Contract(FXRP_ETH_OFT, new Interface(BAL_ABI), provider);
      return BigInt(await erc20.balanceOf(user));
    },
    ethBalanceOf: async (user: string) => BigInt(await provider.getBalance(user)),
  };
}

/**
 * El cotizador del swap-fill en Ethereum (2026-08-29).
 *
 * Vive aquí por la misma razón que los demás lectores: el ensayo en seco y la
 * ruta tienen que ejercitar EXACTAMENTE el mismo, o el ensayo verificaría un
 * carril que no es el que se firma. Reusa `quoteFillExactOutput` de Flare con
 * el venue de Ethereum — el mismo código, otro sitio donde comprar.
 */
export function makeEthFillQuoter(): FillQuoteFn {
  const provider = getRpcForChain(1);
  const venue = ethereumSwapVenue();
  return (p) => quoteFillExactOutput(provider, { ...p, venue });
}
