/**
 * El nacimiento del pote — lógica pura, sin red.
 *
 * Lo que se fija: los params eternos se validan ANTES de gastar gas (la regla
 * de elegibilidad I4 por tipo incluida), el batch compone las tres llamadas en
 * orden (create → approve → deposit ERC-4626 con el consejo como receiver), y
 * el depósito génesis es la defensa de inflación (Z10), no un detalle.
 */

import { ethers } from 'ethers';
import {
  buildPoteCreationBatch,
  poteParamsFor,
  PoteCreationError,
  POTE_B_COOLDOWN_SECONDS,
  POTE_VENUE_KIND,
  validatePoteParams,
  type PoteCreationParams,
} from '../AstryumPoteCreationService';

const REF = '0x' + '11'.repeat(32);
const FACTORY = '0xface00fe00000000000000000000000000000001';
const COUNCIL_R = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const COUNCIL_PA = '0xc0c0000000000000000000000000000000000001';
const PREDICTED_VAULT = '0x1a11000000000000000000000000000000000001';
const KINETIC = '0xD1b7A5eFa9bd88F291F7A4563a8f6185c0249CB3';
const FIRELIGHT = '0x4C18Ff3C89632c3Dd62E796c0aFA5c07c4c1B2b3';
const FXRP = '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE';

beforeEach(() => {
  process.env.FXRP_TOKEN = FXRP;
});
afterEach(() => {
  delete process.env.FXRP_TOKEN;
});

function poteA(): PoteCreationParams {
  return {
    name: 'Astryum Pote A',
    symbol: 'apA-FXRP',
    constitutionRef: REF,
    cooldownSeconds: 0,
    bufferFloorBps: 1000,
    initialVenues: [{ target: KINETIC, kind: POTE_VENUE_KIND.COMPOUND_V2, label: 'Kinetic' }],
  };
}

function poteB(): PoteCreationParams {
  return {
    name: 'Astryum Pote B',
    symbol: 'apB-FXRP',
    constitutionRef: REF,
    cooldownSeconds: POTE_B_COOLDOWN_SECONDS,
    bufferFloorBps: 1000,
    initialVenues: [{ target: FIRELIGHT, kind: POTE_VENUE_KIND.ERC4626_QUEUED, label: 'Firelight' }],
  };
}

describe('validatePoteParams — la elegibilidad I4 se comprueba antes de gastar gas', () => {
  it('acepta los dos potes bien formados', () => {
    expect(() => validatePoteParams(poteA())).not.toThrow();
    expect(() => validatePoteParams(poteB())).not.toThrow();
  });

  it('rechaza un venue encolado en un pote de salida inmediata (I4 por tipo)', () => {
    const bad = poteA();
    bad.initialVenues = [{ target: FIRELIGHT, kind: POTE_VENUE_KIND.ERC4626_QUEUED, label: 'Firelight' }];
    expect(() => validatePoteParams(bad)).toThrow(/QUEUED_NEEDS_COOLDOWN|cooldown/);
  });

  it('rechaza un venue encolado con cooldown > 0 pero MENOR que la cola de salida', () => {
    // El footgun real: cooldown>0 (pasa el check del contrato) pero más corto que
    // la cola de Firelight → el ticket madura antes de que drene la cola y
    // claimRedeem revierte. El guardarraíl lo caza antes de firmar.
    const bad = poteB();
    bad.cooldownSeconds = 24 * 3600; // 24h < 72h
    let code = '';
    try {
      validatePoteParams(bad);
    } catch (e) {
      code = (e as PoteCreationError).code;
    }
    expect(code).toBe('QUEUED_NEEDS_COOLDOWN');
  });

  it('rechaza ref no-SHA256, cooldown fuera de rango y cero venues', () => {
    expect(() => validatePoteParams({ ...poteA(), constitutionRef: '0xabc' })).toThrow(PoteCreationError);
    expect(() => validatePoteParams({ ...poteB(), cooldownSeconds: 40 * 24 * 3600 })).toThrow(/2592000/);
    expect(() => validatePoteParams({ ...poteA(), initialVenues: [] })).toThrow(/al menos un venue/);
    // …y el código tipado, para el consumidor que discrimina por code.
    try {
      validatePoteParams({ ...poteA(), initialVenues: [] });
      throw new Error('unreachable');
    } catch (e) {
      expect((e as PoteCreationError).code).toBe('NO_VENUES');
    }
  });
});

