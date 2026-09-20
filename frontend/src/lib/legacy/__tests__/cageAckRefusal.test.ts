/**
 * productizer it. 31 (agente D, 4.3) — LOS DOS CLIENTES DE LA PUERTA DEL
 * RECONOCIMIENTO DE LA JAULA LEEN `cause`.
 *
 * El servidor dice desde it. 27 POR QUÉ falta el reconocimiento (`cause`), y
 * ni CageBirthCard ni CouncilVaultEntry lo leían: abrían el modal por el
 * código a secas y reintentaban al confirmar. Para tres de las cuatro causas
 * confirmar no arregla nada (la ficha no parsea, está adelantada al reloj del
 * servidor — it. 31 la separa —, o la base no contestó): la persona confirmaba,
 * volvía el mismo 409 y se reabría el modal. La regla es pura y se prueba aquí;
 * el cable a las dos pantallas se fija en fuente.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CAGE_ACK_CANNOT_CONFIRM_FALLBACK, cageAckRefusalOf } from '../cageAckRefusal';

const refusal = (body: Record<string, unknown>) => ({ status: 409, body: { error: 'CAGE_ACK_REQUIRED', version: 1, ...body } });

describe('cageAckRefusalOf — solo «no_record» abre el modal', () => {
  it('no_record ⇒ confirmar SÍ ayuda: se abre el texto', () => {
    expect(cageAckRefusalOf(refusal({ cause: 'no_record', detail: 'Read “How a cage works” and confirm…' }))).toMatchObject({ confirmHelps: true, cause: 'no_record' });
  });

  it('un servidor viejo sin `cause` se lee como no_record (misma conducta que antes)', () => {
    expect(cageAckRefusalOf(refusal({}))).toMatchObject({ confirmHelps: true, cause: null });
  });

  it.each(['unreadable_mark', 'ahead_of_clock', 'read_failed'] as const)('%s ⇒ confirmar NO ayuda: se enseña la frase del servidor, no el modal', (cause) => {
    const out = cageAckRefusalOf(refusal({ cause, detail: `server sentence for ${cause}` }));
    expect(out).toEqual({ confirmHelps: false, cause, detail: `server sentence for ${cause}` });
  });

  it('una causa desconocida se trata como «no consta»: abre el modal antes que tapiar a la persona sin frase', () => {
    expect(cageAckRefusalOf(refusal({ cause: 'something_new' }))).toMatchObject({ confirmHelps: true, cause: null });
  });

  it('otro código no es un rechazo de reconocimiento', () => {
    expect(cageAckRefusalOf({ status: 409, body: { error: 'NONCE_SEAT_TAKEN' } })).toBeNull();
    expect(cageAckRefusalOf(new Error('network'))).toBeNull();
    expect(cageAckRefusalOf(null)).toBeNull();
  });

  it('sin `detail` para una causa que confirmar no arregla, hay una frase de reserva que no acusa ni promete', () => {
    expect(cageAckRefusalOf(refusal({ cause: 'read_failed' }))?.detail).toBeNull();
    expect(CAGE_ACK_CANNOT_CONFIRM_FALLBACK).toMatch(/Confirming again will not clear this/);
    expect(CAGE_ACK_CANNOT_CONFIRM_FALLBACK).toMatch(/no capital has moved/);
    expect(CAGE_ACK_CANNOT_CONFIRM_FALLBACK).not.toMatch(/you have not/i);
  });
});

describe('el cable: las dos pantallas deciden por `cageAckRefusalOf`, no por el código a secas', () => {
  const legacy = join(__dirname, '..', '..', '..', 'components', 'legacy');
  it.each(['CageBirthCard.tsx', 'CouncilVaultEntry.tsx'])('%s', (file) => {
    const src = readFileSync(join(legacy, file), 'utf8');
    expect(src).toContain("from '../../lib/legacy/cageAckRefusal'");
    expect(src).toContain('const ack = cageAckRefusalOf(err);');
    expect(src).toContain('if (ack.confirmHelps) {');
    expect(src).toContain('setError(ack.detail ?? t(CAGE_ACK_CANNOT_CONFIRM_FALLBACK));');
    // La forma vieja — abrir el modal por el código a secas — ya no existe.
    expect(src).not.toMatch(/body\?\.error === 'CAGE_ACK_REQUIRED'\)\s*\{\s*setAckOpen\(true\)/);
  });
});
