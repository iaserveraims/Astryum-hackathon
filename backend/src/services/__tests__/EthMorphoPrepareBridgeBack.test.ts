/**
 * H3 — la VUELTA del puente (Ethereum → Flare).
 *
 * Sin ella el carril era un embudo: el FXRP entraba, el colateral salía del
 * mercado… y se quedaba varado en Ethereum. El recorrido del runbook
 * («repagar → sacar colateral → puentear de vuelta») moría en el paso 3.
 */
import {
  prepareFxrpBridgeBack,
  type FxrpBridgeBackReader,
} from '../EthMorphoPrepareService';
import {
  FLARE_EID,
  FXRP_ETH_OFT,
  FXRP_OFT_ADAPTER_FLARE,
  addrToBytes32,
  feeWithBuffer,
  buildBridgeBackLegs,
} from '../../connectors/protocols/adapters/FxrpOftBridgeAdapter';
import { Interface } from 'ethers';

const E6 = 10n ** 6n;
const USER = '0x1111111111111111111111111111111111111111';
const QUOTE = 3_000_000_000_000_000n; // 0,003 ETH

function stubReader(over: Partial<{
  peer: string; fxrp: bigint; eth: bigint; quote: bigint;
}> = {}): FxrpBridgeBackReader {
  return {
    async peerOf(eid: number) {
      expect(eid).toBe(FLARE_EID); // la vuelta pregunta por FLARE, no por ETH
      return over.peer ?? addrToBytes32(FXRP_OFT_ADAPTER_FLARE);
    },
    async sharedDecimals() { return 6; },
    async quoteSendNative() { return over.quote ?? QUOTE; },
    async fxrpBalanceOf() { return over.fxrp ?? 100n * E6; },
    async ethBalanceOf() { return over.eth ?? 10n ** 18n; },
  };
}

const check = (r: { preflight: { checks: Array<{ name: string; ok: boolean; code?: string }> } }, name: string) =>
  r.preflight.checks.find((c) => c.name === name);

describe('buildBridgeBackLegs — el calldata de la vuelta', () => {
  it('UNA sola pata: send. Sin approve (OFT nativo)', () => {
    const legs = buildBridgeBackLegs(USER, 5n * E6, QUOTE);
    expect(legs).toHaveLength(1);
    expect(legs[0].to).toBe(FXRP_ETH_OFT);
    expect(legs[0].description).toContain('Flare');
  });

  it('manda al EID de FLARE, a la MISMA dirección, con minAmountLD exacto', () => {
    const iface = new Interface([
      'function send((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) sendParam, (uint256 nativeFee, uint256 lzTokenFee) fee, address refundAddress) payable',
    ]);
    const [leg] = buildBridgeBackLegs(USER, 5n * E6, QUOTE);
    const d = iface.decodeFunctionData('send', leg.data);
    expect(Number(d.sendParam.dstEid)).toBe(FLARE_EID);
    expect(String(d.sendParam.to).toLowerCase()).toBe(addrToBytes32(USER));
    // sharedDecimals == local ⇒ exacto: cualquier desvío revierte, no pierde polvo
    expect(d.sendParam.amountLD).toBe(d.sendParam.minAmountLD);
    expect(String(d.refundAddress).toLowerCase()).toBe(USER.toLowerCase());
  });

  it('el value lleva el techo (+5%), no la cotización pelada', () => {
    const [leg] = buildBridgeBackLegs(USER, 1n * E6, QUOTE);
    expect(BigInt(leg.value)).toBe(feeWithBuffer(QUOTE));
    expect(BigInt(leg.value)).toBeGreaterThan(QUOTE);
  });

  it('refusa importes y cotizaciones imposibles en vez de componer basura', () => {
    expect(() => buildBridgeBackLegs(USER, 0n, QUOTE)).toThrow(/amount/);
    expect(() => buildBridgeBackLegs(USER, 1n, 0n)).toThrow(/fee quote/);
    expect(() => buildBridgeBackLegs('nope', 1n, QUOTE)).toThrow(/address/);
  });
});

describe('prepareFxrpBridgeBack — la ruta verificada antes de firmar', () => {
  it('compone en chain 1 con la comisión viva y su techo dichos', async () => {
    const r = await prepareFxrpBridgeBack(stubReader(), { user: USER, amountBase: (5n * E6).toString() });
    expect(r.chainId).toBe(1); // se firma en Ethereum
    expect(r.preflight.ok).toBe(true);
    expect(r.disclosure.lzFeeQuotedWei).toBe(QUOTE.toString());
    expect(r.disclosure.lzFeeMaxWei).toBe(feeWithBuffer(QUOTE).toString());
    expect(r.disclosure.destinationNote).toContain('Flare');
    // La diferencia que el usuario tiene que ver: aquí la comisión es ETH.
    expect(r.disclosure.paNote).toContain('ETH');
  });

  it('REFUTA si el par de Flare no es el adapter canónico — los tokens se perderían', async () => {
    await expect(
      prepareFxrpBridgeBack(
        stubReader({ peer: addrToBytes32('0x000000000000000000000000000000000000dEaD') }),
        { user: USER, amountBase: (1n * E6).toString() },
      ),
    ).rejects.toMatchObject({ code: 'BRIDGE_PEER_DRIFT' });
  });

  it('bloquea sin FXRP en Ethereum', async () => {
    const r = await prepareFxrpBridgeBack(stubReader({ fxrp: 0n }), {
      user: USER, amountBase: (5n * E6).toString(),
    });
    expect(check(r, 'balance')?.ok).toBe(false);
    expect(check(r, 'balance')?.code).toBe('BRIDGE_EXCEEDS_BALANCE');
    expect(r.preflight.ok).toBe(false);
  });

  it('bloquea sin ETH para la comisión — y lo dice en ETH, no en FLR', async () => {
    const r = await prepareFxrpBridgeBack(stubReader({ eth: 1n }), {
      user: USER, amountBase: (5n * E6).toString(),
    });
    const fee = check(r, 'fee');
    expect(fee?.ok).toBe(false);
    expect(fee?.code).toBe('INSUFFICIENT_ETH_FOR_FEE');
  });

  it('no simula cuando un pre-flight ya bloquea — y lo dice', async () => {
    const r = await prepareFxrpBridgeBack(stubReader({ fxrp: 0n }), {
      user: USER, amountBase: (5n * E6).toString(),
    });
    expect(r.simulation.attempted).toBe(false);
    expect(r.simulation.note).toMatch(/pre-flight/i);
  });
});
