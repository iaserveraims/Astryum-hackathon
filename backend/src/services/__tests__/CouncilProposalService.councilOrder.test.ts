/**
 * G9 (auditoría 17-ago) — the council order composed BY RULE must be as honest
 * as the one composed through `POST /council-order/prepare`.
 *
 * Two silent failures are pinned here, and both of them PASS on the old code:
 *  - the proposal title (what the quorum reads before signing) was written in
 *    the contract's integers: "Put 100000 base units … into venue #0";
 *  - an order the cage already refuses reached the inbox, took the account's one
 *    live proposal slot, and only reverted after the signatures and the ~20 FLR
 *    FDC round had been spent.
 *
 * `readVaultState` is the only thing stubbed (it is the RPC): `checkDirectTo`,
 * `checkRecall`, `checkSetPayees`, `venueProtocolName` and the real
 * `encodeCouncilOrder` all run for real, so the assertions are about the
 * sentence a person actually sees.
 */

const mockReadVaultState = jest.fn();
jest.mock('../flare/LegacyVaultStateService', () => ({
  ...jest.requireActual('../flare/LegacyVaultStateService'),
  readVaultState: (...a: unknown[]) => mockReadVaultState(...a),
}));

const CAGE = {
  chain: 'flare' as const,
  rpcUrl: 'http://rpc.invalid',
  sourceId: 'XRP' as const,
  explorerTx: 'https://flare-explorer.flare.network/tx/',
  bridge: '0x02aE0000000000000000000000000000000000aa',
  vault: '0xc8370000000000000000000000000000000000bb',
  orderAnchor: 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH',
};
jest.mock('../flare/LegacyCageResolver', () => ({
  requireCageForCouncil: jest.fn(async () => CAGE),
}));

const mockSaveOrder = jest.fn(async () => undefined);
jest.mock('../flare/LegacyOrderStore', () => ({
  saveCouncilOrderRecord: (...a: unknown[]) => mockSaveOrder(...a),
}));

// The handoff builder is the only RPC on the compose path. Stub the chain reads
// (nonce + constitutionRef) but run the REAL encoder with whatever summaryCtx it
// was handed — that is the whole point of the test.
const CONSTITUTION_REF = `0x${'ab'.repeat(32)}`;
const mockBuildHandoff = jest.fn();
jest.mock('../../connectors/protocols/xrpl/XrplCouncilOrderService', () => ({
  ...jest.requireActual('../../connectors/protocols/xrpl/XrplCouncilOrderService'),
  buildCouncilOrderHandoff: (...a: unknown[]) => mockBuildHandoff(...a),
}));

jest.mock('../../database/prismaClient', () => ({
  prisma: { councilProposal: { findFirst: jest.fn(), create: jest.fn() } },
}));
jest.mock('../../integrations/providers/chain/XRPLProvider', () => ({ xrplProvider: {} }));
jest.mock('../../connectors/protocols/xrpl/XrplMultisigCoordinator', () => ({
  prepareCouncilMultisig: jest.fn(),
  NotACouncilError: class NotACouncilError extends Error {},
}));

import {
  checkBpsSetter,
  checkProposeVenue,
  checkVenueExists,
  composeCouncilRuleTx,
  councilOrderPreflight,
  CouncilOrderWouldRevertError,
} from '../CouncilProposalService';

const COUNCIL = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh';

