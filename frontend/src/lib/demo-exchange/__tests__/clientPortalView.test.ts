/**
 * CLIENTE POR EXCHANGE.
 *
 * Su regla: «cuando crea una cuenta a un exchange es al
 * que ha pedido acceso y le han dado la verificación, sino no está dentro de ese
 * exchange». Ser cliente es por exchange; la llave pide acceso a cada uno.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { portalDataFrom, portalView, type PortalData } from '../clientPortalView';
import type { RunSummary } from '../api';

const ex = (runId: string, label: string, status: 'open' | 'closed' = 'open') =>
  ({ runId, seq: 1, label, councilAddress: 'r', omnibusAddress: 'r', policy: 'A', poteAddress: null, bridgeAddress: null, registryAddress: null, createdAt: '', status, clients: 0, receipts: 0 }) as unknown as RunSummary;
const V2 = ex('run1', 'Exchange Test V2');
const NEW = ex('run2', 'EXCHANGE TEST');
const mine = (runId: string, label: string) => ({ runId, exchangeLabel: label, client: { label: 'User1', tag: 101 } });

describe('CREAR con una llave que ya es cliente de otro exchange', () => {
  it('la captura: cliente de V2, EXCHANGE TEST abierto → se ofrece pedir acceso, NO se entra a V2', () => {
    const data: PortalData = { memberships: [mine('run1', V2.label)], joinable: [NEW] };
    expect(portalView({ mode: 'create', data, chosen: null })).toEqual({ kind: 'pick-join' });
  });

  it('elegido el exchange nuevo, se abre ESE (su alta)', () => {
    const data: PortalData = { memberships: [mine('run1', V2.label)], joinable: [NEW] };
    expect(portalView({ mode: 'create', data, chosen: 'run2' })).toEqual({ kind: 'run', runId: 'run2' });
  });

  it('ya cliente de todos los abiertos → se dice, y se ofrecen sus cuentas', () => {
    const data: PortalData = { memberships: [mine('run1', V2.label)], joinable: [] };
    expect(portalView({ mode: 'create', data, chosen: null })).toEqual({ kind: 'already-everywhere' });
  });

  it('sin cuenta y un solo exchange abierto → directo a su alta (como antes)', () => {
    const data: PortalData = { memberships: [], joinable: [NEW] };
    expect(portalView({ mode: 'create', data, chosen: null })).toEqual({ kind: 'run', runId: 'run2' });
  });

  it('sin cuenta y ninguno abierto → none-open', () => {
    expect(portalView({ mode: 'create', data: { memberships: [], joinable: [] }, chosen: null })).toEqual({ kind: 'none-open' });
  });

  it('Sigue: la llave con ficha de OTRA sesión y nada más que unir → se dice, sin alta', () => {
    const data: PortalData = { memberships: [], joinable: [], heldElsewhere: { exchange: V2, reclaimRequired: false } };
    expect(portalView({ mode: 'create', data, chosen: null })).toEqual({ kind: 'held-elsewhere' });
  });

  it('…pero si hay OTRO exchange al que pedir acceso, se ofrece (con la nota)', () => {
    const data: PortalData = { memberships: [], joinable: [NEW], heldElsewhere: { exchange: V2, reclaimRequired: false } };
    expect(portalView({ mode: 'create', data, chosen: null })).toEqual({ kind: 'pick-join' });
  });
});

describe('ENTRAR', () => {
  it('una cuenta → a ella', () => {
    expect(portalView({ mode: 'enter', data: { memberships: [mine('run1', V2.label)], joinable: [NEW] }, chosen: null })).toEqual({ kind: 'run', runId: 'run1' });
  });
  it('varias (una por exchange) → eliges entre las TUYAS', () => {
    const data: PortalData = { memberships: [mine('run1', V2.label), mine('run2', NEW.label)], joinable: [] };
    expect(portalView({ mode: 'enter', data, chosen: null })).toEqual({ kind: 'pick-mine' });
  });
  it('ninguna → «aún no tienes cuenta», jamás un alta que no pidió', () => {
    expect(portalView({ mode: 'enter', data: { memberships: [], joinable: [NEW] }, chosen: null })).toEqual({ kind: 'no-account-yet' });
  });
});

describe('portalDataFrom', () => {
  it('lee memberships y joinable del backend nuevo', () => {
    const d = portalDataFrom({
      found: true, runId: 'run1', exchange: V2, client: { label: 'User1', tag: 101 },
      memberships: [{ runId: 'run1', exchange: V2, client: { label: 'User1', tag: 101 } }],
      joinable: [NEW],
    });
    expect(d.memberships).toEqual([mine('run1', V2.label)]);
    expect(d.joinable).toEqual([NEW]);
  });

  it('backend anterior con cuenta (sin campos nuevos): su cuenta y nada que unir — nunca entra mudo', () => {
    const d = portalDataFrom({ found: true, runId: 'run1', exchange: V2, client: { label: 'User1', tag: 101 } });
    expect(d).toEqual({ memberships: [mine('run1', V2.label)], joinable: [] });
    expect(portalView({ mode: 'create', data: d, chosen: null })).toEqual({ kind: 'already-everywhere' });
  });

  it('backend anterior sin cuenta: los abiertos salvo el de la ficha ajena', () => {
    const d = portalDataFrom({ found: false, exchanges: [V2, NEW, ex('run3', 'Closed', 'closed')], heldElsewhere: { exchange: V2, reclaimRequired: false } });
    expect(d.joinable.map((x) => x.runId)).toEqual(['run2']);
  });
});

describe('el portal usa la regla', () => {
  const SRC = readFileSync(join(__dirname, '..', '..', '..', 'components', 'demo-exchange', 'client', 'ExchangeClientApp.tsx'), 'utf8');
  it('decide con portalView y ya no entra directo con `found`', () => {
    expect(SRC).toContain('portalView({ mode: opening ?');
    expect(SRC).not.toMatch(/phase === 'found'/);
  });
});
