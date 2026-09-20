import {
  assessStructureAuthority,
  canCloseStructureDoor,
  planBirthReserve,
  planStructureBirth,
  type StructureBirthInput,
  type StructureSeat,
} from '../XrplStructureBirth';

const ROOT = 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH'; // la cuenta PERSONAL, la que manda
const FUNDER = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe'; // la caja que patrocina (omnibus)
const STRUCT = 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY'; // la cuenta comandada que nace
const KID = 'rsuHaTvJh1bDmDoxX9QcKP7HThk8NJQTNb';
const SPOUSE = 'rK4tsuHUu9M5WxqbvGGLaXRHbQ9YqmXqPS';
const OPERATOR = 'rDcohDbBFvNCwXvNEaJDpJmsrYRdAAZFjq';

/** Cifras de mainnet, verificadas en xrpl.org. */
const RESERVE = { baseXrp: 1, incrementXrp: 0.2 };

function seat(account: string, weight: number, holder: StructureSeat['holder']): StructureSeat {
  return { account, weight, holder };
}

/** Por defecto: la personal manda SOLA — la «subwallet» en el sentido llano. */
function input(over: Partial<StructureBirthInput> = {}): StructureBirthInput {
  return {
    kind: 'family',
    governance: 'sole',
    rootAddress: ROOT,
    funderAddress: FUNDER,
    structureAddress: STRUCT,
    seats: [seat(ROOT, 1, 'root')],
    quorum: 1,
    reserve: RESERVE,
    designation: true,
    paysThroughCredentialGate: false,
    carriesOwnCredentials: false,
    armAnchorGate: false,
    receivesThirdPartyReturns: true,
    ...over,
  };
}

/** Un consejo de familia: la personal es UNO de tres, quórum 2. */
function shared(over: Partial<StructureBirthInput> = {}): StructureBirthInput {
  return input({
    governance: 'shared',
    seats: [seat(ROOT, 1, 'root'), seat(SPOUSE, 1, 'member'), seat(KID, 1, 'member')],
    quorum: 2,
    ...over,
  });
}

function codes(plan: ReturnType<typeof planStructureBirth>): string[] {
  return plan.refusals.map((r) => r.code);
}

describe('assessStructureAuthority — quién puede mover esta cuenta, en aritmética', () => {
  test('una sola personal sentada con quórum 1: manda sola', () => {
    const a = assessStructureAuthority([seat(ROOT, 1, 'root')], 1);
    expect(a.rootWeight).toBe(1);
    expect(a.rootAloneBinds).toBe(true);
    expect(a.membersBindWithoutRoot).toBe(false);
    expect(a.operatorAloneBinds).toBe(false);
  });

  test('consejo de tres con quórum 2: la personal NO manda sola, y los otros dos sí pueden sin ella', () => {
    const a = assessStructureAuthority([seat(ROOT, 1, 'root'), seat(SPOUSE, 1, 'member'), seat(KID, 1, 'member')], 2);
    expect(a.rootAloneBinds).toBe(false);
    expect(a.membersBindWithoutRoot).toBe(true); // continuidad: la familia sigue sin el titular
    expect(a.quorumMargin).toBe(1);
  });

  test('un tercero con peso de quórum obliga solo — esa es la línea de la custodia', () => {
    const a = assessStructureAuthority([seat(OPERATOR, 2, 'operator'), seat(ROOT, 1, 'root')], 2);
    expect(a.operatorAloneBinds).toBe(true);
    expect(a.rootAloneBinds).toBe(false);
  });

  test('sin margen de quórum la puerta no se puede cerrar', () => {
    expect(assessStructureAuthority([seat(ROOT, 1, 'root'), seat(SPOUSE, 1, 'member')], 2).canCloseDoor).toBe(false);
  });

  /**
   * EL HALLAZGO QUE IMPORTA: la forma más simple del modelo — una
   * personal sentada SOLA, quórum 1 — tiene margen 0, así que su puerta NO se
   * puede cerrar. Y es correcto: con la master desactivada y un único asiento,
   * perder la llave de la personal deja esa cuenta muerta con su dinero dentro.
   * O se deja la master viva (y entonces la cuenta no está del todo comandada),
   * o se sienta un segundo asiento de respaldo.
   */
  test('una personal sentada SOLA tiene margen 0: manda, pero su puerta no se cierra', () => {
    const solo = assessStructureAuthority([seat(ROOT, 1, 'root')], 1);
    expect(solo.rootAloneBinds).toBe(true);
    expect(solo.quorumMargin).toBe(0);
    expect(solo.canCloseDoor).toBe(false);
  });

  test('con un asiento de respaldo, la personal sigue mandando sola Y la puerta se puede cerrar', () => {
    const backed = assessStructureAuthority([seat(ROOT, 1, 'root'), seat(SPOUSE, 1, 'member')], 1);
    expect(backed.rootAloneBinds).toBe(true);
    expect(backed.quorumMargin).toBe(1);
    expect(backed.canCloseDoor).toBe(true);
  });

  test('un quórum inalcanzable no se lee como «obliga cualquiera»', () => {
    const a = assessStructureAuthority([seat(ROOT, 1, 'root')], 5);
    expect(a.rootAloneBinds).toBe(false);
    expect(a.operatorAloneBinds).toBe(false);
    expect(a.canCloseDoor).toBe(false);
  });
});

