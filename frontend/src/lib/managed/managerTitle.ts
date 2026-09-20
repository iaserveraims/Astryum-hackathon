/**
 * managerTitle — WHICH credentials the manager desk reads, and nothing else
 * (pure; ManagerTitleStation / ManagerTitleLine / the Manager shelf use it).
 *
 * Founder 2026-09-15: «no me reconoce … las credenciales de la cuenta que las
 * tiene, y además está leyendo credenciales que no debería leer en este
 * apartado (solo KYC y AIFM)».
 *
 * The backend gate speaks in OR-groups since the exchange rail (13-sep):
 * `MANAGER_CREDENTIAL_TYPE=AIFM|CASP,KYC|KYB` reads as «(the licence of YOUR
 * sector) AND (your identity)». The desk used to take each group as a literal
 * credential type — it looked for a credential called "AIFM|CASP", found none,
 * told a manager holding AIFM + KYC that they held nothing, and titled the rows
 * with the exchange's types. Here each group is resolved to the MANAGER's leg:
 * AIFM for the licence, KYC for the identity. The exchange desk resolves the
 * same groups to CASP / KYB on its own side.
 *
 * And the ledger's credential directory of an account lists what it HOLDS and
 * what it ISSUED, of every type. The title is the SUBJECT's (13-sep rule), and
 * this desk is about the manager's title only — so the tray it shows keeps
 * exactly the credentials whose subject is the account and whose type is one
 * of the manager's legs.
 */

import type { CredentialRead, CredentialsTray } from '../xrpl/credentialsApi';

/** The manager's legs, identity before licence — the only types this desk reads. */
export const MANAGER_TITLE_TYPES = ['KYC', 'AIFM'] as const;

const ORDER: Record<string, number> = { KYC: 0, AIFM: 1 };

/**
 * The gate's `credentialTypes` (each entry a type or an OR-group `A|B`)
 * resolved to the credential types the MANAGER must hold, one per group:
 * the manager's type inside the group when there is one, else the group's
 * first type (the gate really requires it, and hiding it would lie). No
 * gate read yet → the manager's two legs. Deduped; KYC first, then AIFM.
 */
export function managerTitleLegs(gateTypes: readonly string[] | undefined | null): string[] {
  const groups = (gateTypes ?? []).map((g) => g.trim()).filter((g) => g.length > 0);
  const source = groups.length > 0 ? groups : [...MANAGER_TITLE_TYPES];
  const out: string[] = [];
  for (const group of source) {
    const types = group.split('|').map((s) => s.trim().toUpperCase()).filter((s) => s.length > 0);
    if (types.length === 0) continue;
    const mine = types.find((t) => (MANAGER_TITLE_TYPES as readonly string[]).includes(t));
    const leg = mine ?? types[0];
    if (!out.includes(leg)) out.push(leg);
  }
  return out.sort((a, b) => (ORDER[a] ?? 9) - (ORDER[b] ?? 9));
}

/** Does this credential belong on the manager desk of `account`? Subject AND type. */
export function isManagerTitleCredential(cred: CredentialRead, account: string, legs: readonly string[]): boolean {
  return cred.subject === account && legs.includes(cred.credentialType.toUpperCase());
}

/**
 * The tray narrowed to the manager's own title credentials, with its counts
 * recomputed. Null in, null out — «could not read» stays «could not read».
 */
export function managerTitleTray(tray: CredentialsTray | null, account: string, legs: readonly string[]): CredentialsTray | null {
  if (!tray) return null;
  const credentials = tray.credentials.filter((c) => isManagerTitleCredential(c, account, legs));
  return {
    ...tray,
    credentials,
    pendingAcceptance: credentials.filter((c) => c.state === 'pending-acceptance').length,
    hasAcceptedValidCredential: credentials.some((c) => c.issuerAccepted && (c.state === 'valid' || c.state === 'expiring-soon')),
  };
}

/**
 * PURE: does `credentials` satisfy one gate entry (a type or an OR-group)?
 * Mirrors the backend's evaluateManagerCredential: any type of the group,
 * state valid or expiring-soon. Issuer allowlist deliberately not applied
 * here (see managerWallets' header).
 */
export function holdsGateGroup(credentials: readonly CredentialRead[], group: string): boolean {
  const wants = group.split('|').map((s) => s.trim().toUpperCase()).filter((s) => s.length > 0);
  if (wants.length === 0) return false;
  return credentials.some(
    (c) => wants.includes(c.credentialType.toUpperCase()) && (c.state === 'valid' || c.state === 'expiring-soon'),
  );
}
