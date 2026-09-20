/**
 * La cola de la mesa sin autopilot (18-sep): lo que los clientes PIDIERON y el
 * omnibus firma con un QR. Pura — las reglas se prueban sin montar la consola.
 *
 * Por qué hay reglas de «se puede servir ya»: servir una petición la TOMA primero
 * (el backend no deja que la mesa pague mientras la petición reserva el saldo:
 * PAYMENT_IN_FLIGHT) y después compone el pago. Si el pago no se pudiera
 * componer, la petición ya no estaría en la cola. Así que solo se ofrece servir
 * lo que el servidor va a aceptar componer:
 *   · sin un pago de la mesa abierto para ese cliente (se paga una vez);
 *   · meter en el vault, no con una RETIRADA suya pendiente delante — la salida
 *     pesa sobre la entrada esté donde esté (availableBalance, it. 27);
 *   · con lo que el pago necesita: la wallet de retirada del cliente, o su cuenta
 *     de passkey y el pote.
 */
import type { ClientRequest, DemoRun } from './api';

/** Peticiones pendientes + pagos de la mesa en vuelo: lo que espera a la mesa. */
export function pendingDeskWork(run: Pick<DemoRun, 'requests' | 'deskPayments'>): number {
  const reqs = (run.requests ?? []).filter((q) => q.status === 'pending').length;
  const open = (run.deskPayments ?? []).filter((p) => p.status === 'prepared' || p.status === 'signed').length;
  return reqs + open;
}

export type Servability =
  | { ok: true }
  | { ok: false; why: 'desk-payment-open' | 'withdraw-first' | 'no-wallet' | 'no-passkey' | 'no-pote' | 'no-client' };

export function servability(run: Pick<DemoRun, 'requests' | 'deskPayments' | 'clients' | 'poteAddress'>, q: ClientRequest): Servability {
  const client = run.clients.find((c) => c.id === q.clientId);
  if (!client) return { ok: false, why: 'no-client' };
  if ((run.deskPayments ?? []).some((p) => p.clientId === q.clientId && (p.status === 'prepared' || p.status === 'signed'))) {
    return { ok: false, why: 'desk-payment-open' };
  }
  if (q.kind === 'put-to-work') {
    const withdrawAhead = (run.requests ?? []).some((o) => o.id !== q.id && o.clientId === q.clientId && o.kind === 'withdraw' && o.status === 'pending');
    if (withdrawAhead) return { ok: false, why: 'withdraw-first' };
    if (!client.passkeyAccount) return { ok: false, why: 'no-passkey' };
    if (!run.poteAddress) return { ok: false, why: 'no-pote' };
  } else if (!client.xrplAddress) {
    return { ok: false, why: 'no-wallet' };
  }
  return { ok: true };
}

/** Drops → importe XRP EXACTO para la API (`^\d+(\.\d{1,6})?$`): sin separadores ni redondeo. */
export function dropsToXrpAmount(drops: string): string {
  const d = BigInt(drops);
  const whole = d / BigInt(1_000_000);
  const frac = (d % BigInt(1_000_000)).toString().padStart(6, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole.toString();
}
