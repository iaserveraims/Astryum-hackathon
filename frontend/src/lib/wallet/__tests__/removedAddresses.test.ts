/**
 * Lo que el usuario quita NO vuelve por ningún camino automático.
 *
 * Esta es la regla que faltaba (fundador 2026-09-13, segunda vuelta: «la firma
 * y demás funciona, pero no se borra la wallet, no desaparece de la account»).
 * Se borraba la fila Y la entrada del registro, y la cuenta reaparecía igual,
 * porque cada carga del registro vuelca los punteros locales del navegador y
 * volvía a darla de alta. Con la marca puesta, ese volcado la salta — y la
 * lista de candidatos tampoco la ofrece.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import {
  isAddressRemoved,
  markAddressRemoved,
  unmarkAddressRemoved,
  removalKey,
  removedAddresses,
} from '../removedAddresses';

const XRPL = 'rpM7wQNUZLmPDbLMFmYZFzRGCcQjTFVhVh';
const EVM = '0xC8B2e2F8f0c3B5aA4d1dF8B3E9a0F1c2D3e4A55D';

// El módulo lee `window.localStorage`; el entorno de estos tests es node.
const store = new Map<string, string>();
const hadWindow = 'window' in globalThis;
vi.stubGlobal('window', {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
});

beforeEach(() => store.clear());
afterAll(() => {
  if (!hadWindow) vi.unstubAllGlobals();
});

describe('removalKey', () => {
  it('EVM se compara en minúsculas', () => {
    expect(removalKey(EVM)).toBe(EVM.toLowerCase());
  });

  it('XRPL es base58: se respeta tal cual', () => {
    expect(removalKey(XRPL)).toBe(XRPL);
  });

  it('los espacios pegados no cuentan', () => {
    expect(removalKey(`  ${XRPL} `)).toBe(XRPL);
  });
});

describe('la marca de quitado', () => {
  it('una dirección limpia no está marcada', () => {
    expect(isAddressRemoved(XRPL)).toBe(false);
  });

  it('marcar y preguntar: el camino que usa el volcado del registro', () => {
    markAddressRemoved(XRPL);
    expect(isAddressRemoved(XRPL)).toBe(true);
  });

  it('añadirla otra vez levanta la marca — intención fresca', () => {
    markAddressRemoved(XRPL);
    unmarkAddressRemoved(XRPL);
    expect(isAddressRemoved(XRPL)).toBe(false);
  });

  it('una EVM marcada se reconoce escrita de cualquier forma', () => {
    markAddressRemoved(EVM.toLowerCase());
    expect(isAddressRemoved(EVM)).toBe(true);
    expect(isAddressRemoved(EVM.toUpperCase().replace('0X', '0x'))).toBe(true);
  });

  it('una XRPL marcada NO se confunde con la misma en minúsculas', () => {
    markAddressRemoved(XRPL);
    expect(isAddressRemoved(XRPL.toLowerCase())).toBe(false);
  });

  it('marcar dos veces no duplica', () => {
    markAddressRemoved(XRPL);
    markAddressRemoved(XRPL);
    expect(removedAddresses().size).toBe(1);
  });

  it('quitar una que no estaba no rompe nada', () => {
    expect(() => unmarkAddressRemoved(XRPL)).not.toThrow();
    expect(isAddressRemoved(XRPL)).toBe(false);
  });

  it('varias direcciones conviven', () => {
    markAddressRemoved(XRPL);
    markAddressRemoved(EVM);
    expect(isAddressRemoved(XRPL)).toBe(true);
    expect(isAddressRemoved(EVM)).toBe(true);
    unmarkAddressRemoved(XRPL);
    expect(isAddressRemoved(XRPL)).toBe(false);
    expect(isAddressRemoved(EVM)).toBe(true);
  });

  it('un almacenamiento con basura no tumba la lectura', () => {
    store.set('astryum-removed-wallet-addresses', '{no es json');
    expect(isAddressRemoved(XRPL)).toBe(false);
  });
});
