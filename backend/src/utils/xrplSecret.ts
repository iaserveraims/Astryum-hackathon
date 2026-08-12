/**
 * xrplSecret — EL único sitio del backend donde una clave XRPL de infra PROPIA
 * se convierte en la Wallet que firma. Dos trampas, las dos mordidas de verdad:
 *
 * 1. **Formato.** Xaman enseña por defecto los "secret numbers" (8 grupos de 6
 *    dígitos), no el family seed. xrpl.js 4.x no los sabe leer: no existe
 *    `Wallet.fromSecretNumbers`. El anchor-feed llevaba desde el 6-ago-2026
 *    fallando cada tick por esto.
 *
 * 2. **Algoritmo.** `Wallet.fromSeed(s)` de xrpl.js 4.5 deriva SIEMPRE ed25519:
 *    pasa `algorithm: opts.algorithm ?? ECDSA.ed25519` a `deriveKeypair`, que
 *    solo mira el tipo codificado en la seed cuando NO le pasan algoritmo. Con
 *    una seed secp256k1 (la que da Xaman) sale otra cuenta, en silencio.
 *    Vector canónico: `snoPBrXtMeMyMHUVTgbuqAfg1SUTb` es la cuenta génesis
 *    rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh, pero `Wallet.fromSeed` devuelve
 *    rGWrZyQqhTp9Xu7G5Pkayo7bXjH4k4QYpf. Aquí se deriva SIEMPRE con el
 *    algoritmo que la propia seed lleva codificado.
 *
 * Prohibido volver a llamar a `Wallet.fromSeed` suelto: se importa esto.
 *
 * Frontera regulatoria (invariante #1): esto solo toca claves de infraestructura
 * PROPIA de Astryum (anchor del consejo, keeper de escrows). Ninguna clave de
 * usuario pasa por el backend, y este módulo jamás devuelve ni registra la seed.
 */
import { ECDSA, Wallet, decodeSeed, encodeSeed } from 'xrpl';

/** Los 8×6 dígitos de Xaman, con espacios, guiones o pegados. */
export function looksLikeSecretNumbers(raw: string): boolean {
  return /^\d{48}$/.test(raw.replace(/[\s-]+/g, ''));
}

/**
 * Secret numbers → family seed secp256k1.
 *
 * Cada grupo son 5 dígitos de valor (un uint16 big-endian) + 1 de checksum,
 * `valor * (posición * 2 + 1) % 9`. Los 8 valores concatenados son los 128 bits
 * de entropía de los que sale el family seed — el mismo que enseña Xaman al
 * exportar la cuenta.
 *
 * `verifyChecksum: false` salta la comprobación: solo lo usa el fallback que
 * exige que la cuenta derivada case con la esperada (ver `xrplWalletFromSecret`),
 * donde la cuenta ES la prueba y el checksum sobra.
 */
export function secretNumbersToFamilySeed(raw: string, opts: { verifyChecksum?: boolean } = {}): string {
  const digits = raw.replace(/[\s-]+/g, '');
  if (!/^\d{48}$/.test(digits)) {
    throw new Error('XRPL_SECRET_NUMBERS_MALFORMED: se esperaban 8 grupos de 6 dígitos (48 en total)');
  }
  const entropy = new Uint8Array(16);
  for (let i = 0; i < 8; i += 1) {
    const group = digits.slice(i * 6, i * 6 + 6);
    const value = Number(group.slice(0, 5));
    if (opts.verifyChecksum !== false && (value * (i * 2 + 1)) % 9 !== Number(group.slice(5))) {
      throw new Error(
        `XRPL_SECRET_NUMBERS_CHECKSUM: el grupo ${i + 1} no cuadra su dígito de control — revisa los dígitos`,
      );
    }
    entropy[i * 2] = (value >>> 8) & 0xff;
    entropy[i * 2 + 1] = value & 0xff;
  }
  return encodeSeed(entropy, 'secp256k1');
}

/** Acepta los dos formatos que da Xaman y devuelve siempre el family seed. */
export function familySeedFrom(raw: string): string {
  const s = raw.trim();
  return looksLikeSecretNumbers(s) ? secretNumbersToFamilySeed(s) : s;
}

/** El algoritmo codificado en la seed — el que xrpl.js ignora por defecto. */
function algorithmOf(seed: string): ECDSA {
  return decodeSeed(seed).type === 'ed25519' ? ECDSA.ed25519 : ECDSA.secp256k1;
}

/**
 * La Wallet que de verdad firma, desde un family seed (`s…`) o desde los secret
 * numbers de Xaman.
 *
 * `expected` (la cuenta que TIENE que salir) es el cinturón de seguridad, y solo
 * se usa para aceptar una derivación alternativa cuando la canónica no casa:
 *
 * - el otro algoritmo, porque hay cuentas creadas justo con el default ed25519
 *   de xrpl.js sobre una seed secp256k1;
 * - los secret numbers sin verificar el checksum, porque si la cuenta derivada
 *   es la esperada, la entropía era correcta pase lo que pase con el dígito.
 *
 * Sin `expected` no se adivina nada: se deriva con el algoritmo de la seed y el
 * checksum es guardia dura. Nunca devuelve una cuenta que no sea la esperada sin
 * que el llamante pueda verlo — devuelve la canónica y que él decida.
 */
export function xrplWalletFromSecret(raw: string, expected?: string): Wallet {
  const s = raw.trim();
  let seed: string;
  try {
    seed = familySeedFrom(s);
  } catch (e) {
    if (!expected || !looksLikeSecretNumbers(s)) throw e;
    const relaxed = deriveMatching(secretNumbersToFamilySeed(s, { verifyChecksum: false }), expected);
    if (relaxed.classicAddress !== expected) throw e; // sin la prueba, el checksum manda
    return relaxed;
  }
  return deriveMatching(seed, expected);
}

/** Deriva con el algoritmo de la seed; solo cambia al otro si eso da `expected`. */
function deriveMatching(seed: string, expected?: string): Wallet {
  const primary = Wallet.fromSeed(seed, { algorithm: algorithmOf(seed) });
  if (!expected || primary.classicAddress === expected) return primary;

  const sibling = Wallet.fromSeed(seed, {
    algorithm: algorithmOf(seed) === ECDSA.ed25519 ? ECDSA.secp256k1 : ECDSA.ed25519,
  });
  return sibling.classicAddress === expected ? sibling : primary;
}

export interface XrplSecretDiagnosis {
  /** Qué formato se reconoció en el env — jamás el contenido. */
  format: 'family-seed' | 'secret-numbers' | 'unknown';
  /** La cuenta que deriva (dato público, no es la clave). */
  address?: string;
  /** true = deriva la cuenta esperada; sin `expected`, undefined. */
  matchesExpected?: boolean;
  /** El motivo cuando no deriva nada (checksum, base58 inválido…). */
  error?: string;
}

/**
 * Diagnóstico para el panel: por qué una clave de infra no abre su cuenta, sin
 * enseñar la clave. Misma filosofía que `/api/access-gate`: la pantalla dice QUÉ
 * falla, en vez de dejarlo en conjetura.
 */
export function diagnoseXrplSecret(raw: string | undefined, expected?: string): XrplSecretDiagnosis {
  const s = (raw ?? '').trim();
  const format = looksLikeSecretNumbers(s) ? 'secret-numbers' : s.startsWith('s') ? 'family-seed' : 'unknown';
  try {
    const address = xrplWalletFromSecret(s, expected).classicAddress;
    return { format, address, matchesExpected: expected ? address === expected : undefined };
  } catch (e) {
    return { format, error: (e as Error).message };
  }
}
