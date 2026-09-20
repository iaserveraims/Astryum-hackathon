import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareRecall } from '@/lib/institutional/api';
import { createMemberPayload, paymentMemoHex } from '@/lib/xrpl/councilSigning';
import {
  ORDINARY_PAYLOAD_EXPIRY_MAX_MIN,
  __resetPayloadExpiryMin,
  serverDeclaredCeremony,
} from '@/lib/wallet/handoffRelease';
import { releaseCeremonySeat } from '@/components/legacy/CouncilMultisigFlow';

/**
 * productizer it. 27 — LA CADENA DE LA VENTANA, DE PUNTA A PUNTA.
 *
 * Tres roturas de la misma cadena, y las tres pasaban sus tests de pieza:
 *
 *   1. el servidor decide desde it. 25 §2.1 cuánto vive el payload de un 0xFE
 *      (lee el SignerList de la cuenta y compone la `LastLedgerSequence` con esa
 *      ventana), y su número no llegaba a NINGÚN payload: las tres puertas que
 *      lo aprenden llamaban a `notePayloadExpiryMin` SIN memo, y 1440 pasa del
 *      clamp ordinario, así que la rama de pestaña también lo descartaba. Lo que
 *      hacía funcionar la ceremonia era un `expire: 1440` escrito a mano;
 *   2. la puerta que devuelve el asiento de nonce (`/multisign/release`) se
 *      llamaba con un solo parámetro, y el servidor hace `if (!memo) return {}`
 *      en su primera línea: el asiento seguía ocupado 24 h después de cancelar;
 *   3. el desvío del navegador a la ceremonia dependía SOLO de su propia lectura
 *      del SignerList, que puede discrepar de la del servidor — y en la
 *      dirección que hace daño (servidor «ceremonia», navegador «no lo sé») se
 *      firmaba con la `Sequence` autorrellenada por Xaman.
 *
 * Aquí se ejecuta la cadena entera con los módulos que envían: la respuesta del
 * servidor entra por `lib/institutional/api`, y lo que sale es el `expire` del
 * payload de un miembro y el cuerpo de la petición de liberación.
 */

const API = 'http://localhost:4000';
const CEREMONY_MEMO = 'FE000000000000030D40' + 'AB'.repeat(32);
const ORDINARY_MEMO = 'FE000000000000030D40' + 'CD'.repeat(32);

/** El Payment que un consejo firma: un 0xFE con su memo, tal cual sale del prepare. */
function zeroFePayment(memoHex: string): Record<string, unknown> {
  return {
    TransactionType: 'Payment',
    Account: 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf',
    Destination: 'rCoreVaultXXXXXXXXXXXXXXXXXXXXXXXX',
    Amount: '1000000',
    Memos: [{ Memo: { MemoData: memoHex } }],
  };
}

/** La respuesta de un prepare que compone un 0xFE: la caducidad Y el memo, juntos. */
function stubPrepare(body: Record<string, unknown>): void {
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  })) as unknown as typeof fetch;
}

/** La ruta de Xaman que acuña la petición de un miembro. Guarda lo que se le pide. */
function stubXamanCreate(): { bodies: Array<Record<string, unknown>> } {
  const bodies: Array<Record<string, unknown>> = [];
  global.fetch = vi.fn(async (_url: unknown, init?: { body?: string }) => {
    bodies.push(JSON.parse(String(init?.body ?? '{}')));
    return { ok: true, json: async () => ({ uuid: 'u-1', refs: { qr_png: 'x' }, next: { always: 'y' } }) };
  }) as unknown as typeof fetch;
  return { bodies };
}

beforeEach(() => {
  __resetPayloadExpiryMin();
  vi.stubGlobal('window', {
    localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  });
  process.env.NEXT_PUBLIC_API_URL = API;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  __resetPayloadExpiryMin();
});