describe('planStructureBirth — el árbol es del usuario', () => {
  test('la subwallet llana se admite: una personal sentada sola, quórum 1', () => {
    const plan = planStructureBirth(input());
    expect(plan.refusals).toEqual([]);
    expect(plan.ok).toBe(true);
    expect(plan.authority.rootAloneBinds).toBe(true);
  });

  test('el consejo de familia también, con la personal como uno de tres', () => {
    const plan = planStructureBirth(shared());
    expect(plan.refusals).toEqual([]);
    expect(plan.authority.rootAloneBinds).toBe(false);
    expect(plan.authority.quorumMargin).toBe(1);
  });

  test('si la personal no se sienta, no comanda nada', () => {
    const plan = planStructureBirth(
      input({ governance: 'shared', seats: [seat(SPOUSE, 1, 'member'), seat(KID, 1, 'member')], quorum: 2 }),
    );
    expect(codes(plan)).toContain('ROOT_HAS_NO_SEAT');
  });

  test('el asiento marcado como personal tiene que ser LA personal declarada', () => {
    const plan = planStructureBirth(input({ seats: [seat(SPOUSE, 1, 'root')] }));
    expect(codes(plan)).toContain('ROOT_HAS_NO_SEAT');
  });

  test('declarar «manda sola» cuando no alcanza el quórum se rehúsa con las dos cifras', () => {
    const plan = planStructureBirth(
      input({ governance: 'sole', seats: [seat(ROOT, 1, 'root'), seat(SPOUSE, 1, 'member')], quorum: 2 }),
    );
    expect(codes(plan)).toContain('ROOT_CANNOT_BIND_ALONE');
    expect(plan.refusals.find((r) => r.code === 'ROOT_CANNOT_BIND_ALONE')!.reason).toMatch(/suman 1/);
  });

  test('declarar gobierno compartido cuando la personal alcanza el quórum sola también se rehúsa', () => {
    const plan = planStructureBirth(
      shared({ seats: [seat(ROOT, 2, 'root'), seat(SPOUSE, 1, 'member')], quorum: 2 }),
    );
    expect(codes(plan)).toContain('ROOT_BINDS_ALONE');
  });

  test('un tercero que alcanza el quórum se rehúsa — salvo que se declare a propósito', () => {
    const seats = [seat(ROOT, 1, 'root'), seat(OPERATOR, 2, 'operator')];
    expect(codes(planStructureBirth(input({ governance: 'shared', seats, quorum: 2 })))).toContain('OPERATOR_REACHES_QUORUM');
    const declared = planStructureBirth(input({ governance: 'shared', seats, quorum: 2, operatorMayBind: true }));
    expect(codes(declared)).not.toContain('OPERATOR_REACHES_QUORUM');
  });

  test('una casilla no es una cuenta: planificar su nacimiento es una negativa', () => {
    expect(codes(planStructureBirth(input({ kind: 'box' })))).toContain('BOX_IS_NOT_AN_ACCOUNT');
  });

  test('la comandada no puede sentarse en su propia lista', () => {
    const plan = planStructureBirth(
      input({ governance: 'shared', seats: [seat(ROOT, 1, 'root'), seat(STRUCT, 1, 'member')], quorum: 2 }),
    );
    expect(codes(plan)).toContain('SEAT_IS_THE_STRUCTURE');
  });

  test('asientos repetidos, pesos imposibles, quórum inalcanzable y direcciones falsas se dicen por separado', () => {
    expect(codes(planStructureBirth(input({ seats: [seat(ROOT, 1, 'root'), seat(ROOT, 1, 'root')] })))).toContain('DUPLICATE_SEAT');
    expect(codes(planStructureBirth(input({ seats: [seat(ROOT, 0, 'root')] })))).toContain('BAD_SEAT');
    expect(codes(planStructureBirth(input({ quorum: 99 })))).toContain('QUORUM_UNREACHABLE');
    expect(codes(planStructureBirth(input({ quorum: 0 })))).toContain('BAD_QUORUM');
    expect(codes(planStructureBirth(input({ seats: [] })))).toContain('NO_SEATS');
    expect(codes(planStructureBirth(input({ seats: [seat('not-an-address', 1, 'root')] })))).toContain('BAD_SEAT');
  });
});

