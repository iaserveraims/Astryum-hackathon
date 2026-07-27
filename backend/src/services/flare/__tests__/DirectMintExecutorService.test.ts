/**
 * DirectMintExecutorService — tests de las partes puras del executor 0xFE.
 * El carril completo (FDC → proof → ejecución) es integración on-chain y se
 * valida con el CLI (--check / dry-run); aquí se fija el contrato del parseo
 * del memo y la descodificación de reverts, que es lo que decide QUÉ se
 * ejecuta y POR QUÉ falla.
 */
import { ethers } from 'ethers';
import { parseMemo0xFE, describeRevert, assertUserOpExecutable, ExecutorAbort } from '../DirectMintExecutorService';

describe('parseMemo0xFE', () => {
  // Memo real de la tx 23C43B96… (earnXRP, 2026-07-12): FE | walletId(1B) |
  // executorFee(8B) | userOpHash(32B) = 42 bytes.
  const REAL_MEMO =
    'FE000000000000030D40B17C530F24AA1011AC0CB1E3A8CC4B2E027BE2A7A9D2081C3D3B9BCE3EB98A67';

  it('descompone el memo 0xFE real en walletId, fee y userOpHash', () => {
    const m = parseMemo0xFE(REAL_MEMO);
    expect(m.opcode).toBe(0xfe);
    expect(m.walletId).toBe(0);
    expect(m.executorFeeUBA).toBe(200_000n); // 0x030D40 = 0.2 XRP en drops
    expect(m.userOpHash).toBe('0xb17c530f24aa1011ac0cb1e3a8cc4b2e027be2a7a9d2081c3d3b9bce3eb98a67');
    expect(m.raw).toBe(REAL_MEMO);
  });

  it('acepta 0x-prefijo y minúsculas (normaliza)', () => {
    const m = parseMemo0xFE('0x' + REAL_MEMO.toLowerCase());
    expect(m.userOpHash).toBe('0xb17c530f24aa1011ac0cb1e3a8cc4b2e027be2a7a9d2081c3d3b9bce3eb98a67');
  });

  it('rechaza longitudes distintas de 42 bytes', () => {
    expect(() => parseMemo0xFE(REAL_MEMO.slice(0, 80))).toThrow(ExecutorAbort);
    expect(() => parseMemo0xFE(REAL_MEMO + '00')).toThrow(/MEMO_BAD_LENGTH/);
  });

  it('rechaza opcodes que no sean 0xFE — este executor no ejecuta otra cosa', () => {
    expect(() => parseMemo0xFE('FF' + REAL_MEMO.slice(2))).toThrow(/MEMO_NOT_0xFE/);
  });
});

describe('describeRevert', () => {
  it('nombra los errores conocidos del carril 0xFE', () => {
    const iface = new ethers.Interface([
      'error DirectMintingStillDelayed(uint256 allowedAt)',
    ]);
    const data = iface.encodeErrorResult('DirectMintingStillDelayed', [1234567890n]);
    expect(describeRevert({ data })).toBe('DirectMintingStillDelayed(1234567890)');
  });

  it('deja el selector crudo cuando el error no es conocido', () => {
    expect(describeRevert({ data: '0xdeadbeef00' })).toMatch(/revert data: 0xdeadbeef00/);
  });

  it('cae al message cuando no hay revert data', () => {
    expect(describeRevert(new Error('boom'))).toBe('boom');
  });
});

describe('assertUserOpExecutable — el veredicto barato ANTES de pagar attestation', () => {
  // Los tres casos reales del incidente 2026-07-18 (244 attestations × 20 FLR
  // quemadas): sender ajeno, nonce consumido, y el caso sano que debe pasar.
  const PA = '0xe3030A6B8b567f4755A03791A91F51Cd57855697';
  const OTHER = '0xe7A124A08933d246398382be0Ce246157D9750a6';

  it('pasa cuando sender == PA y nonce == nonce on-chain', () => {
    expect(() => assertUserOpExecutable({ sender: PA, nonce: 2n }, PA, 2n)).not.toThrow();
  });

  it('sender de otra cuenta = inejecutable PERMANENTE (InvalidSender garantizado)', () => {
    try {
      assertUserOpExecutable({ sender: OTHER, nonce: 0n }, PA, 0n);
      throw new Error('debió lanzar');
    } catch (e) {
      expect(e).toBeInstanceOf(ExecutorAbort);
      expect((e as ExecutorAbort).permanent).toBe(true);
      expect((e as Error).message).toMatch(/InvalidSender/);
    }
  });

  it('nonce consumido = inejecutable PERMANENTE (InvalidNonce garantizado)', () => {
    try {
      assertUserOpExecutable({ sender: PA, nonce: 2n }, PA, 3n);
      throw new Error('debió lanzar');
    } catch (e) {
      expect(e).toBeInstanceOf(ExecutorAbort);
      expect((e as ExecutorAbort).permanent).toBe(true);
      expect((e as Error).message).toMatch(/InvalidNonce/);
    }
  });

  it('nonce futuro = en cola, reintentable SIN pagar (no permanente)', () => {
    try {
      assertUserOpExecutable({ sender: PA, nonce: 5n }, PA, 3n);
      throw new Error('debió lanzar');
    } catch (e) {
      expect(e).toBeInstanceOf(ExecutorAbort);
      expect((e as ExecutorAbort).permanent).toBe(false);
    }
  });

  it('el sender se compara case-insensitive (checksum vs lowercase)', () => {
    expect(() => assertUserOpExecutable({ sender: PA.toLowerCase(), nonce: 1n }, PA, 1n)).not.toThrow();
  });
});