describe('poteParamsFor — los dos potes del rodaje', () => {
  beforeEach(() => {
    process.env.KINETIC_KFXRP_ISO = KINETIC;
    process.env.FIRELIGHT_STXRP = FIRELIGHT;
  });
  afterEach(() => {
    delete process.env.KINETIC_KFXRP_ISO;
    delete process.env.FIRELIGHT_STXRP;
  });

  it('A es Kinetic + salida inmediata; B es Firelight + 72h', () => {
    const a = poteParamsFor('A', REF);
    expect(a.cooldownSeconds).toBe(0);
    expect(a.initialVenues[0].kind).toBe(POTE_VENUE_KIND.COMPOUND_V2);
    const b = poteParamsFor('B', REF);
    expect(b.cooldownSeconds).toBe(POTE_B_COOLDOWN_SECONDS);
    // El pote B lleva DOS venues: Kinetic (síncrono) + Firelight (encolado) —
    // el operador reparte el capital entre ambos dentro del mismo pote.
    expect(b.initialVenues).toHaveLength(2);
    expect(b.initialVenues.map((v) => v.kind).sort()).toEqual(
      [POTE_VENUE_KIND.COMPOUND_V2, POTE_VENUE_KIND.ERC4626_QUEUED].sort()
    );
  });
});

describe('buildPoteCreationBatch — create → approve → deposit(assets, receiver)', () => {
  it('compone las tres llamadas en orden, el génesis va al consejo (Z10)', () => {
    const genesisUBA = 100_000_000n; // 100 FXRP
    const batch = buildPoteCreationBatch({
      factoryAddress: FACTORY,
      councilR: COUNCIL_R,
      councilPersonalAccount: COUNCIL_PA,
      params: poteA(),
      predictedVault: PREDICTED_VAULT,
      genesisUBA,
    });

    expect(batch).toHaveLength(3);
    // 1) create sobre la factory
    expect(batch[0].to.toLowerCase()).toBe(FACTORY.toLowerCase());
    // 2) approve del FXRP hacia el pote predicho
    expect(batch[1].to.toLowerCase()).toBe(FXRP.toLowerCase());
    const approve = new ethers.Interface(['function approve(address,uint256)']).decodeFunctionData(
      'approve',
      batch[1].calldata
    );
    expect(approve[0].toLowerCase()).toBe(PREDICTED_VAULT.toLowerCase());
    expect(approve[1]).toBe(genesisUBA);
    // 3) deposit(assets, receiver=consejo) — ERC-4626, receiver = la PA (Z10)
    expect(batch[2].to.toLowerCase()).toBe(PREDICTED_VAULT.toLowerCase());
    const deposit = new ethers.Interface(['function deposit(uint256,address)']).decodeFunctionData(
      'deposit',
      batch[2].calldata
    );
    expect(deposit[0]).toBe(genesisUBA);
    expect(deposit[1].toLowerCase()).toBe(COUNCIL_PA.toLowerCase());
  });

  it('rechaza un génesis de cero (sin él no hay defensa de inflación)', () => {
    expect(() =>
      buildPoteCreationBatch({
        factoryAddress: FACTORY,
        councilR: COUNCIL_R,
        councilPersonalAccount: COUNCIL_PA,
        params: poteA(),
        predictedVault: PREDICTED_VAULT,
        genesisUBA: 0n,
      })
    ).toThrow(/genesisUBA debe ser > 0/);
  });
});