describe('PlanStructureBirth — el hallazgo: la credencial la lleva QUIEN ENVÍA', () => {
  test('una comandada que paga por sí misma a un destino con puerta, sin credenciales propias, se rehúsa', () => {
    const plan = planStructureBirth(input({ paysThroughCredentialGate: true, carriesOwnCredentials: false }));
    expect(codes(plan)).toContain('COMMANDED_PAYS_THROUGH_GATE');
    // Y dice por qué firmar desde la personal no lo arregla.
    expect(plan.refusals.find((r) => r.code === 'COMMANDED_PAYS_THROUGH_GATE')!.reason).toMatch(/el que envía sigue siendo ella/);
  });

  test('con credenciales propias, la misma cuenta pasa', () => {
    const plan = planStructureBirth(input({ paysThroughCredentialGate: true, carriesOwnCredentials: true }));
    expect(codes(plan)).not.toContain('COMMANDED_PAYS_THROUGH_GATE');
    expect(plan.ok).toBe(true);
  });

  test('si no paga por sí misma (paga la personal), no hace falta credencial propia', () => {
    const plan = planStructureBirth(input({ paysThroughCredentialGate: false, carriesOwnCredentials: false }));
    expect(codes(plan)).not.toContain('COMMANDED_PAYS_THROUGH_GATE');
  });

  test('un agente o una casilla jamás llevan credencial propia: heredan de la raíz', () => {
    expect(codes(planStructureBirth(input({ kind: 'agent', carriesOwnCredentials: true })))).toContain('COMPLIANCE_ON_CAPTIVE');
    expect(codes(planStructureBirth(input({ kind: 'enterprise', carriesOwnCredentials: true })))).not.toContain('COMPLIANCE_ON_CAPTIVE');
  });

  test('armar la puerta sobre una cuenta que recibe la vuelta de un tercero es una negativa', () => {
    expect(codes(planStructureBirth(input({ armAnchorGate: true, receivesThirdPartyReturns: true })))).toContain('GATE_WOULD_BLOCK_RETURNS');
    expect(codes(planStructureBirth(input({ armAnchorGate: true, receivesThirdPartyReturns: false })))).not.toContain('GATE_WOULD_BLOCK_RETURNS');
  });
});

