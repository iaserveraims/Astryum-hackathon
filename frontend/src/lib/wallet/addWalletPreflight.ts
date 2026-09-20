'use client';

/**
 * QUÉ ES ESTA DIRECCIÓN, ANTES DE AÑADIRLA.
 *
 * Añadir una wallet podía acabar en tres sitios distintos sin decir en cuál:
 */

import { addressKey } from '../authority';

/**
 * Lo que este módulo necesita de una fila de wallet, declarado aquí a
 * propósito. Importar el tipo del cliente de wallets arrastraba su grafo de
 * módulos —la API entera— a todo el que cargue este fichero, y dejaba el test
 * dependiendo de medio árbol para comprobar cuatro veredictos. La fila real
 * encaja aquí por forma, sin que nadie tenga que declararlo.
 */
export interface PreflightWallet {
  address: string;
  nickname?: string | null;
  label?: string | null;
  walletType?: string;
  ecosystem?: string;
}

/** XRPL classic address. Un clasificador para la UI, no un validador de firma. */
export const PREFLIGHT_XRPL_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
export const PREFLIGHT_EVM_RE = /^0x[a-fA-F0-9]{40}$/;

export type AddWalletVerdict =
  /** Dirección nueva para esta cuenta y sin consejo: alta directa. */
  | { kind: 'new' }
  /** Ya la tienes enlazada. No es un error — es que no hay nada que hacer. */
  | { kind: 'already_linked'; wallet: PreflightWallet }
  /** El ledger dice que la firma de esta cuenta es un quórum, no una llave. */
  | { kind: 'governed'; memberCount: number; quorum: number | null }
  /** La lectura no llegó. Se dice; no se convierte en un «está limpia». */
  | { kind: 'unreadable'; detail: string };

/** La fila de esta dirección en la lista del usuario, si la hay. */
export function findLinkedWallet<W extends PreflightWallet>(
  address: string,
  wallets: readonly W[],
): W | null {
  const key = addressKey(address.trim());
  if (!key) return null;
  return wallets.find((w) => !!w.address && addressKey(w.address) === key) ?? null;
}

/** La lectura del consejo, inyectable para poder probar sin red. */
export type CouncilReader = (account: string) => Promise<{
  council: { signers?: unknown[]; quorum?: number } | null;
}>;

/**
 * La lectura de verdad, cargada PEREZOSAMENTE. El cliente de API arrastra medio
 * árbol de módulos detrás; quien sólo quiera saber si una dirección ya está en
 * la lista no tiene por qué pagarlo — ni al cargar la pantalla, ni en un test.
 */
const readCouncilFromLedger: CouncilReader = async (account) => {
  const { xrplLegacy } = await import('../../services/v1Api');
  return xrplLegacy.council(account);
};

/**
 * Qué es esta dirección para ESTA cuenta, antes de añadirla.
 *
 * El orden importa: primero la lista propia (barata y decisiva), y sólo
 * después el ledger. Una dirección que ya tienes no necesita que nadie lea
 * nada — y era justo el caso que más silencio producía.
 */
export async function inspectAddressForAdd(
  address: string,
  wallets: readonly PreflightWallet[],
  readCouncil: CouncilReader = readCouncilFromLedger,
): Promise<AddWalletVerdict> {
  const addr = address.trim();

  const linked = findLinkedWallet(addr, wallets);
  if (linked) return { kind: 'already_linked', wallet: linked };

  // Los consejos son de XRPL. Una EVM no puede tener SignerList, así que
  // pagar una lectura por ella sería inventarse una espera.
  if (!PREFLIGHT_XRPL_RE.test(addr)) return { kind: 'new' };

  try {
    const res = await readCouncil(addr);
    const signers = res?.council?.signers;
    if (Array.isArray(signers) && signers.length > 0) {
      const quorum = res?.council?.quorum;
      return {
        kind: 'governed',
        memberCount: signers.length,
        quorum: typeof quorum === 'number' ? quorum : null,
      };
    }
    return { kind: 'new' };
  } catch (e) {
    return { kind: 'unreadable', detail: (e as Error).message || 'ledger_read_failed' };
  }
}

/**
 * ¿Este veredicto exige parar y preguntar?
 *
 * `new` entra sola. `already_linked` para (no hay nada que añadir). Los otros
 * dos paran para que el usuario decida con la información delante.
 */
export function needsConfirmation(v: AddWalletVerdict): boolean {
  return v.kind !== 'new';
}

/**
 * En qué estante va a aterrizar la fila, para poder decirlo ANTES y DESPUÉS.
 * Una cuenta con consejo se pinta en el estante Legacy, en solo lectura.
 */
export function shelfForVerdict(v: AddWalletVerdict): 'legacy' | 'personal' {
  return v.kind === 'governed' ? 'legacy' : 'personal';
}
