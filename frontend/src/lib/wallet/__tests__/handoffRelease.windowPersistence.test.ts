/**
 * productizer it. 29 (§5) — LA VENTANA DE UNA FILA SOBREVIVE A UNA RECARGA.
 *
 * `perMemoExpiryMin` era un `Map` de módulo: tras un F5 `serverDeclaredCeremony(memo)`
 * volvía a `false`, la decisión caía en el RPC público y, cuando ese devolvía
 * `null`, `sendIntent` seguía por la firma simple con la `Sequence` autorrellenada —
 * el gemelo que it. 27 decía cerrar. Aquí «recargar» es tirar el módulo y volver a
 * importarlo sobre el MISMO almacén del navegador (fingido): lo que el servidor
 * dijo de una fila tiene que seguir ahí.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const MEMO_CEREMONY = 'FE000000000000030D40' + 'AB'.repeat(32);
const MEMO_ORDINARY = 'FE000000000000030D40' + 'CD'.repeat(32);

/** A browser storage that outlives a module reload — the thing an F5 keeps. */
function fakeStorage(seed: Record<string, string> = {}) {
  const data = new Map<string, string>(Object.entries(seed));
  return {
    data,
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

type Mod = typeof import('../handoffRelease');
async function freshModule(): Promise<Mod> {
  vi.resetModules();
  return import('../handoffRelease');
}

let storage = fakeStorage();
beforeEach(() => {
  storage = fakeStorage();
  vi.stubGlobal('window', { localStorage: storage });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('lo que el servidor dijo de una fila sobrevive a un F5', () => {
  it('una ceremonia declarada antes de recargar sigue declarada después', async () => {
    const before = await freshModule();
    before.notePayloadExpiryMin(1440, MEMO_CEREMONY);
    expect(before.serverDeclaredCeremony(MEMO_CEREMONY)).toBe(true);

    const after = await freshModule(); // the F5: new module, same storage
    expect(after.serverDeclaredCeremony(MEMO_CEREMONY)).toBe(true);
    expect(after.ceremonyPayloadExpiryMin(MEMO_CEREMONY)).toBe(1440);
  });

  /**
   * it. 31 (§5): a single signature is only «declared» when the server said it
   * READ the SignerList (`signerListRead: 'single'`). The reading survives the
   * reload with the window it qualifies; a short window noted WITHOUT it is not a
   * verdict before the reload and must not become one after it.
   */
  it('…y una firma simple LEÍDA también: el servidor dijo que leyó esa cuenta', async () => {
    const before = await freshModule();
    before.notePayloadExpiryMin(5, MEMO_ORDINARY, 'single');
    expect(before.serverDeclaredSingleSignature(MEMO_ORDINARY)).toBe(true);

    const after = await freshModule();
    expect(after.serverDeclaredSingleSignature(MEMO_ORDINARY)).toBe(true);
    expect(after.serverSignerListRead(MEMO_ORDINARY)).toBe('single');
    expect(after.serverDeclaredCeremony(MEMO_ORDINARY)).toBe(false);
    expect(after.payloadExpiryMin(undefined, MEMO_ORDINARY)).toBe(5);
  });

  it('una ventana corta SIN lectura declarada no es «firma sola» — ni antes ni después de recargar', async () => {
    const before = await freshModule();
    before.notePayloadExpiryMin(5, MEMO_ORDINARY); // what an older backend answers: the window alone
    expect(before.serverDeclaredSingleSignature(MEMO_ORDINARY)).toBe(false);
    expect(before.serverSignerListRead(MEMO_ORDINARY)).toBe('unknown');

    const after = await freshModule();
    expect(after.serverDeclaredSingleSignature(MEMO_ORDINARY)).toBe(false);
    expect(after.payloadExpiryMin(undefined, MEMO_ORDINARY)).toBe(5); // the window itself is still learnt

    // …and a server that SAID it could not read is exactly the same silence.
    const unknown = await freshModule();
    unknown.notePayloadExpiryMin(5, MEMO_ORDINARY, 'unknown');
    expect(unknown.serverDeclaredSingleSignature(MEMO_ORDINARY)).toBe(false);
    expect((await freshModule()).serverDeclaredSingleSignature(MEMO_ORDINARY)).toBe(false);
  });

  it('el silencio sigue sin ser un veredicto tras recargar', async () => {
    const m = await freshModule();
    expect(m.serverDeclaredCeremony(MEMO_CEREMONY)).toBe(false);
    expect(m.serverDeclaredSingleSignature(MEMO_CEREMONY)).toBe(false);
  });
});

describe('la nota escrita es acotada, caduca y no se fía de lo que encuentra', () => {
  const KEY = 'astryum.handoff.rowWindow.v1';

  it('una nota más vieja que la vida máxima de un payload se descarta al leer', async () => {
    storage.setItem(
      KEY,
      JSON.stringify({ [MEMO_CEREMONY]: { m: 1440, t: Date.now() - 26 * 60 * 60 * 1000 } }),
    );
    const m = await freshModule();
    expect(m.serverDeclaredCeremony(MEMO_CEREMONY)).toBe(false);
  });

  it('una nota corrupta no rompe nada: el módulo se comporta como it. 27', async () => {
    storage.setItem(KEY, '{not json');
    const m = await freshModule();
    expect(m.serverDeclaredCeremony(MEMO_CEREMONY)).toBe(false);
    m.notePayloadExpiryMin(1440, MEMO_CEREMONY);
    expect(m.serverDeclaredCeremony(MEMO_CEREMONY)).toBe(true);
  });

  it('un valor absurdo escrito en el almacén no se aprende', async () => {
    storage.setItem(KEY, JSON.stringify({ [MEMO_CEREMONY]: { m: 99_999, t: Date.now() } }));
    const m = await freshModule();
    expect(m.serverDeclaredCeremony(MEMO_CEREMONY)).toBe(false);
  });

  it('sin almacén (modo privado) el Map manda y nada revienta', async () => {
    vi.stubGlobal('window', {
      get localStorage(): Storage {
        throw new Error('SecurityError');
      },
    });
    const m = await freshModule();
    m.notePayloadExpiryMin(1440, MEMO_CEREMONY);
    expect(m.serverDeclaredCeremony(MEMO_CEREMONY)).toBe(true);
  });

  it('el reset de tests también borra la nota escrita', async () => {
    const m = await freshModule();
    m.notePayloadExpiryMin(1440, MEMO_CEREMONY);
    expect(storage.getItem(KEY)).not.toBeNull();
    m.__resetPayloadExpiryMin();
    expect(storage.getItem(KEY)).toBeNull();
    expect(m.serverDeclaredCeremony(MEMO_CEREMONY)).toBe(false);
  });
});
