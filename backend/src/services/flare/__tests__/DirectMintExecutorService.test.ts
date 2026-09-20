/**
 * DirectMintExecutorService — tests de las partes puras del executor 0xFE.
 * El carril completo (FDC → proof → ejecución) es integración on-chain y se
 * valida con el CLI (--check / dry-run); aquí se fija el contrato del parseo
 * del memo y la descodificación de reverts, que es lo que decide QUÉ se
 * ejecuta y POR QUÉ falla.
 */
import { ethers } from 'ethers';
import { parseMemo0xFE, describeRevert, assertUserOpExecutable, ExecutorAbort, isOwnInstruction } from '../DirectMintExecutorService';

describe('parseMemo0xFE', () => {
  // Memo real de la tx 23C43B96… (earnXRP): FE | walletId(1B) |
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

describe('IsOwnInstruction — qué 0xFE del Core Vault compartido es NUESTRO', () => {
  const TAG = 2607090002;
  // Memo real del put-to-work del autopilot en staging (tx 88653B9C…): el
  // omnibus lo firmó SIN SourceTag, como toda cuenta operativa.
  const OMNIBUS_MEMO = 'FE000000000000030D40805F132F386E1AF698C4A8332C8900EE5F46FD626E66FF28B862117977F817DA';
  const OMNIBUS_HASH = '0x805f132f386e1af698c4a8332c8900ee5f46fd626e66ff28b862117977f817da';
  const inStore = async (h: string) => h === OMNIBUS_HASH;

  it('con la etiqueta del proyecto es nuestro, sin mirar el store', async () => {
    const hasHandoff = jest.fn(inStore);
    expect(await isOwnInstruction({ tag: TAG, opcode: 'FE', memoHex: 'FE' + '0'.repeat(82) }, { onlyTag: TAG, hasHandoff })).toBe(true);
    expect(hasHandoff).not.toHaveBeenCalled();
  });

  it('EL CASO QUE ESTABA ROTO: un 0xFE operativo sin etiqueta cuyo despacho está en nuestro store es nuestro', async () => {
    expect(await isOwnInstruction({ tag: undefined, opcode: 'FE', memoHex: OMNIBUS_MEMO }, { onlyTag: TAG, hasHandoff: inStore })).toBe(true);
  });

  it('un 0xFE de OTRA app (sin etiqueta y sin fila en nuestro store) sigue sin ser nuestro', async () => {
    const foreign = 'FE2A' + '0'.repeat(16) + 'ab'.repeat(32);
    expect(await isOwnInstruction({ tag: undefined, opcode: 'FE', memoHex: foreign }, { onlyTag: TAG, hasHandoff: inStore })).toBe(false);
  });

  it('una etiqueta ajena no convierte en nuestro un despacho que no compusimos', async () => {
    expect(await isOwnInstruction({ tag: 12345, opcode: 'FE', memoHex: 'FE' + 'cd'.repeat(41) }, { onlyTag: TAG, hasHandoff: inStore })).toBe(false);
  });

  it('store ilegible: NO es nuestro en este tick (no se ejecuta lo que no se puede probar)', async () => {
    const broken = async () => {
      throw new Error('pooler down');
    };
    expect(await isOwnInstruction({ tag: undefined, opcode: 'FE', memoHex: OMNIBUS_MEMO }, { onlyTag: TAG, hasHandoff: broken })).toBe(false);
  });

  it('otros opcodes y memos malformados siguen la regla vieja (solo con etiqueta)', async () => {
    expect(await isOwnInstruction({ tag: undefined, opcode: 'FF', memoHex: 'FF' + OMNIBUS_MEMO.slice(2) }, { onlyTag: TAG, hasHandoff: inStore })).toBe(false);
    expect(await isOwnInstruction({ tag: undefined, opcode: 'FE', memoHex: 'FE00' }, { onlyTag: TAG, hasHandoff: inStore })).toBe(false);
  });

  it('sin hasHandoff el comportamiento es el de siempre, y sin onlyTag (FLARE_EXECUTOR_ALL) todo cuenta', async () => {
    expect(await isOwnInstruction({ tag: undefined, opcode: 'FE', memoHex: OMNIBUS_MEMO }, { onlyTag: TAG })).toBe(false);
    expect(await isOwnInstruction({ tag: undefined, opcode: 'FE', memoHex: OMNIBUS_MEMO }, { onlyTag: null })).toBe(true);
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
