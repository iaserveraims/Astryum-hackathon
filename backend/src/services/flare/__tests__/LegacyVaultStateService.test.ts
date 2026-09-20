/**
 * The cage's read layer — pure logic only (no RPC, no network).
 *
 * What matters here is that the pre-flight tells the TRUTH: every branch of
 * checkDirectTo corresponds to a real revert in LegacyVault._allocate, and the
 * amount conversions are exact at 18 decimals (where floats silently lie).
 */

import { assertCouncilBinding } from '../../../connectors/protocols/xrpl/XrplCouncilOrderService';
import {
  buildVaultDepositCalls,
  checkDirectTo,
  checkMoveDestination,
  checkRecall,
  checkSetPayees,
  checkVenueAcceptsEntry,
  computeStrayAssets,
  decodeVenueKind,
  formatBaseUnits,
  parseBaseUnits,
  type LegacyVaultState,
} from '../LegacyVaultStateService';

const DEC = 18;
const one = (n: string) => parseBaseUnits(n, DEC);

/** A vault holding 100 units of principal: 40 working in venue #0, 60 idle. */
function vaultState(over: Partial<LegacyVaultState> = {}): LegacyVaultState {
  return {
    vault: '0xc8379c79779cCE3B738424892709fe0D4339E3b1',
    chain: 'flare',
    asset: { address: '0x1234567890123456789012345678901234567890', symbol: 'FXRP', decimals: DEC },
    totalPrincipal: one('100').toString(),
    allocatedPrincipal: one('40').toString(),
    idlePrincipal: one('60').toString(),
    totalValue: one('100').toString(),
    maxVenueBps: 10_000, // wide open unless a test narrows it
    migrated: false,
    totalClaimable: '0',
    strayAssets: '0',
    venues: [
      { id: 0, target: '0xaaaa000000000000000000000000000000000001', targetSymbol: 'vFXRP', shares: one('40').toString(), kind: 'erc4626', readyAt: 0, retired: false, basis: one('40').toString(), value: one('40').toString() },
      { id: 1, target: '0xaaaa000000000000000000000000000000000002', targetSymbol: 'isoFXRP', shares: '0', kind: 'compoundv2', readyAt: 0, retired: false, basis: '0', value: '0' },
    ],
    ...over,
  };
}

describe('venue kinds', () => {
  it('decodes the contract enum in its declared order', () => {
    expect(decodeVenueKind(0)).toBe('erc4626');
    expect(decodeVenueKind(1)).toBe('compoundv2');
    expect(decodeVenueKind(1n)).toBe('compoundv2');
  });

  it('refuses to guess a kind it does not know', () => {
    // A newer vault could add a kind. Mis-labelling one would tell the family
    // their principal goes somewhere it does not.
    expect(() => decodeVenueKind(7)).toThrow(/unknown VenueKind/);
  });
});

describe('base-unit conversion is exact', () => {
  it('formats without floats and trims trailing zeros', () => {
    expect(formatBaseUnits(10n ** 18n, 18)).toBe('1');
    expect(formatBaseUnits(1_500_000_000_000_000_000n, 18)).toBe('1.5');
    expect(formatBaseUnits(1n, 18)).toBe('0.000000000000000001');
    expect(formatBaseUnits(0n, 18)).toBe('0');
    expect(formatBaseUnits(12345n, 0)).toBe('12345');
  });

  it('parses back to the same bigint (round-trip)', () => {
    for (const human of ['1', '1.5', '0.000000000000000001', '123456.789']) {
      expect(formatBaseUnits(parseBaseUnits(human, 18), 18)).toBe(human);
    }
  });

  it('survives amounts that Number would round away', () => {
    // 123456789.123456789012345678 has more significant digits than a double
    // carries — the whole reason nothing in this module touches Number.
    const human = '123456789.123456789012345678';
    expect(formatBaseUnits(parseBaseUnits(human, 18), 18)).toBe(human);
  });

  it('rejects precision the token cannot hold instead of truncating', () => {
    expect(() => parseBaseUnits('1.1234567', 6)).toThrow(/lose precision/);
    expect(parseBaseUnits('1.123456', 6)).toBe(1_123_456n);
  });

  it('rejects anything that is not a positive decimal', () => {
    for (const bad of ['', '-1', 'abc', '1e18', '1.2.3', ' ']) {
      expect(() => parseBaseUnits(bad, 18)).toThrow();
    }
    expect(() => parseBaseUnits('0', 18)).toThrow(/greater than zero/);
  });
});

