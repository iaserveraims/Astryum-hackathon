/**
 * La puerta del ancla — la regla de CONJUNTO EXACTO del ledger, fijada en seco.
 *
 * rippled (Credentials.cpp `authorized`) busca `keylet::depositPreauth(dst,
 * sortedSet)`: el conjunto {emisor, tipo} que lleva el Payment tiene que ser
 * EXACTAMENTE uno de los DepositPreauth del destino. Lo que se fija aquí:
 *
 *  1. La config de la puerta del gestor (grupos OR) se expande a un objeto por
 *     combinación — no a un objeto con todos los pares (eso sería «AND»).
 *  2. La orden ELIGE el conjunto que el ancla admite: el caso real de rNyre…
 *     (17-sep-2026), que sostiene AIFM+KYC del notario Y un AIFM+KYC que se
 *     emitió a sí misma. Llevarse las 4 era tecNO_PERMISSION; ahora van las 2.
 *  3. La negativa solo existe con la puerta ENCENDIDA y sin conjunto que cubra;
 *     con la puerta apagada, nunca se rehúsa (el ledger no exige nada).
 *  4. El plan de armado: reserva base + 0,2 × objetos, con los números reales
 *     del ancla rLcoFM… el 17-sep (4,000025 XRP, 0 objetos).
 */
import {
  AnchorGateError,
  credentialTypeToHex,
  decideOrderCredentialIds,
  expandGateSets,
  gateDrift,
  gateSetKey,
  parseDepositPreauthObjects,
  planAnchorGateArm,
  selectCredentialIdsForGate,
  type AnchorGateState,
  type HeldCredential,
} from '../XrplAnchorGateService';

const ANCHOR = 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7';
const NOTARY = 'rHKxjrGRrCegQhLrdnXEPAeGyeJ1JR4Hae';
const OTHER_ISSUER = 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG';
const RNYRE = 'rNyrefquhQfqFYwHojT8aHwVPmKtqYZtg8';
const RDCOH = 'rDcohNUmBApE8bSPP695GkUsSMfBeM5Czj';
const OMNIBUS = 'rMB8xNE6XYyg9f6D7vB4LeZLwdVSCQwREf';

const hex = (t: string) => credentialTypeToHex(t);
const id = (c: string) => c.repeat(64);

function held(subject: string, issuer: string, type: string, ledgerIndex: string, state = 'valid'): HeldCredential {
  return { subject, issuer, credentialTypeHex: hex(type), ledgerIndex, state };
}

/** Lo que el ledger decía de rNyre el 17-sep-2026: dos del notario, dos autoemitidas. */
const RNYRE_HELD: HeldCredential[] = [
  held(RNYRE, NOTARY, 'AIFM', id('1')),
  held(RNYRE, RNYRE, 'KYC', id('2')),
  held(RNYRE, RNYRE, 'AIFM', id('3')),
  held(RNYRE, NOTARY, 'KYC', id('4')),
];

const CONFIG_SETS = expandGateSets(['AIFM|CASP', 'KYC|KYB'], [NOTARY]);

