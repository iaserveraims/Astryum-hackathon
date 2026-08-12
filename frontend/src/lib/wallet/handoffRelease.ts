/**
 * releaseHandoffSeat — libera el asiento de nonce de una orden 0xFE preparada
 * y NO firmada (el usuario canceló, pulsó Atrás o cerró el modal en revisión).
 *
 * El backend marca esa fila 'superseded' para que el usuario pueda preparar
 * otra al instante, sin esperar al TTL del asiento (buildDirectMintHandoff) ni
 * quedar tapiado por NONCE_SEAT_TAKEN. Best-effort y fire-and-forget: si falla,
 * el TTL sigue siendo la red de seguridad. `keepalive` para que sobreviva al
 * desmontaje del modal / navegación.
 *
 * Solo toca filas 'queued' server-side: jamás vuelve inejecutable una Payment
 * ya firmada (el executor la resuelve por hash pase cual sea el status). Por eso
 * solo debe llamarse cuando el usuario ABANDONA sin firmar, no tras firmar.
 */
import { getApiBase } from '../env';

export function releaseHandoffSeat(memoHex: string | undefined | null): void {
  if (!memoHex || typeof window === 'undefined') return;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = window.localStorage.getItem('auth_token');
  if (token) headers['Authorization'] = `Bearer ${token}`;
  try {
    void fetch(`${getApiBase()}/flare-demo/handoff/release`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ memoHex }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* best-effort — el TTL del asiento cubre el fallo */
  }
}
