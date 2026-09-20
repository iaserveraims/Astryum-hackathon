/**
 * productizer it. 33 (agente C, 7 — menores del lado del cliente).
 *
 *  · `for-account` sin `.catch`: si `fetch` reventaba (sin red, DNS), el portal
 *    se quedaba en «Finding your exchange…» para siempre. Ahora la excepción es
 *    una negativa reintentable (`networkRefusal`) y pasa por `PortalRefusal`.
 *  · El portal «clásico» (`ExchangeClientSite`, pegajoso en localStorage) leía
 *    el 503 de `for-account` como «could not be found» sin botón: misma fase que
 *    el portal del producto.
 *  · `ExchangeSetupPanel.archive()` ignoraba la respuesta: el fundador pulsaba
 *    «cerrar», el servidor decía 409 RUN_HAS_LIVE_WORK, y nada pasaba.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PortalRefusal } from '../PortalRefusal';
import { describeRefusal, networkRefusal, refusalIsRetryable } from '../../../../lib/demo-exchange/api';

const t = (s: string) => s;

describe('networkRefusal — fetch que revienta = «no pude leer», reintentable', () => {
  it('es una negativa reintentable con frase propia, y PortalRefusal la pinta con «Try again»', () => {
    const refusal = networkRefusal(new TypeError('Failed to fetch'));
    expect(refusal).toMatchObject({ status: 0, error: 'NETWORK_UNREACHABLE', retryable: true, detail: 'Failed to fetch' });
    expect(refusalIsRetryable(refusal)).toBe(true);
    expect(describeRefusal(refusal, t)).toContain('could not be reached from this device');
    const html = renderToStaticMarkup(createElement(PortalRefusal, { refusal, onRetry: () => {} }));
    expect(html).toContain('Your exchange could not be read right now');
    expect(html).toMatch(/<button[^>]*>[\s\S]*?Try again[\s\S]*?<\/button>/);
    expect(html).not.toContain('could not be found');
  });
});

describe('el cable', () => {
  const app = readFileSync(join(__dirname, '..', 'ExchangeClientApp.tsx'), 'utf8');
  const site = readFileSync(join(__dirname, '..', 'ExchangeClientSite.tsx'), 'utf8');
  const panel = readFileSync(join(__dirname, '..', '..', 'ExchangeSetupPanel.tsx'), 'utf8');

  it('los dos portales capturan la excepción de for-account y la convierten en la fase error con networkRefusal', () => {
    for (const src of [app, site]) {
      expect(src).toMatch(/demoApi\.forAccount\(account\)\.then\([\s\S]*?\}\)\.catch\(\(e: unknown\) => \{[\s\S]*?setState\(\{ phase: 'error', refusal: networkRefusal\(e\) \}\);/);
    }
  });

  it('el portal clásico monta PortalRefusal con un reintento que vuelve a preguntar (attempt en las deps)', () => {
    expect(site).toContain("import { PortalRefusal } from './PortalRefusal';");
    expect(site).toContain('<PortalRefusal refusal={state.refusal} onRetry={() => setAttempt((n) => n + 1)} />');
    expect(site).toMatch(/\}, \[account, attempt\]\);/);
    expect(site).not.toContain("title={t('Your exchange could not be found right now')} hint={state.detail}");
  });

  it('archive() lee la respuesta: una negativa se pinta junto al perfil (describeRefusal), y no se refresca como si hubiera cerrado', () => {
    expect(panel).toMatch(/const r = await demoApi\.patchRun\(runId, \{ status: 'closed' \}\);\s*if \(!r\.ok\) \{\s*setArchiveErr\(\{ runId, text: describeRefusal\(r\.refusal, t\) \}\);\s*return;\s*\}/);
    expect(panel).toContain('data-testid="setup-panel-archive-error"');
  });
});
