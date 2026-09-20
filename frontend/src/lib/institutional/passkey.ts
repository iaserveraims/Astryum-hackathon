/**
 * passkey — el núcleo criptográfico del lado usuario (Face ID / WebAuthn P256).
 *
 * Todo lo delicado vive aquí como funciones PURAS y testeables: el cómputo del
 * challenge (byte-idéntico a AstryumVault.challengeForBatch), el parseo de la
 * clave pública P256, el de la firma DER, la normalización low-S y el split del
 * clientDataJSON. Los `navigator.credentials.*` (que no se pueden testear sin
 * autenticador) quedan en wrappers finos que llaman a estas funciones.
 *
 * Regla de custodia (Z17): la llave la controla SOLO el usuario (Face ID). El
 * relayer solo transporta la firma; jamás una key del servicio.
 */

import { ethers } from 'ethers';

/** Orden de la curva secp256r1 (P-256) — para normalizar low-S. */
const P256_N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
const P256_HALF_N = P256_N / BigInt(2);

export interface Call {
  target: string;
  value: string; // decimal string (wei)
  data: string; // 0x hex
}

export interface WebAuthnSig {
  authenticatorData: string; // 0x hex
  clientDataPre: string;
  clientDataPost: string;
  r: string; // bytes32 0x hex
  s: string; // bytes32 0x hex (low-S normalized)
}

/**
 * El reto que la passkey debe firmar — EXACTAMENTE lo que calcula el contrato:
 *   keccak256(abi.encode(chainid, account, nonce, calls))
 * Para la primera acción (cuenta contrafactual sin desplegar) nonce = 0.
 */
export function computeBatchChallenge(input: {
  chainId: number;
  account: string;
  nonce: bigint | number;
  calls: Call[];
}): string {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const encoded = coder.encode(
    ['uint256', 'address', 'uint256', 'tuple(address target, uint256 value, bytes data)[]'],
    [
      BigInt(input.chainId),
      ethers.getAddress(input.account),
      BigInt(input.nonce),
      input.calls.map((c) => [ethers.getAddress(c.target), BigInt(c.value), c.data]),
    ]
  );
  return ethers.keccak256(encoded);
}

/** base64url sin padding de un buffer — el formato del challenge en WebAuthn. */
export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 0x-hex (32 bytes) → Uint8Array. */
export function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let h = '0x';
  for (const b of bytes) h += b.toString(16).padStart(2, '0');
  return h;
}

/**
 * Extrae (x, y) de la clave pública P256 en formato SPKI DER (lo que devuelve
 * AuthenticatorAttestationResponse.getPublicKey()). Para P256 los ÚLTIMOS 65
 * bytes son el punto sin comprimir: 0x04 ‖ X(32) ‖ Y(32).
 */
export function parseP256PublicKey(spkiDer: Uint8Array): { x: string; y: string } {
  if (spkiDer.length < 65) throw new Error('SPKI demasiado corto para una clave P256');
  const point = spkiDer.slice(spkiDer.length - 65);
  if (point[0] !== 0x04) throw new Error('el punto público no está sin comprimir (0x04)');
  return {
    x: '0x' + Buffer.from(point.slice(1, 33)).toString('hex'),
    y: '0x' + Buffer.from(point.slice(33, 65)).toString('hex'),
  };
}

/**
 * Parsea una firma ECDSA en DER (0x30 len 0x02 rlen R 0x02 slen S) → {r, s}
 * de 32 bytes cada uno, con S normalizado a low-S (P256 es maleable: la mitad
 * alta de S es una segunda firma válida; los verificadores exigen la baja).
 */
export function parseDerSignature(der: Uint8Array): { r: string; s: string } {
  let i = 0;
  if (der[i++] !== 0x30) throw new Error('DER: falta SEQUENCE');
  // longitud de la secuencia (puede ser forma larga, pero para P256 cabe en 1 byte)
  if (der[i] & 0x80) i += 1 + (der[i] & 0x7f);
  else i += 1;
  if (der[i++] !== 0x02) throw new Error('DER: falta INTEGER r');
  let rLen = der[i++];
  let r = der.slice(i, i + rLen);
  i += rLen;
  if (der[i++] !== 0x02) throw new Error('DER: falta INTEGER s');
  let sLen = der[i++];
  let s = der.slice(i, i + sLen);

  const to32 = (b: Uint8Array): Uint8Array => {
    // quita ceros de relleno del DER, luego pad a 32 por la izquierda
    let start = 0;
    while (start < b.length - 1 && b[start] === 0x00) start++;
    const trimmed = b.slice(start);
    if (trimmed.length > 32) throw new Error('DER: integer > 32 bytes');
    const out = new Uint8Array(32);
    out.set(trimmed, 32 - trimmed.length);
    return out;
  };

  const rB = to32(r);
  let sB = to32(s);
  let sBig = BigInt(bytesToHex(sB));
  if (sBig > P256_HALF_N) {
    sBig = P256_N - sBig;
    sB = hexToBytes(sBig.toString(16).padStart(64, '0'));
  }
  return { r: bytesToHex(rB), s: bytesToHex(sB) };
}

/**
 * Parte el clientDataJSON alrededor del challenge (en base64url) para que el
 * contrato lo reconstruya como pre ‖ base64url(challenge) ‖ post. Falla si el
 * challenge no aparece — jamás se firma un clientData que no lo contenga.
 */
