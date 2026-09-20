'use client';

/**
 * usePasskeyActions — el lado usuario con Face ID, de punta a punta.
 *
 * Una sola firma passkey autoriza cualquier acción del usuario (Z16/Z17):
 * meter FXRP en un vault, redimir, o enviar a una wallet externa. El flujo:
 *   1. leer la cuenta contrafactual del usuario (dirección + nonce)
 *   2. calcular el challenge byte-idéntico al contrato
 *   3. Face ID firma el challenge (la llave la controla SOLO el usuario)
 *   4. el relayer (del operador/Astryum) porta la firma y paga el gas
 *
 * La passkey (credentialId + pubkey) se guarda en localStorage por usuario —
 * es material PÚBLICO (id de credencial + clave pública), jamás la llave
 * privada, que nunca sale del dispositivo.
 */

import { useCallback, useState } from 'react';
import { getPasskeyAccount, relayPasskeyBatch, type RelayResult } from './api';
import { passkeyRelayRefusal } from './passkeyRelayOutcome';
import { describePasskeyError } from './passkeyErrors';
import {
  computeBatchChallenge,
  registerPasskey,
  signWithPasskey,
  passkeySupported,
  type Call,
  type PasskeyHandle,
} from './passkey';

const FLARE_CHAIN_ID = 14;
const STORE_KEY = 'astryum.passkey.v1';

function loadHandle(): PasskeyHandle | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as PasskeyHandle) : null;
  } catch {
    return null;
  }
}

export interface PasskeyActionState {
  supported: boolean;
  handle: PasskeyHandle | null;
  account: string | null;
  busy: boolean;
  error: string | null;
}

export function usePasskeyActions() {
  const [handle, setHandle] = useState<PasskeyHandle | null>(() => loadHandle());
  const [account, setAccount] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Alta de la passkey del cliente (una vez). */
  const register = useCallback(async (label: string) => {
    setError(null);
    setBusy(true);
    try {
      const h = await registerPasskey(label);
      window.localStorage.setItem(STORE_KEY, JSON.stringify(h));
      setHandle(h);
      const acc = await getPasskeyAccount(h.pubKeyX, h.pubKeyY);
      setAccount(acc.account);
      return h;
    } catch (e) {
      setError(describePasskeyError(e));
      throw e;
    } finally {
      setBusy(false);
    }
  }, []);

  /** Resuelve (y cachea) la dirección contrafactual del usuario. */
  const resolveAccount = useCallback(async (): Promise<{ address: string; deployed: boolean }> => {
    const h = handle ?? loadHandle();
    if (!h) throw new Error('No hay passkey dada de alta.');
    setError(null);
    try {
      const acc = await getPasskeyAccount(h.pubKeyX, h.pubKeyY);
      setAccount(acc.account);
      return { address: acc.account, deployed: acc.deployed };
    } catch (e) {
      // Sin fijar el error, el gate se quedaba en «Leyendo tu cuenta…» para siempre.
      setError(describePasskeyError(e));
      throw e;
    }
  }, [handle]);

  /**
   * Firma y ejecuta un lote de calls con Face ID. Devuelve el resultado del
   * relay (tx hashes) — todo comprobable en el explorador.
   */
  const signAndRelay = useCallback(
    async (calls: Call[], hooks?: { onHandOff?: () => void }): Promise<RelayResult> => {
      const h = handle ?? loadHandle();
      if (!h) throw new Error('No hay passkey dada de alta.');
      setError(null);
      setBusy(true);
      try {
        const acc = await getPasskeyAccount(h.pubKeyX, h.pubKeyY);
        setAccount(acc.account);
        // nonce = 0 en la cuenta contrafactual sin desplegar; el relayer la
        // despliega antes del executeBatch, y ese primer batch usa nonce 0.
        const nonce = acc.deployed ? await readNonce(acc.account) : BigInt(0);
        const challenge = computeBatchChallenge({ chainId: FLARE_CHAIN_ID, account: acc.account, nonce, calls });
        const sig = await signWithPasskey(h.credentialId, challenge);
        // El lote FIRMADO sale del navegador aquí. Quien tenga que distinguir
        // «no se firmó» de «firmado, resultado desconocido» marca la entrega
        // en este punto (lib/institutional/passkeyRelayOutcome).
        hooks?.onHandOff?.();
        const res = await relayPasskeyBatch({ pubKeyX: h.pubKeyX, pubKeyY: h.pubKeyY, calls, sig });
        // Mismo mensaje de siempre; el status viaja para saber si el lote llegó a emitirse.
        if (!res.ok) throw passkeyRelayRefusal(res.refusal);
        return res.data;
      } catch (e) {
        setError((e as Error).message);
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [handle]
  );

  /** Olvida la passkey guardada — para grabar otra toma con una cuenta nueva.
   *  Solo borra el material PÚBLICO local; la llave del dispositivo sigue en el
   *  autenticador (una passkey no se borra desde la web). */
  const forget = useCallback(() => {
    try {
      window.localStorage.removeItem(STORE_KEY);
    } catch {
      /* noop */
    }
    setHandle(null);
    setAccount(null);
    setError(null);
  }, []);

  const state: PasskeyActionState = { supported: passkeySupported(), handle, account, busy, error };
  return { state, register, resolveAccount, signAndRelay, forget };
}

/** Lee el nonce actual de la cuenta passkey desplegada (para el challenge).
 *  Dato público de la cadena → RPC público de Flare. */
async function readNonce(account: string): Promise<bigint> {
  const { ethers } = await import('ethers');
  const provider = new ethers.JsonRpcProvider('https://flare-api.flare.network/ext/C/rpc');
  const c = new ethers.Contract(account, ['function nonce() view returns (uint256)'], provider);
  return BigInt((await c.nonce()).toString());
}
