/**
 * productizer it. 29 (§5) — «NO PUDE LEER» YA NO SE FIRMA COMO SI FUERA UN «NO».
 *
 * `sendIntent` decidía entre la ceremonia y la firma simple con una lectura del
 * SignerList en un RPC público; cuando esa lectura devolvía `null` seguía por
 * `service.submitTransaction`, donde Xaman AUTORRELLENA la `Sequence` — la única
 * forma en que dos Payments de la misma cuenta entran los dos. it. 27 puso la
 * lectura del servidor delante, pero vivía en un Map que un F5 vaciaba.
 *
 * Hasta ahora este hook «no se podía importar» (su grafo arrastra el stack de
 * wallets) y el desvío se comprobaba leyendo el fuente. Aquí se EJECUTA: los tres
 * módulos pesados se fingen en su frontera (la fábrica de wallets, el store y los
 * hooks de React), y `sendIntent` corre de verdad sobre `handoffRelease`,
 * `accountQuorum` y el bus reales.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const submitTransaction = vi.fn(async () => 'A'.repeat(64));
const ACCOUNT = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const MEMO = 'FE000000000000030D40' + 'AB'.repeat(32);

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    // The hook has no state of its own: `useMemo` builds the service, `useCallback`
    // wraps `sendIntent`. Outside a renderer both are the identity.
    useMemo: (f: () => unknown) => f(),
    useCallback: (f: unknown) => f,
  };
});
vi.mock('@/services/wallets/WalletServiceFactory', () => ({
  WalletServiceFactory: { getWalletService: () => ({ submitTransaction }) },
}));
vi.mock('@/services/wallets/XamanWalletService', () => ({ XamanWalletService: class {} }));
vi.mock('@/stores/walletStore', () => ({
  useWalletStore: (selector: (s: unknown) => unknown) =>
    selector({
      activeWallet: { id: 'w1', walletType: 'xaman' },
      wallets: [{ id: 'w1', walletType: 'xaman', isConnected: true, address: ACCOUNT }],
    }),
}));

import { useXrplWalletPartner } from '../useXrplWalletPartner';
import { __resetPayloadExpiryMin, notePayloadExpiryMin } from '../handoffRelease';
import { __resetAccountQuorumCache } from '@/lib/xrpl/accountQuorum';

function zeroFePayment(memoHex: string) {
  return {
    TransactionType: 'Payment' as const,
    Account: ACCOUNT,
    Destination: 'rCoreVaultXXXXXXXXXXXXXXXXXXXXXXXX',
    Amount: '1000000',
    Memos: [{ Memo: { MemoData: memoHex } }],
  };
}

/** Every public node fails: the read is `null` everywhere. */
function chainUnreadable(): void {
  global.fetch = vi.fn(async () => {
    throw new Error('node down');
  }) as unknown as typeof fetch;
}
/** Every node answers: this account has (or has not) a SignerList. */
function chainSays(quorum: boolean): void {
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ result: { account_objects: quorum ? [{ LedgerEntryType: 'SignerList' }] : [] } }),
  })) as unknown as typeof fetch;
}

async function rejectionOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return '';
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

