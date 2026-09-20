/**
 * isXrplWallet — the classifier behind the "Reinforce it" door.
 *
 * WHY THIS EXISTS (2026-08-21). The door was first written as
 * `w.ecosystem === 'xrpl'` and simply never appeared. The reason is a row the
 * product manufactures itself: `dedupeWallets` folds the signed-in account's
 * login address into the list as `{ address, label: 'Login wallet',
 * chainId: 14 }` when it is not registered in /api/wallets/mine — no
 * `ecosystem`, and a hardcoded Flare chainId on what may well be an XRPL
 * account. So the field lies by omission on exactly the surface where the
 * user keeps their wallet.
 *
 * The rule this locks down: the ADDRESS decides. That is the same direction
 * the backend already enforces when registering a wallet (it derives the
 * ecosystem from the address shape and refuses a caller's contradicting
 * claim), so the two ends agree.
 */

import { describe, expect, it } from 'vitest';
import {
  isXrplWallet,
  walletDisplayName,
  walletDisplayNameMap,
  walletColor,
  LEGACY_WALLET_COLOR,
  WALLET_COLOR_PRESETS,
  usesXamanAvatar,
} from '../walletIdentity';
import { dominantHex, setXamanHue } from '../wallet/xamanHues';

// A real mainnet XRPL classic address (the Legacy order anchor in this repo's
// env) — a shape check with a made-up string proves nothing about length.
const XRPL = 'rK4tsuGhmbhaNQuvucL8n1RKLtARBCp3qm';
const EVM = '0x1234567890abcdef1234567890abcdef12345678';

describe('isXrplWallet', () => {
  it('trusts an explicit xrpl ecosystem', () => {
    expect(isXrplWallet({ address: XRPL, ecosystem: 'xrpl' })).toBe(true);
  });

  it('recognises an XRPL address with NO ecosystem — the "Login wallet" row', () => {
    expect(isXrplWallet({ address: XRPL })).toBe(true);
  });

  it('recognises an XRPL address the synthetic row mislabels as Flare', () => {
    // dedupeWallets stamps chainId 14 on the login row regardless of chain;
    // the address still says XRPL and the address wins.
    expect(isXrplWallet({ address: XRPL, ecosystem: undefined })).toBe(true);
  });

  it('rejects an EVM address', () => {
    expect(isXrplWallet({ address: EVM, ecosystem: 'evm' })).toBe(false);
  });

  it('rejects an EVM address with no ecosystem', () => {
    expect(isXrplWallet({ address: EVM })).toBe(false);
  });

  it('rejects an empty or absent address rather than guessing', () => {
    expect(isXrplWallet({ address: '' })).toBe(false);
    expect(isXrplWallet({})).toBe(false);
  });

  it('rejects an r-prefixed string that is too short to be an address', () => {
    expect(isXrplWallet({ address: 'rShort' })).toBe(false);
  });

  it('rejects base58-illegal characters (0, O, I, l) inside the body', () => {
    expect(isXrplWallet({ address: 'r0OIl' + 'a'.repeat(25) })).toBe(false);
  });
});

/* ── The 2026-08-22 identity kit: never-the-address, numbering, indigo ────── */

describe('walletDisplayName never returns the address (founder 2026-08-22)', () => {
  it("the login row filed as 'siwe' reads as an honest generic, not 0x…", () => {
    expect(walletDisplayName({ address: EVM, walletType: 'siwe', ecosystem: 'evm' })).toBe('Ethereum wallet');
  });

  it('an unrecognised XRPL row reads as XRPL wallet', () => {
    expect(walletDisplayName({ address: XRPL, ecosystem: 'xrpl' })).toBe('XRPL wallet');
  });

  it('a proper-cased connector name is shown as-is (Rabby, Brave Wallet)', () => {
    expect(walletDisplayName({ address: EVM, walletType: 'Rabby', ecosystem: 'evm' })).toBe('Rabby');
    expect(walletDisplayName({ address: EVM, walletType: 'Brave Wallet', ecosystem: 'evm' })).toBe('Brave Wallet');
  });

  it("raw plumbing values ('manual' curated, 'evm' generic) never reach the screen", () => {
    expect(walletDisplayName({ address: XRPL, walletType: 'manual', ecosystem: 'xrpl' })).toBe('Watch-only');
    expect(walletDisplayName({ address: EVM, walletType: 'evm', ecosystem: 'evm' })).toBe('Ethereum wallet');
  });
});

describe('walletDisplayNameMap numbers duplicates stably', () => {
  const A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  it('two unnamed MetaMasks become MetaMask / MetaMask 2, by address order', () => {
    const map = walletDisplayNameMap([
      { address: B, walletType: 'MetaMask', ecosystem: 'evm' },
      { address: A, walletType: 'MetaMask', ecosystem: 'evm' },
    ]);
    expect(map.get(A)).toBe('MetaMask');
    expect(map.get(B)).toBe('MetaMask 2');
  });

  it('a user nickname never gets a number and never collides', () => {
    const map = walletDisplayNameMap([
      { address: A, walletType: 'MetaMask', ecosystem: 'evm', nickname: 'Fría' },
      { address: B, walletType: 'MetaMask', ecosystem: 'evm' },
    ]);
    expect(map.get(A)).toBe('Fría');
    expect(map.get(B)).toBe('MetaMask'); // alone in its base name — unnumbered
  });
});

describe('walletColor: a council is ALWAYS the Legacy indigo', () => {
  it('ignores a stored personal colour on a council row', () => {
    expect(
      walletColor({ color: '#f97316', walletType: 'Council · multisig', ecosystem: 'xrpl' }),
    ).toBe(LEGACY_WALLET_COLOR);
  });
});

