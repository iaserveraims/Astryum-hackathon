/**
 * A.2 — the SourceTag pipeline, end to end over every XRPL builder.
 *
 * One env tag set once; EVERY builder that composes XRPL txjson must stamp it.
 * A builder missing from this list is a builder that can ship untagged txs —
 * add new builders here as they land. (The FXRP mint Payment is covered by
 * FlareDirectMintService.test.ts; the frontend rail preserves the field because
 * XamanWalletService.signTransaction spreads the txjson unchanged.)
 */
import { _resetXrplSourceTagCache } from '../../../../config/xrplSourceTag';
import { buildEscrowCreate, buildEscrowFinish } from '../XrplEscrowService';
import { buildOfferCreate, buildOfferCancel } from '../XrplDexService';
import { buildAmmDeposit, buildAmmWithdraw } from '../XrplAmmService';

const ACCOUNT = 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH';
const RLUSD_ISSUER = 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De';
const TEST_TAG = 987654321;

const ORIGINAL_TAG = process.env.XRPL_SOURCE_TAG;

beforeEach(() => {
  process.env.XRPL_SOURCE_TAG = String(TEST_TAG);
  _resetXrplSourceTagCache();
});

afterAll(() => {
  if (ORIGINAL_TAG === undefined) delete process.env.XRPL_SOURCE_TAG;
  else process.env.XRPL_SOURCE_TAG = ORIGINAL_TAG;
  _resetXrplSourceTagCache();
});

const futureISO = new Date(Date.now() + 30 * 86_400_000).toISOString();

const BUILDS: Array<[string, () => { xrplTx: { SourceTag?: number } }]> = [
  [
    'EscrowCreate',
    () => buildEscrowCreate({ account: ACCOUNT, amountDrops: '1000000', finishAfterISO: futureISO }),
  ],
  ['EscrowFinish', () => buildEscrowFinish({ account: ACCOUNT, owner: ACCOUNT, offerSequence: 1 })],
  [
    'OfferCreate',
    () =>
      buildOfferCreate({
        account: ACCOUNT,
        takerGets: '1000000',
        takerPays: { currency: 'RLUSD', issuer: RLUSD_ISSUER, value: '2' },
      }),
  ],
  ['OfferCancel', () => buildOfferCancel({ account: ACCOUNT, offerSequence: 2 })],
  [
    'AMMDeposit',
    () =>
      buildAmmDeposit({
        account: ACCOUNT,
        asset: { currency: 'XRP' },
        asset2: { currency: 'RLUSD', issuer: RLUSD_ISSUER },
        deposit: { mode: 'single-asset', amount: '1000000' },
      }),
  ],
  [
    'AMMWithdraw',
    () =>
      buildAmmWithdraw({
        account: ACCOUNT,
        asset: { currency: 'XRP' },
        asset2: { currency: 'RLUSD', issuer: RLUSD_ISSUER },
        withdraw: { mode: 'all' },
      }),
  ],
];

describe('A.2 — no Astryum-composed XRPL tx leaves without the SourceTag', () => {
  test.each(BUILDS)('%s stamps the project tag', (_name, build) => {
    expect(build().xrplTx.SourceTag).toBe(TEST_TAG);
  });
});

describe('A.3 — the REAL Make Waves tag (assigned by the panel)', () => {
  const MAKE_WAVES_TAG = 2607090002; // official value, public on-ledger

  test.each(BUILDS)('%s stamps SourceTag: 2607090002 when the env carries the real value', (_name, build) => {
    process.env.XRPL_SOURCE_TAG = String(MAKE_WAVES_TAG);
    _resetXrplSourceTagCache();
    expect(build().xrplTx.SourceTag).toBe(MAKE_WAVES_TAG);
  });

  test('the real value is a valid UInt32 (sanity of the panel-assigned number)', () => {
    expect(Number.isInteger(MAKE_WAVES_TAG)).toBe(true);
    expect(MAKE_WAVES_TAG).toBeGreaterThan(0);
    expect(MAKE_WAVES_TAG).toBeLessThanOrEqual(0xffffffff);
  });
});
