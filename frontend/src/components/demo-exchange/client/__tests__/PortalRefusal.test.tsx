/**
 * EL PORTAL DEL EXCHANGE, ANTE EL 503 DE
 * «NO PUDE USAR TU MARCA», PINTA LA FRASE DEL SERVIDOR Y UN REINTENTO.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PortalRefusal } from '../PortalRefusal';
import type { Refusal } from '../../../../lib/demo-exchange/api';

const render = (refusal: Refusal): string => renderToStaticMarkup(createElement(PortalRefusal, { refusal, onRetry: () => {} }));

/** Lo que `GET /runs/for-account` contesta hoy con la marca adelantada (backend, `ownershipUnreadableBody`). */
const AHEAD_OF_CLOCK: Refusal = {
  status: 503,
  error: 'OWNERSHIP_UNREADABLE',
  retryable: true,
  detail:
    "This sign-in's security record is dated later than our own clock, so the exchange cannot yet tell whether your account here was opened before or after it last changed hands. Nothing was changed and nothing is lost: this clears on its own once our clock passes that date — try again later. Re-linking a wallet will not help, and no claim code is needed. If it persists, write to us: an administrator can check that date.",
};

describe('PortalRefusal — el 503 OWNERSHIP_UNREADABLE del portal (4.2)', () => {
  it('pinta la frase del SERVIDOR («dated later than our own clock»), no «could not be read just now»', () => {
    const html = render(AHEAD_OF_CLOCK);
    expect(html).toContain('dated later than our own clock');
    expect(html).toContain('no claim code is needed');
    expect(html).not.toContain('could not be read just now');
    // Y el título es el de «no pude leer», no el de «no existe».
    expect(html).toContain('Your exchange could not be read right now');
    expect(html).not.toContain('could not be found');
  });

  it('ofrece el reintento: hay un botón «Try again»', () => {
    const html = render(AHEAD_OF_CLOCK);
    expect(html).toMatch(/<button[^>]*>[\s\S]*?Try again[\s\S]*?<\/button>/);

    expect(html).not.toMatch(/claim code\b(?! is needed)/);
  });

  it('un servidor viejo sin `detail` sigue teniendo frase y reintento (fallback, nunca el código)', () => {
    const html = render({ status: 503, error: 'OWNERSHIP_UNREADABLE' });
    expect(html).toContain('could not be read just now');
    expect(html).not.toContain('>OWNERSHIP_UNREADABLE<');
    expect(html).toMatch(/<button[^>]*>[\s\S]*?Try again[\s\S]*?<\/button>/);
  });

  it('una negativa NO reintentable no inventa el botón', () => {
    const html = render({ status: 404, error: 'RUN_NOT_FOUND', detail: 'no such exchange' });
    expect(html).toContain('Your exchange could not be found right now');
    expect(html).not.toContain('Try again');
  });
});

/**
 * El cable: `ClientPortal` monta ESTE componente en su fase `error` y le pasa el
 * incremento de `attempt` (que es lo que vuelve a llamar a `for-account`).
 * Renderizar `ExchangeClientApp` entero no es posible en este entorno (su grafo
 * de imports arrastra la pila de wallets), así que el enlace se fija en fuente.
 */
describe('ClientPortal usa PortalRefusal para la fase error', () => {
  const SRC = readFileSync(join(__dirname, '..', 'ExchangeClientApp.tsx'), 'utf8');

  it('monta PortalRefusal con el reintento que re-pregunta a for-account', () => {
    expect(SRC).toContain("import { PortalRefusal } from './PortalRefusal';");
    expect(SRC).toContain('<PortalRefusal refusal={state.refusal} onRetry={() => setAttempt((n) => n + 1)} />');
    // …y el efecto depende de `attempt`, así que el botón vuelve a preguntar de verdad.
    expect(SRC).toMatch(/\}, \[account, attempt\]\);/);
  });
});
