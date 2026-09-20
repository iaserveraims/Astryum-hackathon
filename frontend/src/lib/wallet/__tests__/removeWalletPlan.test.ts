/**
 * Quitar una cuenta tiene que quitarla DE VERDAD.
 *
 * El fallo que fija esto: una cuenta gobernada llega a la lista por hasta tres
 * caminos a la vez (fila real, puntero del registro, sesión conectada), y
 * borrar sólo uno la deja volver en la siguiente lectura. El repo ya pagó ese
 * patrón antes — «se re-creaba en cada carga después de borrarla».
 */
import { describe, it, expect } from 'vitest';
import {
  planWalletRemoval,
  touchesServer,
  isSyntheticRow,
  SYNTHETIC_ROW_PREFIX,
} from '../removeWalletPlan';

const XRPL = 'rpM7wQNUZLmPDbLMFmYZFzRGCcQjTFVhVh';
const EVM = '0xC8B2e2F8f0c3B5aA4d1dF8B3E9a0F1c2D3e4A55D';

describe('isSyntheticRow', () => {
  it('reconoce la fila sintetizada del consejo — su id no existe en el servidor', () => {
    expect(isSyntheticRow(`${SYNTHETIC_ROW_PREFIX}${XRPL}`)).toBe(true);
    expect(isSyntheticRow('9f2c1e84-0000-4000-8000-000000000000')).toBe(false);
  });
});

describe('planWalletRemoval', () => {
  it('fila real sin puntero: se borra en el servidor y se olvida en local', () => {
    const plan = planWalletRemoval({ wallet: { id: 'w-1', address: XRPL } });
    expect(plan).toEqual({
      walletId: 'w-1',
      registryId: null,
      address: XRPL,
      disconnectXrplSession: false,
    });
    expect(touchesServer(plan)).toBe(true);
  });

  it('fila SINTETIZADA: no se pide su borrado — sería un 404', () => {
    const plan = planWalletRemoval({ wallet: { id: `${SYNTHETIC_ROW_PREFIX}${XRPL}`, address: XRPL } });
    expect(plan.walletId).toBeNull();
    expect(touchesServer(plan)).toBe(false);
  });

  it('fila real MÁS puntero del registro: se borran LAS DOS cosas', () => {
    // Este es el caso que hacía volver la cuenta: borrabas la fila y el
    // puntero seguía ahí, así que la siguiente lectura la resucitaba.
    const plan = planWalletRemoval({
      wallet: { id: 'w-1', address: XRPL },
      governed: [{ address: XRPL, registryId: 'reg-9' }],
    });
    expect(plan.walletId).toBe('w-1');
    expect(plan.registryId).toBe('reg-9');
  });

  it('el puntero se encuentra aunque la fila sea sintetizada', () => {
    const plan = planWalletRemoval({
      wallet: { id: `${SYNTHETIC_ROW_PREFIX}${XRPL}`, address: XRPL },
      governed: [{ address: XRPL, registryId: 'reg-9' }],
    });
    expect(plan.walletId).toBeNull();
    expect(plan.registryId).toBe('reg-9');
    expect(touchesServer(plan)).toBe(true);
  });

  it('un puntero sin registryId no inventa un borrado', () => {
    const plan = planWalletRemoval({
      wallet: { id: 'w-1', address: XRPL },
      governed: [{ address: XRPL, registryId: null }],
    });
    expect(plan.registryId).toBeNull();
  });

  it('la dirección XRPL es sensible a mayúsculas: no se confunde con otra', () => {
    const plan = planWalletRemoval({
      wallet: { id: 'w-1', address: XRPL },
      governed: [{ address: XRPL.toLowerCase(), registryId: 'reg-otro' }],
    });
    expect(plan.registryId).toBeNull();
  });

  it('la dirección EVM sí se compara ignorando mayúsculas', () => {
    const plan = planWalletRemoval({
      wallet: { id: 'w-1', address: EVM },
      governed: [{ address: EVM.toLowerCase(), registryId: 'reg-evm' }],
    });
    expect(plan.registryId).toBe('reg-evm');
  });

  it('si es la wallet CONECTADA, hay que soltar la sesión o vuelve sola', () => {
    const plan = planWalletRemoval({
      wallet: { id: `${SYNTHETIC_ROW_PREFIX}${XRPL}`, address: XRPL },
      connectedXrplAddress: XRPL,
    });
    expect(plan.disconnectXrplSession).toBe(true);
  });

  it('otra wallet conectada no obliga a desconectar nada', () => {
    const plan = planWalletRemoval({
      wallet: { id: 'w-1', address: XRPL },
      connectedXrplAddress: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
    });
    expect(plan.disconnectXrplSession).toBe(false);
  });

  it('los espacios pegados no rompen ninguna comparación', () => {
    const plan = planWalletRemoval({
      wallet: { id: 'w-1', address: `  ${XRPL}  ` },
      governed: [{ address: ` ${XRPL} `, registryId: 'reg-9' }],
      connectedXrplAddress: ` ${XRPL} `,
    });
    expect(plan.address).toBe(XRPL);
    expect(plan.registryId).toBe('reg-9');
    expect(plan.disconnectXrplSession).toBe(true);
  });
});
