/**
 * EL BOTÓN DEL DUEÑO DICE LO QUE EL SERVIDOR
 * HIZO, no una frase fija.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { demoApi, doorOpenedNotice, openRefusalDoor } from '../../../../lib/demo-exchange/api';

const t = (s: string) => s;

function stubFetch(body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })));
}
afterEach(() => vi.unstubAllGlobals());

/** What `DELETE …/requests/:rid` answers when the journal held a validated failure (routes/demoExchange.ts). */
const RECONCILED_FAILED = {
  request: { id: 'rq_dead', kind: 'put-to-work', status: 'refused', drops: '2000000', txHash: 'D'.repeat(64), reason: 'XRPL_tecPATH_DRY: the ledger answered tecPATH_DRY (DDDD…)' },
  reconciled: 'failed-on-ledger',
  run: { runId: 'run1', clients: [], receipts: [], appliedTxHashes: [] },
};
/** …and when nothing had ever been signed. */
const NOTHING_SIGNED = {
  request: { id: 'rq_dead', kind: 'put-to-work', status: 'refused', drops: '2000000', reason: 'WITHDRAWN_BY_THE_CLIENT: taken out of the queue by its owner — nothing was ever signed for it' },
  run: { runId: 'run1', clients: [], receipts: [], appliedTxHashes: [] },
};

describe('el 200 real del DELETE llega con `reconciled`, y la frase lo sigue', () => {
  it('CONSUMIDOR: `reconciled: failed-on-ledger` → la frase dice que HUBO un pago firmado que el ledger rechazó — jamás «Nothing had been signed»', async () => {
    stubFetch(RECONCILED_FAILED);
    const r = await openRefusalDoor(demoApi, 'run1', 'c1', { kind: 'request', id: 'rq_dead' });
    if (!r.ok) throw new Error('expected ok');
    expect(r.data.reconciled).toBe('failed-on-ledger');
    const notice = doorOpenedNotice({ kind: 'request', id: 'rq_dead' }, r.data.reconciled, t);
    expect(notice).toContain('A payment had been signed for it');
    expect(notice).toContain('the XRP Ledger refused it');
    expect(notice).toContain('never left');
    expect(notice).not.toContain('Nothing had been signed');
  });

  it('sin `reconciled` (nada firmado) → la frase de siempre', async () => {
    stubFetch(NOTHING_SIGNED);
    const r = await openRefusalDoor(demoApi, 'run1', 'c1', { kind: 'request', id: 'rq_dead' });
    if (!r.ok) throw new Error('expected ok');
    expect(r.data.reconciled).toBeUndefined();
    const notice = doorOpenedNotice({ kind: 'request', id: 'rq_dead' }, r.data.reconciled, t);
    expect(notice).toContain('taken out of the queue');
    expect(notice).toContain('Nothing had been signed for it');
  });

  it('una reserva de mesa → su frase, y un `reconciled` futuro desconocido no se lee como «nada firmado»', () => {
    expect(doorOpenedNotice({ kind: 'desk', id: 'dp1' }, undefined, t)).toContain('That reservation was released');
    const unknown = doorOpenedNotice({ kind: 'request', id: 'rq' }, 'some-new-kind', t);
    expect(unknown).toContain('reconciled it against the ledger');
    expect(unknown).not.toContain('Nothing had been signed');
  });
});

describe('el cable — el hook usa doorOpenedNotice con lo que el servidor contestó', () => {
  const hook = readFileSync(join(__dirname, '..', 'useExchangeClient.ts'), 'utf8');
  it('openDoor → setNotice(doorOpenedNotice(door, r.data.reconciled, t)), y la frase fija ya no vive en el hook', () => {
    expect(hook).toContain('setNotice(doorOpenedNotice(door, r.data.reconciled, t));');
    expect(hook).not.toContain("t('That request was taken out of the queue. Nothing had been signed for it");
  });
});