/** A readable cage: 6-decimal FXRP, one Kinetic venue, 1 FXRP idle, 10% cap. */
const vaultState = (over: Record<string, unknown> = {}) => ({
  vault: CAGE.vault,
  chain: 'flare',
  council: CAGE.bridge,
  asset: { address: '0xFXRP', symbol: 'FXRP', decimals: 6 },
  totalPrincipal: '1000000',
  allocatedPrincipal: '0',
  idlePrincipal: '1000000',
  totalValue: '1000000',
  maxVenueBps: 10_000,
  migrated: false,
  venues: [
    {
      id: 0,
      target: '0x1111111111111111111111111111111111111111',
      targetSymbol: 'isoFXRP',
      shares: '0',
      kind: 'compoundv2',
      readyAt: 0,
      retired: false,
      basis: '0',
      value: '0',
    },
  ],
  totalClaimable: '0',
  strayAssets: '0',
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.KINETIC_KFXRP_ISO = '0x1111111111111111111111111111111111111111';
  process.env.XRPL_SOURCE_TAG = '';
  mockReadVaultState.mockResolvedValue(vaultState());
  mockBuildHandoff.mockImplementation(async (input: Record<string, any>) => {
    const actual = jest.requireActual('../../connectors/protocols/xrpl/XrplCouncilOrderService');
    const encoded = actual.encodeCouncilOrder(
      input.action,
      input.params,
      CONSTITUTION_REF,
      7,
      input.summaryCtx,
    );
    return {
      xrplTx: { TransactionType: 'Payment', Account: COUNCIL },
      order: { ...encoded, bridge: input.cage.bridge, vault: input.cage.vault, chain: 'flare', constitutionRef: CONSTITUTION_REF },
      disclosure: { disclosedToUser: true, astryumSigns: false, note: '', facts: {} },
    };
  });
});

describe('composeCouncilRuleTx — councilOrder speaks human units (G9)', () => {
  it('the title the quorum reads carries the token amount and the venue NAME, not base units', async () => {
    const composed = await composeCouncilRuleTx(
      'councilOrder',
      { council: COUNCIL, orderAction: 'direct-to', orderParams: { venueId: 0, amount: '100000' } },
      COUNCIL,
    );

    // OLD CODE: "Put 100000 base units of principal to work in venue #0".
    expect(composed.summary).toContain('0.1 FXRP');
    expect(composed.summary).toContain('Kinetic (venue #0)');
    expect(composed.summary).not.toContain('base units');

    // The context reaches the builder — and it decorates ONLY the summary.
    expect(mockBuildHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        summaryCtx: expect.objectContaining({ decimals: 6, symbol: 'FXRP' }),
      }),
    );
    expect(mockReadVaultState).toHaveBeenCalledWith(CAGE.vault);
    expect(mockSaveOrder).toHaveBeenCalledTimes(1);
  });

  it('an unreadable vault still composes (best-effort), falling back to base units', async () => {
    mockReadVaultState.mockRejectedValue(new Error('flare rpc unreachable'));

    const composed = await composeCouncilRuleTx(
      'councilOrder',
      { council: COUNCIL, orderAction: 'direct-to', orderParams: { venueId: 0, amount: '100000' } },
      COUNCIL,
    );
    expect(composed.summary).toContain('100000 base units');
    expect(mockBuildHandoff).toHaveBeenCalledWith(expect.not.objectContaining({ summaryCtx: expect.anything() }));
    expect(mockSaveOrder).toHaveBeenCalledTimes(1); // never blocked over wording
  });
});

