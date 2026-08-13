/**
 * Input-validation contract of POST /api/wallet-transfer/prepare and the two
 * FAssets bridge prepare routes.
 *
 * Hermetic by construction: /prepare reads no chain state at all, and the
 * bridge routes validate input BEFORE the FLARE_DEFI_ENABLED gate, which runs
 * before any RPC — malformed input → 400 with a stable code, well-formed
 * input → 503 FLARE_DEFI_DISABLED (flag unset in tests), proving validation
 * passed without touching the network.
 */
import express from 'express';
import request from 'supertest';
import walletTransferRouter from '../walletTransfer';
import * as flareMint from '../../connectors/protocols/flare/FlareDirectMintService';

const app = express();
app.use(express.json());
app.use('/api/wallet-transfer', walletTransferRouter);

const GOOD_XRPL = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh';
const GOOD_XRPL_2 = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe';
const GOOD_EVM = '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d';
const GOOD_EVM_2 = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

beforeEach(() => {
  delete process.env.FLARE_DEFI_ENABLED; // bridge gate closed → valid input ⇒ 503
});

describe('POST /api/wallet-transfer/prepare — rail guard', () => {
  it.each([undefined, 'solana', 'flare', 42])('rejects rail %s', async (bad) => {
    const res = await request(app)
      .post('/api/wallet-transfer/prepare')
      .send({ rail: bad, from: GOOD_EVM, to: GOOD_EVM_2, amount: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_RAIL');
  });
});

describe('POST /api/wallet-transfer/prepare — evm (FLR on Flare)', () => {
  const valid = { rail: 'evm', from: GOOD_EVM, to: GOOD_EVM_2, amount: '1.5' };

  it('returns the unsigned single-call payload + disclosure', async () => {
    const res = await request(app).post('/api/wallet-transfer/prepare').send(valid);
    expect(res.status).toBe(200);
    expect(res.body.rail).toBe('evm');
    expect(res.body.calls).toEqual([
      { to: GOOD_EVM_2, data: '0x', value: '1500000000000000000', chainId: 14 },
    ]);
    expect(res.body.disclosure.disclosedToUser).toBe(true);
    expect(res.body.disclosure.astryumSigns).toBe(false);
    expect(res.body.disclosure.asset).toBe('FLR');
  });

  it('rejects a bad-checksum destination with 400, not 500', async () => {
    const badChecksum = '0x1d80C49BbBCd1C0911346656B529DF9E5c2F783d';
    const res = await request(app).post('/api/wallet-transfer/prepare').send({ ...valid, to: badChecksum });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_TO_ADDRESS');
  });

  it('rejects a missing/invalid source address', async () => {
    const res = await request(app).post('/api/wallet-transfer/prepare').send({ ...valid, from: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_FROM_ADDRESS');
  });

  it('rejects sending to the same address', async () => {
    const res = await request(app).post('/api/wallet-transfer/prepare').send({ ...valid, to: GOOD_EVM });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('SAME_ADDRESS');
  });

  it('rejects an XRPL destination as cross-ecosystem, not as a typo', async () => {
    const res = await request(app).post('/api/wallet-transfer/prepare').send({ ...valid, to: GOOD_XRPL });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CROSS_ECOSYSTEM_NOT_SUPPORTED');
  });

  it.each(['Infinity', '1e400', 'NaN', -1, 0, 'abc', '1,5'])(
    'rejects non-finite / non-positive amount (%s)',
    async (bad) => {
      const res = await request(app).post('/api/wallet-transfer/prepare').send({ ...valid, amount: bad });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_AMOUNT');
    },
  );
});

describe('POST /api/wallet-transfer/prepare — evm asset FXRP (ERC-20 on Flare)', () => {
  const valid = { rail: 'evm', asset: 'FXRP', from: GOOD_EVM, to: GOOD_EVM_2, amount: '1.5' };
  const FXRP_TOKEN = '0x8b4abA9C4BAB1C1a8144E579adB6DA6b6a577A5E';

  it('returns an unsigned ERC-20 transfer on the live-resolved FXRP token', async () => {
    const spy = jest
      .spyOn(flareMint, 'resolveFxrpToken')
      .mockResolvedValueOnce(FXRP_TOKEN);
    try {
      const res = await request(app).post('/api/wallet-transfer/prepare').send(valid);
      expect(res.status).toBe(200);
      expect(res.body.rail).toBe('evm');
      expect(res.body.calls).toHaveLength(1);
      expect(res.body.calls[0].to).toBe(FXRP_TOKEN);
      expect(res.body.calls[0].value).toBe('0');
      expect(res.body.calls[0].chainId).toBe(14);
      // transfer(address,uint256) selector + recipient + 1.5 FXRP in UBA (drops)
      expect(res.body.calls[0].data.startsWith('0xa9059cbb')).toBe(true);
      expect(BigInt('0x' + res.body.calls[0].data.slice(-64))).toBe(1_500_000n);
      expect(res.body.disclosure.action).toBe('token-transfer');
      expect(res.body.disclosure.asset).toBe('FXRP');
      expect(res.body.disclosure.amount).toBe(1.5);
      expect(res.body.disclosure.disclosedToUser).toBe(true);
      expect(res.body.disclosure.astryumSigns).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('rejects an unknown evm asset', async () => {
    const res = await request(app).post('/api/wallet-transfer/prepare').send({ ...valid, asset: 'USDT' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_ASSET');
  });

  it('routes an XRPL destination to the redeem bridge, not this transfer (no RPC)', async () => {
    const res = await request(app).post('/api/wallet-transfer/prepare').send({ ...valid, to: GOOD_XRPL });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CROSS_ECOSYSTEM_NOT_SUPPORTED');
    expect(res.body.detail).toContain('bridge/flare-to-xrpl');
  });

  it('rejects sub-drop precision (7+ decimals) as INVALID_AMOUNT before any RPC', async () => {
    const res = await request(app).post('/api/wallet-transfer/prepare').send({ ...valid, amount: '0.0000001' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_AMOUNT');
  });

  it('rejects sending to the same address', async () => {
    const res = await request(app).post('/api/wallet-transfer/prepare').send({ ...valid, to: GOOD_EVM });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('SAME_ADDRESS');
  });
});

describe('POST /api/wallet-transfer/prepare — xrpl (XRP)', () => {
  const valid = { rail: 'xrpl', from: GOOD_XRPL, to: GOOD_XRPL_2, amount: 2 };

  it('rejects a non-XRP asset on the xrpl rail', async () => {
    const res = await request(app).post('/api/wallet-transfer/prepare').send({ ...valid, asset: 'FXRP' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_ASSET');
  });

  it('returns the unsigned Payment (no Account — Xaman injects the signer)', async () => {
    const res = await request(app).post('/api/wallet-transfer/prepare').send(valid);
    expect(res.status).toBe(200);
    expect(res.body.rail).toBe('xrpl');
    expect(res.body.xrplPayment).toEqual({
      TransactionType: 'Payment',
      Destination: GOOD_XRPL_2,
      Amount: '2000000',
    });
    expect(res.body.xrplPayment.Account).toBeUndefined();
    expect(res.body.disclosure.disclosedToUser).toBe(true);
    expect(res.body.disclosure.astryumSigns).toBe(false);
    expect(res.body.disclosure.asset).toBe('XRP');
  });

  it.each(['0x1234', 'not-an-address', 'rIL0O', 'r'])(
    'rejects a malformed XRPL destination (%s)',
    async (bad) => {
      const res = await request(app).post('/api/wallet-transfer/prepare').send({ ...valid, to: bad });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_TO_ADDRESS');
    },
  );

  it('rejects an EVM destination as cross-ecosystem', async () => {
    const res = await request(app).post('/api/wallet-transfer/prepare').send({ ...valid, to: GOOD_EVM });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CROSS_ECOSYSTEM_NOT_SUPPORTED');
  });

  it('stamps the Make Waves SourceTag on the plain Payment when configured', async () => {
    const { _resetXrplSourceTagCache } = require('../../config/xrplSourceTag');
    process.env.XRPL_SOURCE_TAG = '77777';
    _resetXrplSourceTagCache();
    try {
      const res = await request(app).post('/api/wallet-transfer/prepare').send(valid);
      expect(res.status).toBe(200);
      expect(res.body.xrplPayment.SourceTag).toBe(77777);
    } finally {
      delete process.env.XRPL_SOURCE_TAG;
      _resetXrplSourceTagCache();
    }
  });

  it('rejects sub-drop precision (7+ decimals) as INVALID_AMOUNT', async () => {
    const res = await request(app).post('/api/wallet-transfer/prepare').send({ ...valid, amount: '0.0000001' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_AMOUNT');
  });

  it('rejects sending to the same address', async () => {
    const res = await request(app).post('/api/wallet-transfer/prepare').send({ ...valid, to: GOOD_XRPL });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('SAME_ADDRESS');
  });
});

describe('POST /api/wallet-transfer/bridge/xrpl-to-flare/prepare — validation', () => {
  const valid = { xrplAddress: GOOD_XRPL, evmDestination: GOOD_EVM, amountXrp: 25 };

  it.each(['0x1234', 'not-an-address', undefined])('rejects a bad XRPL source (%s)', async (bad) => {
    const res = await request(app)
      .post('/api/wallet-transfer/bridge/xrpl-to-flare/prepare')
      .send({ ...valid, xrplAddress: bad });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_FROM_ADDRESS');
  });

  it('rejects a bad-checksum EVM destination with 400, not 500', async () => {
    const badChecksum = '0x1d80C49BbBCd1C0911346656B529DF9E5c2F783d';
    const res = await request(app)
      .post('/api/wallet-transfer/bridge/xrpl-to-flare/prepare')
      .send({ ...valid, evmDestination: badChecksum });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_TO_ADDRESS');
  });

  it.each(['Infinity', -1, 0, 'abc'])('rejects bad amountXrp (%s)', async (bad) => {
    const res = await request(app)
      .post('/api/wallet-transfer/bridge/xrpl-to-flare/prepare')
      .send({ ...valid, amountXrp: bad });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_AMOUNT');
  });

  it('valid input passes validation and stops at the feature-flag gate (no RPC)', async () => {
    const res = await request(app).post('/api/wallet-transfer/bridge/xrpl-to-flare/prepare').send(valid);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('FLARE_DEFI_DISABLED');
  });
});

describe('POST /api/wallet-transfer/bridge/flare-to-xrpl/prepare — validation', () => {
  const valid = { evmWallet: GOOD_EVM_2, xrplDestination: GOOD_XRPL_2, amountXrp: '10' };

  it('rejects a bad EVM source', async () => {
    const res = await request(app)
      .post('/api/wallet-transfer/bridge/flare-to-xrpl/prepare')
      .send({ ...valid, evmWallet: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_FROM_ADDRESS');
  });

  it.each(['0x1234', 'rIL0O', GOOD_EVM])('rejects a non-XRPL destination (%s)', async (bad) => {
    const res = await request(app)
      .post('/api/wallet-transfer/bridge/flare-to-xrpl/prepare')
      .send({ ...valid, xrplDestination: bad });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_TO_ADDRESS');
  });

  it.each(['NaN', -5, 0])('rejects bad amountXrp (%s)', async (bad) => {
    const res = await request(app)
      .post('/api/wallet-transfer/bridge/flare-to-xrpl/prepare')
      .send({ ...valid, amountXrp: bad });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_AMOUNT');
  });

  it('valid input passes validation and stops at the feature-flag gate (no RPC)', async () => {
    const res = await request(app).post('/api/wallet-transfer/bridge/flare-to-xrpl/prepare').send(valid);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('FLARE_DEFI_DISABLED');
  });
});