export function splitClientData(clientDataJSON: string, challengeHex: string): { pre: string; post: string } {
  const challengeB64 = toBase64Url(hexToBytes(challengeHex));
  const idx = clientDataJSON.indexOf(challengeB64);
  if (idx < 0) throw new Error('el clientDataJSON no contiene el challenge esperado');
  return { pre: clientDataJSON.slice(0, idx), post: clientDataJSON.slice(idx + challengeB64.length) };
}

/** Compone el WebAuthnSig que consume el contrato/relayer, desde la assertion. */
export function buildWebAuthnSig(input: {
  authenticatorData: Uint8Array;
  clientDataJSON: string;
  derSignature: Uint8Array;
  challengeHex: string;
}): WebAuthnSig {
  const { pre, post } = splitClientData(input.clientDataJSON, input.challengeHex);
  const { r, s } = parseDerSignature(input.derSignature);
  return { authenticatorData: bytesToHex(input.authenticatorData), clientDataPre: pre, clientDataPost: post, r, s };
}

// ── wrappers de navegador (no testeables sin autenticador) ──────────────────

export interface PasskeyHandle {
  credentialId: string; // base64url, para localizar la passkey al firmar
  pubKeyX: string;
  pubKeyY: string;
}

const RP_NAME = 'Astryum';

/** ¿Soporta este navegador WebAuthn con plataforma (Face ID / Touch ID)? */
export function passkeySupported(): boolean {
  return typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials;
}

function b64urlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Lo que el navegador dice poder hacer ANTES de abrir la ventana; null = no lo dice. */
export interface PasskeyPlaces {
  /** Autenticador de plataforma con verificación (Touch ID, Windows Hello, un gestor de passkeys). */
  thisDevice: boolean | null;
  /** Transporte híbrido: el móvil por QR desde ESTE ordenador. En un PC exige Bluetooth. */
  phoneNearby: boolean | null;
}

/** Puro: capacidades (getClientCapabilities) + isUVPAA → dónde puede nacer la llave. */
export function readPasskeyPlaces(
  caps: Record<string, boolean> | null,
  uvpa: boolean | null
): PasskeyPlaces {
  const flag = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
  return {
    thisDevice: flag(caps?.userVerifyingPlatformAuthenticator) ?? uvpa,
    phoneNearby: flag(caps?.hybridTransport),
  };
}

/** Pregunta al navegador sin abrir ninguna ventana. Nunca lanza. */
export async function probePasskeyPlaces(): Promise<PasskeyPlaces> {
  if (!passkeySupported()) return { thisDevice: false, phoneNearby: false };
  const PKC = window.PublicKeyCredential;
  const caps = (await PKC.getClientCapabilities?.().catch(() => null)) ?? null;
  const uvpa = (await PKC.isUserVerifyingPlatformAuthenticatorAvailable?.().catch(() => null)) ?? null;
  return readPasskeyPlaces(caps, uvpa);
}

/**
 * Alta de la passkey del usuario (Face ID). Devuelve la clave pública P256
 * (x, y) para su cuenta contrafactual y el id de la credencial. Exige
 * residentKey y verificación del usuario; la llave vive en un dispositivo del
 * usuario — soberana, Z17.
 *
 * Sin `authenticatorAttachment` (fundador 2026-09-14): 'platform' escondía el
 * móvil. Pero en un PC el móvil («iPhone, iPad o Android») solo aparece CON
 * Bluetooth, y Windows Hello solo aparece si sabe hacer P-256: en el PC del
 * fundador (TPM Intel PTT) `certutil -csp "Microsoft Passport Key Storage
 * Provider" -key` muestra TODAS sus llaves FIDO en RSA — incluida la de
 * google.com, que pide ES256 primero —, así que con ES256 obligatorio Hello no
 * se ofrece. Sin Bluetooth, la salida es abrir la página EN el móvil
 * (PasskeyGate lo ofrece con un QR). Aceptar RS256 no es opción: la cuenta
 * verifica P-256 on-chain (RIP-7212).
 */
export async function registerPasskey(userLabel: string): Promise<PasskeyHandle> {
  if (!passkeySupported()) throw new Error('Este navegador no soporta passkeys.');
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: challenge as BufferSource,
      rp: { name: RP_NAME },
      user: { id: userId as BufferSource, name: userLabel, displayName: userLabel },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }], // ES256 / P-256, lo único que verifica RIP-7212
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      timeout: 60_000,
      attestation: 'none',
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('No se creó la passkey.');

  const att = cred.response as AuthenticatorAttestationResponse;
  const spki = att.getPublicKey?.();
  if (!spki) throw new Error('El autenticador no expuso la clave pública (getPublicKey).');
  const { x, y } = parseP256PublicKey(new Uint8Array(spki));
  return { credentialId: toBase64Url(new Uint8Array(cred.rawId)), pubKeyX: x, pubKeyY: y };
}

/**
 * Firma un challenge con la passkey (Face ID). El challenge es el hash exacto
 * que el contrato reconstruye — se pasa como el `challenge` de WebAuthn.
 */
export async function signWithPasskey(credentialId: string, challengeHex: string): Promise<WebAuthnSig> {
  if (!passkeySupported()) throw new Error('Este navegador no soporta passkeys.');
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: hexToBytes(challengeHex) as BufferSource,
      allowCredentials: [{ type: 'public-key', id: b64urlToBytes(credentialId) as BufferSource }],
      userVerification: 'required',
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!assertion) throw new Error('No se firmó.');

  const resp = assertion.response as AuthenticatorAssertionResponse;
  return buildWebAuthnSig({
    authenticatorData: new Uint8Array(resp.authenticatorData),
    clientDataJSON: new TextDecoder().decode(resp.clientDataJSON),
    derSignature: new Uint8Array(resp.signature),
    challengeHex,
  });
}