describe('la ventana que el servidor decidió llega al payload que un miembro firma', () => {
  it('un prepare que declara ceremonia (1440) acuña peticiones de 24 h PARA ESA FILA', async () => {
    stubPrepare({ ok: true, payloadExpiryMin: 1440, memoHex: CEREMONY_MEMO, xrplPayment: zeroFePayment(CEREMONY_MEMO) });
    await prepareRecall({ pote: '0xPOTE', venueId: 1, amountBase: '1' });

    const xaman = stubXamanCreate();
    await createMemberPayload(zeroFePayment(CEREMONY_MEMO), 'rMEMBER');

    expect((xaman.bodies[0].options as { expire?: number }).expire).toBe(1440);
  });

  /**
   * LA MITAD QUE DUELE, Y QUE ES EL PUNTO ENTERO DE «UNA SOLA LECTURA». Si el
   * servidor compuso esos bytes con la ventana de una firma simple, acuñar un
   * payload de 24 h es firmar durante horas algo que el ledger deja de admitir a
   * los seis minutos (`tefMAX_LEDGER`). El número del servidor manda también
   * cuando es incómodo: la ceremonia caduca a la vista en vez de morir callada.
   */
  it('…y cuando el servidor compuso una ventana corta, la petición también es corta', async () => {
    stubPrepare({ ok: true, payloadExpiryMin: 5, memoHex: ORDINARY_MEMO, xrplPayment: zeroFePayment(ORDINARY_MEMO) });
    await prepareRecall({ pote: '0xPOTE', venueId: 1, amountBase: '1' });

    const xaman = stubXamanCreate();
    await createMemberPayload(zeroFePayment(ORDINARY_MEMO), 'rMEMBER');

    expect((xaman.bodies[0].options as { expire?: number }).expire).toBe(5);
  });

  /**
   * La ventana es de una FILA, no de la pestaña: abrir la salida de un pote de
   * consejo y firmar después un 0xFE cualquiera no puede acuñar 24 h sobre el
   * asiento de nonce de otra cuenta (it. 25 §2, conservado).
   */
  it('la ventana de una ceremonia no se contagia a los bytes de otra fila', async () => {
    stubPrepare({ ok: true, payloadExpiryMin: 1440, memoHex: CEREMONY_MEMO });
    await prepareRecall({ pote: '0xPOTE', venueId: 1, amountBase: '1' });
    stubPrepare({ ok: true, payloadExpiryMin: 5, memoHex: ORDINARY_MEMO });
    await prepareRecall({ pote: '0xPOTE', venueId: 2, amountBase: '1' });

    const xaman = stubXamanCreate();
    await createMemberPayload(zeroFePayment(ORDINARY_MEMO), 'rMEMBER');
    expect((xaman.bodies[0].options as { expire?: number }).expire).toBe(5);
  });

  /**
   * Unos bytes que el servidor NUNCA compuso (una constitución, un SignerSet: sin
   * memo de 0xFE) siguen siendo una ceremonia: un quórum firma a velocidad humana
   * y el defecto ordinario de 5 minutos haría imposible juntar las firmas.
   */
  it('sin memo de 0xFE queda el defecto de una ceremonia, jamás el de una firma simple', async () => {
    stubPrepare({ ok: true, payloadExpiryMin: 5, memoHex: ORDINARY_MEMO });
    await prepareRecall({ pote: '0xPOTE', venueId: 1, amountBase: '1' });

    const xaman = stubXamanCreate();
    await createMemberPayload({ TransactionType: 'SignerListSet', Account: 'rCOUNCIL' }, 'rMEMBER');

    const expire = (xaman.bodies[0].options as { expire?: number }).expire as number;
    expect(expire).toBe(1440);
    expect(expire).toBeGreaterThan(ORDINARY_PAYLOAD_EXPIRY_MAX_MIN);
  });
});

