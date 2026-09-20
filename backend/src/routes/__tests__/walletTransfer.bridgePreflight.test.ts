/**
 * it. 34 — POST /api/wallet-transfer/bridge/flare-to-xrpl/prepare attaches its
 * dry-run verdict (invariant #11).
 *
 * WHY. «Convert to XRP» from an EVM wallet (PaActionsModal, unmint branch) joins
 * two prepares into one signature: `/iso-withdraw/prepare` (Kinetic) and THIS
 * route (the FAssets redeem). The first attached `preflight` since it. 31; this
 * one attached nothing, and the screen composed the pair with no verdict to
 * show. A redeem that would revert (not enough FXRP, paused) is a proven
 * failure the person deserves to read BEFORE the wallet opens.
 *
 * THE CONSUMER UNDER TEST: the route with the GENUINE `preflightEvmCalls` (no
 * stub) over a fake node — its eth_call answers `0x` (ok), throws a
 * CALL_EXCEPTION (a revert = proven failure), or dies on transport (dry-run
 * unavailable, never a block). And `dependsOnPrior: true` — what the modal sends
 * when the redeem rides after the Kinetic withdraw in the same signature — marks
 * the step 'unverified' WITHOUT an eth_call (a burn dry-run against today's
 * balance would be a false negative).
 *
 * Hermetic: ethers.Contract and JsonRpcProvider are fakes; nothing is signed.
 */
import express from 'express';
import request from 'supertest';

/** What the fake node does on eth_call for the redeem. */
const NODE: { mode: 'ok' | 'revert' | 'down'; calls: Array<{ from?: string; to?: string; data?: string }> } = {
  mode: 'ok',
  calls: [],
};

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
  class FakeRpcProvider {
    async call(tx: { from?: string; to?: string; data?: string }): Promise<string> {
      NODE.calls.push(tx);
      if (NODE.mode === 'revert') {
        throw Object.assign(new Error('execution reverted: "ERC20: burn amount exceeds balance"'), {
          code: 'CALL_EXCEPTION',
          reason: 'ERC20: burn amount exceeds balance',
        });
      }
      if (NODE.mode === 'down') throw new Error('could not coalesce error (eth_call: 429 Too Many Requests)');
      return '0x';
    }
  }
  return { ...actual, ethers: { ...actual.ethers, Contract: FakeContract, JsonRpcProvider: FakeRpcProvider } };
});

const ASSET_MANAGER = '0x2a3Fe068cD92178554cabcf7c95ADf49B4B0B6A8';
jest.mock('../../connectors/protocols/flare/FlareDirectMintService', () => ({
  ...jest.requireActual('../../connectors/protocols/flare/FlareDirectMintService'),
  resolveAssetManagerFxrp: jest.fn(async () => ASSET_MANAGER),
  readRedemptionFeeBips: jest.fn(async () => 18),
}));

import walletTransferRouter from '../walletTransfer';

const app = express();
app.use(express.json());
app.use('/api/wallet-transfer', walletTransferRouter);

const WALLET = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const body = { evmWallet: WALLET, xrplDestination: 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe', amountXrp: '10' };
const ENV = { ...process.env };

beforeEach(() => {
  NODE.mode = 'ok';
  NODE.calls = [];
  process.env = { ...ENV };
  process.env.FLARE_DEFI_ENABLED = 'true';
});
afterAll(() => {
  process.env = ENV;
});

const prepare = (extra: Record<string, unknown> = {}) =>
  request(app).post('/api/wallet-transfer/bridge/flare-to-xrpl/prepare').send({ ...body, ...extra });

describe('bridge/flare-to-xrpl — the prepare carries a dry-run verdict', () => {
  it('a redeem the node accepts comes back with preflight {available, willSucceed}, dry-run FROM the signing wallet', async () => {
    const res = await prepare();
    expect(res.status).toBe(200);
    expect(res.body.preflight).toMatchObject({ available: true, willSucceed: true });
    expect(res.body.preflight.steps).toEqual([{ label: 'redeem FXRP to XRP', verdict: 'ok' }]);
    // The eth_call ran against the SAME bytes the wallet will sign, from that wallet.
    expect(NODE.calls).toHaveLength(1);
    expect(NODE.calls[0].from).toBe(WALLET);
    expect(NODE.calls[0].to).toBe(ASSET_MANAGER);
    expect(NODE.calls[0].data).toBe(res.body.calls[0].data);
  });

  it('a redeem that would revert is a PROVEN failure: willSucceed=false with the reason — and the prepare still answers 200', async () => {
    NODE.mode = 'revert';
    const res = await prepare();
    expect(res.status).toBe(200);
    expect(res.body.preflight.available).toBe(true);
    expect(res.body.preflight.willSucceed).toBe(false);
    expect(res.body.preflight.reason).toMatch(/burn amount exceeds balance/);
    expect(res.body.calls).toHaveLength(1); // the unsigned payload is still there — the person decides
  });

  it('a node that does not answer degrades to available=false — never a block, never a fake green', async () => {
    NODE.mode = 'down';
    const res = await prepare();
    expect(res.status).toBe(200);
    expect(res.body.preflight.available).toBe(false);
    expect(res.body.preflight.willSucceed).toBe(false);
    expect(res.body.preflight.reason).toMatch(/dry-run unavailable/);
  });

  it('dependsOnPrior=true (the redeem rides after a withdraw in the same signature): the step is UNVERIFIED and no eth_call is made', async () => {
    NODE.mode = 'revert'; // would be a false negative — must not even be asked
    const res = await prepare({ dependsOnPrior: true });
    expect(res.status).toBe(200);
    expect(NODE.calls).toHaveLength(0);
    expect(res.body.preflight.available).toBe(false);
    expect(res.body.preflight.steps).toEqual([
      { label: 'redeem FXRP to XRP', verdict: 'unverified', reason: expect.stringMatching(/depends on an earlier step/) },
    ]);
  });

  it('only a literal true marks the step dependent — a truthy string does not', async () => {
    const res = await prepare({ dependsOnPrior: 'yes' });
    expect(res.status).toBe(200);
    expect(NODE.calls).toHaveLength(1);
    expect(res.body.preflight.available).toBe(true);
  });
});
