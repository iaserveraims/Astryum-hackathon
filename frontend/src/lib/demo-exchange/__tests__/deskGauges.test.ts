/**
 * productizer it. 23 (3.2 y 3.3) — LO QUE EL SERVIDOR NO SUPO, SE DICE.
 *
 * 3.2: `spentTodayXrp` es `number | null` en el backend desde la it. 21 (el
 * libro de gasto se lee ESTRICTO, y «no pude leerlo» jamás puede pasar por «0
 * gastado hoy» en el número que acota una llave que firma). El frontend seguía
 * tipándolo `number`, así que la consola imprimía la palabra «null» y la mesa
 * dejaba un hueco — que al lado de «/ 200 XRP today» se lee como cero.
 *
 * 3.3: `OMNIBUS_OWNER_UNKNOWN` lo decide una puerta MÁS ESTRECHA que la que dejó
 * pasar (`requireAdmin` admite `x-admin-session` sin poblar `req.siwe`), y no es
 * reintentable: repetir no cambia nada. Lo que lo cambia es la sesión de
 * Astryum que prueba que la cuenta es tuya — y eso hay que decirlo.
 */
import { describe, expect, it } from 'vitest';
import { omnibusOwnerUnknownStep, refusalIsRetryable, spentTodayText } from '../api';

const t = (s: string) => s;

describe('3.2 — el gasto de hoy: un número, o una frase (nunca «null» ni un hueco)', () => {
  it('cuando el servidor lo leyó, es el número contra el tope', () => {
    expect(spentTodayText({ spentTodayXrp: 42, dailyCapXrp: 200 }, t)).toBe('42 / 200 XRP');
    expect(spentTodayText({ spentTodayXrp: 0, dailyCapXrp: 200 }, t)).toBe('0 / 200 XRP');
  });

  it('cuando no lo pudo leer, lo DICE — y la palabra «null» no aparece nunca', () => {
    const text = spentTodayText({ spentTodayXrp: null, dailyCapXrp: 200 }, t);
    expect(text).toMatch(/could not be read/);
    expect(text).not.toMatch(/null/);
    expect(text).toContain('200');
    // Ni un hueco: un hueco al lado del tope se lee como cero.
    expect(text.trim().length).toBeGreaterThan(10);
  });

  it('un valor que no es un número finito se trata igual que null', () => {
    expect(spentTodayText({ spentTodayXrp: Number.NaN, dailyCapXrp: 200 }, t)).toMatch(/could not be read/);
    expect(spentTodayText({ spentTodayXrp: undefined as unknown as number, dailyCapXrp: 200 }, t)).toMatch(/could not be read/);
  });

  it('sin estado todavía es un guion, no un cero', () => {
    expect(spentTodayText(null, t)).toBe('—');
  });
});

describe('3.3 — OMNIBUS_OWNER_UNKNOWN tiene un paso, no un muro', () => {
  it('sin sesión: dice que hay que entrar con la cuenta dueña, y que la de admin no lo prueba', () => {
    const step = omnibusOwnerUnknownStep({ error: 'OMNIBUS_OWNER_UNKNOWN', sessionState: 'no-session-presented' }, t);
    expect(step).toBeTruthy();
    expect(step).toMatch(/Sign in to Astryum/);
    expect(step).toMatch(/admin session/);
    expect(step).toMatch(/nothing was created/);
  });

  it('con una sesión que no verificó: dice que caducó, no que la cuenta sea de otro', () => {
    const step = omnibusOwnerUnknownStep({ error: 'OMNIBUS_OWNER_UNKNOWN', sessionState: 'session-not-verified' }, t);
    expect(step).toMatch(/did not verify/);
    expect(step).not.toMatch(/belongs to another/);
  });

  it('y jamás inventa un camino sobre otra negativa', () => {
    expect(omnibusOwnerUnknownStep({ error: 'OMNIBUS_IS_A_USER_ACCOUNT' }, t)).toBeNull();
    expect(omnibusOwnerUnknownStep(null, t)).toBeNull();
  });

  it('no es «reintentable»: repetir la misma llamada no cambia nada', () => {
    expect(refusalIsRetryable({ status: 409, error: 'OMNIBUS_OWNER_UNKNOWN' })).toBe(false);
    // …pero el 503 de «no pude leer si tiene dueño» sí lo es.
    expect(refusalIsRetryable({ status: 503, error: 'OMNIBUS_OWNERSHIP_UNREADABLE' })).toBe(true);
  });
});
