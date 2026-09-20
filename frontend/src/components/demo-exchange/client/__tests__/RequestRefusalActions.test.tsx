/**
 * LA PUERTA DEL DUEÑO LLEGA AL DUEÑO: EL
 * CONSUMIDOR, contra el cuerpo REAL del 409.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RequestRefusalActions } from '../RequestRefusalActions';
import { demoApi, describeRefusal, describeRequestRefusal, openRefusalDoor, refusalDoors, refusalIsRetryable, requestAcceptedNotice, type Refusal, type RequestRefusal } from '../../../../lib/demo-exchange/api';

const t = (s: string) => s;

/** El cuerpo que `POST …/requests` contesta hoy con una SALIDA pendiente delante de una entrada (routes/demoExchange.ts). */
const INSUFFICIENT_WITH_DOOR = {
  error: 'INSUFFICIENT_AVAILABLE_BALANCE',
  detail: 'The demo ledger holds 2.000000 XRP for this client, but 2.000000 XRP of it are reserved by payments still in flight — 0.000000 XRP are available now. Nothing of it appears signed: DELETE /api/demo-exchange/runs/:id/clients/:cid/requests/rq_exit takes it out of the way (it cedes only if nothing was signed for it), and then this composes.',
  balanceDrops: '2000000',
  reservedDrops: '2000000',
  availableDrops: '0',
  inFlight: [{ source: 'request', id: 'rq_exit', kind: 'withdraw', status: 'pending', drops: '2000000', releasable: true }],
  withdrawableRequestIds: ['rq_exit'],
};
/** Una entrada MUERTA (NO_CLIENT_ACCOUNT) delante de otra entrada. */
const REQUEST_PENDING_WITH_DOOR = {
  error: 'REQUEST_PENDING',
  detail: 'There is already a pending request of this kind for this client. If it is stuck, take it out of the queue first: DELETE /api/demo-exchange/runs/:id/clients/:cid/requests/rq_dead (it cedes only if nothing was signed for it), then ask again.',
  request: { id: 'rq_dead', kind: 'put-to-work', status: 'pending', drops: '1000000', reason: 'NO_CLIENT_ACCOUNT: the client has no Flare account yet (Face ID)' },
  withdrawableRequestIds: ['rq_dead'],
};
/** Una reserva de mesa sin memo delante de una entrada. */
const DESK_WITH_DOOR = {
  error: 'INSUFFICIENT_AVAILABLE_BALANCE',
  detail: '…',
  balanceDrops: '2000000',
  reservedDrops: '2000000',
  availableDrops: '0',
  inFlight: [{ source: 'desk', id: 'dp_abandoned', kind: 'put-to-work', status: 'prepared', drops: '2000000', releasable: true }],
  releasableDeskPaymentIds: ['dp_abandoned'],
};
/** Lo firmado: sin puerta. */
const SIGNED_NO_DOOR = {
  error: 'INSUFFICIENT_AVAILABLE_BALANCE',
  detail: '…',
  balanceDrops: '2000000',
  reservedDrops: '2000000',
  availableDrops: '0',
  inFlight: [{ source: 'request', id: 'rq_signed', kind: 'put-to-work', status: 'pending', drops: '2000000', releasable: false }],
};

function stubFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; method: string }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { method?: string }) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET' });
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }),
  );
  return calls;
}

async function refusalOf(status: number, body: unknown): Promise<Refusal> {
  stubFetch(status, body);
  const r = await demoApi.addRequest('run1', 'c1', { kind: 'put-to-work', amountXrp: '1' });
  if (r.ok) throw new Error('expected a refusal');
  return r.refusal;
}

function asRequestRefusal(kind: 'put-to-work' | 'withdraw', refusal: Refusal): RequestRefusal {
  return { kind, amountXrp: '1', refusal, doors: refusalDoors(refusal), retryable: refusalIsRetryable(refusal) };
}

const render = (refusal: RequestRefusal | null, onOpenDoor: (d: { kind: string; id: string }) => void = () => {}) =>
  renderToStaticMarkup(createElement(RequestRefusalActions, { refusal, busy: false, onOpenDoor, onRetry: () => {} }));

afterEach(() => vi.unstubAllGlobals());

