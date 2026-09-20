/**
 * productizer-it9 §3.4 · it13 §4.3 — the FAssets redemption fee is a LIVE protocol
 * figure, and the hand-walked `getSettings()` decoder answers it only when the
 * struct is EXACTLY the one it expects.
 *
 * `getSettings()` returns `AssetManagerSettings.Data`, a DYNAMIC tuple (string #5,
 * two uint256[] #49/#50). What these tests pin: the right number from the real
 * mainnet return (read 2026-09-14) and from faithful re-encodings of it; null —
 * never a wrong number, never 0 — from any struct that moved (a field inserted, a
 * field removed, or both cancelling out around #25), from anything that does not
 * look like that struct; and null when the chain cannot be read.
 */
import { AbiCoder, Interface } from 'ethers';
import type { Provider } from 'ethers';
import {
  _resetAssetManagerCache,
  _resetRedemptionFeeCache,
  decodeRedemptionFeeBipsFromSettings,
  estimateRedemptionFee,
  readRedemptionFeeBips,
  redemptionFeeDisclosureLine,
  SETTINGS_FIELD_TYPES,
} from '../FlareDirectMintService';

/** AssetManagerSettings.Data, declaration order (flare-foundation/fassets main, 2026-09-14). */
const SETTINGS_TYPES = [
  'address', 'address', 'address', 'address', 'address', 'string', 'address', 'address', 'address', 'address',
  'address', 'uint8', 'uint8', 'bytes32', 'uint32', 'uint32', 'uint16', 'uint64', 'uint64', 'uint64',
  'uint16', 'bool', 'uint64', 'uint64', 'uint64', 'uint16', 'uint32', 'uint32', 'uint64', 'uint128',
  'uint16', 'uint16', 'uint128', 'uint64', 'uint64', 'uint64', 'uint64', 'uint64', 'uint64', 'uint64',
  'uint64', 'uint32', 'uint64', 'uint64', 'uint64', 'uint64', 'uint64', 'uint32', 'uint64', 'uint256[]',
  'uint256[]', 'uint64', 'uint64', 'uint64', 'uint64', 'uint16', 'uint64', 'uint64', 'uint32', 'uint32',
];

const XRP_BYTES32 = '39948964274347012936981351272266369804895606997075518274053929213164037079040';
/**
 * `AssetManagerFXRP.getSettings()` on Flare mainnet, 2026-09-14, word by word
 * (0x2a3Fe068cD92178554cabcf7c95ADf49B4B0B6A8). Word 0 is the tuple offset; words
 * 1-60 are the head; then the "XRP" suffix string and the two liquidation arrays.
 */
const LIVE_WORDS: string[] = [
  '32',
  '54136795343429656043930477442259966902863560883', '989554659625343704922888602616464403255760373182',
  '212400523123916756079858127429417263463363468486', '1296839192557280877375807365453508311976622290403',
  '182974909656506170180626164828533797921252645285', '1920', '0',
  '1200877289561714583009975734563152000095034118050', '525695345918473622999969575539833729792152309452',
  '57005', '359335910796818711847950221672483280968098554897', '6', '6', XRP_BYTES32,
  '4000', '5000', '1', '1000000', '1', '10000000', '0', '0', '170000000000000', '225', '900', '18', '10500',
  '0', '21600', '500000', '20', '0', '25000000', '3600', '600', '0', '864000', '86400', '0', '0', '0', '10000',
  '10800', '3600', '300', '86400', '7200', '60', '300', '1984', '2112', '3600', '259200', '604800',
  '0', '0', '0', '0', '0', '0',
  '3', XRP_BYTES32,
  '3', '10400', '10800', '11200',
  '3', '10000', '10000', '10000',
];
const LIVE_RAW = '0x' + LIVE_WORDS.map((w) => BigInt(w).toString(16).padStart(64, '0')).join('');

const coder = AbiCoder.defaultAbiCoder();
const tupleOf = (types: readonly string[]) => `tuple(${types.join(',')})`;
const encode = (types: readonly string[], values: unknown[]) => coder.encode([tupleOf(types)], [values]);
/** The live values, decoded with the official declaration — a fresh mutable copy each call. */
const liveValues = (): unknown[] => [...coder.decode([tupleOf(SETTINGS_TYPES)], LIVE_RAW)[0]];
const withFee = (bips: number) => {
  const values = liveValues();
  values[25] = bips;
  return encode(SETTINGS_TYPES, values);
};
/** The live return with one head word replaced verbatim (to write what no encoder would). */
const withHeadWord = (field: number, value: bigint) => {
  const words = [...LIVE_WORDS];
  words[1 + field] = value.toString();
  return '0x' + words.map((w) => BigInt(w).toString(16).padStart(64, '0')).join('');
};

