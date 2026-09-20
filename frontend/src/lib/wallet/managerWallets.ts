/**
 * managerWallets — which of the user's linked wallets ARE manager wallets
 * (the Manager shelf of /app/wallets, founder).
 */

import { useEffect, useMemo, useState } from 'react';

import { addressKey } from '../authority';
import { listCages, listPotes, type CageSummary } from '../institutional/api';
import { isSmartAccountType } from './paFold';
import { holdsGateGroup } from '../managed/managerTitle';
import {
  readCredentialTray,
  readManagerCredentialStatus,
  type CredentialRead,
} from '../xrpl/credentialsApi';

const XRPL_ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,35}$/;
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * PURE: does this account hold EVERY required manager credential type,
 * accepted and alive? Mirrors the backend's evaluateManagerCredential
 * (state 'valid' or 'expiring-soon'), minus the issuer allowlist — see the
 * header for why the shelf deliberately skips it. Each required entry may be
 * an OR-group (`AIFM|CASP`: the licence of either sector) — the gate has
 * spoken that way since the exchange rail, and a literal compare
 * left every credentialed manager off the shelf.
 */
export function holdsManagerCredentials(credentials: CredentialRead[], requiredTypes: string[]): boolean {
  if (requiredTypes.length === 0) return false;
  return requiredTypes.every((group) => holdsGateGroup(credentials, group));
}

/**
 * PURE: fold the three legs into the set of manager wallet keys. A Legacy
 * council never lands on the Manager shelf: governed beats mandate. A null
 * leg means «that read did not answer» and adds nothing.
 *
 * Dos exclusiones más:
 *  - Una SMART ACCOUNT jamás es «la wallet del manager»: no tiene llave
 *    propia (se opera desde su Xaman dueña). Aunque la chain la nombre
 *    directora de una jaula, la wallet de manager es su DUEÑA, no ella.
 *  - Una wallet XRPL cuyo consejo AÚN NO se ha leído (unresolvedXrplKeys)
 *    tampoco: «gobernada gana a mandato» exige SABER que no es gobernada.
 */
export function composeManagerKeys(input: {
  wallets: Array<{ address: string; walletType?: string }>;
  councilKeys: ReadonlySet<string>;
  /** XRPL wallets whose council read has NOT answered `false` yet. */
  unresolvedXrplKeys?: ReadonlySet<string>;
  poteCouncils: ReadonlySet<string> | null;
  directorKeys: ReadonlySet<string> | null;
  credentialedKeys: ReadonlySet<string> | null;
}): Set<string> {
  const out = new Set<string>();
  for (const w of input.wallets) {
    const key = addressKey(w.address);
    if (isSmartAccountType(w.walletType)) continue;
    if (input.councilKeys.has(key)) continue;
    if (input.unresolvedXrplKeys?.has(key)) continue;
    if (
      input.poteCouncils?.has(w.address) ||       // XRPL: exact case
      input.directorKeys?.has(key) ||             // EVM: addressKey lower-cases both sides
      input.credentialedKeys?.has(key)
    ) {
      out.add(key);
    }
  }
  return out;
}

/** Session cache for the credential leg — credentials change rarely (a wizard
 *  ceremony, a renewal), and the wallets screen remounts often. 5 minutes:
 *  each entry costs the backend a ledger read, and with a dozen linked
 *  wallets a 60s TTL re-paid the whole sweep on nearly every visit
 *  («va muy lento»). */
const credentialHoldCache = new Map<string, { at: number; held: boolean }>();
const CREDENTIAL_CACHE_MS = 5 * 60_000;

// El grifo: como mucho TRES lecturas de credenciales en vuelo —
// la ráfaga de una por wallet competía con las lecturas de autoridad y el
// portfolio por el mismo lector XRPL del backend.
const CREDENTIAL_MAX_CONCURRENT = 3;
let credentialSlots = 0;
const credentialWaiters: Array<() => void> = [];
async function withCredentialSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (credentialSlots >= CREDENTIAL_MAX_CONCURRENT) {
    await new Promise<void>((resolve) => credentialWaiters.push(resolve));
  }
  credentialSlots += 1;
  try {
    return await fn();
  } finally {
    credentialSlots -= 1;
    credentialWaiters.shift()?.();
  }
}