describe('1+2 — el 409 real entra por call() y la pantalla pinta la puerta', () => {
  it('una salida pendiente delante de una entrada: `inFlight` e ids llegan, y hay UN botón con ese id', async () => {
    const refusal = await refusalOf(409, INSUFFICIENT_WITH_DOOR);
    expect(refusal.withdrawableRequestIds).toEqual(['rq_exit']);
    expect(refusal.inFlight).toHaveLength(1);
    expect(refusal.availableDrops).toBe('0');
    expect(refusalDoors(refusal)).toEqual([{ kind: 'request', id: 'rq_exit' }]);

    const html = render(asRequestRefusal('put-to-work', refusal));
    expect(html.match(/<button/g) ?? []).toHaveLength(1);
    expect(html).toContain('data-door-kind="request"');
    expect(html).toContain('data-door-id="rq_exit"');
    expect(html).toContain('Take the stuck withdrawal out of the queue (2 XRP)');
    // y la frase para la persona lleva los números, no el DELETE crudo
    const sentence = describeRequestRefusal(refusal, t);
    expect(sentence).toContain('0 XRP are available now: 2 XRP of your 2 XRP are held');
    expect(sentence).toContain('take it out of the way below');
    expect(sentence).not.toContain('DELETE /api');
  });

  it('una entrada MUERTA delante de otra entrada (REQUEST_PENDING): botón con el id de la muerta', async () => {
    const refusal = await refusalOf(409, REQUEST_PENDING_WITH_DOOR);
    expect(refusalDoors(refusal)).toEqual([{ kind: 'request', id: 'rq_dead' }]);
    const html = render(asRequestRefusal('put-to-work', refusal));
    expect(html).toContain('data-door-id="rq_dead"');
    expect(html).toContain('Take the stuck vault entry out of the queue');
    expect(describeRequestRefusal(refusal, t)).toBe('You already have a request of this kind waiting. If it is stuck, take it out of the queue first and ask again.');
  });

  it('una reserva de mesa sin memo: botón de SU puerta (desk), con importe', async () => {
    const refusal = await refusalOf(409, DESK_WITH_DOOR);
    expect(refusalDoors(refusal)).toEqual([{ kind: 'desk', id: 'dp_abandoned' }]);
    const html = render(asRequestRefusal('withdraw', refusal));
    expect(html).toContain('data-door-kind="desk"');
    expect(html).toContain('data-door-id="dp_abandoned"');
    expect(html).toContain('Release the desk reservation (2 XRP)');
  });

  it('4 — lo FIRMADO no tiene botón: el componente no pinta nada', async () => {
    const refusal = await refusalOf(409, SIGNED_NO_DOOR);
    expect(refusalDoors(refusal)).toEqual([]);
    expect(render(asRequestRefusal('withdraw', refusal))).toBe('');
  });

  it('4 — una lectura NUESTRA fallida (SUBMISSION_JOURNAL_UNREADABLE) tiene frase propia y «Try again», jamás el detail crudo', async () => {
    const refusal = await refusalOf(409, { error: 'SUBMISSION_JOURNAL_UNREADABLE', retryable: true, detail: "whether this client's pending entries already carry a signed payment could not be read (P1001) — nothing was composed" });
    expect(refusalIsRetryable(refusal)).toBe(true);
    const sentence = describeRefusal(refusal, t);
    expect(sentence).toContain('could not read the exchange’s record of which of your payments were already signed');
    expect(sentence).toContain('not a statement that your money is held');
    expect(sentence).toContain('Try again');
    expect(sentence).not.toContain('P1001');
    const html = render(asRequestRefusal('withdraw', refusal));
    expect(html).toMatch(/<button[^>]*>[\s\S]*?Try again[\s\S]*?<\/button>/);
    expect(html).not.toContain('data-door-id');
  });

  it('El otro código sin lector: DESK_PAYMENT_NOT_RELEASABLE_HERE dice que SÍ retiene la retirada (la verdad de la)', () => {
    const sentence = describeRefusal({ status: 409, error: 'DESK_PAYMENT_NOT_RELEASABLE_HERE', detail: 'raw' }, t);
    expect(sentence).toContain('including against your withdrawal');
    // The promise is conditioned on the loop that keeps it
    expect(sentence).toContain('on its own while its backend loop is running, or by the desk otherwise');
    expect(sentence).not.toBe('raw');
  });
});