describe('checkDirectTo mirrors every revert in _allocate', () => {
  it('passes an order the vault can actually honour', () => {
    expect(checkDirectTo(vaultState(), 1, one('10'))).toEqual({ ok: true });
  });

  it('catches a venue that does not exist (VenueUnknown)', () => {
    const v = checkDirectTo(vaultState(), 99, one('10'));
    expect(v.ok).toBe(false);
    expect(v.code).toBe('VENUE_UNKNOWN');
    // The whole point: this is the order that used to cost a full ceremony
    // plus the FDC round before failing on the far side.
    expect(v.reason).toMatch(/does not exist/);
  });

  it('catches a retired venue (VenueRetiredError)', () => {
    const state = vaultState();
    state.venues[1].retired = true;
    expect(checkDirectTo(state, 1, one('10')).code).toBe('VENUE_RETIRED');
  });

  it('catches a venue still inside its waiting period (VenueNotReady)', () => {
    const state = vaultState();
    const now = 1_800_000_000;
    state.venues[1].readyAt = now + 3_600;
    expect(checkDirectTo(state, 1, one('10'), now).code).toBe('VENUE_NOT_READY');
    // ...and lets it through once the period has elapsed.
    expect(checkDirectTo(state, 1, one('10'), now + 7_200).ok).toBe(true);
  });

  it('catches a zero amount (ZeroAmount)', () => {
    expect(checkDirectTo(vaultState(), 1, 0n).code).toBe('ZERO_AMOUNT');
  });

  it('catches directing more than sits idle (InsufficientIdlePrincipal)', () => {
    const v = checkDirectTo(vaultState(), 1, one('61'));
    expect(v.code).toBe('INSUFFICIENT_IDLE_PRINCIPAL');
    expect(v.reason).toContain('60');
    expect(v.reason).toContain('FXRP');
    // The boundary itself is allowed — exactly the idle balance is legal.
    expect(checkDirectTo(vaultState(), 1, one('60')).ok).toBe(true);
  });

  it('catches the D2 entry cap on projected post-move values (EntryCapExceeded)', () => {
    // Cap each venue at 50% of a 100-unit vault. Venue #1 holds nothing, so 50
    // is exactly the line and 51 crosses it.
    const state = vaultState({ maxVenueBps: 5_000 });
    expect(checkDirectTo(state, 1, one('50')).ok).toBe(true);
    const over = checkDirectTo(state, 1, one('51'));
    expect(over.code).toBe('ENTRY_CAP_EXCEEDED');
    expect(over.reason).toContain('50.00%');
  });

  it('counts what a venue ALREADY holds toward its cap', () => {
    // Venue #0 already holds 40 of a 100-unit vault against a 50% cap: only 10
    // more may enter, not 50.
    const state = vaultState({ maxVenueBps: 5_000 });
    expect(checkDirectTo(state, 0, one('10')).ok).toBe(true);
    expect(checkDirectTo(state, 0, one('11')).code).toBe('ENTRY_CAP_EXCEEDED');
  });

  it('refuses any direction once the vault has migrated', () => {
    expect(checkDirectTo(vaultState({ migrated: true }), 1, one('10')).code).toBe('VAULT_MIGRATED');
  });

  it('reports the FIRST blocking reason, so the fix is unambiguous', () => {
    // A retired venue AND an impossible amount: the venue is named first,
    // because moving the amount would not help.
    const state = vaultState();
    state.venues[1].retired = true;
    expect(checkDirectTo(state, 1, one('999')).code).toBe('VENUE_RETIRED');
  });
});

