/**
 * SIN AUTOPILOT: cada petición del cliente la firma el omnibus con un QR.
 *
 * Captura del — el autopilot solo abre UN omnibus, y el de un exchange nuevo vive en
 * la Xaman de su dueño. Decisión: «el autopilot hay que sacarlo no visible y que
 * se haga a través de QR».
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dropsToXrpAmount, pendingDeskWork, servability } from '../deskQueue';
import { AUTOPILOT_UI } from '../autopilotVisibility';
import type { ClientRequest, DemoRun } from '../api';

const T = '2026-09-18T10:00:00.000Z';
const req = (id: string, clientId: string, kind: 'withdraw' | 'put-to-work', status: ClientRequest['status'] = 'pending'): ClientRequest =>
  ({ id, clientId, kind, drops: '1500000', status, createdAt: T, updatedAt: T });
const client = (id: string, extra: Record<string, unknown> = {}) => ({ id, runId: 'r', label: id, tag: 201, kyc: 'none', xrpOnExchangeDrops: '5000000', createdAt: T, ...extra });
const runWith = (over: Partial<DemoRun>): DemoRun =>
  ({ runId: 'r', clients: [client('c1', { xrplAddress: 'rWallet', passkeyAccount: '0xabc' })], requests: [], deskPayments: [], poteAddress: '0xpote', ...over }) as unknown as DemoRun;

describe('servability — solo se ofrece servir lo que el servidor va a componer', () => {
  it('una retirada con wallet → sí', () => {
    const q = req('q1', 'c1', 'withdraw');
    expect(servability(runWith({ requests: [q] }), q)).toEqual({ ok: true });
  });

  it('meter en el vault con cuenta de passkey y pote → sí', () => {
    const q = req('q1', 'c1', 'put-to-work');
    expect(servability(runWith({ requests: [q] }), q)).toEqual({ ok: true });
  });

  it('con un pago de la mesa abierto para ese cliente → no (se paga una vez)', () => {
    const q = req('q1', 'c1', 'withdraw');
    const run = runWith({ requests: [q], deskPayments: [{ id: 'dp', kind: 'withdraw', clientId: 'c1', drops: '1', status: 'prepared', createdAt: T, updatedAt: T }] });
    expect(servability(run, q)).toEqual({ ok: false, why: 'desk-payment-open' });
  });

  it('meter en el vault con una RETIRADA suya pendiente → primero la retirada', () => {
    const w = req('w', 'c1', 'withdraw');
    const p = req('p', 'c1', 'put-to-work');
    const run = runWith({ requests: [p, w] });
    expect(servability(run, p)).toEqual({ ok: false, why: 'withdraw-first' });
    // …y la retirada, en cambio, sí se sirve aunque haya una entrada delante.
    expect(servability(run, w)).toEqual({ ok: true });
  });

  it('sin lo que el pago necesita → se dice qué falta', () => {
    const run = runWith({ clients: [client('c1')] as unknown as DemoRun['clients'], poteAddress: undefined });
    expect(servability(run, req('q', 'c1', 'withdraw'))).toEqual({ ok: false, why: 'no-wallet' });
    expect(servability(run, req('q', 'c1', 'put-to-work'))).toEqual({ ok: false, why: 'no-passkey' });
    const withKey = runWith({ poteAddress: undefined });
    expect(servability(withKey, req('q', 'c1', 'put-to-work'))).toEqual({ ok: false, why: 'no-pote' });
  });
});

describe('pendingDeskWork y dropsToXrpAmount', () => {
  it('cuenta las pendientes y los pagos de la mesa en vuelo, nada más', () => {
    const run = runWith({
      requests: [req('a', 'c1', 'withdraw'), req('b', 'c1', 'put-to-work', 'done'), req('c', 'c1', 'withdraw', 'refused')],
      deskPayments: [
        { id: 'd1', kind: 'withdraw', clientId: 'c1', drops: '1', status: 'signed', createdAt: T, updatedAt: T },
        { id: 'd2', kind: 'withdraw', clientId: 'c1', drops: '1', status: 'settled', createdAt: T, updatedAt: T },
      ],
    });
    expect(pendingDeskWork(run)).toBe(2);
  });

  it('el importe EXACTO que pidió el cliente, en la forma que acepta la API', () => {
    expect(dropsToXrpAmount('1500000')).toBe('1.5');
    expect(dropsToXrpAmount('2000000')).toBe('2');
    expect(dropsToXrpAmount('1')).toBe('0.000001');
    expect(dropsToXrpAmount('1234567890123')).toBe('1234567.890123');
    for (const d of ['1500000', '2000000', '1', '1234567890123']) expect(dropsToXrpAmount(d)).toMatch(/^\d+(\.\d{1,6})?$/);
  });
});

describe('el cableado', () => {
  const root = join(__dirname, '..', '..', '..', 'components', 'demo-exchange');
  const QUEUE = readFileSync(join(root, 'console', 'DeskRequestQueue.tsx'), 'utf8');
  const CONSOLE_ = readFileSync(join(root, 'console', 'ExchangeConsole.tsx'), 'utf8');
  const CLIENT = readFileSync(join(root, 'client', 'ExchangeClientApp.tsx'), 'utf8');

  it('el autopilot está fuera de la vista', () => {
    expect(AUTOPILOT_UI).toBe(false);
    // Lo que se enseñaba del autopilot en la consola queda detrás de la constante.
    expect(CONSOLE_).toMatch(/AUTOPILOT_UI \? \(on \?/);
    expect(CONSOLE_).toContain('<DeskRequestQueue demo={demo} run={run} onBlockedChange={onBlockedChange} />');
  });

  it('la cola TOMA la petición antes de componer su pago, y el pago es por el importe que pidió el cliente', () => {
    const take = QUEUE.indexOf('demoApi.takeRequest(');
    expect(take).toBeGreaterThan(0);
    expect(QUEUE.indexOf('demoApi.withdrawPrepare(')).toBeGreaterThan(take);
    expect(QUEUE.indexOf('demoApi.reserveDeskPayment(')).toBeGreaterThan(take);
    expect(QUEUE).toContain('dropsToXrpAmount(q.drops)');
    // La mesa no elige importe: no hay campo que lo edite.
    expect(QUEUE).not.toMatch(/<input/);
  });

  it('Lo firmado y validado no se pinta como error', () => {
    // Se reintenta en silencio lo que es «el nodo aún no lo ve»…
    expect(QUEUE).toMatch(/for \(let i = 0; i < 6 && !recorded; i\+\+\)/);
    // …y el rojo «the exchange ledger could not record it» ya no sale de esta cola.
    expect(QUEUE).not.toContain('but the exchange ledger could not record it');
    expect(QUEUE).not.toContain("but its hash could not be kept on the desk record");
  });

  it('firma el OMNIBUS de la run, con su QR', () => {
    expect(QUEUE).toContain('<OmnibusSignDoor');
    expect(QUEUE).toContain('account={run.omnibusAddress}');
  });

  it('el KYC ofrece el paso 2 (el omnibus acepta con su QR) cuando no hay autopilot', () => {
    expect(CONSOLE_).toContain('prepareCredentialAccept({ issuer: run.councilAddress, subject: run.omnibusAddress, credentialType })');
  });

  it('el cliente no lee «Refused» cuando la mesa la tomó', () => {
    expect(CLIENT).toContain("if (isTakenByDesk(r)) return { label: t('With the exchange'), tone: 'info' };");
    expect(CLIENT).toContain('deskPaymentStatus(p, t)');
  });
});
