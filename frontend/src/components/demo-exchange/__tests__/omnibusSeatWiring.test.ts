import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * EL RELOJ DEL ASIENTO, TAMBIÉN EN LA MESA.
 *
 * 1.3: `notePayloadOpened` lo llamaba SOLO `XamanSingleSign`. La puerta del
 * ómnibus (la que firma el 0xFE de la mesa) no, así que el servidor seguía
 * midiendo la vida del payload desde que lo COMPUSO — minutos antes de que
 * Xaman creara nada. A los cinco minutos daba por muerto un payload todavía
 * firmable y entregaba su asiento: el gemelo sobre el nonce del ómnibus, con el
 * XRP del cliente ya en el Core Vault.
 */

const SRC = readFileSync(join(__dirname, '..', 'OmnibusSignDoor.tsx'), 'utf8');

describe('OmnibusSignDoor sella la caducidad REAL del payload (1.3)', () => {
  it('llama a notePayloadOpened con el instante que trae el bus, no con el de componer', () => {
    expect(SRC).toContain("from '../../lib/wallet/handoffRelease'");
    expect(SRC).toContain('notePayloadOpened(memoHex, new Date(expiresAt))');
    // El uuid (y su ventana) llegan por el bus: esta puerta no crea el payload.
    expect(SRC).toContain('onXamanPayload');
    expect(SRC).toMatch(/prompt\.purpose !== 'transaction'/);
  });

  it('solo sobre un 0xFE, y jamás con una ventana de ceremonia (24 h)', () => {
    // Un Payment sin memo 0xFE (el payout al cliente) no tiene asiento que sellar.
    expect(SRC).toContain('flareInstructionMemoOf(xrplTx)');
    expect(SRC).toMatch(/expiresAt - Date\.now\(\) > maxWindowMs/);
  });

  /**
   * LA VENTANA ES LA DEL SERVIDOR, NO UN 5 ESCRITO A MANO.
   * El backend mide el asiento con `HANDOFF_PAYLOAD_EXPIRY_MIN` y lo contesta
   * como `payloadExpiryMin` en cada prepare; la mesa acuñaba su payload con un
   * `expire: 5` fijo y topaba lo que sella en 15 min inventados. Bajar la
   * variable del servidor soltaba el asiento con el payload TODAVÍA firmable.
   */
  it('aprende la caducidad del SERVIDOR y con ella topa lo que sella', () => {
    expect(SRC).toContain('payloadExpiryMin');
    expect(SRC).toContain('const expireMin = payloadExpiryMin(serverExpiryMin)');
    expect(SRC).toContain('const maxWindowMs = maxPayloadWindowMs(expireMin)');
    // El tope se DERIVA de ese número (más un minuto de holgura), nunca al revés.
    expect(SRC).toMatch(/expireMin \* 60_000 \+ 60_000/);
  });

  it('la mesa le pasa el número que contestó su propio prepare', () => {
    const DESK = readFileSync(join(__dirname, '..', 'ExchangeDesk.tsx'), 'utf8');
    expect(DESK).toContain('payloadExpiryMin={workPending.handoff.payloadExpiryMin}');
    const API = readFileSync(join(__dirname, '..', '..', '..', 'lib', 'demo-exchange', 'api.ts'), 'utf8');
    // Con el memo de la fila. Sin él el número se aprendía solo para
    // la pestaña, y el de una ceremonia (24 h) pasa del clamp ordinario: se
    // descartaba entero.
    expect(API).toContain('notePayloadExpiryMin(');
    expect(API).toContain('handoff.payloadExpiryMin ?? body.payloadExpiryMin,');
    expect(API).toContain('handoff.memoHex ?? body.memoHex,');
  });

  /**
   * EL SEGUNDO AVISO ES EL BUENO. El servicio pone el QR con la
   * ventana que PIDIÓ y la reemplaza un viaje después por el `expires_at` que
   * Xaman cuenta de verdad; sellar solo el primero guardaba la conjetura.
   */
  it('re-sella la correccion del MISMO payload, y jamas la de otra ceremonia', () => {
    expect(SRC).toContain('if (sealedUuid !== null && prompt.uuid !== sealedUuid) return;');
    expect(SRC).toContain('if (sealedAt === expiresAt) return;');
  });

  it('y se desengancha al terminar: el oyente no sobrevive a la firma', () => {
    expect(SRC).toMatch(/stopWatching\?\.\(\)/);
  });
});

describe('Cancelar en Xaman explica cuándo se libera el asiento (3.3)', () => {
  it('solo pide soltarlo en el final donde NADA se movió', () => {
    expect(SRC).toMatch(/action\.view === 'review' && memoHex/);
    expect(SRC).toContain('askToFreeTheSeat');
    expect(SRC).toContain('releaseHandoffSeatResult');
  });

  it('pinta los segundos que midió el SERVIDOR y hace que cuenten', () => {
    expect(SRC).toContain('seatWaitFrom(r.secondsLeft');
    expect(SRC).toContain('seatWaitText(seatWait, nowMs, t)');
    expect(SRC).toMatch(/setInterval\(\(\) => \{[\s\S]*setNowMs\(t\);/);
  });

  it('ofrece el botón solo cuando puede funcionar (la ventana ya pasó)', () => {
    expect(SRC).toMatch(/seatSecs <= 0 \? \(/);
  });
});

/**
 * «NO PUDE LEER» NO ES «NO EXISTE», TAMPOCO EN LA
 * PANTALLA DEL CLIENTE.
 *
 * `GET /runs/for-account` es una de las cinco rutas que la lectura estricta dejó
 * contestando 500; la pantalla lo pintaba «Your exchange could not be found
 * right now», que a un cliente le dice que su cuenta ya no está. Un 503
 * reintentable dice lo que es y ofrece la única acción útil — y «Try again»
 * tiene que volver a PREGUNTAR, no solo reescribir el muro.
 */
describe('La pantalla del cliente distingue «no pude leer» de «no existe» (3.2)', () => {
  const CLIENT = readFileSync(join(__dirname, '..', 'client', 'ExchangeClientApp.tsx'), 'utf8');
  // La fase `error` vive ahora en su propio componente
  // (`PortalRefusal`), para que un test pueda RENDERIZARLA contra el 503 real y
  // ver el botón (client/__tests__/PortalRefusal.test.tsx). El cable se fija aquí.
  const PORTAL_REFUSAL = readFileSync(join(__dirname, '..', 'client', 'PortalRefusal.tsx'), 'utf8');

  it('guarda la negativa entera, no solo su texto, y pregunta si es repetible', () => {
    expect(CLIENT).toContain("phase: 'error'; refusal: Refusal");
    expect(CLIENT).toContain('<PortalRefusal refusal={state.refusal} onRetry={() => setAttempt((n) => n + 1)} />');
    expect(PORTAL_REFUSAL).toContain('refusalIsRetryable(refusal)');
    expect(PORTAL_REFUSAL).toContain('describeRefusal(refusal, t)');
  });

  it('el título cambia: leer no es encontrar', () => {
    expect(PORTAL_REFUSAL).toContain('Your exchange could not be read right now');
    expect(PORTAL_REFUSAL).toContain('Your exchange could not be found right now');
  });

  it('«Try again» vuelve a pedirlo de verdad (el efecto depende del intento)', () => {
    expect(CLIENT).toContain('setAttempt((n) => n + 1)');
    expect(CLIENT).toMatch(/\}, \[account, attempt\]\);/);
  });
});