describe('quién decide que estos bytes los firma un quórum', () => {
  it('la lectura del SERVIDOR viaja con la fila y se puede preguntar por ella', async () => {
    stubPrepare({ ok: true, payloadExpiryMin: 1440, memoHex: CEREMONY_MEMO });
    await prepareRecall({ pote: '0xPOTE', venueId: 1, amountBase: '1' });

    expect(serverDeclaredCeremony(paymentMemoHex(zeroFePayment(CEREMONY_MEMO)))).toBe(true);
    // Una fila que el servidor compuso con la ventana de una firma simple NO es
    // una ceremonia, por mucho que la cuenta tenga SignerList en algún caché.
    expect(serverDeclaredCeremony(paymentMemoHex(zeroFePayment(ORDINARY_MEMO)))).toBe(false);
  });

  it('el silencio no es un veredicto: sin respuesta del servidor no se afirma nada', () => {
    expect(serverDeclaredCeremony(paymentMemoHex(zeroFePayment(CEREMONY_MEMO)))).toBe(false);
    expect(serverDeclaredCeremony(null)).toBe(false);
    expect(serverDeclaredCeremony(undefined)).toBe(false);
  });

  /**
   * El desvío vive en `useXrplWalletPartner`, que no se puede importar aquí (su
   * grafo arrastra el stack de wallets: `Cannot find package 'got'`). Lo que se
   * comprueba sobre el código que ENVÍA es que la lectura del servidor va
   * PRIMERO y que la del navegador queda detrás — el orden es el arreglo.
   */
  it('el desvío pregunta al servidor ANTES que al RPC público', () => {
    const src = readFileSync(
      join(__dirname, '..', '..', 'wallet', 'useXrplWalletPartner.ts'),
      'utf8',
    );
    // it. 29 (§5): the memo is read once (`memoHex`) and asked about twice — the
    // ceremony verdict and its single-signature twin — before any public node.
    const server = src.indexOf('serverDeclaredCeremony(memoHex)');
    const single = src.indexOf('serverDeclaredSingleSignature(memoHex)');
    const browser = src.indexOf('await accountHasQuorum(signerAccount)');
    const submit = src.indexOf('service.submitTransaction(tx)');
    expect(server).toBeGreaterThan(-1);
    expect(single).toBeGreaterThan(-1);
    expect(browser).toBeGreaterThan(-1);
    expect(server).toBeLessThan(single);
    expect(single).toBeLessThan(browser);
    // …and the null read is refused BEFORE the single-signature submit (the
    // executable proof lives in `useXrplWalletPartner.quorumRouting.test.ts`).
    // it. 31 (§6): only a 0xFE — an `FE…` instruction memo — holds a nonce seat.
    const refusal = src.indexOf('hasQuorum === null && flareInstructionMemoOf(tx) !== null');
    expect(refusal).toBeGreaterThan(browser);
    expect(refusal).toBeLessThan(submit);
  });
});

describe('cancelar la ceremonia devuelve TAMBIÉN el asiento de nonce del 0xFE', () => {
  function stubRelease(body: unknown, ok = true): void {
    global.fetch = vi.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
  }

  it('el memo de los bytes en pantalla viaja en el cuerpo — la mitad que faltaba', async () => {
    stubRelease({ released: true, seat: { released: true, reason: 'ceremony-ended' } });
    const memo = paymentMemoHex(zeroFePayment(CEREMONY_MEMO));
    expect(memo).toBe(CEREMONY_MEMO);

    await releaseCeremonySeat('rCOUNCIL', memo);

    const [, init] = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(JSON.parse(String((init as { body?: string }).body))).toEqual({
      account: 'rCOUNCIL',
      memoHex: CEREMONY_MEMO,
    });
  });

  it('unos bytes sin 0xFE no inventan un asiento: se manda la cuenta y nada más', async () => {
    stubRelease({ released: true });
    await releaseCeremonySeat('rCOUNCIL', paymentMemoHex({ TransactionType: 'SignerListSet' }));

    const [, init] = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(JSON.parse(String((init as { body?: string }).body))).toEqual({ account: 'rCOUNCIL' });
  });

  /**
   * LA CADENA, SOBRE EL CÓDIGO QUE ENVÍA. `releaseCeremonySeat` podía ser
   * perfecta y seguir sin llamador con memo: eso es exactamente lo que pasó
   * durante una iteración entera. La pantalla del consejo tiene que pasar el
   * memo DE LOS BYTES QUE ESTÁ FIRMANDO, y eso se lee donde se escribe.
   */
  it('`abandon()` la llama con el memo de la transacción de la ceremonia', () => {
    const src = readFileSync(
      join(__dirname, '..', '..', '..', 'components', 'legacy', 'CouncilMultisigFlow.tsx'),
      'utf8',
    );
    // it. 34 (E): the same call now also names the sitting (`sittingIdRef.current`),
    // so a «Cancel» that lands after a newer sitting re-pinned these bytes is a
    // no-op server-side. The memo still comes off the bytes on screen.
    expect(src).toContain('await releaseCeremonySeat(account, paymentMemoHex(xrplTx), sittingIdRef.current)');

  });
});