describe('1. expandGateSets — un objeto por combinación, nunca uno con todos los pares', () => {
  it('AIFM|CASP,KYC|KYB con un emisor son 4 conjuntos de 2', () => {
    expect(CONFIG_SETS).toHaveLength(4);
    for (const set of CONFIG_SETS) expect(set).toHaveLength(2);
    const keys = CONFIG_SETS.map(gateSetKey);
    expect(keys).toEqual([...keys].sort()); // orden canónico
    expect(keys).toContain(gateSetKey([{ issuer: NOTARY, credentialTypeHex: hex('AIFM') }, { issuer: NOTARY, credentialTypeHex: hex('KYC') }]));
    expect(keys).toContain(gateSetKey([{ issuer: NOTARY, credentialTypeHex: hex('CASP') }, { issuer: NOTARY, credentialTypeHex: hex('KYB') }]));
  });

  it('dos emisores duplican las alternativas de cada grupo (2×2 × 2×2 = 16)', () => {
    expect(expandGateSets(['AIFM|CASP', 'KYC|KYB'], [NOTARY, OTHER_ISSUER])).toHaveLength(16);
  });

  it('un solo tipo y un emisor es un conjunto de uno', () => {
    expect(expandGateSets(['AIFM'], [NOTARY])).toEqual([[{ issuer: NOTARY, credentialTypeHex: hex('AIFM') }]]);
  });

  it('grupos que se solapan colapsan: AIFM,AIFM|KYC no repite el par dentro del conjunto', () => {
    const sets = expandGateSets(['AIFM', 'AIFM|KYC'], [NOTARY]);
    const keys = sets.map(gateSetKey);
    expect(keys).toEqual([
      gateSetKey([{ issuer: NOTARY, credentialTypeHex: hex('AIFM') }]),
      gateSetKey([{ issuer: NOTARY, credentialTypeHex: hex('AIFM') }, { issuer: NOTARY, credentialTypeHex: hex('KYC') }]),
    ]);
  });

  it('sin emisores o sin tipos no hay conjuntos (la puerta no deja pasar a nadie — y se ve)', () => {
    expect(expandGateSets(['AIFM'], [])).toEqual([]);
    expect(expandGateSets([], [NOTARY])).toEqual([]);
    expect(expandGateSets(['', ' | '], [NOTARY])).toEqual([]);
  });
});

describe('2. parseDepositPreauthObjects — el ledger, interpretado', () => {
  it('separa conjuntos por credencial y cuentas; ignora lo ilegible', () => {
    const parsed = parseDepositPreauthObjects([
      {
        LedgerEntryType: 'DepositPreauth',
        AuthorizeCredentials: [
          { Credential: { Issuer: NOTARY, CredentialType: hex('KYC') } },
          { Credential: { Issuer: NOTARY, CredentialType: hex('AIFM').toLowerCase() } },
        ],
      },
      { LedgerEntryType: 'DepositPreauth', Authorize: RDCOH },
      { LedgerEntryType: 'DepositPreauth', AuthorizeCredentials: [{ Credential: { Issuer: 'not-an-address', CredentialType: 'ZZ' } }] },
      { LedgerEntryType: 'Credential', Issuer: NOTARY },
    ]);
    expect(parsed.accounts).toEqual([RDCOH]);
    expect(parsed.credentialSets).toHaveLength(1);
    expect(gateSetKey(parsed.credentialSets[0])).toBe(
      gateSetKey([{ issuer: NOTARY, credentialTypeHex: hex('AIFM') }, { issuer: NOTARY, credentialTypeHex: hex('KYC') }]),
    );
  });
});

