/**
 * El tope por cuenta, dicho antes de firmar — la parte pura.
 */
import { checkDepositCap, depositCapRefusal } from '../AstryumDepositCapService';
import { decodeRegistryRow } from '../AstryumRegistryReadService';

const FXRP = { symbol: 'FXRP', decimals: 6 };

describe('checkDepositCap — el hueco lo dice el pote, aquí solo se compara', () => {
  it('cabe: importe ≤ hueco', () => {
    expect(checkDepositCap(1_000_000n, 1_000_000n)).toEqual({ ok: true, headroom: 1_000_000n });
    expect(checkDepositCap(1_000_000n, 1n).ok).toBe(true);
  });

  it('no cabe: importe > hueco, con el hueco y el importe para el aviso', () => {
    const r = checkDepositCap(500_000n, 1_000_000n);
    expect(r).toEqual({ ok: false, code: 'DEPOSIT_CAP_PER_USER', headroom: 500_000n, amount: 1_000_000n });
  });

  it('hueco 0 bloquea cualquier importe (la cuenta ya está al máximo)', () => {
    expect(checkDepositCap(0n, 1n).ok).toBe(false);
  });

  it('«no pude leer» (null) NO bloquea: el contrato decide', () => {
    expect(checkDepositCap(null, 10n ** 30n)).toEqual({ ok: true, headroom: null });
  });

  it('un pote v1 responde uint256.max y nunca bloquea', () => {
    expect(checkDepositCap(2n ** 256n - 1n, 10n ** 30n).ok).toBe(true);
  });
});

describe('depositCapRefusal — lo que ve el usuario', () => {
  it('dice cuánto cabe aún, en humano y en base, y que salir siempre cabe', () => {
    const r = depositCapRefusal({ ok: false, code: 'DEPOSIT_CAP_PER_USER', headroom: 2_500_000n, amount: 4_000_000n }, FXRP);
    expect(r.error).toBe('DEPOSIT_CAP_PER_USER');
    expect(r.headroom).toBe('2.5');
    expect(r.headroomBase).toBe('2500000');
    expect(r.amountBase).toBe('4000000');
    expect(r.detail).toMatch(/2\.5 FXRP/);
    expect(r.detail).toMatch(/4\.0 FXRP/);
  });

  it('con hueco 0 no invita a bajar el importe: ya está al máximo', () => {
    const r = depositCapRefusal({ ok: false, code: 'DEPOSIT_CAP_PER_USER', headroom: 0n, amount: 1n }, FXRP);
    expect(r.detail).toMatch(/máximo/);
    expect(r.detail).toMatch(/salir siempre cabe/);
  });
});

describe('decodeRegistryRow — el estado de una entrada de la whitelist', () => {
  const T = '0xd1b7a5efa9bd88f291f7a4563a8f6185c0249cb3';
  it('activa', () => {
    const v = decodeRegistryRow({ chainId: 14n, target: T, entry: { kind: 1n, activeAt: 1_700_000_000n, active: true } });
    expect(v).toMatchObject({ chainId: 14, kind: 'compoundv2', kindCode: 1, status: 'active', activeAt: 1_700_000_000 });
    expect(v.target).toBe('0xD1b7A5eFa9bd88F291F7A4563a8f6185c0249CB3'); // checksum
  });
  it('pendiente de timelock: propuesta, no activa, con fecha', () => {
    expect(decodeRegistryRow({ chainId: 14, target: T, entry: { kind: 0, activeAt: 1, active: false } }).status).toBe('pending');
  });
  it('retirada: borrada del mapping (activeAt 0) pero sigue enumerada', () => {
    const v = decodeRegistryRow({ chainId: 14, target: T, entry: { kind: 0, activeAt: 0, active: false } });
    expect(v.status).toBe('removed');
  });
  it('un kind desconocido no revienta el catálogo', () => {
    expect(decodeRegistryRow({ chainId: 1, target: T, entry: { kind: 9, activeAt: 1, active: true } }).kind).toBe('unknown');
  });
});
