/**
 * «NO PUDE LEER SI ESTA CUENTA ES TUYA» NO ES
 * «ABRE UNA»: EL CONSUMIDOR, contra el cuerpo REAL de `GET /runs/:id`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PortalRefusal } from '../PortalRefusal';
import { demoApi, ownershipUnreadableFor, type DemoRun } from '../../../../lib/demo-exchange/api';

const ACCOUNT = '0x4011015268644de37061D6C9b734b1738A8933C8';
const OTHER = '0x9999999999999999999999999999999999999999';

/** What `GET /runs/:id` answers now while the reader's mark cannot be used (backend, `ownershipUnreadableBody`). */
const VIEWER_UNREADABLE = {
  error: 'OWNERSHIP_UNREADABLE',
  retryable: true,
  cause: 'read-failed',
  detail: 'Whether this sign-in was taken over could not be read just now — our database did not answer. Nothing was changed and nothing is lost: try again in a moment.',
};

function runBody(clients: Array<Record<string, unknown>>, viewerUnreadable?: Record<string, unknown>) {
  return {
    run: { runId: 'run1', seq: 1, label: 'Take', councilAddress: 'r1', omnibusAddress: 'r2', policy: 'A', createdAt: '2026-01-01T00:00:00.000Z', status: 'open', clients, receipts: [], appliedTxHashes: [] },
    ...(viewerUnreadable ? { viewerUnreadable } : {}),
  };
}

/** The owner's funded row, as the server serves it with the mark unusable: owned, NOT mine. */
const OWNED_NOT_MINE = { id: 'c1', runId: 'run1', label: 'Alice', tag: 101, kyc: 'none', passkeyAccount: ACCOUNT, xrpOnExchangeDrops: '50000000', createdAt: '2026-01-01T00:00:00.000Z', owned: true, claimable: false, mine: false };

function stubFetch(body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })));
}
afterEach(() => vi.unstubAllGlobals());

describe('1 — el cuerpo real de GET /runs/:id entra por call() y la marca viaja dentro del run', () => {
  it('con `viewerUnreadable` al nivel de arriba, `r.data.run.viewerUnreadable` lo lleva', async () => {
    stubFetch(runBody([OWNED_NOT_MINE], VIEWER_UNREADABLE));
    const r = await demoApi.getRun('run1');
    if (!r.ok) throw new Error('expected ok');
    expect(r.data.run.viewerUnreadable).toMatchObject({ error: 'OWNERSHIP_UNREADABLE', cause: 'read-failed' });
    expect(r.data.run.clients[0]).toMatchObject({ owned: true, mine: false });
  });

  it('sin él (marca usable), el run no lo lleva', async () => {
    stubFetch(runBody([{ ...OWNED_NOT_MINE, mine: true }]));
    const r = await demoApi.getRun('run1');
    if (!r.ok) throw new Error('expected ok');
    expect(r.data.run.viewerUnreadable).toBeUndefined();
  });
});

