import { buildAmmDeposit, buildAmmWithdraw } from '../XrplAmmService';
import { _resetXrplSourceTagCache } from '../../../../config/xrplSourceTag';
import { AMMDepositFlags, AMMWithdrawFlags } from 'xrpl';

const ACCOUNT = 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH';
const RLUSD_ISSUER = 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De';
const XRP = { currency: 'XRP' };
const RLUSD = { currency: 'RLUSD', issuer: RLUSD_ISSUER };
const LP_TOKEN = {
  currency: '039C99CD9AB0B70B32ECDA51EAAE471625608EA2',
  issuer: 'rE54zDvgnghAoPopCgvtiqWNq3dU5y836S',
  value: '10',
};

const ORIGINAL_TAG = process.env.XRPL_SOURCE_TAG;

afterEach(() => {
  if (ORIGINAL_TAG === undefined) delete process.env.XRPL_SOURCE_TAG;
  else process.env.XRPL_SOURCE_TAG = ORIGINAL_TAG;
  _resetXrplSourceTagCache();
});

describe('buildAmmDeposit — XLS-30 liquidity', () => {
  test('two-asset proportional deposit (tfTwoAsset)', () => {
    const { xrplTx, disclosure } = buildAmmDeposit({
      account: ACCOUNT,
      asset: XRP,
      asset2: RLUSD,
      deposit: {
        mode: 'two-asset',
        amount: '10000000',
        amount2: { currency: 'RLUSD', issuer: RLUSD_ISSUER, value: '20' },
      },
      poolTradingFee: 500,
    });
    expect(xrplTx.TransactionType).toBe('AMMDeposit');
    expect(xrplTx.Asset).toEqual(XRP);
    expect(xrplTx.Asset2).toEqual(RLUSD);
    expect(xrplTx.Amount).toBe('10000000');
    expect(xrplTx.Flags).toBe(AMMDepositFlags.tfTwoAsset);
    // trading fee disclosed as protocol data with source (invariant #9)
    expect(disclosure.facts.poolTradingFeePct).toBe(0.5);
    expect(disclosure.facts.poolTradingFeeSource).toContain('amm_info');
    expect(disclosure.note).not.toMatch(/recommend|guarantee|we pay/i);
  });

  test('single-asset deposit (tfSingleAsset)', () => {
    const { xrplTx } = buildAmmDeposit({
      account: ACCOUNT,
      asset: XRP,
      asset2: RLUSD,
      deposit: { mode: 'single-asset', amount: '5000000' },
    });
    expect(xrplTx.Flags).toBe(AMMDepositFlags.tfSingleAsset);
    expect(xrplTx.Amount2).toBeUndefined();
  });

  test('lp-token-out deposit (tfLPToken)', () => {
    const { xrplTx } = buildAmmDeposit({
      account: ACCOUNT,
      asset: XRP,
      asset2: RLUSD,
      deposit: { mode: 'lp-token-out', lpTokenOut: LP_TOKEN },
    });
    expect(xrplTx.Flags).toBe(AMMDepositFlags.tfLPToken);
    expect(xrplTx.LPTokenOut).toEqual(LP_TOKEN);
  });

  test('non-XRP pool asset requires a valid issuer', () => {
    expect(() =>
      buildAmmDeposit({
        account: ACCOUNT,
        asset: XRP,
        asset2: { currency: 'RLUSD' },
        deposit: { mode: 'single-asset', amount: '1000000' },
      }),
    ).toThrow(/issuer must be a valid XRPL address/);
  });

  test('stamps the SourceTag when configured', () => {
    process.env.XRPL_SOURCE_TAG = '424242';
    _resetXrplSourceTagCache();
    const { xrplTx } = buildAmmDeposit({
      account: ACCOUNT,
      asset: XRP,
      asset2: RLUSD,
      deposit: { mode: 'single-asset', amount: '1000000' },
    });
    expect(xrplTx.SourceTag).toBe(424242);
  });
});

describe('buildAmmWithdraw', () => {
  test('withdraw all (tfWithdrawAll) needs no amounts', () => {
    const { xrplTx, disclosure } = buildAmmWithdraw({
      account: ACCOUNT,
      asset: XRP,
      asset2: RLUSD,
      withdraw: { mode: 'all' },
    });
    expect(xrplTx.Flags).toBe(AMMWithdrawFlags.tfWithdrawAll);
    expect(xrplTx.Amount).toBeUndefined();
    expect(xrplTx.LPTokenIn).toBeUndefined();
    expect(disclosure.note).toContain('ALL your LP tokens');
  });

  test('lp-token-in withdraw (tfLPToken)', () => {
    const { xrplTx } = buildAmmWithdraw({
      account: ACCOUNT,
      asset: XRP,
      asset2: RLUSD,
      withdraw: { mode: 'lp-token-in', lpTokenIn: LP_TOKEN },
    });
    expect(xrplTx.Flags).toBe(AMMWithdrawFlags.tfLPToken);
    expect(xrplTx.LPTokenIn).toEqual(LP_TOKEN);
  });

  test('single-asset withdraw (tfSingleAsset)', () => {
    const { xrplTx } = buildAmmWithdraw({
      account: ACCOUNT,
      asset: XRP,
      asset2: RLUSD,
      withdraw: { mode: 'single-asset', amount: '3000000' },
    });
    expect(xrplTx.Flags).toBe(AMMWithdrawFlags.tfSingleAsset);
    expect(xrplTx.Amount).toBe('3000000');
  });
});
