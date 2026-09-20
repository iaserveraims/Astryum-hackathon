/**
 * Las órdenes a la jaula v2 — la codificación pura, sin RPC.
 *
 * Lo que aquí se fija: que cada acción produzca EXACTAMENTE los bytes que la
 * jaula sabe ejecutar (se decodifican de vuelta contra su ABI), que el memo sea
 * el keccak de `abi.encode(nonce, calldata)` (lo que el bridge exige), y que
 * la validación rechace antes de componer lo que reventaría después de firmar.
 */
import { ethers } from 'ethers';
import {
  CAGE_AUTHORITY_ABI,
  encodeCageOrder,
  isPoteScoped,
  ownCredentialIdsFor,
  venueKindOf,
  type CageOrderAction,
} from '../AstryumCageOrderService';

const IFACE = new ethers.Interface(CAGE_AUTHORITY_ABI);
const REF = '0x' + '11'.repeat(32);
const POTE = '0xb0b0000000000000000000000000000000000001';
const TARGET = '0xaaaa000000000000000000000000000000000001';
const HEIR = '0xeeee000000000000000000000000000000000001';

describe('encodeCageOrder — los bytes que la jaula ejecuta', () => {
  it('directTo lleva el pote como primer parámetro y la constitución como último', () => {
    const o = encodeCageOrder('direct-to', { pote: POTE, venueId: 0, amount: '1000000' }, REF, 7);
    const d = IFACE.decodeFunctionData('directTo', o.cageCalldata);
    expect(String(d[0]).toLowerCase()).toBe(POTE);
    expect(BigInt(d[1])).toBe(0n);
    expect(BigInt(d[2])).toBe(1_000_000n);
    expect(String(d[3]).toLowerCase()).toBe(REF);
    expect(o.nonce).toBe(7);
  });

  it('el memo es keccak256(abi.encode(nonce, calldata)) — lo que el bridge compara', () => {
    const o = encodeCageOrder('recall', { pote: POTE, venueId: 1, amount: '5' }, REF, 3);
    const expected = ethers.AbiCoder.defaultAbiCoder().encode(['uint64', 'bytes'], [3, o.cageCalldata]);
    expect(o.orderData).toBe(expected);
    expect(o.orderHash).toBe(ethers.keccak256(expected));
    expect(o.memoHex).toBe(ethers.keccak256(expected).slice(2).toUpperCase());
  });

  it('createPote codifica los venues iniciales, el gate y quién paga la fee', () => {
    const o = encodeCageOrder(
      'create-pote',
      {
        name: 'Conservador',
        symbol: 'cons-FXRP',
        cooldownSeconds: 0,
        bufferFloorBps: 1000,
        maxPayeeBps: 2000,
        initialVenues: [{ target: TARGET, kind: 'compoundv2' }],
        feePayer: HEIR,
      },
      REF,
      0,
    );
    const d = IFACE.decodeFunctionData('createPote', o.cageCalldata);
    // (PoteParams p, bytes32 ref, address feePayer): la ficha va en un struct.
    const p = d[0];
    expect(p.name).toBe('Conservador');
    expect(Number(p.maxPayeeBps)).toBe(2000);
    expect(BigInt(p.maxDepositPerUser)).toBe(0n); // sin tope por cuenta si no se pide
    expect(String(p.initialGate)).toBe(ethers.ZeroAddress); // sin gate = abierto
    expect(String(p.initialVenues[0][0]).toLowerCase()).toBe(TARGET);
    expect(Number(p.initialVenues[0][1])).toBe(1); // compoundv2
    expect(String(d[1]).toLowerCase()).toBe(REF);
    expect(String(d[2]).toLowerCase()).toBe(HEIR);
    expect(o.summary).toMatch(/open/);
    expect(o.summary).toMatch(/no per-account cap/);
  });

  it('createPote con tope por cuenta: va en la ficha, en unidades base, y se dice', () => {
    const o = encodeCageOrder(
      'create-pote',
      { name: 'Capado', symbol: 'cap-FXRP', maxDepositPerUser: '2500000000', feePayer: HEIR },
      REF,
      0,
    );
    const d = IFACE.decodeFunctionData('createPote', o.cageCalldata);
    expect(BigInt(d[0].maxDepositPerUser)).toBe(2_500_000_000n);
    expect(o.summary).toMatch(/max 2500000000 base units per account/);
    expect(() => encodeCageOrder('create-pote', { name: 'x', symbol: 'x', maxDepositPerUser: '-1', feePayer: HEIR }, REF, 0)).toThrow(
      /maxDepositPerUser/,
    );
  });

  it('set-max-deposit habla de UN pote y codifica setMaxDepositPerUser(pote, cap, ref)', () => {
    const o = encodeCageOrder('set-max-deposit', { pote: POTE, cap: '1000000' }, REF, 2);
    const d = IFACE.decodeFunctionData('setMaxDepositPerUser', o.cageCalldata);
    expect(String(d[0]).toLowerCase()).toBe(POTE);
    expect(BigInt(d[1])).toBe(1_000_000n);
    expect(String(d[2]).toLowerCase()).toBe(REF);
    expect(o.summary).toMatch(/exits are never blocked/);
    expect(isPoteScoped('set-max-deposit')).toBe(true);

    const off = encodeCageOrder('set-max-deposit', { pote: POTE, cap: '0' }, REF, 3);
    expect(off.summary).toMatch(/Remove the per-account cap/);
  });

  it('setPayees reparte por debajo del cap del pote — el cap no vive aquí', () => {
    const o = encodeCageOrder(
      'set-payees',
      { pote: POTE, payees: [{ account: HEIR, bps: 10_000 }] },
      REF,
      0,
    );
    const d = IFACE.decodeFunctionData('setPayees', o.cageCalldata);
    expect(Number(d[2][0])).toBe(10_000); // se codifica; el POTE decide si lo admite
  });

  it('propose-successor / execute-succession codifican el traspaso', () => {
    const p = encodeCageOrder('propose-successor', { newCage: TARGET }, REF, 9);
    expect(String(IFACE.decodeFunctionData('proposeSuccessor', p.cageCalldata)[0]).toLowerCase()).toBe(TARGET);
    const e = encodeCageOrder('execute-succession', {}, REF, 10);
    expect(IFACE.decodeFunctionData('executeSuccession', e.cageCalldata)[0].toLowerCase()).toBe(REF);
  });

  it('cada acción conocida codifica sin lanzar con parámetros válidos', () => {
    const samples: Array<[CageOrderAction, Record<string, unknown>]> = [
      ['accept-pote', { pote: POTE }], // adoptar es gobierno (759051a4): orden de la autoridad
      ['propose-venue', { pote: POTE, target: TARGET, kind: 'erc4626' }],
      ['retire-venue', { pote: POTE, venueId: 0 }],
      ['evacuate', { pote: POTE, venueId: 0 }],
      ['set-max-venue-bps', { pote: POTE, bps: 5000 }],
      ['set-user-gate', { pote: POTE, gate: TARGET }],
      ['move', { pote: POTE, fromId: 0, toId: 1, amount: '1' }],
      ['cede', { director: HEIR, untilISO: new Date(Date.now() + 86_400_000).toISOString() }],
      ['end-cession', {}],
      ['set-constitution-ref', { newRefHex: '0x' + '22'.repeat(32) }],
      ['register-remote-wallet', { chainId: 1, walletIdHex: '0x' + '33'.repeat(32) }],
      ['register-remote-pote', { chainId: 1, pote: TARGET }],
      ['cancel-successor', {}],
    ];
    for (const [action, params] of samples) {
      const o = encodeCageOrder(action, params, REF, 1);
      expect(o.cageCalldata.startsWith('0x')).toBe(true);
      expect(o.summary.length).toBeGreaterThan(10);
    }
  });
});