async function credentialLegFor(addresses: string[]): Promise<Set<string>> {
  const held = new Set<string>();
  if (addresses.length === 0) return held;
  // One status read tells us the gate mode and the required types; with the
  // gate ON we then ask the backend's own verdict per account (stronger —
  // it also honours the issuer allowlist and the off-ledger partner path).
  const status = await readManagerCredentialStatus(addresses[0]);
  const required = status.credentialTypes ?? [];
  await Promise.all(
    addresses.map(async (address) => {
      const cached = credentialHoldCache.get(address);
      if (cached && Date.now() - cached.at < CREDENTIAL_CACHE_MS) {
        if (cached.held) held.add(addressKey(address));
        return;
      }
      try {
        let ok: boolean;
        if (status.gate === 'enabled') {
          const verdict =
            address === addresses[0] ? status : await withCredentialSlot(() => readManagerCredentialStatus(address));
          ok = verdict.ok === true;
        } else {
          const tray = await withCredentialSlot(() => readCredentialTray(address));
          // EL TÍTULO ES DEL SUJETO: el directorio de un emisor
          // lleva las credenciales que EMITIÓ — sin el filtro, el ancla
          // emisora aterrizaba en el estante Manager.
          ok = holdsManagerCredentials(tray.credentials.filter((c) => c.subject === address), required);
        }
        credentialHoldCache.set(address, { at: Date.now(), held: ok });
        if (ok) held.add(addressKey(address));
      } catch {
        /* fail-quiet: this wallet simply is not moved by this leg */
      }
    }),
  );
  return held;
}

/**
 * The Manager shelf's classifier. Reads the three legs when `enabled` and
 * folds them with composeManagerKeys. Consumers get a Set of addressKeys.
 */
export function useManagerWalletKeys(
  wallets: Array<{ address: string; ecosystem?: string | null; walletType?: string }>,
  councilKeys: ReadonlySet<string>,
  enabled: boolean,
  /** XRPL wallets whose council read has not answered `false` yet — see
   *  composeManagerKeys: unknown governance never sits on the Manager shelf. */
  unresolvedXrplKeys?: ReadonlySet<string>,
): Set<string> {
  const [poteCouncils, setPoteCouncils] = useState<Set<string> | null>(null);
  const [directorKeys, setDirectorKeys] = useState<Set<string> | null>(null);
  const [credentialedKeys, setCredentialedKeys] = useState<Set<string> | null>(null);

  // Stable identity for the wallet list — the linking store rebuilds the
  // array on every refresh, and effects must not re-fire on identity alone.
  const xrplAddresses = useMemo(
    () =>
      wallets
        .map((w) => w.address)
        .filter((a) => XRPL_ADDRESS_RE.test(a))
        .sort(),
    [wallets],
  );
  const xrplListKey = xrplAddresses.join(',');

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    listPotes(false)
      .then((r) => {
        if (!alive) return;
        setPoteCouncils(new Set(r.map((p) => p.councilXrplAddress).filter((a): a is string => !!a)));
      })
      .catch(() => {
        /* fail-quiet */
      });
    listCages()
      .then((r) => {
        if (!alive) return;
        const now = Math.floor(Date.now() / 1000);
        setDirectorKeys(
          new Set(
            r.cages
              .filter((c): c is CageSummary => 'director' in c)
              .filter((c) => EVM_ADDRESS_RE.test(c.director) && !/^0x0{40}$/.test(c.director) && c.directorUntil > now)
              .map((c) => addressKey(c.director)),
          ),
        );
      })
      .catch(() => {
        /* fail-quiet */
      });
    return () => {
      alive = false;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || xrplAddresses.length === 0) return;
    let alive = true;
    // A Legacy council never needs the credential read — it can never land on
    // this shelf anyway (composeManagerKeys drops it).
    const candidates = xrplAddresses.filter((a) => !councilKeys.has(addressKey(a)));
    credentialLegFor(candidates)
      .then((s) => {
        if (alive) setCredentialedKeys(s);
      })
      .catch(() => {
        /* fail-quiet */
      });
    return () => {
      alive = false;
    };
    // councilKeys is derived state that settles after the ledger answers; the
    // list key captures the wallets themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, xrplListKey, councilKeys]);

  return useMemo(
    () => composeManagerKeys({ wallets, councilKeys, unresolvedXrplKeys, poteCouncils, directorKeys, credentialedKeys }),
    [wallets, councilKeys, unresolvedXrplKeys, poteCouncils, directorKeys, credentialedKeys],
  );
}
