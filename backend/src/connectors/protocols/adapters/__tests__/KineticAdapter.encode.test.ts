/**
 * KineticAdapter.encodeAction — the connector calldata source (PATH C).
 *
 * Proves the single-neck contract: the adapter contributes ONLY deterministic
 * {to, calldata, value}. The same output feeds the manual "Entrar" button AND
 * moneyflow conditional intents (ConditionalIntentService.DeterministicAction).
 *
 * No RPC: encodeAction uses only env addresses + ethers ABI encoding.
 */
import { Interface } from 'ethers';
import { KineticAdapter } from '../KineticAdapter';
import { resetAddressCache } from '../../../../config/protocolAddresses';

const COMPTROLLER = '0x8041680Fb73E1Fe5F851e76233DCDfA0f2D2D7c8';
const KUSDCE = '0xDEeBaBe05BDA7e8C1740873abF715f16164C29B8';
const WALLET = '0x1111111111111111111111111111111111111111';

const KTOKEN_IFACE = new Interface([
  'function mint(uint256 mintAmount) returns (uint256)',
  'function redeemUnderlying(uint256 redeemAmount) returns (uint256)',
  'function borrow(uint256 borrowAmount) returns (uint256)',
  'function repayBorrow(uint256 repayAmount) returns (uint256)',
]);

describe('KineticAdapter.encodeAction', () => {
  beforeEach(() => {
    process.env.KINETIC_COMPTROLLER = COMPTROLLER;
    process.env.KINETIC_KUSDCE = KUSDCE;
    resetAddressCache();
  });

  it('encodes supply→mint to the kUSDCe market with value 0', async () => {
    const r = await new KineticAdapter().encodeAction({
      actionType: 'supply', amount: '1000000', userWallet: WALLET, assetSymbol: 'USDC.E',
    });
    expect(r.to.toLowerCase()).toBe(KUSDCE.toLowerCase());
    expect(r.value).toBe('0');
    const parsed = KTOKEN_IFACE.parseTransaction({ data: r.calldata });
    expect(parsed?.name).toBe('mint');
    expect(parsed?.args[0]).toBe(1000000n);
  });

  it.each([
    ['withdraw', 'redeemUnderlying'],
    ['borrow', 'borrow'],
    ['repay', 'repayBorrow'],
  ])('encodes %s→%s', async (actionType, fn) => {
    const r = await new KineticAdapter().encodeAction({
      actionType, amount: '500', userWallet: WALLET, assetSymbol: 'USDC.E',
    });
    expect(r.to.toLowerCase()).toBe(KUSDCE.toLowerCase());
    expect(KTOKEN_IFACE.parseTransaction({ data: r.calldata })?.name).toBe(fn);
  });

  it('refuses an unconfigured market (FXRP has no kToken in env) — never guesses calldata', async () => {
    await expect(
      new KineticAdapter().encodeAction({ actionType: 'supply', amount: '1', userWallet: WALLET, assetSymbol: 'FXRP' }),
    ).rejects.toThrow(/KINETIC_MARKET_NOT_CONFIGURED/);
  });

  it('refuses an unsupported action', async () => {
    await expect(
      new KineticAdapter().encodeAction({ actionType: 'add_liquidity', amount: '1', userWallet: WALLET, assetSymbol: 'USDC.E' }),
    ).rejects.toThrow(/KINETIC_ACTION_UNSUPPORTED/);
  });

  it('refuses a non-integer amount', async () => {
    await expect(
      new KineticAdapter().encodeAction({ actionType: 'supply', amount: '1.5', userWallet: WALLET, assetSymbol: 'USDC.E' }),
    ).rejects.toThrow(/KINETIC_BAD_AMOUNT/);
  });
});
