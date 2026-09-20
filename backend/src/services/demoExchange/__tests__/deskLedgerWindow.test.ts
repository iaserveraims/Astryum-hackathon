/**
 * productizer it. 19 (R1 1.6) — LA VENTANA DE LA MESA Y LA DEL CONSTRUCTOR SON
 * LA MISMA, Y NO PUEDEN VOLVER A SEPARARSE.
 *
 * La mesa clavaba 100 ledgers (~6,7 min) mientras el payload de Xaman caduca a
 * los 5: cada composición abandonada congelaba el asiento de nonce del omnibus
 * —que comparten TODOS los clientes de la mesa— casi dos minutos después de que
 * ya nadie pudiera firmar. La ventana viva es ahora «lo que vive el payload + un
 * minuto de margen», que es exactamente la del constructor.
 *
 * Este test es el TRIPWIRE: compara las dos funciones contra el mismo entorno.
 * Si alguien mueve una sola, la suite se cae aquí y no en producción.
 */
import { defaultLastLedgerWindow } from '../../../connectors/protocols/flare/FlareDirectMintService';
import { DESK_PAYOUT_LEDGER_WINDOW, PUT_TO_WORK_LEDGER_WINDOW, putToWorkLedgerWindow } from '../deskPaymentProof';

const SAVED = process.env.HANDOFF_PAYLOAD_EXPIRY_MIN;
afterEach(() => {
  if (SAVED === undefined) delete process.env.HANDOFF_PAYLOAD_EXPIRY_MIN;
  else process.env.HANDOFF_PAYLOAD_EXPIRY_MIN = SAVED;
});

describe('la ventana del put-to-work se mide contra el payload', () => {
  it('con la caducidad por defecto son 90 ledgers ≈ 6 min (5 min de payload + 1 de margen)', () => {
    delete process.env.HANDOFF_PAYLOAD_EXPIRY_MIN;
    expect(putToWorkLedgerWindow()).toBe(90);
    // …y ya no los 100 que se clavaban antes (≈ 6,7 min de asiento congelado).
    expect(putToWorkLedgerWindow()).toBeLessThan(PUT_TO_WORK_LEDGER_WINDOW);
  });

  it('es el MISMO número que el del constructor, con cualquier caducidad', () => {
    for (const expiry of [undefined, '1', '5', '10', '45', '0.1', 'abc', '600']) {
      if (expiry === undefined) delete process.env.HANDOFF_PAYLOAD_EXPIRY_MIN;
      else process.env.HANDOFF_PAYLOAD_EXPIRY_MIN = expiry;
      expect(putToWorkLedgerWindow()).toBe(defaultLastLedgerWindow());
    }
  });

  it('nunca baja de lo que vive el payload: firmar en el último segundo aún entra', () => {
    for (const expiry of ['1', '5', '10', '45']) {
      process.env.HANDOFF_PAYLOAD_EXPIRY_MIN = expiry;
      // 15 ledgers por minuto: la ventana cubre entera la vida del payload.
      expect(putToWorkLedgerWindow()).toBeGreaterThanOrEqual(Number(expiry) * 15);
    }
  });

  it('la ventana del PAGO de la mesa (un payout firmado en Xaman) no se toca aquí', () => {
    expect(DESK_PAYOUT_LEDGER_WINDOW).toBe(100);
  });
});