describe('decodeRedemptionFeeBipsFromSettings — the live struct', () => {
  it('the declaration order pinned in the service is the official one', () => {
    expect(SETTINGS_TYPES).toHaveLength(60);
    expect([...SETTINGS_FIELD_TYPES]).toEqual(SETTINGS_TYPES);
  });

  it('the LIVE mainnet return (71 words, #5=1920, #49=1984, #50=2112) reads 18 BIPS', () => {
    expect(LIVE_WORDS).toHaveLength(71);
    expect(decodeRedemptionFeeBipsFromSettings(LIVE_RAW)).toBe(18);
    // Cross-check against the real ABI coder on the official declaration, and
    // prove the fixture is a byte-exact encoding of those values.
    expect(Number(liveValues()[25])).toBe(18);
    expect(encode(SETTINGS_TYPES, liveValues())).toBe(LIVE_RAW);
  });

  it('reads whatever fee governance sets on that shape (a real 0 stays 0)', () => {
    expect(decodeRedemptionFeeBipsFromSettings(withFee(20))).toBe(20);
    expect(decodeRedemptionFeeBipsFromSettings(withFee(0))).toBe(0);
  });
});

describe('decodeRedemptionFeeBipsFromSettings — a struct that moved answers null, never a neighbour', () => {
  it('a field inserted before #25 and one removed after it (net zero) → null, not underlyingSecondsForPayment', () => {
    const types = [...SETTINGS_TYPES];
    const values = liveValues();
    types.splice(23, 0, 'uint64');
    values.splice(23, 0, 7n);
    types.splice(28, 1); // the old #27 (__redemptionDefaultFactorPoolBIPS), shifted to 28
    values.splice(28, 1);
    expect(types).toHaveLength(60);
    const raw = encode(types, values);
    expect(raw.length).toBe(LIVE_RAW.length); // same size: only the value anchors can tell
    expect(Number(values[25])).toBe(900); // what a plain head-word reader would call a 9% fee
    expect(decodeRedemptionFeeBipsFromSettings(raw)).toBeNull();
  });

  it('a field removed before #25 and one inserted after it (net zero) → null', () => {
    const types = [...SETTINGS_TYPES];
    const values = liveValues();
    types.splice(24, 1);
    values.splice(24, 1);
    types.splice(26, 0, 'uint64');
    values.splice(26, 0, 7n);
    expect(types).toHaveLength(60);
    expect(Number(values[25])).toBe(10500);
    expect(decodeRedemptionFeeBipsFromSettings(encode(types, values))).toBeNull();
  });

  it('a field inserted (61-word head) or removed (59-word head) → null', () => {
    const inserted = [...SETTINGS_TYPES];
    const insertedValues = liveValues();
    inserted.splice(30, 0, 'uint64');
    insertedValues.splice(30, 0, 7n);
    expect(decodeRedemptionFeeBipsFromSettings(encode(inserted, insertedValues))).toBeNull();

    const removed = [...SETTINGS_TYPES];
    const removedValues = liveValues();
    removed.splice(30, 1);
    removedValues.splice(30, 1);
    expect(decodeRedemptionFeeBipsFromSettings(encode(removed, removedValues))).toBeNull();
  });

  it('a struct whose dynamic members moved answers null', () => {
    const staticAt5 = [...SETTINGS_TYPES];
    const v5 = liveValues();
    staticAt5[5] = 'uint256';
    v5[5] = 1n;
    expect(decodeRedemptionFeeBipsFromSettings(encode(staticAt5, v5))).toBeNull();
    const staticAt49 = [...SETTINGS_TYPES];
    const v49 = liveValues();
    staticAt49[49] = 'uint256';
    v49[49] = 3n;
    expect(decodeRedemptionFeeBipsFromSettings(encode(staticAt49, v49))).toBeNull();
  });

  it('trailing data, a shifted tuple offset or liquidation arrays of different lengths → null', () => {
    expect(decodeRedemptionFeeBipsFromSettings(LIVE_RAW + '00'.repeat(32))).toBeNull();
    expect(decodeRedemptionFeeBipsFromSettings('0x' + (64).toString(16).padStart(64, '0') + '00'.repeat(32) + LIVE_RAW.slice(66))).toBeNull();
    const values = liveValues();
    values[50] = [10000n, 10000n];
    expect(decodeRedemptionFeeBipsFromSettings(encode(SETTINGS_TYPES, values))).toBeNull();
  });

  it('a static word wider than its declared type → null', () => {
    expect(decodeRedemptionFeeBipsFromSettings(withHeadWord(30, 1n << 16n))).toBeNull(); // uint16 maxRedeemedTickets
    expect(decodeRedemptionFeeBipsFromSettings(withHeadWord(21, 2n))).toBeNull(); // bool
  });

  it.each([
    ['assetMintingDecimals ≠ 6', 12, 18n],
    ['assetDecimals ≠ 6', 11, 18n],
    ['collateralReservationFeeBIPS at 100%', 16, 10_000n],
    ['redemptionDefaultFactorVaultCollateralBIPS not above 100%', 26, 10_000n],
    ['vaultCollateralBuyForFlareFactorBIPS below 100%', 41, 9_999n],
    ['redemptionFeeBIPS at 100%', 25, 10_000n],
  ])('a protocol-enforced value that does not hold (%s) → null', (_label, field, value) => {
    expect(decodeRedemptionFeeBipsFromSettings(withHeadWord(field as number, value as bigint))).toBeNull();
  });

  it('a liquidation collateral factor not above 100% → null', () => {
    const values = liveValues();
    values[49] = [10000n, 10800n, 11200n];
    expect(decodeRedemptionFeeBipsFromSettings(encode(SETTINGS_TYPES, values))).toBeNull();
  });

  it.each(['0x', '', '0x1234', 'not-hex', '0x' + '00'.repeat(64)])('garbage (%s) → null', (raw) => {
    expect(decodeRedemptionFeeBipsFromSettings(raw)).toBeNull();
  });
});