/**
 * REUSE (auditorí) — `checkMoveDestination` lived in
 * CouncilProposalService.ts with its OWN literal copy of the VENUE_RETIRED and
 * VENUE_NOT_READY branches of `checkDirectTo`: same codes, same conditions,
 * only the prose differed, and its own comment admitted it only sat there
 * because that round did not own this file.
 */
describe('checkVenueAcceptsEntry — una condición, dos voces (directTo vs move)', () => {
  const RETIRED = () => {
    const st = vaultState();
    st.venues[1].retired = true;
    return st;
  };
  const NOT_READY = (now: number) => {
    const st = vaultState();
    st.venues[1].readyAt = now + 3_600;
    return st;
  };

  it('las dos puertas coinciden SIEMPRE en el veredicto y en el código', () => {
    const now = 1_800_000_000;
    const cases: Array<[LegacyVaultState, number]> = [
      [vaultState(), 1],
      [RETIRED(), 1],
      [NOT_READY(now), 1],
      [vaultState(), 99],
    ];
    for (const [st, venueId] of cases) {
      // `checkDirectTo` runs on an amount the vault can honour, so the only
      // thing that can differ between the two is the entry gate they share.
      const direct = checkDirectTo(st, venueId, one('10'), now);
      const move = checkMoveDestination(st, venueId, now);
      expect(move.ok).toBe(direct.ok);
      expect(move.code).toBe(direct.code);
    }
  });

  it('un venue retirado: mismo código, y el move CONSERVA su frase de rescate', () => {
    const st = RETIRED();
    const direct = checkDirectTo(st, 1, one('10'));
    const move = checkMoveDestination(st, 1);
    expect(direct.code).toBe('VENUE_RETIRED');
    expect(move.code).toBe('VENUE_RETIRED');
    // La prosa del move es la que explica POR QUÉ un rescate tampoco entra.
    expect(move.reason).toContain('a rescue is still an entry');
    expect(direct.reason).not.toContain('a rescue');
    // …y la de directTo sigue diciendo lo suyo: las salidas nunca se bloquean.
    expect(direct.reason).toContain('Exits from it still work');
  });

  it('dentro de la ventana D1a: mismo código, misma fecha, frases distintas', () => {
    const now = 1_800_000_000;
    const st = NOT_READY(now);
    const opensAt = new Date((now + 3_600) * 1000).toISOString();
    const direct = checkDirectTo(st, 1, one('10'), now);
    const move = checkMoveDestination(st, 1, now);
    expect(direct.code).toBe('VENUE_NOT_READY');
    expect(move.code).toBe('VENUE_NOT_READY');
    expect(direct.reason).toContain(opensAt);
    expect(move.reason).toContain(opensAt);
    expect(move.reason).toContain('not even a rescue');
    expect(move.reason).toContain("30-day waiting period");
    // Pasada la ventana, las dos puertas abren.
    expect(checkMoveDestination(st, 1, now + 7_200).ok).toBe(true);
    expect(checkDirectTo(st, 1, one('10'), now + 7_200).ok).toBe(true);
  });

  it('la puerta devuelve el venue cuando abre, para que quien la llama no lo busque otra vez', () => {
    const gate = checkVenueAcceptsEntry(vaultState(), 1, 0, 'direct');
    expect(gate.ok).toBe(true);
    if (gate.ok) expect(gate.venue.id).toBe(1);
  });

  it('checkMoveDestination juzga el VENUE y nada del tamaño: ni tope D2 ni principal ocioso', () => {
    // 50% cap with venue #0 already holding 40 of 100: `directTo` refuses 11
    // more, a rescue must NOT — `_allocate(..., enforceCap = false)`.
    const capped = vaultState({ maxVenueBps: 5_000 });
    expect(checkDirectTo(capped, 0, one('11')).code).toBe('ENTRY_CAP_EXCEEDED');
    expect(checkMoveDestination(capped, 0).ok).toBe(true);
    // And the idle balance is irrelevant to a rescue: the principal arrives
    // from the origin venue in the same call, never from the idle pot.
    const dry = vaultState({ idlePrincipal: '0' });
    expect(checkDirectTo(dry, 1, one('1')).code).toBe('INSUFFICIENT_IDLE_PRINCIPAL');
    expect(checkMoveDestination(dry, 1).ok).toBe(true);
  });

  it('un venue que no existe se nombra por su número (no «basis insuficiente»)', () => {
    const v = checkMoveDestination(vaultState(), 99);
    expect(v.code).toBe('VENUE_UNKNOWN');
    expect(v.reason).toMatch(/Venue #99 does not exist/);
  });
});

describe('funding the cage (approve + deposit)', () => {
  it('composes approve then deposit, in that order, both unsigned', () => {
    const plan = buildVaultDepositCalls(vaultState(), one('25'));
    expect(plan.calls).toHaveLength(2);
    // approve(vault, amount) on the ASSET, then deposit(amount) on the VAULT.
    expect(plan.calls[0].to).toBe(vaultState().asset.address);
    expect(plan.calls[0].data.startsWith('0x095ea7b3')).toBe(true);
    expect(plan.calls[1].to).toBe(vaultState().vault);
    expect(plan.calls[1].data.startsWith('0xb6b55f25')).toBe(true); // deposit(uint256)
    expect(plan.calls.every((c) => c.value === '0')).toBe(true);
    expect(plan.disclosure.astryumSigns).toBe(false);
  });

  it('encodes the exact amount the funder asked for', () => {
    const plan = buildVaultDepositCalls(vaultState(), one('25'));
    expect(plan.amount).toBe(one('25').toString());
    expect(plan.amountHuman).toBe('25');
    // The amount must appear verbatim in BOTH calls — an approve that differs
    // from the deposit is either a failed tx or a lingering allowance.
    const hex = one('25').toString(16).padStart(64, '0');
    expect(plan.calls[0].data.toLowerCase()).toContain(hex);
    expect(plan.calls[1].data.toLowerCase()).toContain(hex);
  });

  it('says the irreversible part out loud, before any signature', () => {
    const plan = buildVaultDepositCalls(vaultState(), one('25'));
    // This is the fact that must never be discovered after the fact: the cage
    // has no function that returns principal to an address.
    expect(plan.disclosure.facts.principalIsWithdrawable).toBe(false);
    expect(plan.disclosure.note).toMatch(/cannot be withdrawn to any address/i);
    expect(plan.disclosure.note).toMatch(/nobody can take it out/i);
  });

  it('is permissionless — funding needs no quorum', () => {
    // deposit() carries no onlyCouncil modifier; claiming otherwise would send
    // a funder to collect signatures they do not need.
    expect(buildVaultDepositCalls(vaultState(), one('1')).disclosure.facts.needsCouncilQuorum).toBe(false);
  });

  it('refuses to fund a migrated vault or a zero amount', () => {
    expect(() => buildVaultDepositCalls(vaultState({ migrated: true }), one('1'))).toThrow(/migrated/);
    expect(() => buildVaultDepositCalls(vaultState(), 0n)).toThrow(/greater than zero/);
  });

  it('respects the asset decimals it was handed, not a hardcoded 18', () => {
    // FXRP on Flare mainnet has SIX decimals (read on-chain). A
    // hardcoded 18 here would over-approve by a factor of a trillion.
    const six = vaultState({ asset: { address: '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE', symbol: 'FXRP', decimals: 6 } });
    const plan = buildVaultDepositCalls(six, parseBaseUnits('25', 6));
    expect(plan.amount).toBe('25000000');
    expect(plan.amountHuman).toBe('25');
  });
});

describe('the binding that decides whether the vault will obey', () => {
  const BRIDGE = '0x02aE9fcB76768e42b8D3Ed9FE842238A6616b26F';

  it('accepts the live deployment (vault.council() IS the bridge)', () => {
    expect(() => assertCouncilBinding(BRIDGE, BRIDGE)).not.toThrow();
    expect(() => assertCouncilBinding(BRIDGE.toLowerCase(), BRIDGE.toUpperCase())).not.toThrow();
  });

  it('refuses BEFORE the quorum signs when the vault obeys someone else', () => {
    // Without this, prepare succeeds, the family signs, the FDC round runs and
    // is paid for (~20 FLR) — and only then does the vault revert NotCouncil().
    expect(() => assertCouncilBinding('0x000000000000000000000000000000000000dEaD', BRIDGE))
      .toThrow(/would revert with NotCouncil/);
  });
});

describe('assets stranded in the vault', () => {
  it('counts tokens transferred directly instead of through deposit()', () => {
    // 60 in the contract, 40 of it idle principal, 5 owed as yield -> 15 stray.
    expect(computeStrayAssets(one('60'), one('40'), one('5'))).toBe(one('15'));
  });

  it('is zero when every token is accounted for', () => {
    expect(computeStrayAssets(one('45'), one('40'), one('5'))).toBe(0n);
  });

  it('never reports negative when a venue holds part of the principal', () => {
    // allocated principal lives in the venue, not in the contract, so the raw
    // balance is legitimately below idle+claimable at times.
    expect(computeStrayAssets(one('1'), one('40'), 0n)).toBe(0n);
  });

  it('catches the real foot-gun: FXRP minted straight to the vault address', () => {
    // The mint rail can send FXRP to any EVM address, and the vault address is
    // the intuitive wrong answer. Those tokens never become principal, so idle
    // stays 0 and every directTo still reverts — while looking funded.
    const stray = computeStrayAssets(one('50'), 0n, 0n);
    expect(stray).toBe(one('50'));
    expect(checkDirectTo(vaultState({ idlePrincipal: '0', strayAssets: stray.toString() }), 1, one('10')).code)
      .toBe('INSUFFICIENT_IDLE_PRINCIPAL');
  });
});

describe('checkRecall mirrors the exit side', () => {
  it('lets the council pull back what a venue holds', () => {
    expect(checkRecall(vaultState(), 0, one('40'))).toEqual({ ok: true });
    expect(checkRecall(vaultState(), 0, one('10'))).toEqual({ ok: true });
  });

  it('refuses more than the venue holds as principal', () => {
    const v = checkRecall(vaultState(), 0, one('41'));
    expect(v.code).toBe('INSUFFICIENT_VENUE_BASIS');
    expect(v.reason).toContain('40');
    expect(v.reason).toContain('FXRP');
  });

  it('names an unknown venue precisely instead of blaming the amount', () => {
    // The contract would say "insufficient basis" (an unknown venue has none);
    // that sends someone to fix the wrong field.
    expect(checkRecall(vaultState(), 99, one('1')).code).toBe('VENUE_UNKNOWN');
  });

  it('refuses a zero amount', () => {
    expect(checkRecall(vaultState(), 0, 0n).code).toBe('ZERO_AMOUNT');
  });

  it('ALLOWS exiting a retired or not-yet-open venue — exits are never blocked', () => {
    // The whole point of retiring a venue is to leave it. The cage never
    // delays or caps an exit (D1a/D2), and neither may this pre-flight.
    const state = vaultState();
    state.venues[0].retired = true;
    state.venues[0].readyAt = Math.floor(Date.now() / 1000) + 86_400;
    expect(checkRecall(state, 0, one('40'))).toEqual({ ok: true });
  });

  it('still allows an exit after the vault has migrated', () => {
    // recall carries no notMigrated modifier in the contract — capital must
    // always be able to come home out of a venue.
    expect(checkRecall(vaultState({ migrated: true }), 0, one('40'))).toEqual({ ok: true });
  });
});

describe('checkSetPayees (E6) — the ceremony saver and the trap guard', () => {
  const VAULT = '0xc8379c79779cCE3B738424892709fe0D4339E3b1';
  const BRIDGE = '0x02aEb26F000000000000000000000000000000AA';
  const stack = { vault: VAULT, bridge: BRIDGE };
  const HEIR_A = '0x1111111111111111111111111111111111111111';
  const HEIR_B = '0x2222222222222222222222222222222222222222';

  it('accepts an exact 100.00% split', () => {
    expect(
      checkSetPayees(stack, [
        { account: HEIR_A, bps: 6_000 },
        { account: HEIR_B, bps: 4_000 },
      ]),
    ).toEqual({ ok: true });
  });

  it('accepts the EMPTY list — the endowment decision composes', () => {
    // payees=[] is legal on the contract and is the way BACK to pure
    // capitalization; refusing it here would lock a family into a split.
    expect(checkSetPayees(stack, [])).toEqual({ ok: true });
  });

  it('refuses Σ ≠ 10000 — the 90% order that used to reach the quorum', () => {
    // 60% + 30% passed the old UI, got signed, paid an FDC round, and only
    // then reverted PayeeBpsSumInvalid() on the vault.
    const v = checkSetPayees(stack, [
      { account: HEIR_A, bps: 6_000 },
      { account: HEIR_B, bps: 3_000 },
    ]);
    expect(v.code).toBe('PAYEE_BPS_SUM_INVALID');
    expect(v.reason).toContain('90.00%');
  });

  it('refuses the bridge as payee — funds trapped for ever, not a revert', () => {
    const v = checkSetPayees(stack, [{ account: BRIDGE, bps: 10_000 }]);
    expect(v.code).toBe('PAYEE_TRAPS_FUNDS');
    expect(v.reason).toContain('bridge');
  });

  it('refuses the vault itself as payee — yield would become stray assets', () => {
    const v = checkSetPayees(stack, [{ account: VAULT, bps: 10_000 }]);
    expect(v.code).toBe('PAYEE_TRAPS_FUNDS');
  });

  it('compares trap addresses case-insensitively (EVM addresses)', () => {
    const v = checkSetPayees(stack, [{ account: BRIDGE.toLowerCase(), bps: 10_000 }]);
    expect(v.code).toBe('PAYEE_TRAPS_FUNDS');
  });

  it('refuses the zero address and zero/fractional shares like the contract', () => {
    expect(
      checkSetPayees(stack, [{ account: '0x0000000000000000000000000000000000000000', bps: 10_000 }]).code,
    ).toBe('PAYEE_ZERO_ADDRESS');
    expect(checkSetPayees(stack, [{ account: HEIR_A, bps: 0 }]).code).toBe('PAYEE_ZERO_BPS');
    expect(checkSetPayees(stack, [{ account: HEIR_A, bps: 99.5 }]).code).toBe('PAYEE_ZERO_BPS');
  });

  it('refuses malformed input instead of letting the encoder throw generically', () => {
    expect(checkSetPayees(stack, 'not-a-list').code).toBe('PAYEE_INVALID');
    expect(checkSetPayees(stack, [{ account: 'rXRPLAddressNotEvm', bps: 10_000 }]).code).toBe('PAYEE_INVALID');
  });

  it('ALLOWS a duplicated address — the contract splits twice; the form warns', () => {
    // Blocking here would make the pre-flight a second authority over the
    // cage: a duplicate lands fine on-chain (two transfers, same wallet).
    expect(
      checkSetPayees(stack, [
        { account: HEIR_A, bps: 5_000 },
        { account: HEIR_A, bps: 5_000 },
      ]),
    ).toEqual({ ok: true });
  });
});
