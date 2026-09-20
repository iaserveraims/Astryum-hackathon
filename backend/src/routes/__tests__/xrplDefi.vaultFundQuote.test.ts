/**
 * G13 — «un quórum de 0 firma»: a FAILED read must never be served as a figure.
 *
 * `/vault-fund/quote` used to size the multisig signing fee with
 * `getSignerCouncil(account).catch(() => null)` → `?? 0`, which gave the same
 * answer to two different questions: "this account has no signer list" (0 is
 * the truth) and "XRPL did not answer" (0 is invented). The invention then
 * travelled: fee = base x 1, MAX = spendable minus ONE signature, and the
 * funding surface printed the literal words "a quorum of 0 signs" — after
 * which the quorum's own payment failed underfunded with a cryptic tec.
 */
import express from 'express';
import request from 'supertest';
import xrplDefiRouter from '../xrplDefi';
import { xrplProvider } from '../../integrations/providers/chain/XRPLProvider';

const COUNCIL = 'rsmvJMhhh8Bhr2cTLDbXKrGoCCLptKDmrf';
const VAULT = '0xc8379c79779cCE3B738424892709fe0D4339E3b1';

// The route only constructs a provider to hand to the (stubbed) Flare reads.
jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  class FakeJsonRpcProvider {}
  return { ...actual, ethers: { ...actual.ethers, JsonRpcProvider: FakeJsonRpcProvider } };
});

jest.mock('../../services/flare/LegacyCageResolver', () => ({
  requireCageForCouncil: jest.fn(async () => ({
    rpcUrl: 'http://rpc.invalid',
    vault: '0xc8379c79779cCE3B738424892709fe0D4339E3b1',
    bridge: '0x02aE9fcB76768e42b8D3Ed9FE842238A6616b26F',
    chainId: 14,
  })),
  noCageResponse: () => null,
}));

// Live AssetManagerFXRP settings (mainnet shape) — read is stubbed, maths real.
jest.mock('../../connectors/protocols/flare/FlareDirectMintService', () => {
  const actual = jest.requireActual('../../connectors/protocols/flare/FlareDirectMintService');
  return {
    ...actual,
    readDirectMintParams: jest.fn(async () => ({
      fxrpToken: '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE',
      paymentAddress: 'rCoreVaultXXXXXXXXXXXXXXXXXXXXXXXX',
      minFeeUBA: BigInt(100_000),
      feeBIPS: BigInt(0),
      executorFeeUBA: BigInt(100_000),
      granularityUBA: BigInt(1),
    })),
  };
});

jest.mock('../../services/flare/LegacyVaultStateService', () => {
  const actual = jest.requireActual('../../services/flare/LegacyVaultStateService');
  return {
    ...actual,
    readVaultState: jest.fn(async () => ({
      vault: '0xc8379c79779cCE3B738424892709fe0D4339E3b1',
      chain: 'flare',
      asset: { address: '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE', symbol: 'FXRP', decimals: 6 },
      totalPrincipal: '0',
      allocatedPrincipal: '0',
      idlePrincipal: '0',
      totalValue: '0',
      maxVenueBps: 10_000,
      migrated: false,
      venues: [],
      totalClaimable: '0',
      strayAssets: '0',
    })),
  };
});

const app = express();
app.use(express.json());
app.use('/api/xrpl-defi', xrplDefiRouter);

const SPENDABLE = {
  balanceXrp: 100,
  spendableXrp: 99,
  reserveXrp: 1,
  ownerCount: 0,
  nextObjectReserveXrp: 0.2,
};

function council(signers: number) {
  return {
    quorum: signers,
    masterKeyDisabled: true,
    signers: Array.from({ length: signers }, (_, i) => ({ account: `rSigner${i}`, weight: 1 })),
  };
}

beforeEach(() => {
  jest.spyOn(xrplProvider, 'getSpendableBalance').mockResolvedValue(SPENDABLE);
  jest.spyOn(xrplProvider, 'getBaseFeeDrops').mockResolvedValue(10);
});
afterEach(() => jest.restoreAllMocks());

const quote = () => request(app).get('/api/xrpl-defi/vault-fund/quote').query({ account: COUNCIL });

describe('G13 — a failed council read is not the number 0', () => {
  it('XRPL unreachable → signerCount/txFeeXrp/maxGrossXrp are null, never a figure', async () => {
    jest.spyOn(xrplProvider, 'getSignerCouncil').mockRejectedValue(new Error('websocket closed'));

    const res = await quote();

    expect(res.status).toBe(200);
    // The old code answered 0 / '0.00001' / '98.99999' here — a fee for ONE
    // signature and a MAX the council could not actually pay.
    expect(res.body.signerCount).toBeNull();
    expect(res.body.txFeeXrp).toBeNull();
    expect(res.body.maxGrossXrp).toBeNull();
    // The rest of the quote is still honest data and must survive.
    expect(res.body.balanceXrp).toBe('100');
    expect(res.body.spendableXrp).toBe('99');
    expect(typeof res.body.minGrossXrp).toBe('string');
  });

  it('a real council reads as its real size and the fee is base x (1 + signers)', async () => {
    jest.spyOn(xrplProvider, 'getSignerCouncil').mockResolvedValue(council(3));

    const res = await quote();

    expect(res.status).toBe(200);
    expect(res.body.signerCount).toBe(3);
    expect(res.body.txFeeXrp).toBe('0.00004'); // 10 drops x (1 + 3)
    expect(res.body.maxGrossXrp).toBe('98.99996');
  });

  it('no signer list, read SUCCESSFULLY, still means 0 — there 0 is the answer', async () => {
    jest.spyOn(xrplProvider, 'getSignerCouncil').mockResolvedValue(null);

    const res = await quote();

    expect(res.status).toBe(200);
    expect(res.body.signerCount).toBe(0);
    expect(res.body.txFeeXrp).toBe('0.00001'); // 10 drops x (1 + 0)
    expect(res.body.maxGrossXrp).toBe('98.99999');
  });

  it('the fee-bearing fields are the ONLY ones the failed read nulls out', async () => {
    jest.spyOn(xrplProvider, 'getSignerCouncil').mockRejectedValue(new Error('timeout'));

    const res = await quote();

    expect(res.body.account).toBe(COUNCIL);
    expect(res.body.asset.symbol).toBe('FXRP');
    expect(res.body.cage).toBeDefined();
  });
});