describe('planStructureBirth — avisos: verdades que cuesta saber tarde, pero no paran nada', () => {
  function noteCodes(plan: ReturnType<typeof planStructureBirth>): string[] {
    return plan.notes.map((n) => n.code);
  }

  test('quien paga el nacimiento no gana ningún poder, y se dice', () => {
    const plan = planStructureBirth(input());
    expect(noteCodes(plan)).toContain('FUNDING_GIVES_NO_POWER');
    expect(plan.notes.find((n) => n.code === 'FUNDING_GIVES_NO_POWER')!.text).toContain(FUNDER);
  });

  test('si la caja además se sienta, ya no hace falta aclararlo', () => {
    const plan = planStructureBirth(
      input({
        governance: 'shared',
        seats: [seat(ROOT, 1, 'root'), seat(FUNDER, 1, 'operator'), seat(SPOUSE, 1, 'member')],
        quorum: 2,
      }),
    );
    expect(noteCodes(plan)).not.toContain('FUNDING_GIVES_NO_POWER');
  });

  test('la ventana de la llave de nacimiento se avisa SIEMPRE', () => {
    expect(noteCodes(planStructureBirth(input()))).toContain('BIRTH_KEY_WINDOW');
    expect(noteCodes(planStructureBirth(shared()))).toContain('BIRTH_KEY_WINDOW');
  });

  test('un asiento que no es cuenta se nombra, con su contrapartida', () => {
    const plan = planStructureBirth(
      shared({ seatsFunded: { [ROOT]: true, [SPOUSE]: false, [KID]: true } }),
    );
    const note = plan.notes.find((n) => n.code === 'UNFUNDED_SEATS')!;
    expect(note.text).toContain(SPOUSE);
    expect(note.text).toMatch(/no cuestan reserva/);
    expect(note.text).toMatch(/no se pueden rotar/);
  });

  test('sin lectura del ledger no se afirma que un asiento no exista', () => {
    expect(noteCodes(planStructureBirth(shared()))).not.toContain('UNFUNDED_SEATS');
  });

  test('el caso de un solo asiento avisa de que su puerta no se podrá cerrar', () => {
    const plan = planStructureBirth(input());
    expect(plan.ok).toBe(true); // se puede constituir…
    expect(noteCodes(plan)).toContain('SOLE_SEAT_NO_DOOR'); // …pero se dice antes de empezar
  });

  test('con respaldo, ese aviso desaparece', () => {
    const plan = planStructureBirth(input({ seats: [seat(ROOT, 1, 'root'), seat(SPOUSE, 1, 'member')], quorum: 1 }));
    expect(noteCodes(plan)).not.toContain('SOLE_SEAT_NO_DOOR');
  });

  test('una personal que aún no existe en el ledger puede SENTARSE pero no EMITIR', () => {
    expect(codes(planStructureBirth(input({ designation: true, rootFunded: false })))).toContain('ROOT_NOT_ON_LEDGER');
    expect(codes(planStructureBirth(input({ designation: false, rootFunded: false })))).not.toContain('ROOT_NOT_ON_LEDGER');
    // Y «no se pudo leer» jamás es «no existe».
    expect(codes(planStructureBirth(input({ designation: true })))).not.toContain('ROOT_NOT_ON_LEDGER');
  });
});

describe('planStructureBirth — el orden de la ceremonia (la puerta va última o brickea la cuenta)', () => {
  test('la puerta espera al ensayo Y a la designación, y se marca irreversible', () => {
    const plan = planStructureBirth(input());
    expect(plan.steps.map((s) => s.id)).toEqual(['fund', 'constitute', 'rehearse', 'designate', 'close-door']);
    const door = plan.steps.find((s) => s.id === 'close-door')!;
    expect(door.after).toEqual(['rehearse', 'designate']);
    expect(door.irreversible).toBe(true);
    // Solo la master puede desactivarse a sí misma: un multifirma da tecNEED_MASTER_KEY.
    expect(door.signer).toBe('structure-master');
    expect(door.tx).toBe('AccountSet');
  });

  test('sin designación la puerta espera solo al ensayo', () => {
    const plan = planStructureBirth(input({ designation: false }));
    expect(plan.steps.map((s) => s.id)).toEqual(['fund', 'constitute', 'rehearse', 'close-door']);
    expect(plan.steps.find((s) => s.id === 'close-door')!.after).toEqual(['rehearse']);
  });

  test('la lista de firmantes se pone ANTES de la puerta: el quórum ya puede recuperar la reserva', () => {
    const plan = planStructureBirth(input());
    const constitute = plan.steps.findIndex((s) => s.id === 'constitute');
    expect(constitute).toBeLessThan(plan.steps.findIndex((s) => s.id === 'close-door'));
    expect(plan.steps[constitute].after).toEqual(['fund']);
    expect(plan.steps[constitute].signer).toBe('structure-master');
  });

  test('la reserva la patrocina la caja, y la designación la firma la personal', () => {
    const plan = planStructureBirth(input());
    expect(plan.steps.find((s) => s.id === 'fund')!.signer).toBe('funder');
    expect(plan.steps.find((s) => s.id === 'designate')!.signer).toBe('root');
  });
});

