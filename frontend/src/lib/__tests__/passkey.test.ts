/**
 * El núcleo criptográfico de la passkey — sin autenticador, sin red.
 *
 * Lo que se fija: el challenge byte-idéntico al contrato, el parseo de la
 * clave pública P256 y de la firma DER (con low-S), y el split del clientData.
 * Para el parseo se genera una CLAVE Y FIRMA P256 reales con WebCrypto (node),
 * así el DER que se parsea es de verdad, no un fixture inventado.
 */

import { webcrypto } from 'crypto';
import { describe, expect, it } from 'vitest';
import { ethers } from 'ethers';
import {
  buildWebAuthnSig,
  computeBatchChallenge,
  parseDerSignature,
  parseP256PublicKey,
  readPasskeyPlaces,
  splitClientData,
  toBase64Url,
  hexToBytes,
  type Call,
} from '../institutional/passkey';

const subtle = (webcrypto as unknown as Crypto).subtle;

describe('readPasskeyPlaces — dónde puede nacer la llave, antes de abrir la ventana', () => {
  it('un PC sin Bluetooth dice que no llega al móvil', () => {
    expect(readPasskeyPlaces({ hybridTransport: false, userVerifyingPlatformAuthenticator: true }, true)).toEqual({
      thisDevice: true,
      phoneNearby: false,
    });
  });

  it('las capacidades mandan sobre isUVPAA; sin ellas se usa isUVPAA', () => {
    expect(readPasskeyPlaces({ userVerifyingPlatformAuthenticator: false }, true).thisDevice).toBe(false);
    expect(readPasskeyPlaces(null, true)).toEqual({ thisDevice: true, phoneNearby: null });
  });

  it('un navegador que no lo dice queda en null, jamás en false', () => {
    expect(readPasskeyPlaces({}, null)).toEqual({ thisDevice: null, phoneNearby: null });
    expect(readPasskeyPlaces(null, null)).toEqual({ thisDevice: null, phoneNearby: null });
  });
});

describe('computeBatchChallenge — byte-idéntico al contrato', () => {
  it('iguala keccak256(abi.encode(chainid, account, nonce, calls))', () => {
    const account = '0x1111111111111111111111111111111111111111';
    const calls: Call[] = [
      { target: '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE', value: '0', data: '0x095ea7b3' },
      { target: '0xb0b0000000000000000000000000000000000001', value: '0', data: '0x6e553f65' },
    ];
    const got = computeBatchChallenge({ chainId: 14, account, nonce: 0, calls });

    // Recomputa a mano con el mismo AbiCoder — mismo resultado (el contrato usa
    // abi.encode con estos tipos exactos).
    const expected = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256', 'address', 'uint256', 'tuple(address target, uint256 value, bytes data)[]'],
        [BigInt(14), account, BigInt(0), calls.map((c) => [c.target, BigInt(c.value), c.data])]
      )
    );
    expect(got).toBe(expected);
    expect(got).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('cambia si cambia una sola call (no colisiona)', () => {
    const base = { chainId: 14, account: '0x1111111111111111111111111111111111111111', nonce: 0 };
    const a = computeBatchChallenge({ ...base, calls: [{ target: '0x' + '22'.repeat(20), value: '0', data: '0x01' }] });
    const b = computeBatchChallenge({ ...base, calls: [{ target: '0x' + '22'.repeat(20), value: '0', data: '0x02' }] });
    expect(a).not.toBe(b);
  });
});

describe('parseP256PublicKey', () => {
  it('extrae (x,y) del SPKI DER de una clave P256 real', async () => {
    const kp = (await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const spki = new Uint8Array(await subtle.exportKey('spki', kp.publicKey));
    const { x, y } = parseP256PublicKey(spki);
    expect(x).toMatch(/^0x[0-9a-f]{64}$/);
    expect(y).toMatch(/^0x[0-9a-f]{64}$/);
    // El punto sin comprimir son los últimos 65 bytes con prefijo 0x04.
    expect(spki[spki.length - 65]).toBe(0x04);
  });
});

describe('parseDerSignature — con low-S', () => {
  it('parsea una firma ECDSA/P256 real y normaliza S a la mitad baja', async () => {
    const kp = (await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    // WebCrypto devuelve la firma en formato RAW (r‖s, 64 bytes), no DER — la
    // envolvemos en DER para probar el parser tal como llega de WebAuthn.
    const raw = new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, new Uint8Array([1, 2, 3])));
    const r = raw.slice(0, 32);
    const s = raw.slice(32, 64);
    const der = toDer(r, s);

    const parsed = parseDerSignature(der);
    expect(parsed.r).toMatch(/^0x[0-9a-f]{64}$/);
    expect(parsed.s).toMatch(/^0x[0-9a-f]{64}$/);
    // low-S: el S parseado nunca supera n/2.
    const HALF_N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551') / BigInt(2);
    expect(BigInt(parsed.s) <= HALF_N).toBe(true);
  });
});

describe('splitClientData', () => {
  it('parte alrededor del challenge en base64url y reconstruye', () => {
    const challengeHex = '0x' + '3a'.repeat(32);
    const b64 = toBase64Url(hexToBytes(challengeHex));
    const cdj = `{"type":"webauthn.get","challenge":"${b64}","origin":"https://astryum.xyz"}`;
    const { pre, post } = splitClientData(cdj, challengeHex);
    expect(pre + b64 + post).toBe(cdj);
    expect(pre.endsWith('"challenge":"')).toBe(true);
  });

  it('falla si el challenge no aparece — jamás se firma un clientData ajeno', () => {
    expect(() => splitClientData('{"challenge":"otracosa"}', '0x' + '3a'.repeat(32))).toThrow(/no contiene/);
  });
});

describe('buildWebAuthnSig — end to end del parseo', () => {
  it('compone el sig con pre/post/r/s coherentes', async () => {
    const kp = (await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const challengeHex = '0x' + '7c'.repeat(32);
    const b64 = toBase64Url(hexToBytes(challengeHex));
    const clientDataJSON = `{"type":"webauthn.get","challenge":"${b64}","origin":"https://astryum.xyz"}`;
    const authData = new Uint8Array(37);
    authData[32] = 0x01; // User Present
    const raw = new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, new Uint8Array([9])));
    const der = toDer(raw.slice(0, 32), raw.slice(32, 64));

    const sig = buildWebAuthnSig({ authenticatorData: authData, clientDataJSON, derSignature: der, challengeHex });
    expect(sig.clientDataPre + b64 + sig.clientDataPost).toBe(clientDataJSON);
    expect(sig.r).toMatch(/^0x[0-9a-f]{64}$/);
    expect(sig.authenticatorData).toMatch(/^0x[0-9a-f]{74}$/); // 37 bytes
  });
});

/** Envuelve (r,s) crudos en DER, como llega una firma WebAuthn. */
function toDer(r: Uint8Array, s: Uint8Array): Uint8Array {
  const enc = (int: Uint8Array): number[] => {
    let start = 0;
    while (start < int.length - 1 && int[start] === 0) start++;
    let v = Array.from(int.slice(start));
    if (v[0] & 0x80) v = [0x00, ...v]; // DER: entero positivo con MSB set lleva 0x00
    return [0x02, v.length, ...v];
  };
  const body = [...enc(r), ...enc(s)];
  return new Uint8Array([0x30, body.length, ...body]);
}
