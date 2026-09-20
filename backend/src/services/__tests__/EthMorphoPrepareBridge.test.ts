/**
 * prepareFxrpBridge — B6 (plan §13): direct-calldata FXRP bridge Flare→Ethereum.
 * Pinned: route drift refusals (token + peer), the two cost pre-flights (the
 * ~98 FLR LayerZero fee is real money), finite approve, the +5% fee ceiling
 * with auto-refund, and Flare (14) as the signing chain end to end.
 */
import {
  prepareFxrpBridge,
  FxrpBridgeReader,
} from '../EthMorphoPrepareService';
import {
  FXRP_FLARE_ERC20,
  FXRP_ETH_OFT,
  FXRP_OFT_ADAPTER_FLARE,
  ETHEREUM_EID,
  addrToBytes32,
  feeWithBuffer,
  buildBridgeLegs,
} from '../../connectors/protocols/adapters/FxrpOftBridgeAdapter';
import { Interface, MaxUint256 } from 'ethers';

const USER = '0x1111111111111111111111111111111111111111';
const E18 = 10n ** 18n;
const QUOTE = 98n * E18; // ≈ the live magnitude verified on-chain

function stubReader(overrides: Partial<{
  underlying: string; peer: string; fxrpBalance: bigint; flrBalance: bigint; quote: bigint;
}> = {}): FxrpBridgeReader {
  return {
    async underlyingToken() { return overrides.underlying ?? FXRP_FLARE_ERC20; },
    async peerOf(eid: number) {
      expect(eid).toBe(ETHEREUM_EID);
      return overrides.peer ?? addrToBytes32(FXRP_ETH_OFT);
    },
    async sharedDecimals() { return 6; },
    async quoteSendNative() { return overrides.quote ?? QUOTE; },
    async fxrpBalanceOf() { return overrides.fxrpBalance ?? 10_000_000n; }, // 10 FXRP
    async flrBalanceOf() { return overrides.flrBalance ?? 200n * E18; },    // 200 FLR
  };
}

describe('route drift refusals — what the user signs must be the verified route', () => {
  it('refuses when the adapter no longer wraps canonical FXRP', async () => {
    await expect(prepareFxrpBridge(
      stubReader({ underlying: '0x000000000000000000000000000000000000dEaD' }),
      { user: USER, amountBase: '1000000' },
    )).rejects.toMatchObject({ code: 'BRIDGE_TOKEN_DRIFT' });
  });

  it('refuses when the Ethereum peer is not the canonical OFT', async () => {
    await expect(prepareFxrpBridge(
      stubReader({ peer: addrToBytes32('0x000000000000000000000000000000000000dEaD') }),
      { user: USER, amountBase: '1000000' },
    )).rejects.toMatchObject({ code: 'BRIDGE_PEER_DRIFT' });
  });
});

describe('cost pre-flights (ORDER_WOULD_REVERT pattern)', () => {
  it('blocks bridging more FXRP than the wallet holds', async () => {
    const r = await prepareFxrpBridge(stubReader({ fxrpBalance: 500_000n }), {
      user: USER, amountBase: '1000000',
    });
    expect(r.preflight.checks.find((c) => c.name === 'balance'))
      .toMatchObject({ ok: false, code: 'BRIDGE_EXCEEDS_BALANCE' });
  });

  it('blocks when FLR cannot cover the LayerZero fee ceiling, with both numbers', async () => {
    const r = await prepareFxrpBridge(stubReader({ flrBalance: 50n * E18 }), {
      user: USER, amountBase: '1000000',
    });
    const fee = r.preflight.checks.find((c) => c.name === 'fee');
    expect(fee).toMatchObject({ ok: false, code: 'INSUFFICIENT_FLR_FOR_FEE' });
    if (fee && !fee.ok) expect(fee.data?.maxFeeWei).toBe(feeWithBuffer(QUOTE).toString());
  });
});

describe('the legs and the disclosure', () => {
  it('finite approve + send to YOUR OWN address, msg.value = quote +5% ceiling, on Flare', async () => {
    const r = await prepareFxrpBridge(stubReader(), { user: USER, amountBase: '1000000' });
    expect(r.chainId).toBe(14);
    expect(r.legs).toHaveLength(2);

    const decode = new Interface(['function approve(address spender, uint256 amount)']);
    const ap = decode.decodeFunctionData('approve', r.legs[0].data);
    expect(ap.spender).toBe(FXRP_OFT_ADAPTER_FLARE);
    expect(ap.amount).toBe(1_000_000n);
    expect(ap.amount).not.toBe(MaxUint256);

    const maxFee = feeWithBuffer(QUOTE);
    expect(BigInt(r.legs[1].value)).toBe(maxFee);
    expect(r.disclosure.lzFeeQuotedWei).toBe(QUOTE.toString());
    expect(r.disclosure.lzFeeMaxWei).toBe(maxFee.toString());
    expect(r.disclosure.refundNote).toContain('refunds');
    expect(r.disclosure.destinationNote).toContain('YOUR OWN address');
    expect(r.disclosure.paNote).toContain('Personal Account');
    expect(r.preflight.ok).toBe(true);
  });

  it('feeWithBuffer is +5% rounded up', () => {
    expect(feeWithBuffer(100n)).toBe(105n);
    expect(feeWithBuffer(1n)).toBe(2n); // ceil, never under the quote
  });

  it('buildBridgeLegs: minAmountLD is EXACT (shared == local decimals — no silent loss)', () => {
    const legs = buildBridgeLegs(USER, 1_000_000n, QUOTE);
    const iface = new Interface([
      'function send((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) p, (uint256 nativeFee, uint256 lzTokenFee) fee, address refundAddress) payable',
    ]);
    const s = iface.decodeFunctionData('send', legs[1].data);
    expect(s.p.dstEid).toBe(BigInt(ETHEREUM_EID));
    expect(s.p.amountLD).toBe(1_000_000n);
    expect(s.p.minAmountLD).toBe(1_000_000n);
    expect(s.p.to).toBe(addrToBytes32(USER));
    expect(s.refundAddress).toBe(USER);
  });
});
