/**
 * Añadir una wallet no puede acabar en silencio.
 *
 * Los tres silencios que se pagaron en vivo (fundador 2026-09-13) y que este
 * módulo convierte en una frase: la dirección ya estaba, la cuenta tiene
 * consejo (y por eso desaparecía de la lista en producción), y la lectura del
 * ledger no llegó. El cuarto caso —alta limpia— es el único que puede entrar
 * sin preguntar.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  inspectAddressForAdd,
  findLinkedWallet,
  needsConfirmation,
  shelfForVerdict,
  type CouncilReader,
} from '../addWalletPreflight';

import type { PreflightWallet } from '../addWalletPreflight';

const XRPL = 'rpM7wQNUZLmPDbLMFmYZFzRGCcQjTFVhVh';
const XRPL_OTHER = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';
const EVM = '0xC8B2e2F8f0c3B5aA4d1dF8B3E9a0F1c2D3e4A55D';

function wallet(address: string, extra: Partial<PreflightWallet> = {}): PreflightWallet {
  return { address, walletType: 'Xaman', ecosystem: 'xrpl', nickname: null, ...extra };
}

/** El ledger dice «sin consejo». */
const noCouncil: CouncilReader = async () => ({ council: null });
/** El ledger dice «3 firmantes, quórum 2». */
const withCouncil: CouncilReader = async () => ({
  council: { signers: [{}, {}, {}], quorum: 2 },
});

describe('findLinkedWallet', () => {
  it('encuentra la fila EVM ignorando mayúsculas', () => {
    const list = [wallet(EVM.toLowerCase(), { ecosystem: 'evm' })];
    expect(findLinkedWallet(EVM, list)?.address).toBe(EVM.toLowerCase());
  });

  it('la dirección XRPL es sensible a mayúsculas y NO se normaliza', () => {
    const list = [wallet(XRPL)];
    expect(findLinkedWallet(XRPL.toLowerCase(), list)).toBeNull();
    expect(findLinkedWallet(XRPL, list)?.address).toBe(XRPL);
  });

  it('ignora espacios pegados al pegar la dirección', () => {
    expect(findLinkedWallet(`  ${XRPL} `, [wallet(XRPL)])?.address).toBe(XRPL);
  });
});

describe('inspectAddressForAdd', () => {
  it('una dirección que ya tienes se dice, y NO se lee el ledger', async () => {
    const read = vi.fn(withCouncil);
    const v = await inspectAddressForAdd(XRPL, [wallet(XRPL)], read);
    expect(v.kind).toBe('already_linked');
    expect(read).not.toHaveBeenCalled();
  });

  it('una XRPL nueva sin consejo entra sola', async () => {
    const v = await inspectAddressForAdd(XRPL, [], noCouncil);
    expect(v).toEqual({ kind: 'new' });
    expect(needsConfirmation(v)).toBe(false);
  });

  it('una XRPL con consejo para y trae el quórum — el caso que desaparecía', async () => {
    const v = await inspectAddressForAdd(XRPL, [wallet(XRPL_OTHER)], withCouncil);
    expect(v).toEqual({ kind: 'governed', memberCount: 3, quorum: 2 });
    expect(needsConfirmation(v)).toBe(true);
    expect(shelfForVerdict(v)).toBe('legacy');
  });

  it('un consejo sin quórum legible sigue siendo un consejo', async () => {
    const v = await inspectAddressForAdd(XRPL, [], async () => ({ council: { signers: [{}, {}] } }));
    expect(v).toEqual({ kind: 'governed', memberCount: 2, quorum: null });
  });

  it('«no pude leer» NO se disfraza de «no tiene consejo»', async () => {
    const v = await inspectAddressForAdd(XRPL, [], async () => {
      throw new Error('xrpl node unreachable');
    });
    expect(v.kind).toBe('unreadable');
    expect(needsConfirmation(v)).toBe(true);
    // Y aun así el estante que se anuncia es el personal: no se finge un
    // Legacy que nadie ha probado.
    expect(shelfForVerdict(v)).toBe('personal');
  });

  it('una EVM nueva no paga lectura de consejo — en EVM no existe SignerList', async () => {
    const read = vi.fn(withCouncil);
    const v = await inspectAddressForAdd(EVM, [], read);
    expect(v).toEqual({ kind: 'new' });
    expect(read).not.toHaveBeenCalled();
  });

  it('una lista con signers vacío es una cuenta de una sola llave', async () => {
    const v = await inspectAddressForAdd(XRPL, [], async () => ({ council: { signers: [] } }));
    expect(v).toEqual({ kind: 'new' });
  });
});
