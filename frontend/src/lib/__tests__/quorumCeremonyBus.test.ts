/**
 * El desvío a la ceremonia multifirma, que es el punto por el que pasan las
 * DIECISIETE llamadas a `sendIntent` de esta app.
 *
 * Motivo (22-ago-2026): una cuenta reforzada pedía UN QR en todas las
 * superficies — enviar, Kinetic lend, el vault, posiciones, moneyflows —
 * porque cada una construía su propio payload single-sig. Se arreglaron tres
 * pantallas sueltas antes de entender que el arreglo iba en el cuello de
 * botella. Estos tests existen para que nadie vuelva a las tres pantallas.
 *
 * Lo que se fija aquí es lo que NO puede pasar: que una promesa de firma se
 * quede colgada para siempre. Una firma que no vuelve es indistinguible de una
 * app rota, y esta casa ya tuvo bastante con un recibo eterno.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  CEREMONY_ABANDONED,
  CEREMONY_CLOSED_IN_FLIGHT,
  abandonQuorumCeremony,
  ceremonyDispatchPatch,
  dispatchReportAdmissible,
  onQuorumCeremony,
  quorumCeremonyDispatch,
  reportQuorumCeremonyDispatch,
  requestQuorumCeremony,
  type QuorumCeremonyRequest,
} from '../xrpl/quorumCeremonyBus';

const TX = { TransactionType: 'Payment', Account: 'rP49LEKattxJ9ppioRZVVRoZ7QeWvzYyuG' };
const ACCOUNT = 'rP49LEKattxJ9ppioRZVVRoZ7QeWvzYyuG';

/** Monta un "modal" de mentira y devuelve la última petición que recibió. */
function mountHost() {
  const seen: Array<QuorumCeremonyRequest | null> = [];
  const off = onQuorumCeremony((r) => seen.push(r));
  return { seen, off, current: () => seen[seen.length - 1] };
}

describe('quorumCeremonyBus', () => {
  it('SIN modal montado rechaza en el acto — jamás deja la promesa colgada', async () => {
    // Este es el fallo que mataría al usuario en silencio: firmar, no ver nada,
    // y que la pantalla espere para siempre.
    await expect(requestQuorumCeremony(TX, ACCOUNT)).rejects.toThrow(/NO_HOST/);
  });

  it('entrega la petición al modal con la tx y la cuenta intactas', async () => {
    const host = mountHost();
    const p = requestQuorumCeremony(TX, ACCOUNT);
    const req = host.current()!;
    expect(req.account).toBe(ACCOUNT);
    expect(req.tx).toEqual(TX);
    req.resolve('DEADBEEF');
    await expect(p).resolves.toBe('DEADBEEF');
    host.off();
  });

  it('el hash emitido vuelve por la promesa de quien llamó', async () => {
    const host = mountHost();
    const p = requestQuorumCeremony(TX, ACCOUNT);
    host.current()!.resolve('A'.repeat(64));
    await expect(p).resolves.toBe('A'.repeat(64));
    host.off();
  });

  it('abandonar rechaza con un motivo nombrado, no con silencio', async () => {
    const host = mountHost();
    const p = requestQuorumCeremony(TX, ACCOUNT);
    abandonQuorumCeremony();
    await expect(p).rejects.toThrow(CEREMONY_ABANDONED);
    host.off();
  });

  it('al terminar, el modal recibe null y la vía queda libre', async () => {
    const host = mountHost();
    const p = requestQuorumCeremony(TX, ACCOUNT);
    host.current()!.resolve('B'.repeat(64));
    await p;
    expect(host.current()).toBeNull();

    // Y una segunda ceremonia entra sin problema.
    const p2 = requestQuorumCeremony(TX, ACCOUNT);
    host.current()!.resolve('C'.repeat(64));
    await expect(p2).resolves.toBe('C'.repeat(64));
    host.off();
  });

  it('dos ceremonias a la vez se refusan: una cuenta tiene UN solo Sequence', async () => {
    const host = mountHost();
    const p = requestQuorumCeremony(TX, ACCOUNT);
    await expect(requestQuorumCeremony(TX, ACCOUNT)).rejects.toThrow(/BUSY/);
    host.current()!.resolve('D'.repeat(64));
    await p;
    host.off();
  });

  it('un oyente que revienta no impide que los demás se enteren', async () => {
    const boom = onQuorumCeremony(() => {
      throw new Error('roto');
    });
    const host = mountHost();
    const p = requestQuorumCeremony(TX, ACCOUNT);
    expect(host.current()?.account).toBe(ACCOUNT);
    host.current()!.resolve('E'.repeat(64));
    await p;
    boom();
    host.off();
  });

  it('desmontarse deja de recibir', async () => {
    const host = mountHost();
    const before = host.seen.length;
    host.off();
    await expect(requestQuorumCeremony(TX, ACCOUNT)).rejects.toThrow(/NO_HOST/);
    expect(host.seen.length).toBe(before);
  });
});

