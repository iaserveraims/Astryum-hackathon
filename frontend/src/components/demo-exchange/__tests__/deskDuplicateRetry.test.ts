/**
 * productizer it. 23 (3.4 y 3.2) — EL REINTENTO DEL DUPLICADO NO COMPROBABLE,
 * TAMBIÉN EN LA MESA.
 *
 * `DUPLICATE_CHECK_UNREADABLE` dice que la comprobación del duplicado NO PUDO
 * CORRER (el presupuesto de lecturas gastado, un nodo caído): nadie encontró un
 * duplicado, simplemente no pudimos mirar. Viaja `retryable: true` Y
 * `confirmAnotherOrder: true` — un reintento y una escapatoria — y desde la
 * it. 21 las seis puertas del consejo lo pintan con `CouncilOrderInFlightConfirm`
 * (tres botones + los segundos que el servidor pidió esperar).
 *
 * Las DOS puertas de la mesa (abrir el pote, apuntar la puerta KYC) se quedaron
 * con un `window.confirm` de dos salidas: sobre ese código afirmaba un duplicado
 * que nadie vio y tiraba `retryAfterSeconds` y `confirmAnotherOrder`.
 *
 * Las decisiones se prueban ejecutándolas (`mayConfirmAnotherOrder`,
 * `isDuplicateCheckUnreadable`, en lib/institutional); esto impide que el cable
 * se desconecte de las superficies de la mesa.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DESK = readFileSync(join(__dirname, '..', 'ExchangeDesk.tsx'), 'utf8');
const WIZARD = readFileSync(join(__dirname, '..', 'stage', 'ExchangeSetupWizard.tsx'), 'utf8');
const CONSOLE_ = readFileSync(join(__dirname, '..', 'console', 'ExchangeConsole.tsx'), 'utf8');

describe('las puertas de la mesa usan el MISMO lector que las del consejo', () => {
  it.each([
    ['ExchangeDesk', DESK],
    ['ExchangeSetupWizard', WIZARD],
  ])('%s decide con mayConfirmAnotherOrder, no solo con «la misma orden salió»', (_name, src) => {
    expect(src).toContain('mayConfirmAnotherOrder(res.refusal)');
    // El `window.confirm` de dos salidas ya no gobierna ninguna composición.
    expect(src).not.toMatch(/if \(!res\.ok && isSameOrderRecentlyLaunched/);
  });

  it.each([
    ['ExchangeDesk', DESK],
    ['ExchangeSetupWizard', WIZARD],
  ])('%s pinta el panel de tres botones y le pasa los segundos del servidor', (_name, src) => {
    expect(src).toContain('CouncilOrderInFlightConfirm');
    expect(src).toContain('retryAfterSeconds');
    // El reintento existe y NO confirma nada (es nuestra lectura la que falló).
    expect(src).toMatch(/onRetry=\{\(\) => void compose/);
    expect(src).toMatch(/onConfirm=\{\(\) => void (compose|resume)/);
  });

  it('y el `confirmAnotherOrder` que se manda es el que la persona pulsó', () => {
    expect(DESK).toContain("...(opts?.confirmAnother ? { confirmAnotherOrder: true } : {})");
    expect(WIZARD).toContain("...(opts?.confirmAnother ? { confirmAnotherOrder: true } : {})");
  });

  it('la orden de E6 separa «vi un duplicado» de «no pude comprobarlo»', () => {
    expect(DESK).toContain('isDuplicateCheckUnreadable({ code: duplicateOffer.code })');
    // El panel del duplicado que SÍ se vio sigue siendo el suyo.
    expect(DESK).toContain('data-testid="order-duplicate-offer"');
  });
});

/**
 * it. 23 (3.2): «no se pudo leer» se DICE en las dos superficies que pintan el
 * gasto de hoy — nunca la palabra «null», nunca un hueco junto al tope.
 */
describe('el gasto de hoy nunca se pinta como «null» ni como un hueco', () => {
  it('la mesa pasa por spentTodayText', () => {
    expect(DESK).toContain('spentTodayText(status, t)');
    expect(DESK).not.toContain('{status.spentTodayXrp} / {status.dailyCapXrp}');
  });

  it('la consola no mete el valor en String() a ciegas', () => {
    expect(CONSOLE_).not.toContain('String(autopilot.spentTodayXrp)}');
    expect(CONSOLE_).toContain("typeof autopilot.spentTodayXrp === 'number'");
  });
});
