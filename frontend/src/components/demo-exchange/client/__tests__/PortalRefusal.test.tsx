/**
 * productizer it. 31 (agente D, 4.2) — EL PORTAL DEL EXCHANGE, ANTE EL 503 DE
 * «NO PUDE USAR TU MARCA», PINTA LA FRASE DEL SERVIDOR Y UN REINTENTO.
 *
 * Lo que falló y por qué esta prueba existe: la it. 29 hizo que la retirada
 * contestara 503 `OWNERSHIP_UNREADABLE` con «dated later than our clock» cuando
 * la marca de toma de posesión está adelantada al reloj del servidor — y probó
 * `takeoverAtOf`, la pieza. Nadie probó el CONSUMIDOR: la primera llamada del
 * cliente (`GET /runs/for-account`) convertía esa misma marca en «la toma fue
 * ahora», contestaba `heldElsewhere.reclaimRequired: true`, y el portal decía
 * «the exchange has to confirm it is you again with a claim code» — acción de
 * fundador, sin botón, sin reintento (solo la fase `error` incrementa
 * `attempt`). La persona no pasaba del portal, así que los 503 de la retirada
 * ni se alcanzaban. Y aunque hubieran llegado, `REFUSAL_TEXT.OWNERSHIP_UNREADABLE`
 * pisaba el `detail` con «could not be read just now».
 *
 * Aquí se renderiza la fase de verdad (react-dom/server sobre el componente que
 * `ClientPortal` monta en `phase: 'error'`) con el cuerpo que ahora manda el
 * servidor, y se mira el HTML: la frase del servidor, y el botón.
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

describe('PortalRefusal — el 503 OWNERSHIP_UNREADABLE del portal (it. 31, 4.2)', () => {
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
    // Jamás la frase del fundador: la persona no necesita un código de reclamación.
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
