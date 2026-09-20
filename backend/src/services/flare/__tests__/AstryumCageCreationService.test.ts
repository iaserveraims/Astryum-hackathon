/**
 * El nacimiento de una jaula v2 — la codificación pura, sin RPC.
 *
 * Lo que se fija: el batch es [create, approve] (sin génesis: la jaula no
 * custodia), la aprobación va al pote-fee de la jaula PREDICHA y por lo que
 * lande en la PA, y los parámetros eternos se validan antes de componer.
 */
import { ethers } from 'ethers';
import {
  CAGE_FACTORY_ABI,
  buildCageCreationBatch,
  validateCageParams,
  CageCreationError,
  type CageCreationParams,
} from '../AstryumCageCreationService';

const FACTORY = '0xf000000000000000000000000000000000000001';
const ASSET = '0xad552a648c74d49e10027ab8a618a3ad4901c5be';
const KINETIC = '0xd1b7a5efa9bd88f291f7a4563a8f6185c0249cb3';
const UPSHIFT = '0xaaaa000000000000000000000000000000000002';
const PREDICTED = '0xcafe000000000000000000000000000000000001';
const COUNCIL = 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG';
const REF = '0x' + '11'.repeat(32);

const params = (): CageCreationParams => ({
  asset: ASSET,
  constitutionRef: REF,
  allowedTargets: [
    { chainId: 14, target: KINETIC },
    { chainId: 14, target: UPSHIFT },
  ],
});

describe('buildCageCreationBatch — sin génesis, con la fee aprobada', () => {
  it('crea primero, aprueba después, y nada más', () => {
    const batch = buildCageCreationBatch({
      factoryAddress: FACTORY,
      councilR: COUNCIL,
      params: params(),
      predictedCage: PREDICTED,
      feeAllowanceUBA: 3_000_000n,
    });

    expect(batch).toHaveLength(2);

    const factory = new ethers.Interface(CAGE_FACTORY_ABI);
    const created = factory.decodeFunctionData('create', batch[0].calldata);
    expect(batch[0].to.toLowerCase()).toBe(FACTORY);
    expect(created[0]).toBe(COUNCIL);
    expect(String(created[1].asset).toLowerCase()).toBe(ASSET);
    expect(String(created[1].constitutionRef).toLowerCase()).toBe(REF);
    expect(created[1].allowedTargets).toHaveLength(2);
    expect(Number(created[1].allowedTargets[0].chainId)).toBe(14);

    const erc20 = new ethers.Interface(['function approve(address spender, uint256 amount)']);
    const approved = erc20.decodeFunctionData('approve', batch[1].calldata);
    expect(batch[1].to.toLowerCase()).toBe(ASSET);
    expect(String(approved[0]).toLowerCase()).toBe(PREDICTED); // a la jaula que va a nacer
    expect(BigInt(approved[1])).toBe(3_000_000n);
  });

  it('con fee a cero, el batch es solo la creación', () => {
    const batch = buildCageCreationBatch({
      factoryAddress: FACTORY,
      councilR: COUNCIL,
      params: params(),
      predictedCage: PREDICTED,
      feeAllowanceUBA: 0n,
    });
    expect(batch).toHaveLength(1);
  });

  it('ninguna call mueve nativo — el 0xFE paga el gas', () => {
    const batch = buildCageCreationBatch({
      factoryAddress: FACTORY,
      councilR: COUNCIL,
      params: params(),
      predictedCage: PREDICTED,
      feeAllowanceUBA: 1n,
    });
    expect(batch.every((c) => c.value === '0')).toBe(true);
  });
});

describe('validateCageParams — los parámetros eternos, comprobados antes', () => {
  it('acepta unos parámetros sanos', () => {
    expect(() => validateCageParams(params())).not.toThrow();
  });

  it('acepta la lista vacía: la jaula sigue al registro de Astryum (27-ago)', () => {
    const p = params();
    p.allowedTargets = [];
    expect(() => validateCageParams(p)).not.toThrow();
    // Y se codifica como lista vacía, no como ausencia.
    const batch = buildCageCreationBatch({ factoryAddress: FACTORY, councilR: COUNCIL, params: p, predictedCage: PREDICTED, feeAllowanceUBA: 0n });
    const created = new ethers.Interface(CAGE_FACTORY_ABI).decodeFunctionData('create', batch[0].calldata);
    expect(created[1].allowedTargets).toHaveLength(0);
  });

  it('rechaza lo que no es una lista', () => {
    const p = params() as unknown as { allowedTargets: unknown };
    p.allowedTargets = 'kinetic';
    expect(() => validateCageParams(p as CageCreationParams)).toThrow(CageCreationError);
    expect(() => validateCageParams(p as CageCreationParams)).toThrow(/lista/);
  });

  it('rechaza un destino repetido (misma chain, misma dirección)', () => {
    const p = params();
    p.allowedTargets.push({ chainId: 14, target: KINETIC.toUpperCase().replace('0X', '0x') });
    expect(() => validateCageParams(p)).toThrow(/repetido/);
  });

  it('el mismo destino en OTRA chain no es un repetido', () => {
    const p = params();
    p.allowedTargets.push({ chainId: 1, target: KINETIC });
    expect(() => validateCageParams(p)).not.toThrow();
  });

  it('rechaza constitución, activo, chain y target mal formados', () => {
    expect(() => validateCageParams({ ...params(), constitutionRef: '0x12' })).toThrow(/constitutionRef/);
    expect(() => validateCageParams({ ...params(), asset: 'fxrp' })).toThrow(/asset/);
    expect(() => validateCageParams({ ...params(), allowedTargets: [{ chainId: -1, target: KINETIC }] })).toThrow(/chainId/);
    expect(() => validateCageParams({ ...params(), allowedTargets: [{ chainId: 14, target: 'kinetic' }] })).toThrow(/target/);
  });

  it('el batch rechaza una r-address o una factory inválidas', () => {
    expect(() =>
      buildCageCreationBatch({ factoryAddress: 'no', councilR: COUNCIL, params: params(), predictedCage: PREDICTED, feeAllowanceUBA: 0n }),
    ).toThrow(/factoryAddress/);
    expect(() =>
      buildCageCreationBatch({ factoryAddress: FACTORY, councilR: '0xabc', params: params(), predictedCage: PREDICTED, feeAllowanceUBA: 0n }),
    ).toThrow(/r-address/);
  });
});