describe('2 — ownershipUnreadableFor: la negativa solo cuando hay una fila con dueño que no se pudo atribuir', () => {
  const run = (clients: DemoRun['clients'], viewerUnreadable?: DemoRun['viewerUnreadable']) => ({ clients, viewerUnreadable });

  it('LA PERSONA REAL: su fila `owned:true, mine:false` + la marca ilegible → una negativa 503 reintentable con la frase del servidor', () => {
    const refusal = ownershipUnreadableFor(run([OWNED_NOT_MINE as DemoRun['clients'][number]], VIEWER_UNREADABLE), ACCOUNT);
    expect(refusal).toMatchObject({ status: 503, error: 'OWNERSHIP_UNREADABLE', retryable: true });
    expect(refusal?.detail).toContain('our database did not answer');
  });

  it('la misma fila SIN la marca (marca usable) → null: entonces `mine:false` sí significa «no es tuya»', () => {
    expect(ownershipUnreadableFor(run([OWNED_NOT_MINE as DemoRun['clients'][number]]), ACCOUNT)).toBeNull();
  });

  it('la marca ilegible pero NINGUNA fila con dueño para esta passkey → null: «abre una cuenta» es la verdad', () => {
    expect(ownershipUnreadableFor(run([], VIEWER_UNREADABLE), ACCOUNT)).toBeNull();
    expect(ownershipUnreadableFor(run([{ ...OWNED_NOT_MINE, owned: false, claimable: true } as DemoRun['clients'][number]], VIEWER_UNREADABLE), ACCOUNT)).toBeNull();
    // a row owned by somebody, on ANOTHER passkey, says nothing about this one
    expect(ownershipUnreadableFor(run([{ ...OWNED_NOT_MINE, passkeyAccount: OTHER } as DemoRun['clients'][number]], VIEWER_UNREADABLE), ACCOUNT)).toBeNull();
  });

  it('un servidor viejo con la marca pero sin `detail` → la negativa sigue existiendo (el lector pone la frase, nunca el código)', () => {
    const refusal = ownershipUnreadableFor(run([OWNED_NOT_MINE as DemoRun['clients'][number]], { error: 'OWNERSHIP_UNREADABLE', retryable: true }), ACCOUNT);
    expect(refusal).toMatchObject({ status: 503, error: 'OWNERSHIP_UNREADABLE', retryable: true });
    expect(refusal?.detail).toBeUndefined();
  });
});

describe('3 — la pantalla: PortalRefusal con esa negativa pinta la frase del servidor y «Try again», jamás «Open an account»', () => {
  it('renderiza «could not be read» con reintento', () => {
    const refusal = ownershipUnreadableFor({ clients: [OWNED_NOT_MINE as DemoRun['clients'][number]], viewerUnreadable: VIEWER_UNREADABLE }, ACCOUNT)!;
    const html = renderToStaticMarkup(createElement(PortalRefusal, { refusal, onRetry: () => {} }));
    expect(html).toContain('Your exchange could not be read right now');
    expect(html).toContain('our database did not answer');
    expect(html).toMatch(/<button[^>]*>[\s\S]*?Try again[\s\S]*?<\/button>/);
    expect(html).not.toContain('Open an account');
    expect(html).not.toContain('Open my exchange account');
  });
});

describe('el cable — el hook expone la negativa y las dos pantallas preguntan por ella ANTES del alta', () => {
  const hook = readFileSync(join(__dirname, '..', 'useExchangeClient.ts'), 'utf8');
  const app = readFileSync(join(__dirname, '..', 'ExchangeClientApp.tsx'), 'utf8');
  const legacy = readFileSync(join(__dirname, '..', '..', 'ClientApp.tsx'), 'utf8');

  it('useExchangeClient deriva `ownershipUnreadable` de ownershipUnreadableFor(run, account) cuando no hay «mi fila», y lo devuelve', () => {
    expect(hook).toMatch(/const ownershipUnreadable = useMemo\(\(\) => \(me \? null : ownershipUnreadableFor\(run, account\)\)/);
    const ret = hook.indexOf('\n  return {\n    run,\n    account,\n    me,');
    expect(ret).toBeGreaterThan(-1);
    expect(hook.slice(ret)).toMatch(/\n    ownershipUnreadable,\n/);
  });

  it('ExchangeClientApp (ClientDashboard): PortalRefusal con el reintento del libro, antes de <OpenAccount/>', () => {
    const guard = app.indexOf('if (!c.me && c.ownershipUnreadable) return <PortalRefusal refusal={c.ownershipUnreadable} onRetry={() => void demo.reload()} />;');
    const alta = app.indexOf('if (!c.me) return <OpenAccount c={c} />;');
    expect(guard).toBeGreaterThan(-1);
    expect(alta).toBeGreaterThan(guard);
  });

  it('ClientApp (ClientInner, la vista del operador): la misma regla de dinero en los dos sitios', () => {
    const guard = legacy.indexOf('if (!me && ownershipUnreadable) return <PortalRefusal refusal={ownershipUnreadable} onRetry={() => void demo.reload()} />;');
    const alta = legacy.indexOf('if (!me) {');
    expect(guard).toBeGreaterThan(-1);
    expect(alta).toBeGreaterThan(guard);
  });
});
