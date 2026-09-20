import { planStructureBirth, type StructureBirthInput } from '../../../connectors/protocols/xrpl/XrplStructureBirth';
import {
  findStructure,
  nextStructureId,
  stepBlockedBy,
  stepsDone,
  structureByAddress,
  structureProgress,
  structuresOf,
  type DemoStructure,
} from '../structures';

const ROOT = 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH'; // la cuenta PERSONAL
const FUNDER = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe'; // la caja que patrocina
const STRUCT = 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY'; // la comandada
const SPOUSE = 'rsuHaTvJh1bDmDoxX9QcKP7HThk8NJQTNb';
const KID = 'rK4tsuHUu9M5WxqbvGGLaXRHbQ9YqmXqPS';

function birth(over: Partial<StructureBirthInput> = {}): StructureBirthInput {
  return {
    kind: 'family',
    governance: 'shared',
    rootAddress: ROOT,
    funderAddress: FUNDER,
    structureAddress: STRUCT,
    seats: [
      { account: ROOT, weight: 1, holder: 'root' },
      { account: SPOUSE, weight: 1, holder: 'member' },
      { account: KID, weight: 1, holder: 'member' },
    ],
    quorum: 2,
    reserve: { baseXrp: 1, incrementXrp: 0.2 },
    designation: true,
    paysThroughCredentialGate: false,
    carriesOwnCredentials: false,
    armAnchorGate: false,
    receivesThirdPartyReturns: true,
    ...over,
  };
}

function structure(steps: Array<[DemoStructure['steps'][number]['step'], string]> = []): DemoStructure {
  return {
    id: 'st-1-1',
    runId: 'run-1',
    label: 'Familia de prueba',
    kind: 'family',
    governance: 'shared',
    rootAddress: ROOT,
    address: STRUCT,
    seats: birth().seats,
    quorum: 2,
    designation: true,
    paysThroughCredentialGate: false,
    carriesOwnCredentials: false,
    fundingXrp: 3.16,
    steps: steps.map(([step, txHash]) => ({ step, txHash, at: '2026-09-18T00:00:00.000Z' })),
    createdAt: '2026-09-18T00:00:00.000Z',
  };
}

describe('stepBlockedBy — la puerta no se compone antes de tiempo', () => {
  const plan = planStructureBirth(birth());

  test('el plan de referencia son cinco pasos', () => {
    expect(plan.ok).toBe(true);
    expect(plan.steps.map((s) => s.id)).toEqual(['fund', 'constitute', 'rehearse', 'designate', 'close-door']);
  });

  test('recién declarada solo se puede componer el patrocinio', () => {
    const s = structure();
    expect(stepBlockedBy(plan, s, 'fund').missing).toEqual([]);
    expect(stepBlockedBy(plan, s, 'constitute').missing).toEqual(['fund']);
    expect(stepBlockedBy(plan, s, 'close-door').missing).toEqual(['rehearse', 'designate']);
  });

  test('la puerta sigue bloqueada mientras falte UNO de sus previos, y lo nombra', () => {
    const s = structure([
      ['fund', 'H1'],
      ['constitute', 'H2'],
      ['rehearse', 'H3'],
    ]);
    const block = stepBlockedBy(plan, s, 'close-door');
    expect(block.missing).toEqual(['designate']);
    expect(block.reason).toMatch(/designate/);
    // Y avisa de que este paso no se deshace.
    expect(block.reason).toMatch(/cannot be undone/i);
  });

  test('con todos los previos validados la puerta se abre a composición', () => {
    const s = structure([
      ['fund', 'H1'],
      ['constitute', 'H2'],
      ['rehearse', 'H3'],
      ['designate', 'H4'],
    ]);
    expect(stepBlockedBy(plan, s, 'close-door')).toEqual({ missing: [], alreadyDone: false, notInPlan: false });
  });

  test('un paso ya validado no se vuelve a componer', () => {
    const s = structure([['fund', 'H1']]);
    const block = stepBlockedBy(plan, s, 'fund');
    expect(block.alreadyDone).toBe(true);
    expect(block.reason).toMatch(/already validated/i);
  });

  test('un paso que no está en el plan se rehúsa diciendo cuál es el plan', () => {
    const noDesignation = planStructureBirth(birth({ designation: false }));
    const block = stepBlockedBy(noDesignation, structure(), 'designate');
    expect(block.notInPlan).toBe(true);
    expect(block.reason).toMatch(/fund → constitute → rehearse → close-door/);
  });

  test('un registro sin hash no cuenta como validado', () => {
    const s = structure();
    s.steps = [{ step: 'fund', txHash: '', at: '2026-09-18T00:00:00.000Z' }];
    expect(stepsDone(s).has('fund')).toBe(false);
    expect(stepBlockedBy(plan, s, 'constitute').missing).toEqual(['fund']);
  });
});

describe('structureProgress — qué toca ahora', () => {
  const plan = planStructureBirth(birth());

  test('sin pasos, el siguiente es el patrocinio', () => {
    expect(structureProgress(plan, structure())).toEqual({ done: [], next: 'fund', total: 5 });
  });

  test('tras constituir, el siguiente desbloqueado es el ensayo', () => {
    const p = structureProgress(plan, structure([['fund', 'H1'], ['constitute', 'H2']]));
    expect(p.done).toEqual(['fund', 'constitute']);
    expect(p.next).toBe('rehearse');
  });

  test('con todo hecho no hay siguiente', () => {
    const p = structureProgress(
      plan,
      structure([
        ['fund', 'H1'],
        ['constitute', 'H2'],
        ['rehearse', 'H3'],
        ['designate', 'H4'],
        ['close-door', 'H5'],
      ]),
    );
    expect(p.next).toBeNull();
    expect(p.done).toHaveLength(5);
  });
});

describe('registro — punteros, jamás estado', () => {
  test('structuresOf crea la lista una sola vez', () => {
    const run: { structures?: DemoStructure[] } = {};
    const a = structuresOf(run);
    a.push(structure());
    expect(structuresOf(run)).toHaveLength(1);
  });

  test('se encuentra por id y por dirección', () => {
    const run = { structures: [structure()] };
    expect(findStructure(run, 'st-1-1')?.address).toBe(STRUCT);
    expect(structureByAddress(run, STRUCT)?.id).toBe('st-1-1');
    expect(structureByAddress(run, ROOT)).toBeUndefined();
  });

  test('el id lleva la secuencia del tenant y el ordinal', () => {
    expect(nextStructureId({ seq: 7, structures: [] })).toBe('st-7-1');
    expect(nextStructureId({ seq: 7, structures: [structure()] })).toBe('st-7-2');
  });
});