describe('planBirthReserve — la cifra que evita tecINSUFFICIENT_RESERVE a mitad de ceremonia', () => {
  test('con designación: base + (SignerList + credencial + escrow + margen) × incremento + bloqueo + comisiones', () => {
    const r = planBirthReserve({ reserve: RESERVE, seatCount: 3, designation: true });
    expect(r.standingObjects).toBe(2);
    expect(r.transientObjects).toBe(1);
    // 1 + (2 + 1 + 2) × 0,2 + 1 + 0,16 = 3,16
    expect(r.feeHeadroomXrp).toBeCloseTo(0.16, 6);
    expect(r.fundingXrp).toBeCloseTo(3.16, 6);
  });

  test('sin designación la comandada sostiene un objeto menos', () => {
    const withIt = planBirthReserve({ reserve: RESERVE, seatCount: 3, designation: true });
    const without = planBirthReserve({ reserve: RESERVE, seatCount: 3, designation: false });
    expect(without.standingObjects).toBe(1);
    expect(withIt.fundingXrp - without.fundingXrp).toBeCloseTo(0.2, 6);
  });

  test('una subwallet de un solo asiento es la más barata, y aun así lleva margen', () => {
    const r = planBirthReserve({ reserve: RESERVE, seatCount: 1, designation: false });
    expect(r.fundingXrp).toBeGreaterThan(RESERVE.baseXrp + RESERVE.incrementXrp);
  });

  test('deshacerla destruye una reserva de objeto y devuelve el resto', () => {
    const r = planBirthReserve({ reserve: RESERVE, seatCount: 3, designation: true });
    expect(r.unrecoverableXrp).toBeCloseTo(0.2, 6);
    expect(r.recoverableXrp).toBeCloseTo(r.fundingXrp - 0.2 - r.feeHeadroomXrp, 6);
  });

  test('las comisiones crecen con los asientos (el multifirma paga por firmante)', () => {
    const small = planBirthReserve({ reserve: RESERVE, seatCount: 2, designation: false });
    const big = planBirthReserve({ reserve: RESERVE, seatCount: 12, designation: false });
    expect(big.feeHeadroomXrp).toBeGreaterThan(small.feeHeadroomXrp);
  });

  test('sin las cifras del ledger no se inventa una reserva', () => {
    expect(() => planBirthReserve({ reserve: { baseXrp: 0, incrementXrp: 0.2 }, seatCount: 2, designation: false })).toThrow(/reserve figures/);
    expect(() => planBirthReserve({ reserve: { baseXrp: 1, incrementXrp: NaN }, seatCount: 2, designation: false })).toThrow(/reserve figures/);
  });
});

describe('canCloseStructureDoor — la puerta solo se ofrece cuando ya no puede brickear nada', () => {
  const authority = assessStructureAuthority([seat(ROOT, 1, 'root'), seat(SPOUSE, 1, 'member'), seat(KID, 1, 'member')], 2);

  test('con lista, margen y ensayo pasado: se ofrece', () => {
    expect(canCloseStructureDoor({ authority, rehearsalComplete: true, hasSignerList: true })).toEqual({ allowed: true });
  });

  test('sin lista en el ledger: no', () => {
    const v = canCloseStructureDoor({ authority, rehearsalComplete: true, hasSignerList: false });
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/todavía no está en el ledger/);
  });

  test('sin ensayo: no', () => {
    const v = canCloseStructureDoor({ authority, rehearsalComplete: false, hasSignerList: true });
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/firmar cada asiento una vez en cadena/);
  });

  test('con quórum exacto: no, y dice por qué', () => {
    const exact = assessStructureAuthority([seat(ROOT, 1, 'root'), seat(SPOUSE, 1, 'member')], 2);
    const v = canCloseStructureDoor({ authority: exact, rehearsalComplete: true, hasSignerList: true });
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/no tiene margen/);
  });
});
