/**
 * productizer-it13 §4.2 — POST /api/wallet-transfer/bridge/flare-to-xrpl/prepare
 * burns FXRP through AssetManagerFXRP.redeemAmount, so its disclosure carries the
 * FAssets redemption fee as a live figure (invariants #6/#9): bips, the estimated
 * FXRP on the amount redeemed, and a line — or null plus «could not be read — NOT
 * zero». Hermetic: the AssetManager address and the fee read are mocked, and the
 * contract is a fake that only knows the redemption minimum.
 */
import express from 'express';
import request from 'supertest';

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  class FakeContract {
    interface: InstanceType<typeof actual.Interface>;
    constructor(_address: string, abi: string[]) {
      this.interface = new actual.Interface(abi);
    }
    async minimumRedeemAmountUBA() {
      return 5_000_000n;
    }
  }
  // it. 34: the route now dry-runs the redeem (preflightEvmCalls) — a fake node
  // that answers `0x` keeps this suite off the network.
  class FakeRpcProvider {
    async call() {
      return '0x';
    }
  }
  return { ...actual, ethers: { ...actual.ethers, Contract: FakeContract, JsonRpcProvider: FakeRpcProvider } };
});

const mockFeeBips = jest.fn();
jest.mock('../../connectors/protocols/flare/FlareDirectMintService', () => ({
  ...jest.requireActual('../../connectors/protocols/flare/FlareDirectMintService'),
  resolveAssetManagerFxrp: jest.fn(async () => '0x2a3Fe068cD92178554cabcf7c95ADf49B4B0B6A8'),
  readRedemptionFeeBips: (...a: unknown[]) => mockFeeBips(...a),
}));

import walletTransferRouter from '../walletTransfer';

const app = express();
app.use(express.json());
app.use('/api/wallet-transfer', walletTransferRouter);

const body = {
  evmWallet: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  xrplDestination: 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe',
  amountXrp: '10',
};
const ENV = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ENV };
  process.env.FLARE_DEFI_ENABLED = 'true';
});
afterAll(() => {
  process.env = ENV;
});

describe('bridge/flare-to-xrpl — the redemption fee rides the disclosure', () => {
  it('discloses the live fee in BIPS, the estimated FXRP on the amount, and a line with the figure', async () => {
    mockFeeBips.mockResolvedValue(18);
    const res = await request(app).post('/api/wallet-transfer/bridge/flare-to-xrpl/prepare').send(body);
    expect(res.status).toBe(200);
    expect(res.body.rail).toBe('evm');
    expect(res.body.disclosure).toMatchObject({ redemptionFeeBips: 18, redemptionFeeFxrp: 0.018, disclosedToUser: true });
    expect(res.body.disclosure.redemptionFeeLine).toContain('0.18%');
    expect(res.body.disclosure.redemptionFeeLine).toContain('0.018 FXRP');
  });

  it('an unreadable fee is null on both fields with a line that says NOT zero', async () => {
    mockFeeBips.mockResolvedValue(null);
    const res = await request(app).post('/api/wallet-transfer/bridge/flare-to-xrpl/prepare').send(body);
    expect(res.status).toBe(200);
    expect(res.body.disclosure.redemptionFeeBips).toBeNull();
    expect(res.body.disclosure.redemptionFeeFxrp).toBeNull();
    expect(res.body.disclosure.redemptionFeeLine).toMatch(/could not be read/);
    expect(res.body.disclosure.redemptionFeeLine).toMatch(/NOT zero/);
  });
});