/**
 * EL DISTINTIVO POR WALLET (fundador 2026-09-13: «la X de Xaman, pero con un
 * distintivo para cada wallet de Xaman que se conecte»).
 *
 * El color ya era el distintivo de la casa, pero el reparto POR DEFECTO era
 * uno por MARCA: dos cuentas de Xaman sin color elegido a mano salían
 * idénticas en todas las superficies — que es justo el caso que el fundador
 * quiere separar. Ahora el tono se deriva de la dirección. Lo que vigila este
 * bloque es que siga siendo un distintivo LOCAL y ESTABLE: la alternativa que
 * se retiró (7c1aeffb) resolvía lo mismo pidiéndole la imagen a un tercero.
 */
describe('walletColor: el distintivo por wallet', () => {
  const xaman = (address: string) => ({ address, color: null, walletType: 'xaman', ecosystem: 'xrpl' });

  it('dos wallets de Xaman sin color elegido NO comparten tono', () => {
    const a = walletColor(xaman('rDsbeomae4FXwgQTJp9Rs64Qg9vDiTCdBv'));
    const b = walletColor(xaman('rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY'));
    expect(a).not.toBe(b);
  });

  it('la misma dirección da SIEMPRE el mismo tono — entre renders y dispositivos', () => {
    const once = walletColor(xaman(XRPL));
    for (let i = 0; i < 50; i++) expect(walletColor(xaman(XRPL))).toBe(once);
  });

  it('el tono sale del catálogo de la casa, nunca un color inventado', () => {
    for (const a of [XRPL, 'rDsbeomae4FXwgQTJp9Rs64Qg9vDiTCdBv', 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY', EVM]) {
      expect(WALLET_COLOR_PRESETS as readonly string[]).toContain(walletColor(xaman(a)));
    }
  });

  it('el color elegido a mano GANA a la derivación', () => {
    expect(walletColor({ ...xaman(XRPL), color: '#f43f5e' })).toBe('#f43f5e');
  });

  it('un consejo conserva su índigo aunque su dirección derive otro tono', () => {
    expect(walletColor({ address: XRPL, color: null, walletType: 'Council · multisig', ecosystem: 'xrpl' })).toBe(
      LEGACY_WALLET_COLOR,
    );
  });

  it('sin dirección no revienta: cae al tono de la marca', () => {
    expect(typeof walletColor({ color: null, walletType: 'xaman', ecosystem: 'xrpl' })).toBe('string');
  });

  it('reparte de verdad: seis direcciones reales no colapsan en un solo tono', () => {
    const addrs = [
      'rDsbeomae4FXwgQTJp9Rs64Qg9vDiTCdBv',
      'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
      'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY',
      'rnBTXYFn9hCe4KurTwvcPeYrjnhCB9Pjbm',
      'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B',
      'rK4tsuGhmbhaNQuvucL8n1RKLtARBCp3qm',
    ];
    const tones = new Set(addrs.map((a) => walletColor(xaman(a))));
    expect(tones.size).toBeGreaterThanOrEqual(4);
  });
});

/**
 * EL COLOR DEL CUBITO (fundador 2026-09-13): el avatar de Xaman de cada
 * cuenta manda su color dominante a la tarjeta — solo en wallets de Xaman,
 * solo cuando ya se leyó, y nunca por encima del color elegido a mano.
 */
describe('walletColor: el color del cubito de Xaman', () => {
  const xaman = (address: string) => ({ address, color: null, walletType: 'xaman', ecosystem: 'xrpl' });

  it('una wallet de Xaman toma el color de su cubito en cuanto se conoce', () => {
    const before = walletColor(xaman(XRPL));
    setXamanHue(XRPL, '#3355cc');
    expect(walletColor(xaman(XRPL))).toBe('#3355cc');
    expect(before).not.toBe('#3355cc');
  });

  it('el color elegido a mano sigue ganando al cubito', () => {
    setXamanHue(XRPL, '#3355cc');
    expect(walletColor({ ...xaman(XRPL), color: '#f43f5e' })).toBe('#f43f5e');
  });

  it('una wallet XRPL que NO es de Xaman no lleva cubito ni toma su color', () => {
    setXamanHue(XRPL, '#3355cc');
    const watch = { address: XRPL, color: null, walletType: 'manual', ecosystem: 'xrpl' };
    expect(usesXamanAvatar(watch)).toBe(false);
    expect(walletColor(watch)).not.toBe('#3355cc');
    expect(usesXamanAvatar(xaman(XRPL))).toBe(true);
    expect(usesXamanAvatar({ address: EVM, walletType: 'xaman', ecosystem: 'evm' })).toBe(false);
  });
});

describe('dominantHex: el color dominante de un avatar', () => {
  const px = (r: number, g: number, b: number, a = 255, n = 1) => Array(n).fill([r, g, b, a]).flat();

  it('elige el tono más presente y devuelve un color real de la imagen', () => {
    // 6 azules, 3 verdes, 2 transparentes, 4 grises (sombras) → azul
    const data = [...px(40, 80, 220, 255, 6), ...px(40, 200, 60, 255, 3), ...px(255, 0, 0, 10, 2), ...px(120, 120, 125, 255, 4)];
    expect(dominantHex(data)).toBe('#2850dc');
  });

  it('ignora transparentes, negros y grises — sin color saturado no inventa nada', () => {
    expect(dominantHex([...px(0, 0, 0), ...px(30, 30, 30), ...px(200, 200, 200), ...px(255, 0, 0, 0)])).toBeNull();
    expect(dominantHex([])).toBeNull();
  });
});
