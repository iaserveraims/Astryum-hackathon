/**
 * LA PUERTA DE UNA CEREMONIA ABANDONADA, Y LO QUE NO ABRE.
 *
 * Desde la §2.1 el 0xFE de una cuenta que firma por quórum se compone con la vida
 * REAL de sus payloads (24 h). El precio honesto: su asiento de nonce queda
 * ocupado mientras esos bytes puedan entrar — y sin una puerta, la SEGUNDA salida
 * de ese mismo consejo chocaría con un 409 durante un día entero. Eso es tapiar
 * una salida con código nuestro.
 */
import {
  classifySeatSignability,
  DEFAULT_HANDOFF_CEREMONY_EXPIRY_MIN,
  defaultSeatWindowLedgers,
} from '../handoffAuthority';

const MIN = 60_000;
const VALIDATED = 90_000_000;
const NOW = Date.UTC(2026, 8, 15, 12, 0, 0);

/** Una fila de CEREMONIA compuesta hace media hora: su payload vive 24 h. */
function ceremonyRow(over: Record<string, unknown> = {}) {
  return {
    createdAt: new Date(NOW - 30 * MIN),
    lastLedgerSequence: VALIDATED + 20_000,
    composedLedgerIndex: VALIDATED - 450,
    payloadExpiryMin: DEFAULT_HANDOFF_CEREMONY_EXPIRY_MIN,
    ...over,
  };
}

const ctx = (over: Record<string, unknown> = {}) => ({
  nowMs: NOW,
  validatedLedgerIndex: VALIDATED,
  fallbackWindowLedgers: defaultSeatWindowLedgers(),
  ...over,
});

describe('el asiento de una ceremonia: sin la puerta, un día entero', () => {
  it('a la media hora el asiento sigue ocupado y dice cuánto le queda — el quórum sigue firmando', () => {
    const v = classifySeatSignability(ceremonyRow(), ctx());
    expect(v.unsignable).toBe(false);
    expect(v.reason).toBe('payload-live');
    // Le quedan ~23,5 h: es exactamente lo que la segunda salida de ese consejo
    // tendría que esperar si nadie pudiera terminar la ceremonia.
    expect(v.secondsLeft).toBeGreaterThan(23 * 60 * 60);
  });
});

describe('el titular termina la ceremonia: la puerta abre, pero solo con la física a favor', () => {
  it('con la ventana leída ENTERA y sin su memo, el asiento se suelta — y se apunta por qué', () => {
    const v = classifySeatSignability(ceremonyRow(), ctx({ holderEndedCeremony: true, windowState: 'absent' }));
    expect(v.unsignable).toBe(true);
    expect(v.reason).toBe('ceremony-ended'); // no «caducó»: lo terminó una persona
  });

  it('SIN leer la ventana no suelta nada: pide leerla primero', () => {
    const v = classifySeatSignability(ceremonyRow(), ctx({ holderEndedCeremony: true }));
    expect(v.unsignable).toBe(false);
    expect(v.reason).toBe('window-unreadable');
    expect(v.needsWindow).toBe(true);
  });

  /**
   * LA LÍNEA QUE NO SE CRUZA. «No pude leer» jamás libera un asiento: si aquel
   * Payment entró y soltamos el asiento, el prepare siguiente compone otro userOp
   * en el MISMO nonce y uno de los dos muere InvalidNonce con el XRP dentro.
   */
  it('una ventana ILEGIBLE sigue reteniendo el asiento, la termine quien la termine', () => {
    const v = classifySeatSignability(
      ceremonyRow(),
      ctx({ holderEndedCeremony: true, windowState: 'unreadable' }),
    );
    expect(v.unsignable).toBe(false);
    expect(v.reason).toBe('window-unreadable');
  });

  it('una fila FIRMADA no la toca ni el titular', () => {
    const marked = classifySeatSignability(
      ceremonyRow({ signedAt: new Date(NOW - MIN).toISOString() }),
      ctx({ holderEndedCeremony: true, windowState: 'absent' }),
    );
    expect(marked.unsignable).toBe(false);
    expect(marked.reason).toBe('signed');

    // …y tampoco cuando quien lo dice es el LEDGER (la ventana trae su Payment).
    const onLedger = classifySeatSignability(ceremonyRow(), ctx({ holderEndedCeremony: true, windowState: 'signed' }));
    expect(onLedger.unsignable).toBe(false);
    expect(onLedger.reason).toBe('signed');
  });

  it('una firma REPORTADA que el ledger no ha validado sigue frenando el reloj', () => {
    const v = classifySeatSignability(
      ceremonyRow(),
      ctx({ holderEndedCeremony: true, windowState: 'absent', reportedUnverified: true }),
    );
    expect(v.unsignable).toBe(false);
    expect(v.reason).toBe('reported-unverified');
  });

  /**
   * Una fila que SÍ caducó por el reloj se sigue apuntando como caducada: la marca
   * del titular no reescribe lo que pasó de verdad.
   */
  it('si el reloj ya había matado el payload, el motivo sigue siendo la caducidad', () => {
    const old = ceremonyRow({ createdAt: new Date(NOW - 2 * DEFAULT_HANDOFF_CEREMONY_EXPIRY_MIN * MIN) });
    const v = classifySeatSignability(old, ctx({ holderEndedCeremony: true, windowState: 'absent' }));
    expect(v.unsignable).toBe(true);
    expect(v.reason).toBe('payload-expired');
  });
});