describe('3. selectCredentialIdsForGate — el caso real de rNyre', () => {
  it('con 4 credenciales propias elige EXACTAMENTE las 2 del notario que casan con {AIFM,KYC}', () => {
    const pick = selectCredentialIdsForGate(RNYRE, CONFIG_SETS, RNYRE_HELD);
    expect(pick).not.toBeNull();
    expect(pick!.credentialIds.sort()).toEqual([id('1'), id('4')]);
    expect(gateSetKey(pick!.set)).toBe(gateSetKey([{ issuer: NOTARY, credentialTypeHex: hex('AIFM') }, { issuer: NOTARY, credentialTypeHex: hex('KYC') }]));
  });

  it('las credenciales que la cuenta EMITIÓ a otros no cuentan (tecBAD_CREDENTIALS si fueran)', () => {
    const exchangeRoot = 'rwc9DqireGfwcEecBJD8QF41vmA18QN9rR';
    const pick = selectCredentialIdsForGate(exchangeRoot, CONFIG_SETS, [
      held(exchangeRoot, NOTARY, 'CASP', id('A')),
      held(exchangeRoot, NOTARY, 'KYB', id('B')),
      held(OMNIBUS, exchangeRoot, 'KYC-101', id('C')), // emitida al omnibus: no es suya
    ]);
    expect(pick!.credentialIds.sort()).toEqual([id('A'), id('B')]);
  });

  it('una caducada o sin aceptar no cubre; una sin id tampoco', () => {
    expect(selectCredentialIdsForGate(RDCOH, CONFIG_SETS, [held(RDCOH, NOTARY, 'AIFM', id('1'), 'expired'), held(RDCOH, NOTARY, 'KYC', id('2'))])).toBeNull();
    expect(selectCredentialIdsForGate(RDCOH, CONFIG_SETS, [held(RDCOH, NOTARY, 'AIFM', id('1'), 'pending-acceptance'), held(RDCOH, NOTARY, 'KYC', id('2'))])).toBeNull();
    expect(selectCredentialIdsForGate(RDCOH, CONFIG_SETS, [{ ...held(RDCOH, NOTARY, 'AIFM', id('1')), ledgerIndex: null }, held(RDCOH, NOTARY, 'KYC', id('2'))])).toBeNull();
  });

  it('cubrir a medias no vale: AIFM sin KYC ni KYB es null', () => {
    expect(selectCredentialIdsForGate(RDCOH, CONFIG_SETS, [held(RDCOH, NOTARY, 'AIFM', id('1'))])).toBeNull();
  });

  it('prefiere el conjunto más pequeño que cubra (menos formas de caducar a mitad)', () => {
    const sets = [
      [{ issuer: NOTARY, credentialTypeHex: hex('AIFM') }, { issuer: NOTARY, credentialTypeHex: hex('KYC') }],
      [{ issuer: NOTARY, credentialTypeHex: hex('AIFM') }],
    ];
    const pick = selectCredentialIdsForGate(RDCOH, sets, [held(RDCOH, NOTARY, 'AIFM', id('1')), held(RDCOH, NOTARY, 'KYC', id('2'))]);
    expect(pick!.credentialIds).toEqual([id('1')]);
  });
});

describe('4. decideOrderCredentialIds — qué lleva la orden, y cuándo se rehúsa', () => {
  const gateOn: AnchorGateState = { anchor: ANCHOR, depositAuth: true, credentialSets: CONFIG_SETS, accounts: [] };
  const gateOff: AnchorGateState = { ...gateOn, depositAuth: false };
  const noGate: AnchorGateState = { anchor: ANCHOR, depositAuth: false, credentialSets: [], accounts: [] };

  it('puerta encendida + conjunto que cubre → exactamente ese conjunto', () => {
    const d = decideOrderCredentialIds(RNYRE, gateOn, RNYRE_HELD);
    expect(d.reason).toBe('exact-set');
    expect(d.credentialIds.sort()).toEqual([id('1'), id('4')]);
  });

  it('puerta encendida + nadie cubre → NO_MATCHING_TITLE con lo que el ancla admite (antes de firmar)', () => {
    let err: unknown;
    try {
      decideOrderCredentialIds(RDCOH, gateOn, [held(RDCOH, NOTARY, 'AIFM', id('1'))]);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AnchorGateError);
    expect((err as AnchorGateError).code).toBe('NO_MATCHING_TITLE');
    expect((err as Error).message).toMatch(/AIFM from rHKxj/);
    expect((err as Error).message).toMatch(/tecNO_PERMISSION/);
  });

  it('puerta APAGADA + nadie cubre → no se rehúsa: van las propias válidas (el ledger no exige nada)', () => {
    const d = decideOrderCredentialIds(RDCOH, gateOff, [held(RDCOH, NOTARY, 'AIFM', id('1'))]);
    expect(d.reason).toBe('no-gate');
    expect(d.credentialIds).toEqual([id('1')]);
  });

  it('puerta apagada + conjunto que cubre → ya va el exacto (rNyre deja de llevar 4 aunque la puerta aún no exista)', () => {
    const d = decideOrderCredentialIds(RNYRE, gateOff, RNYRE_HELD);
    expect(d.reason).toBe('exact-set');
    expect(d.credentialIds).toHaveLength(2);
  });

  it('ancla sin conjuntos publicados → todas las propias válidas, como siempre', () => {
    const d = decideOrderCredentialIds(RNYRE, noGate, RNYRE_HELD);
    expect(d.reason).toBe('no-gate');
    expect(d.credentialIds).toHaveLength(4);
  });

  it('ancla ilegible (null) → mismo fallback, marcado como unverified', () => {
    const d = decideOrderCredentialIds(RNYRE, null, RNYRE_HELD);
    expect(d.reason).toBe('unverified');
    expect(d.credentialIds).toHaveLength(4);
  });

  it('cuenta preautorizada directamente → sin CredentialIDs (no hacen falta)', () => {
    const d = decideOrderCredentialIds(RDCOH, { ...gateOn, accounts: [RDCOH] }, []);
    expect(d.reason).toBe('preauthorized-account');
    expect(d.credentialIds).toEqual([]);
  });

  it('ajenas nunca: la raíz del exchange no se lleva los KYC que emitió al omnibus', () => {
    const root = 'rwc9DqireGfwcEecBJD8QF41vmA18QN9rR';
    const d = decideOrderCredentialIds(root, noGate, [held(root, NOTARY, 'CASP', id('A')), held(OMNIBUS, root, 'KYC-101', id('C'))]);
    expect(d.credentialIds).toEqual([id('A')]);
  });
});