describe('readRedemptionFeeBips — live read, cached, null on failure', () => {
  const ASSET_MANAGER = '0x2a3Fe068cD92178554cabcf7c95ADf49B4B0B6A8';
  const REGISTRY = new Interface(['function getContractAddressByName(string _name) view returns (address)']);
  const GET_SETTINGS = new Interface(['function getSettings()']).getFunction('getSettings')!.selector;

  function fakeProvider(settingsRaw: () => Promise<string>) {
    const call = jest.fn(async (tx: { to?: string; data?: string }) => {
      if (tx.data?.startsWith(GET_SETTINGS)) {
        expect(String(tx.to).toLowerCase()).toBe(ASSET_MANAGER.toLowerCase());
        return settingsRaw();
      }
      return REGISTRY.encodeFunctionResult('getContractAddressByName', [ASSET_MANAGER]);
    });
    return { provider: { call } as unknown as Provider, call };
  }

  beforeEach(() => {
    _resetAssetManagerCache();
    _resetRedemptionFeeCache();
  });

  it('reads the fee from AssetManagerFXRP and caches it', async () => {
    const settings = jest.fn(async () => LIVE_RAW);
    const { provider } = fakeProvider(settings);
    expect(await readRedemptionFeeBips(provider)).toBe(18);
    expect(await readRedemptionFeeBips(provider)).toBe(18);
    expect(settings).toHaveBeenCalledTimes(1);
  });

  it('an unreadable chain answers null — and the failure is not cached', async () => {
    const settings = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(new Error('rpc down'))
      .mockResolvedValueOnce(withFee(20));
    const { provider } = fakeProvider(settings);
    expect(await readRedemptionFeeBips(provider)).toBeNull();
    expect(await readRedemptionFeeBips(provider)).toBe(20);
  });

  it('a malformed settings return answers null', async () => {
    const { provider } = fakeProvider(async () => '0x1234');
    expect(await readRedemptionFeeBips(provider)).toBeNull();
  });
});

describe('estimateRedemptionFee + redemptionFeeDisclosureLine', () => {
  it('amount × bips / 10000, in FXRP', () => {
    expect(estimateRedemptionFee(5_000_000n, 20)).toEqual({ redemptionFeeBips: 20, redemptionFeeFxrp: 0.01 });
    expect(estimateRedemptionFee(12_345_678n, 25)).toEqual({ redemptionFeeBips: 25, redemptionFeeFxrp: 0.030864 });
    expect(estimateRedemptionFee(5_000_000n, 18)).toEqual({ redemptionFeeBips: 18, redemptionFeeFxrp: 0.009 });
  });

  it('an unread fee stays null on both fields — never 0', () => {
    expect(estimateRedemptionFee(5_000_000n, null)).toEqual({ redemptionFeeBips: null, redemptionFeeFxrp: null });
  });

  it('the line states the figure, or says it could not be read and is NOT zero', () => {
    const line = redemptionFeeDisclosureLine(estimateRedemptionFee(5_000_000n, 18));
    expect(line).toContain('0.18%');
    expect(line).toContain('0.009 FXRP');
    const unread = redemptionFeeDisclosureLine(estimateRedemptionFee(5_000_000n, null));
    expect(unread).toMatch(/could not be read/);
    expect(unread).toMatch(/NOT zero/);
  });
});
