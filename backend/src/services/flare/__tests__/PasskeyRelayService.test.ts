/**
 * El relayer de la firma passkey — validación pura, sin red.
 *
 * Lo que se fija: el anti-DoS (solo destinos de la allowlist), la forma de la
 * firma WebAuthn, y que el lote no sea vacío ni descomunal. El relayer NO puede
 * alterar las calls (la firma las compromete on-chain) — eso lo garantiza el
 * contrato; aquí se garantiza que no paga gas por basura.
 */

import {
  PasskeyRelayError,
  validatePasskeyRelayInput,
  type PasskeyRelayInput,
} from '../PasskeyRelayService';

const FXRP = '0xad552a648c74d49e10027ab8a618a3ad4901c5be';
const POTE = '0xb0b0000000000000000000000000000000000001';
const EVIL = '0xdead000000000000000000000000000000000001';
const allow = new Set([FXRP, POTE]);

function good(over: Partial<PasskeyRelayInput> = {}): PasskeyRelayInput {
  return {
    pubKeyX: '12345678901234567890',
    pubKeyY: '0xabcdef',
    calls: [{ target: FXRP, value: '0', data: '0x095ea7b3' }],
    sig: {
      authenticatorData: '0x' + '00'.repeat(37),
      clientDataPre: '{"type":"webauthn.get","challenge":"',
      clientDataPost: '","origin":"https://astryum.xyz"}',
      r: '0x' + '11'.repeat(32),
      s: '0x' + '22'.repeat(32),
    },
    ...over,
  };
}

describe('validatePasskeyRelayInput', () => {
  it('acepta un lote bien formado a destinos de la allowlist', () => {
    expect(() => validatePasskeyRelayInput(good(), allow)).not.toThrow();
    expect(() =>
      validatePasskeyRelayInput(
        good({ calls: [{ target: FXRP, value: '0', data: '0x' }, { target: POTE, value: '0', data: '0x6e553f65' }] }),
        allow
      )
    ).not.toThrow();
  });

  it('ANTI-DOS: rechaza un destino fuera de la allowlist', () => {
    try {
      validatePasskeyRelayInput(good({ calls: [{ target: EVIL, value: '0', data: '0x' }] }), allow);
      throw new Error('unreachable');
    } catch (e) {
      expect((e as PasskeyRelayError).code).toBe('TARGET_NOT_ALLOWED');
    }
  });

  it('rechaza lote vacío y lote descomunal', () => {
    expect(() => validatePasskeyRelayInput(good({ calls: [] }), allow)).toThrow(/vacío/);
    const many = Array.from({ length: 9 }, () => ({ target: FXRP, value: '0', data: '0x' }));
    expect(() => validatePasskeyRelayInput(good({ calls: many }), allow)).toThrow(/8 calls/);
  });

  it('rechaza firma WebAuthn malformada', () => {
    expect(() =>
      validatePasskeyRelayInput(good({ sig: { ...good().sig, r: '0xshort' } }), allow)
    ).toThrow(PasskeyRelayError);
    expect(() =>
      validatePasskeyRelayInput(good({ sig: { ...good().sig, authenticatorData: 'nothex' } }), allow)
    ).toThrow(/WebAuthn/);
  });

  it('rechaza target, calldata y value inválidos', () => {
    expect(() => validatePasskeyRelayInput(good({ calls: [{ target: 'nope', value: '0', data: '0x' }] }), allow)).toThrow(/target/);
    expect(() => validatePasskeyRelayInput(good({ calls: [{ target: FXRP, value: '0', data: 'nothex' }] }), allow)).toThrow(/hex/);
    expect(() => validatePasskeyRelayInput(good({ calls: [{ target: FXRP, value: '-1', data: '0x' }] }), allow)).toThrow(/wei/);
  });

  it('con allowlist vacía no bloquea por destino (deja pasar la config del operador)', () => {
    expect(() => validatePasskeyRelayInput(good({ calls: [{ target: EVIL, value: '0', data: '0x' }] }), new Set())).not.toThrow();
  });
});
