/**
 * Registrar una wallet con el ecosistema equivocado es NO registrarla.
 *
 * El backend valida el ecosistema contra la FORMA de la dirección y devuelve 400
 * ADDRESS_ECOSYSTEM_MISMATCH ante una contradicción. Como derivaba el ecosistema
 * de la etiqueta `network`, y los servicios de wallet reportan un 'mainnet'
 * genérico que cae en el default 'evm', ninguna cuenta de Xaman llegaba a
 * guardarse: la lista de wallets salía vacía y las superficies que leen de ella
 * (el puente de FXRP, entre otras) se quedaban sin dueño con el que trabajar.
 */
import { describe, it, expect } from 'vitest';
import { registrationChain } from '../registrationChain';

describe('registrationChain', () => {
  it('una cuenta de Xaman se registra como XRPL, no como EVM', () => {
    // XamanWalletService reporta 'xrp' y network 'mainnet' — la combinación
    // exacta que el backend leía como EVM.
    expect(registrationChain({ chainType: 'xrp' as never, network: 'mainnet' })).toEqual({
      ecosystem: 'xrpl',
      network: 'xrpl',
      caip2: 'xrpl:mainnet',
    });
  });

  it('acepta también la grafía del tipo declarado ("xrpl")', () => {
    expect(registrationChain({ chainType: 'xrpl', network: 'mainnet' }).ecosystem).toBe('xrpl');
  });

  it('Aptos no se cuela por el default EVM', () => {
    expect(registrationChain({ chainType: 'aptos', network: 'mainnet' })).toEqual({
      ecosystem: 'aptos',
      network: 'aptos',
      caip2: 'aptos:mainnet',
    });
  });

  it('EVM conserva la etiqueta que reportó la wallet — no reescribe filas existentes', () => {
    expect(registrationChain({ chainType: 'ethereum', network: 'mainnet' })).toEqual({
      ecosystem: 'evm',
      network: 'mainnet',
    });
    expect(registrationChain({ chainType: 'flare', network: 'flare' })).toEqual({
      ecosystem: 'evm',
      network: 'flare',
    });
  });

  it('sin etiqueta de red cae al chainType — nunca a un network vacio que el backend rechaza', () => {
    expect(registrationChain({ chainType: 'flare', network: undefined })).toEqual({
      ecosystem: 'evm',
      network: 'flare',
    });
  });

  it('la etiqueta XRPL coincide con la que escribe la via canonica (sin filas gemelas)', () => {
    // useWalletLinking.watchAddress registra network:'xrpl' + caip2:'xrpl:mainnet'.
    // La clave unica del backend es (userId, address, network): dos etiquetas
    // para la misma cadena son dos filas para una sola wallet.
    const { network, caip2 } = registrationChain({ chainType: 'xrp' as never, network: 'mainnet' });
    expect(network).toBe('xrpl');
    expect(caip2).toBe('xrpl:mainnet');
  });
});