describe('lo que se rechaza ANTES de componer', () => {
  it('constitución mal formada, nonce negativo, acción desconocida', () => {
    expect(() => encodeCageOrder('recall', { pote: POTE, venueId: 0, amount: '1' }, '0x12', 0)).toThrow(/bytes32/);
    expect(() => encodeCageOrder('recall', { pote: POTE, venueId: 0, amount: '1' }, REF, -1)).toThrow(/nonce/);
    expect(() => encodeCageOrder('rob' as CageOrderAction, {}, REF, 0)).toThrow(/unknown/);
  });

  it('un pote que no es dirección, un importe negativo, un director en el pasado', () => {
    expect(() => encodeCageOrder('direct-to', { pote: 'no', venueId: 0, amount: '1' }, REF, 0)).toThrow(/pote/);
    expect(() => encodeCageOrder('direct-to', { pote: POTE, venueId: 0, amount: '-1' }, REF, 0)).toThrow(/amount/);
    expect(() => encodeCageOrder('cede', { director: HEIR, untilISO: '2020-01-01T00:00:00Z' }, REF, 0)).toThrow(/future/);
  });

  it('un cap de payees por encima del 100% ni se codifica', () => {
    expect(() => encodeCageOrder('create-pote', { name: 'x', symbol: 'x', maxPayeeBps: 10_001, feePayer: HEIR }, REF, 0)).toThrow(
      /maxPayeeBps/,
    );
  });
});