/**
 * productizer it. 33 (B2) — LO QUE EL BUS NO PUEDE OLVIDAR.
 *
 * El botón «Cancel» del flujo terminaba emitiendo `abandoned`, cuyo parche es
 * `{committed:false, started:false}`: una sesión que había COMPROMETIDO bytes a
 * un nodo (un broadcast que reventó cae en `error`, donde el botón seguía) quedaba
 * reducida a «nunca empezó», y el Escape siguiente liberaba el asiento por la rama
 * de nunca-empezó y rechazaba ABANDONED sobre un Payment que puede estar en el
 * ledger. El flujo ya no manda ese informe; esta es la mitad del bus.
 */
describe('it. 33 — un `abandoned` rezagado no deshace una emisión comprometida', () => {
  it('dispatchReportAdmissible: `abandoned` solo se admite sobre una petición NO comprometida', () => {
    expect(dispatchReportAdmissible(null, { stage: 'abandoned' })).toBe(true);
    expect(dispatchReportAdmissible({ started: true }, { stage: 'abandoned' })).toBe(true);
    expect(dispatchReportAdmissible({ started: true, committed: true }, { stage: 'abandoned' })).toBe(false);
    // Every other report is admitted whatever the prior state: a NEW sitting
    // (`started`) legitimately clears a previous one of the same request.
    expect(dispatchReportAdmissible({ started: true, committed: true }, { stage: 'started' })).toBe(true);
    expect(dispatchReportAdmissible({ started: true, committed: true }, { stage: 'broadcast-failed' })).toBe(true);
  });

  it('ceremonyDispatchPatch: `broadcast-failed` conserva el compromiso y no borra un hash anterior', () => {
    const patch = ceremonyDispatchPatch({ stage: 'broadcast-failed', message: 'xrplcluster.com: Failed to fetch' });
    expect(patch.committed).toBe(true);
    expect(patch.started).toBe(true);
    expect(patch.broadcastFailed).toBe(true);
    expect(patch.message).toBe('xrplcluster.com: Failed to fetch');
    expect('hash' in patch).toBe(false); // merged over what is there: a hash handed back earlier survives
  });

  it('submitting → broadcast-failed → abandoned (rezagado) → cerrar: sigue comprometida, RECEIPT_UNREAD y el fallo nombrado, jamás ABANDONED', async () => {
    const host = mountHost();
    const p = requestQuorumCeremony(TX, ACCOUNT);
    const req = host.current()!;
    reportQuorumCeremonyDispatch(req, { stage: 'started' });
    reportQuorumCeremonyDispatch(req, { stage: 'submitting' });
    reportQuorumCeremonyDispatch(req, { stage: 'broadcast-failed', message: 'xrplcluster.com: Failed to fetch; xrpl.link: HTTP 502' });
    reportQuorumCeremonyDispatch(req, { stage: 'abandoned' }); // the old button's parting report
    expect(quorumCeremonyDispatch(req)).toMatchObject({ started: true, committed: true, broadcastFailed: true });

    abandonQuorumCeremony();
    const err = (await p.catch((e) => e)) as Error & { code?: string; txHash?: string };
    expect(err.message).not.toBe(CEREMONY_ABANDONED);
    expect(err.message).toContain(CEREMONY_CLOSED_IN_FLIGHT);
    expect(err.message).toMatch(/No XRPL node confirmed taking the submission \(xrplcluster\.com: Failed to fetch; xrpl\.link: HTTP 502\)/);
    expect(err.message).toMatch(/may still have entered/);
    expect(err.code).toBe('RECEIPT_UNREAD');
    expect(err.txHash).toBeUndefined();
    host.off();
  });

  it('…y sobre una sesión que NO se comprometió, `abandoned` sigue significando lo que significaba', async () => {
    // The never-started close asks the server for the dispatch's seat: the
    // network is stubbed at the edge so nothing leaves this process.
    const realFetch = global.fetch;
    const fetchStub = vi.fn(async () => ({ ok: true, json: async () => ({ released: true }) }));
    global.fetch = fetchStub as unknown as typeof fetch;
    try {
      const host = mountHost();
      const p = requestQuorumCeremony(TX, ACCOUNT);
      const req = host.current()!;
      reportQuorumCeremonyDispatch(req, { stage: 'started' });
      reportQuorumCeremonyDispatch(req, { stage: 'abandoned' });
      expect(quorumCeremonyDispatch(req)).toMatchObject({ started: false, committed: false });
      abandonQuorumCeremony();
      await expect(p).rejects.toThrow(CEREMONY_ABANDONED);
      host.off();
    } finally {
      global.fetch = realFetch;
    }
  });
});
