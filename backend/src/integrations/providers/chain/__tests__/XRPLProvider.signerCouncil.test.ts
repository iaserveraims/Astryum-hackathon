/**
 * Regression test for the api_version variance in XRPLProvider.getSignerCouncil.
 *
 * The failure that actually happened (verified live 2026-07-24 against the real
 * council rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf, which HAS a 3-of-4 signer list and
 * a disabled master key on mainnet):
 *
 *   · `account_info` with `signer_lists: true` returns the list UNDER
 *     `account_data` in api_version 1 — the shape of the HTTPS JSON-RPC fallback,
 *     which sends no api_version and therefore gets v1.
 *   · In api_version 2 the field moved to the ROOT of the result. That is what
 *     xrpl.js ≥4 (4.4.3 here) negotiates over the websocket — the DEFAULT
 *     transport of `_request`.
 *
 * Reading only `account_data.signer_lists` therefore returned `null` — "this is
 * not a council" — for a council that demonstrably is one, but ONLY on the
 * websocket path. Over HTTPS it read correctly. Consequences it caused:
 * `rehearsal-status` reported memberCount 0 / rehearsalComplete false, the panel
 * computed `constituted = false` and opened a constituted Legacy in Constitute
 * instead of Govern, and `prepareCouncilMultisig` threw NotACouncilError — i.e.
 * the governed-order flow could not compose at all.
 *
 * Both shapes must yield the same council. The v2 case is the one that regressed.
 */
import { XRPLProvider } from '../XRPLProvider';

const mockRequest = jest.fn();
jest.mock('xrpl', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    isConnected: jest.fn().mockReturnValue(true),
    request: mockRequest,
  })),
}));

const COUNCIL = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
/** The real 3-of-4 quorum on mainnet, each weight 1. */
const SIGNER_ENTRIES = [
  { SignerEntry: { Account: 'rBGVzjE5JcbZs2toRRLLrE6z62HmmGNSxa', SignerWeight: 1 } },
  { SignerEntry: { Account: 'rNaFfVgbqWYotrR3Jz4RorirDUZgLfxhXt', SignerWeight: 1 } },
  { SignerEntry: { Account: 'rGb1VJkxmMzZLbWRFfu9Xh5GVjZGYR4d3x', SignerWeight: 1 } },
  { SignerEntry: { Account: 'rPbwqPUBRkDtThuGMitT3LCJs7PVfvnTwV', SignerWeight: 1 } },
];
const SIGNER_LIST = { SignerQuorum: 3, SignerEntries: SIGNER_ENTRIES };
/** lsfDisableMaster (0x00100000) — the door is closed on the real account. */
const ACCOUNT_DATA = { Account: COUNCIL, Flags: 1048576, Sequence: 105597280 };

beforeEach(() => mockRequest.mockReset());

describe('XRPLProvider.getSignerCouncil — api_version 1 vs 2', () => {
  it('api_version 1 shape (HTTPS fallback): signer_lists nested under account_data', async () => {
    mockRequest.mockResolvedValueOnce({
      result: { account_data: { ...ACCOUNT_DATA, signer_lists: [SIGNER_LIST] } },
    });
    const council = await new XRPLProvider().getSignerCouncil(COUNCIL);
    expect(council).not.toBeNull();
    expect(council!.quorum).toBe(3);
    expect(council!.masterKeyDisabled).toBe(true);
    expect(council!.signers).toHaveLength(4);
  });

  it('api_version 2 shape (xrpl.js websocket, the DEFAULT): signer_lists at the result ROOT', async () => {
    // This is the case that returned null in production code paths.
    mockRequest.mockResolvedValueOnce({
      result: { account_data: { ...ACCOUNT_DATA }, signer_lists: [SIGNER_LIST] },
    });
    const council = await new XRPLProvider().getSignerCouncil(COUNCIL);
    expect(council).not.toBeNull();
    expect(council!.quorum).toBe(3);
    expect(council!.masterKeyDisabled).toBe(true);
    expect(council!.signers.map((s) => s.account).sort()).toEqual(
      SIGNER_ENTRIES.map((e) => e.SignerEntry.Account).sort(),
    );
    expect(council!.signers.every((s) => s.weight === 1)).toBe(true);
  });

  it('both shapes agree — the transport must never change the verdict', async () => {
    mockRequest.mockResolvedValueOnce({
      result: { account_data: { ...ACCOUNT_DATA, signer_lists: [SIGNER_LIST] } },
    });
    const viaV1 = await new XRPLProvider().getSignerCouncil(COUNCIL);
    mockRequest.mockResolvedValueOnce({
      result: { account_data: { ...ACCOUNT_DATA }, signer_lists: [SIGNER_LIST] },
    });
    const viaV2 = await new XRPLProvider().getSignerCouncil(COUNCIL);
    expect(viaV2).toEqual(viaV1);
  });

  it('an account with NO signer list is still null in both shapes (no false council)', async () => {
    mockRequest.mockResolvedValueOnce({ result: { account_data: { ...ACCOUNT_DATA, Flags: 0 } } });
    expect(await new XRPLProvider().getSignerCouncil(COUNCIL)).toBeNull();
    // Empty array at the root must not fabricate a quorum either.
    mockRequest.mockResolvedValueOnce({
      result: { account_data: { ...ACCOUNT_DATA, Flags: 0 }, signer_lists: [] },
    });
    expect(await new XRPLProvider().getSignerCouncil(COUNCIL)).toBeNull();
  });

  it('a signer list with an empty SignerEntries array is null, not a zero-member council', async () => {
    mockRequest.mockResolvedValueOnce({
      result: { account_data: ACCOUNT_DATA, signer_lists: [{ SignerQuorum: 3, SignerEntries: [] }] },
    });
    expect(await new XRPLProvider().getSignerCouncil(COUNCIL)).toBeNull();
  });
});