describe('piezas', () => {
  it('venueKindOf acepta nombre o número y rechaza lo demás', () => {
    expect(venueKindOf('erc4626')).toBe(0);
    expect(venueKindOf('compoundv2')).toBe(1);
    expect(venueKindOf('erc4626queued')).toBe(2);
    expect(venueKindOf(1)).toBe(1);
    expect(() => venueKindOf('aave')).toThrow(/unknown/);
  });

  it('isPoteScoped distingue lo que habla de un pote de lo que habla de la jaula', () => {
    expect(isPoteScoped('direct-to')).toBe(true);
    expect(isPoteScoped('set-payees')).toBe(true);
    expect(isPoteScoped('create-pote')).toBe(false);
    expect(isPoteScoped('cede')).toBe(false);
    expect(isPoteScoped('execute-succession')).toBe(false);
  });
});

/**
 * Las credenciales que viajan en el pago de la orden. El ledger exige que el
 * firmante sea el SUJETO de cada una; una sola ajena devuelve
 * tecBAD_CREDENTIALS, no ejecuta nada y cobra la fee de red igual.
 */
describe('ownCredentialIdsFor — solo las credenciales DEL firmante', () => {
  const ROOT = 'rwc9DqireGfwcEecBJD8QF41vmA18QN9rR';
  const OMNIBUS = 'rMB8xNE6XYyg9f6D7vB4LeZLwdVSCQwREf';
  const cred = (subject: string, state: string, id: string) => ({ subject, state, ledgerIndex: id });

  it('deja fuera las que esa cuenta EMITIÓ para otra — el caso que rompió abrir un pote', () => {
    const ids = ownCredentialIdsFor(ROOT, [
      cred(ROOT, 'valid', 'A1'), // KYB suya
      cred(OMNIBUS, 'valid', 'B1'), // KYC-101 que ella emitió al omnibus
      cred(OMNIBUS, 'valid', 'B2'), // KYC-102
      cred(ROOT, 'valid', 'A2'), // CASP suya
    ]);
    expect(ids).toEqual(['A1', 'A2']);
  });

  it('una caducada o sin aceptar no viaja: haría fallar el pago entero', () => {
    const ids = ownCredentialIdsFor(ROOT, [
      cred(ROOT, 'expired', 'X'),
      cred(ROOT, 'pending-acceptance', 'Y'),
      cred(ROOT, 'unreadable', 'Z'),
      cred(ROOT, 'expiring-soon', 'OK'), // vigente todavía: sí viaja
    ]);
    expect(ids).toEqual(['OK']);
  });

  it('sin ID en el ledger no hay nada que listar', () => {
    expect(ownCredentialIdsFor(ROOT, [{ subject: ROOT, state: 'valid', ledgerIndex: null }])).toEqual([]);
  });

  it('nunca pasa de 8 — el máximo que admite un Payment', () => {
    const many = Array.from({ length: 12 }, (_, i) => cred(ROOT, 'valid', `ID${i}`));
    expect(ownCredentialIdsFor(ROOT, many)).toHaveLength(8);
  });

  it('sin credenciales propias, la lista va vacía y el pago sale sin el campo', () => {
    expect(ownCredentialIdsFor(ROOT, [cred(OMNIBUS, 'valid', 'B1')])).toEqual([]);
  });
});