describe('composeCouncilRuleTx — the pre-flight the rule path never had (G9)', () => {
  it('refuses a direct-to over the idle principal BEFORE anything is composed or persisted', async () => {
    await expect(
      composeCouncilRuleTx(
        'councilOrder',
        { council: COUNCIL, orderAction: 'direct-to', orderParams: { venueId: 0, amount: '5000000' } },
        COUNCIL,
      ),
    ).rejects.toThrow(/INSUFFICIENT_IDLE_PRINCIPAL/);

    // Nothing reached the inbox: no bytes built, no order row, so the account's
    // single live proposal slot is still free for an order that CAN land.
    expect(mockBuildHandoff).not.toHaveBeenCalled();
    expect(mockSaveOrder).not.toHaveBeenCalled();
  });

  it('refuses a direct-to into a venue that does not exist, naming it', async () => {
    await expect(
      composeCouncilRuleTx(
        'councilOrder',
        { council: COUNCIL, orderAction: 'direct-to', orderParams: { venueId: 9, amount: '1000' } },
        COUNCIL,
      ),
    ).rejects.toThrow(/VENUE_UNKNOWN.*Venue #9 does not exist/s);
    expect(mockBuildHandoff).not.toHaveBeenCalled();
  });

  it('refuses a recall bigger than the venue holds for the vault', async () => {
    mockReadVaultState.mockResolvedValue(
      vaultState({
        idlePrincipal: '0',
        allocatedPrincipal: '1000000',
        venues: [{ ...vaultState().venues[0], basis: '1000000', value: '1000000' }],
      }),
    );

    await expect(
      composeCouncilRuleTx(
        'councilOrder',
        { council: COUNCIL, orderAction: 'recall', orderParams: { venueId: 0, amount: '9000000' } },
        COUNCIL,
      ),
    ).rejects.toBeInstanceOf(CouncilOrderWouldRevertError);
    expect(mockSaveOrder).not.toHaveBeenCalled();
  });

  it('refuses set-payees that would strand the yield in the bridge, even with Flare unreadable', async () => {
    mockReadVaultState.mockRejectedValue(new Error('flare rpc unreachable'));

    await expect(
      composeCouncilRuleTx(
        'councilOrder',
        {
          council: COUNCIL,
          orderAction: 'set-payees',
          orderParams: { payees: [{ account: CAGE.bridge, bps: 10_000 }] },
        },
        COUNCIL,
      ),
    ).rejects.toThrow(/PAYEE_TRAPS_FUNDS/);
    expect(mockBuildHandoff).not.toHaveBeenCalled();
  });

  it('lets a legal order through — the guard refuses, it does not gate', async () => {
    mockReadVaultState.mockResolvedValue(
      vaultState({
        idlePrincipal: '0',
        allocatedPrincipal: '1000000',
        venues: [{ ...vaultState().venues[0], basis: '1000000', value: '1000000' }],
      }),
    );

    const composed = await composeCouncilRuleTx(
      'councilOrder',
      { council: COUNCIL, orderAction: 'recall', orderParams: { venueId: 0, amount: '500000' } },
      COUNCIL,
    );
    expect(composed.council).toBe(COUNCIL);
    expect(mockSaveOrder).toHaveBeenCalledTimes(1);
  });

  it('a LEGAL move still composes, with human units', async () => {
    mockReadVaultState.mockResolvedValue(twoVenues());
    const composed = await composeCouncilRuleTx(
      'councilOrder',
      { council: COUNCIL, orderAction: 'move', orderParams: { fromId: 0, toId: 1, amount: '250000' } },
      COUNCIL,
    );
    expect(composed.summary).toContain('0.25 FXRP');
    expect(composed.summary).not.toContain('base units');
    expect(mockSaveOrder).toHaveBeenCalledTimes(1);
  });
});

/**
 * G12-move (ronda 2) — `move` conservaba el éxito no ganado.
 *
 * Everything below FAILS on the code as it shipped in d99063e: `move`,
 * `evacuate`, `retire-venue`, `propose-venue` and the two bps setters had NO
 * pre-flight on either door, so an order aimed at a venue that does not exist,
 * is retired, is still inside its 30-day D1a window — or out of an origin with
 * no basis — composed, took the account's single live proposal slot, collected
 * the quorum's signatures, paid the FDC round (~20 FLR) and reverted inside
 * `_allocate` / `InsufficientVenueBasis` on the far side.
 */
/** A cage with principal ALREADY working: venue #0 holds 1 FXRP, #1 is empty. */
const twoVenues = (over: Record<string, unknown> = {}) =>
  vaultState({
    idlePrincipal: '0',
    allocatedPrincipal: '1000000',
    venues: [
      { ...vaultState().venues[0], basis: '1000000', value: '1000000' },
      {
        id: 1,
        target: '0x2222222222222222222222222222222222222222',
        targetSymbol: 'stXRP',
        shares: '0',
        kind: 'erc4626',
        readyAt: 0,
        retired: false,
        basis: '0',
        value: '0',
      },
    ],
    ...over,
  });

describe('G12-move — el `move` deja de comprar la ronda FDC para revertir', () => {
  it('refuses a move OUT of a venue with no basis (InsufficientVenueBasis), naming the half that fails', async () => {
    mockReadVaultState.mockResolvedValue(twoVenues());
    await expect(
      composeCouncilRuleTx(
        'councilOrder',
        { council: COUNCIL, orderAction: 'move', orderParams: { fromId: 1, toId: 0, amount: '1' } },
        COUNCIL,
      ),
    ).rejects.toThrow(/INSUFFICIENT_VENUE_BASIS[\s\S]*A move first recalls the principal/);
    expect(mockBuildHandoff).not.toHaveBeenCalled();
    expect(mockSaveOrder).not.toHaveBeenCalled();
  });

  it('refuses a move INTO a venue that does not exist', async () => {
    mockReadVaultState.mockResolvedValue(twoVenues());
    await expect(
      composeCouncilRuleTx(
        'councilOrder',
        { council: COUNCIL, orderAction: 'move', orderParams: { fromId: 0, toId: 9, amount: '1000' } },
        COUNCIL,
      ),
    ).rejects.toThrow(/VENUE_UNKNOWN[\s\S]*Venue #9 does not exist/);
  });

  it('refuses a move INTO a retired venue — a rescue is still an entry', async () => {
    const st = twoVenues();
    st.venues[1].retired = true;
    mockReadVaultState.mockResolvedValue(st);
    await expect(
      composeCouncilRuleTx(
        'councilOrder',
        { council: COUNCIL, orderAction: 'move', orderParams: { fromId: 0, toId: 1, amount: '1000' } },
        COUNCIL,
      ),
    ).rejects.toThrow(/VENUE_RETIRED/);
  });

  it('refuses a move INTO a venue still inside its 30-day window (D1a)', async () => {
    const st = twoVenues();
    st.venues[1].readyAt = Math.floor(Date.now() / 1000) + 30 * 86_400;
    mockReadVaultState.mockResolvedValue(st);
    await expect(
      composeCouncilRuleTx(
        'councilOrder',
        { council: COUNCIL, orderAction: 'move', orderParams: { fromId: 0, toId: 1, amount: '1000' } },
        COUNCIL,
      ),
    ).rejects.toThrow(/VENUE_NOT_READY/);
  });

  it('does NOT apply the D2 entry cap to a rescue — `_allocate(..., enforceCap=false)`', async () => {
    // 10% cap, and the whole principal moving into venue #1: `directTo` would be
    // refused here, `moveToVenue` must not be. A pre-flight that copied
    // checkDirectTo would block the emergency the cap deliberately exempts.
    mockReadVaultState.mockResolvedValue(twoVenues({ maxVenueBps: 1000 }));
    const composed = await composeCouncilRuleTx(
      'councilOrder',
      { council: COUNCIL, orderAction: 'move', orderParams: { fromId: 0, toId: 1, amount: '1000000' } },
      COUNCIL,
    );
    expect(composed.summary).toContain('1 FXRP');
    expect(mockSaveOrder).toHaveBeenCalledTimes(1);
  });

  it('an unreadable vault NEVER turns a move into a refusal ("could not check" ≠ "would revert")', async () => {
    mockReadVaultState.mockRejectedValue(new Error('flare rpc unreachable'));
    const composed = await composeCouncilRuleTx(
      'councilOrder',
      { council: COUNCIL, orderAction: 'move', orderParams: { fromId: 0, toId: 1, amount: '1000' } },
      COUNCIL,
    );
    expect(composed.summary).toContain('1000 base units');
    expect(mockSaveOrder).toHaveBeenCalledTimes(1);
  });
});

describe('G12-move — las otras puertas de venue que también revertían caras', () => {
  it('refuses evacuate / retire-venue on a venue id the vault does not have', async () => {
    for (const orderAction of ['evacuate', 'retire-venue']) {
      jest.clearAllMocks();
      mockReadVaultState.mockResolvedValue(twoVenues());
      await expect(
        composeCouncilRuleTx('councilOrder', { council: COUNCIL, orderAction, orderParams: { venueId: 7 } }, COUNCIL),
      ).rejects.toThrow(/VENUE_UNKNOWN[\s\S]*Venue #7 does not exist/);
      expect(mockSaveOrder).not.toHaveBeenCalled();
    }
  });

  it('refuses propose-venue on a target already whitelisted and live (DuplicateVenue)', async () => {
    mockReadVaultState.mockResolvedValue(twoVenues());
    await expect(
      composeCouncilRuleTx(
        'councilOrder',
        {
          council: COUNCIL,
          orderAction: 'propose-venue',
          orderParams: { target: '0x2222222222222222222222222222222222222222', kind: 0 },
        },
        COUNCIL,
      ),
    ).rejects.toThrow(/DUPLICATE_VENUE[\s\S]*already venue #1/);
  });

  it('refuses a venue kind outside the contract enum (a valid uint8 that panics on decode)', async () => {
    mockReadVaultState.mockResolvedValue(twoVenues());
    await expect(
      composeCouncilRuleTx(
        'councilOrder',
        {
          council: COUNCIL,
          orderAction: 'propose-venue',
          orderParams: { target: `0x${'d'.repeat(40)}`, kind: 7 },
        },
        COUNCIL,
      ),
    ).rejects.toThrow(/VENUE_KIND_UNKNOWN/);
  });

  it('lets a genuinely new venue through', async () => {
    mockReadVaultState.mockResolvedValue(twoVenues());
    const composed = await composeCouncilRuleTx(
      'councilOrder',
      {
        council: COUNCIL,
        orderAction: 'propose-venue',
        orderParams: { target: `0x${'d'.repeat(40)}`, kind: 1 },
      },
      COUNCIL,
    );
    expect(composed.summary).toMatch(/Propose venue 0xdd/i);
    expect(mockSaveOrder).toHaveBeenCalledTimes(1);
  });

  it('refuses a bps setter outside the vault bounds even with Flare unreadable (they are constants)', async () => {
    mockReadVaultState.mockRejectedValue(new Error('flare rpc unreachable'));
    await expect(
      composeCouncilRuleTx(
        'councilOrder',
        { council: COUNCIL, orderAction: 'set-max-venue-bps', orderParams: { bps: 500 } },
        COUNCIL,
      ),
    ).rejects.toThrow(/BPS_OUT_OF_BOUNDS[\s\S]*between 1000 and 10000/);
    await expect(
      composeCouncilRuleTx(
        'councilOrder',
        { council: COUNCIL, orderAction: 'set-linaje-fee-bps', orderParams: { bps: 5000 } },
        COUNCIL,
      ),
    ).rejects.toThrow(/BPS_OUT_OF_BOUNDS[\s\S]*between 1000 and 4000/);
    expect(mockBuildHandoff).not.toHaveBeenCalled();
  });

  it('lets the bps setters through inside their bounds', async () => {
    mockReadVaultState.mockResolvedValue(twoVenues());
    await composeCouncilRuleTx(
      'councilOrder',
      { council: COUNCIL, orderAction: 'set-max-venue-bps', orderParams: { bps: 10_000 } },
      COUNCIL,
    );
    await composeCouncilRuleTx(
      'councilOrder',
      { council: COUNCIL, orderAction: 'set-linaje-fee-bps', orderParams: { bps: 4000 } },
      COUNCIL,
    );
    expect(mockSaveOrder).toHaveBeenCalledTimes(2);
  });
});

describe('councilOrderPreflight — the shared verdict (so the HTTP door can adopt it)', () => {
  it('returns the verdict instead of throwing, with the code the route answers 400 with', async () => {
    const pre = await councilOrderPreflight(CAGE, 'direct-to', { venueId: 0, amount: '5000000' });
    expect(pre.blocked?.code).toBe('INSUFFICIENT_IDLE_PRINCIPAL');
    expect(pre.summaryCtx).toEqual(
      expect.objectContaining({ decimals: 6, symbol: 'FXRP', venueLabels: { 0: 'Kinetic' } }),
    );
  });

  it('a venue we cannot name falls back to its receipt-token symbol, never to a guess', async () => {
    delete process.env.KINETIC_KFXRP_ISO;
    const pre = await councilOrderPreflight(CAGE, 'direct-to', { venueId: 0, amount: '1' });
    expect(pre.blocked).toBeUndefined();
    expect(pre.summaryCtx?.venueLabels).toEqual({ 0: 'isoFXRP' });
  });
});

/**
 * The checks this file OWNS, as PURE functions — no RPC, no cage, no mocks.
 *
 * REUSE (auditoría 2026-08-18): `checkMoveDestination` is no longer among them.
 * It duplicated checkDirectTo's retired / not-ready branches and moved to its
 * real home beside checkDirectTo/checkRecall
 * (flare/__tests__/LegacyVaultStateService.test.ts pins it there now). What is
 * left here judges orders that are NOT entries into a venue — retire, evacuate,
 * propose, the bps setters — which is why they stay next to the council door.
 */
describe('G12-move — los mirrors puros de LegacyVault.sol', () => {
  const state = () => twoVenues() as unknown as Parameters<typeof checkVenueExists>[0];

  it('checkVenueExists mirrors `venueId >= venues.length` (retireVenue L388, _evacuate L633)', () => {
    expect(checkVenueExists(state(), 1).ok).toBe(true);
    expect(checkVenueExists(state(), 2)).toMatchObject({ ok: false, code: 'VENUE_UNKNOWN' });
    expect(checkVenueExists(state(), -1)).toMatchObject({ ok: false, code: 'VENUE_UNKNOWN' });
    expect(checkVenueExists(state(), Number.NaN)).toMatchObject({ ok: false, code: 'VENUE_UNKNOWN' });
  });

  it('checkProposeVenue mirrors _addVenue (L572-579) plus notMigrated', () => {
    const fresh = `0x${'e'.repeat(40)}`;
    expect(checkProposeVenue(state(), fresh, 0).ok).toBe(true);
    expect(checkProposeVenue(state(), 'kinetic', 0)).toMatchObject({ code: 'VENUE_TARGET_INVALID' });
    expect(checkProposeVenue(state(), `0x${'0'.repeat(40)}`, 0)).toMatchObject({ code: 'ZERO_ADDRESS' });
    expect(checkProposeVenue(state(), fresh, 2)).toMatchObject({ code: 'VENUE_KIND_UNKNOWN' });
    expect(checkProposeVenue({ ...state(), migrated: true }, fresh, 0)).toMatchObject({ code: 'VAULT_MIGRATED' });
    // A RETIRED venue's target may be proposed again — the contract only
    // refuses a live duplicate, and refusing more would block a real recovery.
    const s = state();
    expect(checkProposeVenue({ ...s, venues: [s.venues[0], { ...s.venues[1], retired: true }] }, s.venues[1].target, 0).ok).toBe(true);
  });

  it('checkBpsSetter carries each setter its OWN bounds (D2 cap vs D5 linaje)', () => {
    expect(checkBpsSetter('set-max-venue-bps', 1000).ok).toBe(true);
    expect(checkBpsSetter('set-max-venue-bps', 999)).toMatchObject({ code: 'BPS_OUT_OF_BOUNDS' });
    expect(checkBpsSetter('set-linaje-fee-bps', 4000).ok).toBe(true);
    // 10000 is legal for the entry cap and illegal for the linaje cut: one
    // shared bounds pair would have let a reverting order through.
    expect(checkBpsSetter('set-max-venue-bps', 10_000).ok).toBe(true);
    expect(checkBpsSetter('set-linaje-fee-bps', 10_000)).toMatchObject({ code: 'BPS_OUT_OF_BOUNDS' });
    expect(checkBpsSetter('set-max-venue-bps', 1000.5)).toMatchObject({ code: 'BPS_OUT_OF_BOUNDS' });
  });
});