describe('5. gateDrift y planAnchorGateArm — config vs ledger, y la reserva', () => {
  const empty: AnchorGateState = { anchor: ANCHOR, depositAuth: false, credentialSets: [], accounts: [] };

  it('deriva: todo falta en un ancla vacía; nada sobra', () => {
    const d = gateDrift(CONFIG_SETS, []);
    expect(d.missing).toHaveLength(4);
    expect(d.extra).toHaveLength(0);
  });

  it('el ancla rLcoFM el 17-sep (4,000025 XRP, 0 objetos): 4 objetos + flag, reserva 1,8, sin déficit', () => {
    const plan = planAnchorGateArm({ state: empty, configSets: CONFIG_SETS, balanceXrp: 4.000025, ownerCount: 0, baseReserveXrp: 1, ownerReserveXrp: 0.2 });
    expect(plan.toAuthorize).toHaveLength(4);
    expect(plan.setFlag).toBe(true);
    expect(plan.reserveAfterXrp).toBeCloseTo(1.8, 6);
    expect(plan.shortfallXrp).toBe(0);
    expect(plan.alreadyArmed).toBe(false);
  });

  it('con 1,5 XRP faltan 0,31 (1,8 + 0,01 de fees − 1,5) y el plan lo dice', () => {
    const plan = planAnchorGateArm({ state: empty, configSets: CONFIG_SETS, balanceXrp: 1.5, ownerCount: 0, baseReserveXrp: 1, ownerReserveXrp: 0.2 });
    expect(plan.shortfallXrp).toBeCloseTo(0.31, 6);
  });

  it('idempotente: con los 4 conjuntos y el flag puestos no hay nada que mandar', () => {
    const armed: AnchorGateState = { anchor: ANCHOR, depositAuth: true, credentialSets: CONFIG_SETS, accounts: [] };
    const plan = planAnchorGateArm({ state: armed, configSets: CONFIG_SETS, balanceXrp: 2, ownerCount: 4, baseReserveXrp: 1, ownerReserveXrp: 0.2 });
    expect(plan.toAuthorize).toEqual([]);
    expect(plan.setFlag).toBe(false);
    expect(plan.alreadyArmed).toBe(true);
  });

  it('a medias (2 de 4 conjuntos, flag apagado): manda solo los 2 que faltan y el flag', () => {
    const half: AnchorGateState = { anchor: ANCHOR, depositAuth: false, credentialSets: CONFIG_SETS.slice(0, 2), accounts: [] };
    const plan = planAnchorGateArm({ state: half, configSets: CONFIG_SETS, balanceXrp: 4, ownerCount: 2, baseReserveXrp: 1, ownerReserveXrp: 0.2 });
    expect(plan.toAuthorize.map(gateSetKey)).toEqual(CONFIG_SETS.slice(2).map(gateSetKey));
    expect(plan.setFlag).toBe(true);
    expect(plan.reserveAfterXrp).toBeCloseTo(1.8, 6);
  });
});