describe('3 — pulsar la puerta dispara exactamente su DELETE', () => {
  it('una petición → DELETE /runs/:id/clients/:cid/requests/:rid', async () => {
    const calls = stubFetch(200, { request: { id: 'rq_exit', status: 'refused' }, run: { runId: 'run1' } });
    const r = await openRefusalDoor(demoApi, 'run1', 'c1', { kind: 'request', id: 'rq_exit' });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].url).toMatch(/\/demo-exchange\/runs\/run1\/clients\/c1\/requests\/rq_exit$/);
  });

  it('una reserva de mesa → DELETE /runs/:id/clients/:cid/desk-payments/:pid (la del DUEÑO, no la de admin)', async () => {
    const calls = stubFetch(200, { deskPayment: { id: 'dp_abandoned', status: 'released' }, run: { runId: 'run1' } });
    const r = await openRefusalDoor(demoApi, 'run1', 'c1', { kind: 'desk', id: 'dp_abandoned' });
    expect(r.ok).toBe(true);
    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].url).toMatch(/\/demo-exchange\/runs\/run1\/clients\/c1\/desk-payments\/dp_abandoned$/);
    expect(calls[0].url).not.toMatch(/\/runs\/run1\/desk-payments\//);
  });

  it('el botón entrega la puerta tal cual al manejador (onOpenDoor recibe {kind,id})', async () => {
    // Sin DOM no hay click: se comprueba que el elemento renderizado lleva la
    // puerta en sus data-attrs y que el cable de la pantalla pasa `c.openDoor`.
    const refusal = await refusalOf(409, INSUFFICIENT_WITH_DOOR);
    const html = render(asRequestRefusal('put-to-work', refusal));
    expect(html).toContain('data-door-kind="request" data-door-id="rq_exit"');
  });
});

describe('el cable — las dos pantallas montan el componente con la puerta del hook', () => {
  const src = readFileSync(join(__dirname, '..', 'ExchangeClientApp.tsx'), 'utf8');
  const hook = readFileSync(join(__dirname, '..', 'useExchangeClient.ts'), 'utf8');

  it('ExchangeClientApp: RequestRefusalActions bajo «Put it into the vault» y bajo «Withdraw to my wallet», con onOpenDoor → c.openDoor', () => {
    const mounts = src.match(/<RequestRefusalActions[^>]*onOpenDoor=\{\(door\) => void c\.openDoor\(door\)\}[^>]*onRetry=\{\(\) => void c\.retryRequest\(\)\}/g) ?? [];
    expect(mounts).toHaveLength(2);
    expect(src.indexOf("{t('Put it into the vault')}")).toBeLessThan(src.indexOf('<RequestRefusalActions'));
    expect(src.lastIndexOf("{t('Withdraw to my wallet')}")).toBeLessThan(src.lastIndexOf('<RequestRefusalActions'));
  });

  it('useExchangeClient: openDoor llama a openRefusalDoor(demoApi, …) y las dos peticiones guardan el rechazo entero', () => {
    expect(hook).toMatch(/async function openDoor\(door: RefusalDoor\)[\s\S]*?openRefusalDoor\(demoApi, run\.runId, me\.id, door\)/);
    expect(hook).toMatch(/setRequestRefusal\(\{ kind, amountXrp, refusal: r\.refusal, doors: refusalDoors\(r\.refusal\), retryable: refusalIsRetryable\(r\.refusal\) \}\)/);
    expect(hook).toContain("const askWithdraw = (amountXrp: string) => askRequest('withdraw', amountXrp, 'withdraw');");
  });
});

describe('el 201 dice la verdad sobre quién sirve', () => {
  it('con autopiloto, «en unos segundos»; sin él, una persona paga y se dice', () => {
    expect(requestAcceptedNotice('withdraw', 'autopilot', t)).toContain('in a few seconds');
    expect(requestAcceptedNotice('withdraw', 'desk', t)).not.toContain('in a few seconds');
    expect(requestAcceptedNotice('withdraw', 'desk', t)).toContain('from its account');
    expect(requestAcceptedNotice('put-to-work', 'desk', t)).toContain('by hand');
  });
});
