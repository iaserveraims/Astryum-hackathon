/**
 * xrplSecret — las dos trampas entre lo que enseña Xaman y la cuenta que firma.
 *
 * El vector de oro es la cuenta GÉNESIS de XRPL (masterpassphrase, pública desde
 * siempre): `snoPBrXtMeMyMHUVTgbuqAfg1SUTb` → rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh.
 * Sirve de test de regresión contra el default ed25519 de `Wallet.fromSeed`, que
 * para esa misma seed devuelve rGWrZyQqhTp9Xu7G5Pkayo7bXjH4k4QYpf — otra cuenta.
 */
import { Wallet, decodeSeed } from 'xrpl';
import {
  looksLikeSecretNumbers,
  secretNumbersToFamilySeed,
  familySeedFrom,
  xrplWalletFromSecret,
  diagnoseXrplSecret,
} from '../xrplSecret';

/** Family seed secp256k1 público (masterpassphrase) — no es de nadie, sin fondos. */
const GENESIS_SEED = 'snoPBrXtMeMyMHUVTgbuqAfg1SUTb';
const GENESIS_ADDRESS = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';
/** Lo que devolvía el `Wallet.fromSeed(seed)` suelto: la cuenta EQUIVOCADA. */
const ED25519_WRONG_ADDRESS = 'rGWrZyQqhTp9Xu7G5Pkayo7bXjH4k4QYpf';

/** Los secret numbers de una seed: el mismo empaquetado que hace Xaman. */
function toSecretNumbers(seed: string): string {
  const bytes = Buffer.from(decodeSeed(seed).bytes);
  const groups: string[] = [];
  for (let i = 0; i < 8; i += 1) {
    const value = bytes.readUInt16BE(i * 2);
    groups.push(`${String(value).padStart(5, '0')}${(value * (i * 2 + 1)) % 9}`);
  }
  return groups.join(' ');
}

const GENESIS_SECRET_NUMBERS = toSecretNumbers(GENESIS_SEED);

describe('el default ed25519 de xrpl.js — la regresión que abría otra cuenta', () => {
  it('Wallet.fromSeed suelto NO da la cuenta génesis (por eso existe este módulo)', () => {
    expect(Wallet.fromSeed(GENESIS_SEED).classicAddress).toBe(ED25519_WRONG_ADDRESS);
  });

  it('xrplWalletFromSecret deriva con el algoritmo codificado en la seed', () => {
    expect(xrplWalletFromSecret(GENESIS_SEED).classicAddress).toBe(GENESIS_ADDRESS);
  });

  it('una seed ed25519 (sEd…) sigue derivando igual — no se rompe lo que ya iba', () => {
    const ed = Wallet.generate('ed25519');
    expect(xrplWalletFromSecret(ed.seed as string).classicAddress).toBe(ed.classicAddress);
  });
});

describe('secret numbers de Xaman (8×6 dígitos)', () => {
  it('los reconoce con espacios, guiones o pegados; no confunde un family seed', () => {
    expect(looksLikeSecretNumbers(GENESIS_SECRET_NUMBERS)).toBe(true);
    expect(looksLikeSecretNumbers(GENESIS_SECRET_NUMBERS.replace(/ /g, '-'))).toBe(true);
    expect(looksLikeSecretNumbers(GENESIS_SECRET_NUMBERS.replace(/ /g, ''))).toBe(true);
    expect(looksLikeSecretNumbers(GENESIS_SEED)).toBe(false);
  });

  it('convierte al MISMO family seed y por tanto a la misma cuenta', () => {
    expect(secretNumbersToFamilySeed(GENESIS_SECRET_NUMBERS)).toBe(GENESIS_SEED);
    expect(xrplWalletFromSecret(GENESIS_SECRET_NUMBERS).classicAddress).toBe(GENESIS_ADDRESS);
    // Da igual cómo se pegue el env: espacios, guiones o de corrido.
    expect(xrplWalletFromSecret(GENESIS_SECRET_NUMBERS.replace(/ /g, '')).classicAddress).toBe(GENESIS_ADDRESS);
  });

  it('un family seed pasa intacto', () => {
    expect(familySeedFrom(` ${GENESIS_SEED} `)).toBe(GENESIS_SEED);
  });

  it('un dígito de control que no cuadra se rechaza (un dedo torcido no deriva otra cuenta)', () => {
    const broken = GENESIS_SECRET_NUMBERS.replace(/^(\d{5})\d/, '$19');
    expect(() => secretNumbersToFamilySeed(broken)).toThrow(/CHECKSUM/);
  });

  it('menos de 48 dígitos = formato inválido, no un decode críptico', () => {
    expect(() => secretNumbersToFamilySeed('000000 000000')).toThrow(/MALFORMED/);
  });

  it('con la cuenta esperada como prueba, el checksum deja de ser el guardia', () => {
    // La entropía es la buena (deriva la cuenta esperada) aunque el dígito falle.
    const broken = GENESIS_SECRET_NUMBERS.replace(/^(\d{5})\d/, '$19');
    expect(xrplWalletFromSecret(broken, GENESIS_ADDRESS).classicAddress).toBe(GENESIS_ADDRESS);
    // Sin esa prueba —o si no casa— manda el checksum.
    expect(() => xrplWalletFromSecret(broken)).toThrow(/CHECKSUM/);
    expect(() => xrplWalletFromSecret(broken, 'rK4tsuGhmbhaNQuvucL8n1RKLtARBCp3qm')).toThrow(/CHECKSUM/);
  });
});

describe('expected — el cinturón que solo acepta la cuenta que TIENE que salir', () => {
  it('acepta la derivación ed25519 si es esa la cuenta esperada (cuentas nacidas del bug)', () => {
    expect(xrplWalletFromSecret(GENESIS_SEED, ED25519_WRONG_ADDRESS).classicAddress).toBe(ED25519_WRONG_ADDRESS);
  });

  it('si no casa ninguna, devuelve la canónica — jamás inventa una cuenta', () => {
    expect(xrplWalletFromSecret(GENESIS_SEED, 'rK4tsuGhmbhaNQuvucL8n1RKLtARBCp3qm').classicAddress).toBe(
      GENESIS_ADDRESS,
    );
  });
});

describe('diagnoseXrplSecret — el gauge del panel, sin enseñar la clave', () => {
  it('dice formato, cuenta y si casa; nunca devuelve la seed', () => {
    const d = diagnoseXrplSecret(GENESIS_SECRET_NUMBERS, GENESIS_ADDRESS);
    expect(d).toEqual({ format: 'secret-numbers', address: GENESIS_ADDRESS, matchesExpected: true });
    expect(JSON.stringify(d)).not.toContain(GENESIS_SEED);
  });

  it('marca el desajuste en vez de fallar en silencio', () => {
    const d = diagnoseXrplSecret(GENESIS_SEED, 'rK4tsuGhmbhaNQuvucL8n1RKLtARBCp3qm');
    expect(d.format).toBe('family-seed');
    expect(d.matchesExpected).toBe(false);
    expect(d.address).toBe(GENESIS_ADDRESS);
  });

  it('una clave ilegible da el motivo, no una excepción', () => {
    const d = diagnoseXrplSecret('esto-no-es-una-seed');
    expect(d.format).toBe('unknown');
    expect(d.error).toBeTruthy();
    expect(d.address).toBeUndefined();
  });
});