beforeEach(() => {
  submitTransaction.mockClear();
  __resetPayloadExpiryMin();
  __resetAccountQuorumCache();
  vi.stubGlobal('window', {
    localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  __resetPayloadExpiryMin();
  __resetAccountQuorumCache();
});

describe('sendIntent — qué decide el camino, y qué NO puede decidirlo', () => {
  it('lectura ilegible + un 0xFE (asiento de nonce) → se rehúsa, retryable, y NADA se firma', async () => {
    chainUnreadable();
    const { sendIntent } = useXrplWalletPartner();

    const msg = await rejectionOf(sendIntent({ tx: zeroFePayment(MEMO) }));

    expect(msg).toMatch(/could not read whether this account signs by quorum/i);
    expect(msg).toMatch(/nothing was signed/i);
    expect(submitTransaction).not.toHaveBeenCalled();
  });

  it('lectura ilegible + unos bytes SIN asiento (un envío) → la firma simple de siempre', async () => {
    chainUnreadable();
    const { sendIntent } = useXrplWalletPartner();

    const out = await sendIntent({
      tx: { TransactionType: 'Payment', Account: ACCOUNT, Destination: 'rSomebody11111111111111111111111111', Amount: '1' },
    });

    expect(out.txHash).toBe('A'.repeat(64));
    expect(submitTransaction).toHaveBeenCalledTimes(1);
  });

  /**
   * it. 31 (§5) — LA COMPROBACIÓN QUE it. 29 QUITÓ, DE VUELTA.
   *
   * it. 29 escribió aquí «el servidor compuso esta fila con la ventana de una
   * firma simple → firma simple, sin preguntar a ningún nodo», y el test pasaba.
   * Pero la ventana corta sale igual de una lectura que dijo «firma sola» que de
   * un timeout del SignerList (`signingCeremonyFor` devuelve `{}` con `'unknown'`
   * y con excepción). Así que una cuenta CON quórum cuyo SignerList el servidor
   * no pudo leer se firmaba sola, con la Sequence autorrellenada — el gemelo.
   *
   * Ahora el servidor declara si LEYÓ (`signerListRead`), y la lectura del
   * navegador sólo se ahorra cuando dijo `'single'`.
   */
  it('el servidor LEYÓ «firma sola» para esta fila → firma simple, sin preguntar a ningún nodo', async () => {
    chainUnreadable(); // and it does not matter
    notePayloadExpiryMin(5, MEMO, 'single'); // what the prepare answered for THIS row: window AND read
    const { sendIntent } = useXrplWalletPartner();

    const out = await sendIntent({ tx: zeroFePayment(MEMO) });

    expect(out.txHash).toBe('A'.repeat(64));
    expect(submitTransaction).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('el servidor compuso la ventana corta SIN poder leer (`unknown`) y la cadena dice «tiene quórum» → la ceremonia, no la firma simple', async () => {
    chainSays(true);
    notePayloadExpiryMin(5, MEMO, 'unknown'); // the window is the default, not a verdict
    const { sendIntent } = useXrplWalletPartner();

    const msg = await rejectionOf(sendIntent({ tx: zeroFePayment(MEMO) }));

    // The ceremony path was taken (no host mounted here → the bus's own code),
    // which is the one outcome it. 29 made impossible for this row.
    expect(msg).toMatch(/QUORUM_CEREMONY_NO_HOST/);
    expect(submitTransaction).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalled(); // the browser DID read the SignerList
  });

  it('una ventana corta sin declaración de lectura (backend antiguo) → también vuelve a leer', async () => {
    chainSays(true);
    notePayloadExpiryMin(5, MEMO); // no `signerListRead` at all
    const { sendIntent } = useXrplWalletPartner();

    const msg = await rejectionOf(sendIntent({ tx: zeroFePayment(MEMO) }));

    expect(msg).toMatch(/QUORUM_CEREMONY_NO_HOST/);
    expect(submitTransaction).not.toHaveBeenCalled();
  });

  it('`unknown` del servidor + cadena ilegible + un 0xFE → se rehúsa, jamás la firma simple', async () => {
    chainUnreadable();
    notePayloadExpiryMin(5, MEMO, 'unknown');
    const { sendIntent } = useXrplWalletPartner();

    const msg = await rejectionOf(sendIntent({ tx: zeroFePayment(MEMO) }));

    expect(msg).toMatch(/could not read whether this account signs by quorum/i);
    expect(submitTransaction).not.toHaveBeenCalled();
  });

  /**
   * it. 31 (§6): only a 0xFE holds a nonce seat. A memo'd Payment that is not an
   * `FE…` instruction (a proof-by-memo, a tag) used to trip the same refusal
   * because `paymentMemoHex` accepts any 8–2048 hex memo.
   */
  it('lectura ilegible + un memo que NO es un 0xFE → la firma simple de siempre (no hay asiento que contestar)', async () => {
    chainUnreadable();
    const { sendIntent } = useXrplWalletPartner();

    const out = await sendIntent({
      tx: {
        TransactionType: 'Payment',
        Account: ACCOUNT,
        Destination: 'rSomebody11111111111111111111111111',
        Amount: '1',
        Memos: [{ Memo: { MemoData: 'AB'.repeat(32) } }], // 64 hex, not FE-prefixed
      },
    });

    expect(out.txHash).toBe('A'.repeat(64));
    expect(submitTransaction).toHaveBeenCalledTimes(1);
  });

  it('el servidor declaró ceremonia para esta fila → la ceremonia, aunque ningún nodo conteste', async () => {
    chainUnreadable();
    notePayloadExpiryMin(1440, MEMO);
    const { sendIntent } = useXrplWalletPartner();

    // No host is mounted in this harness: the bus refuses at once with its own
    // code — which is exactly the proof that the CEREMONY path was taken.
    const msg = await rejectionOf(sendIntent({ tx: zeroFePayment(MEMO) }));

    expect(msg).toMatch(/QUORUM_CEREMONY_NO_HOST/);
    expect(submitTransaction).not.toHaveBeenCalled();
  });

  it('la cadena dice «tiene quórum» → la ceremonia', async () => {
    chainSays(true);
    const { sendIntent } = useXrplWalletPartner();
    const msg = await rejectionOf(sendIntent({ tx: zeroFePayment(MEMO) }));
    expect(msg).toMatch(/QUORUM_CEREMONY_NO_HOST/);
    expect(submitTransaction).not.toHaveBeenCalled();
  });

  it('la cadena dice «firma sola» → la firma simple', async () => {
    chainSays(false);
    const { sendIntent } = useXrplWalletPartner();
    const out = await sendIntent({ tx: zeroFePayment(MEMO) });
    expect(out.txHash).toBe('A'.repeat(64));
    expect(submitTransaction).toHaveBeenCalledTimes(1);
  });
});

describe('accountHasQuorum — un nodo caído no es «no lo sé»', () => {
  it('el primer nodo falla y el segundo contesta: la respuesta es la del segundo', async () => {
    const urls: string[] = [];
    global.fetch = vi.fn(async (url: unknown) => {
      urls.push(String(url));
      if (urls.length === 1) throw new Error('balancer sick');
      return { ok: true, json: async () => ({ result: { account_objects: [{ LedgerEntryType: 'SignerList' }] } }) };
    }) as unknown as typeof fetch;
    const { accountHasQuorum } = await import('@/lib/xrpl/accountQuorum');

    expect(await accountHasQuorum(ACCOUNT)).toBe(true);
    expect(urls).toHaveLength(2);
    expect(urls[0]).not.toBe(urls[1]);
  });

  it('un nodo que contesta un error que no es actNotFound no es un veredicto: se pregunta al siguiente', async () => {
    let n = 0;
    global.fetch = vi.fn(async () => {
      n++;
      if (n === 1) return { ok: true, json: async () => ({ result: { error: 'tooBusy' } }) };
      return { ok: true, json: async () => ({ result: { account_objects: [] } }) };
    }) as unknown as typeof fetch;
    const { accountHasQuorum } = await import('@/lib/xrpl/accountQuorum');

    expect(await accountHasQuorum(ACCOUNT)).toBe(false);
    expect(n).toBe(2);
  });

  it('todos los nodos fallan → null, y ese null no se cachea', async () => {
    let n = 0;
    global.fetch = vi.fn(async () => {
      n++;
      throw new Error('down');
    }) as unknown as typeof fetch;
    const { accountHasQuorum } = await import('@/lib/xrpl/accountQuorum');

    expect(await accountHasQuorum(ACCOUNT)).toBeNull();
    expect(n).toBe(3); // every node we know of was asked
    expect(await accountHasQuorum(ACCOUNT)).toBeNull();
    expect(n).toBe(6); // …and asked again next time, not remembered as «unknown»
  });
});
