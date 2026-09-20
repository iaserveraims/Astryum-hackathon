import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  __resetPayloadExpiryMin,
  notePayloadExpiryMin,
  payloadExpiryMin,
  XAMAN_PAYLOAD_EXPIRY_MIN_DEFAULT,
} from '../../../lib/wallet/handoffRelease';

/**
 * LA MESA NUNCA APRENDÍA LA VENTANA.
 *
 * `XamanWalletService` creaba TODOS sus payloads con `expire: 5` escrito a mano,
 * y el asiento del 0xFE se mide contra la ventana del BACKEND
 * (`HANDOFF_PAYLOAD_EXPIRY_MIN` → `payloadExpiryMin`). Con la variable del
 * servidor por debajo, el asiento se suelta con el payload todavía firmable: el
 * gemelo, con una sola variable de entorno. Y el `expires_at` que devuelve Xaman
 * estaba TIPADO y no se leía en ninguna parte, así que lo que la puerta del
 * omnibus sellaba sobre el asiento era una conjetura de este navegador.
 */

const src = readFileSync(join(process.cwd(), 'src/services/wallets/XamanWalletService.ts'), 'utf8');

describe('el `expire` del payload sale del servidor, no de una constante', () => {
  it('no queda ni un `expire: 5` escrito a mano', () => {
    expect(src).not.toMatch(/expire:\s*5\b/);
    expect(src.match(/expire: this\.payloadExpireMinutes\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(7);
  });

  it('y la cuenta atrás que se enseña usa esa misma ventana', () => {
    expect(src).not.toContain('Date.now() + this.PAYLOAD_TIMEOUT');
    expect(src).toContain('expiresAt: Date.now() + this.payloadWindowMs()');
  });

  it('el helper es el del carril, no una copia', () => {
    expect(src).toContain("import { payloadExpiryMin } from '../../lib/wallet/handoffRelease'");
    expect(src).toContain('return payloadExpiryMin();');
  });
});

describe('el sello usa el `expires_at` REAL que devolvió la API', () => {
  it('se lee del estado del payload, y se corrige el prompt con él', () => {
    expect(src).toContain('status?.payload?.expires_at');
    expect(src).toContain('this.correctPayloadExpiry(prompt)');
  });

  it('una lectura fallida deja la estimación intacta: «no pude leer» nunca empeora nada', () => {
    expect(src).toContain('if (typeof said !== \'string\' || !said.trim()) return null;');
    expect(src).toContain('if (left <= 0 || left > this.MAX_BELIEVABLE_WINDOW_MS) return null;');
  });

  it('y jamás se sella una ventana de 24 h sobre un asiento', () => {
    expect(src).toContain('MAX_BELIEVABLE_WINDOW_MS = 15 * 60_000');
  });
});

describe('payloadExpiryMin — lo que se cree y lo que no', () => {
  it('sin nada aprendido, la constante', () => {
    __resetPayloadExpiryMin();
    expect(payloadExpiryMin()).toBe(XAMAN_PAYLOAD_EXPIRY_MIN_DEFAULT);
  });

  it('lo que dijo el servidor gana', () => {
    __resetPayloadExpiryMin();
    notePayloadExpiryMin(2);
    expect(payloadExpiryMin()).toBe(2);
  });

  it('un valor absurdo se ignora, y la constante aguanta', () => {
    __resetPayloadExpiryMin();
    notePayloadExpiryMin(0);
    notePayloadExpiryMin(-3);
    notePayloadExpiryMin(5000);
    notePayloadExpiryMin('mucho' as unknown as number);
    expect(payloadExpiryMin()).toBe(XAMAN_PAYLOAD_EXPIRY_MIN_DEFAULT);
  });
});
