/**
 * E2 — el tercer estado de autoridad. Un mapping equivocado aquí pinta un
 * quórum como llave única (ceguera) o una wallet personal como Legacy (el
 * producto entero cambia de raíl). Y la regla de clasificación: la marca del
 * dueño manda, salvo puntero deliberado del registry — que es más fuerte.
 */
import { describe, expect, it } from 'vitest';
import { toAuthorityAccount } from '../authority/toAuthorityAccount';
import { staysPersonal } from '../authority/personalQuorum';
import type { Authority } from '../authority';

const WALLET = {
  id: 'w1',
  address: 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh',
  ecosystem: 'xrpl',
  label: 'Mi cuenta',
  isActive: true,
} as never;

function single(hardenedQuorum?: Record<string, unknown>): Authority {
  return {
    id: 'wallet:rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh',
    kind: 'single',
    wallet: WALLET,
    ...(hardenedQuorum ? { hardenedQuorum } : {}),
  } as Authority;
}

describe('toAuthorityAccount — the third state', () => {
  it('a plain wallet maps to simple + single', () => {
    const a = toAuthorityAccount(single())!;
    expect(a.kind).toBe('simple');
    expect(a.authority).toEqual({ type: 'single' });
  });

  it('a CONFIRMED hardened quorum maps to simple + quorum — never governed', () => {
    const a = toAuthorityAccount(
      single({ loading: false, hasCouncil: true, quorum: 2, memberCount: 3, health: { level: 'green' } }),
    )!;
    expect(a.kind).toBe('simple'); // your wallet — NOT a Legacy
    expect(a.authority).toEqual({ type: 'quorum', quorum: 2, total: 3 });
    expect(a.health).toEqual({ level: 'green' });
  });

  it('a stale mark without a ledger-confirmed council paints NOTHING', () => {
    // hasCouncil false/unknown ⇒ single. The ledger is the authority; the
    // owner's mark alone never paints a quorum that does not exist.
    expect(toAuthorityAccount(single({ loading: false, hasCouncil: false }))!.authority).toEqual({
      type: 'single',
    });
    expect(toAuthorityAccount(single({ loading: true }))!.authority).toEqual({ type: 'single' });
  });

  it('a governed authority still maps to governed + quorum', () => {
    const a = toAuthorityAccount({
      id: 'governed:xrpl:rCouncil',
      kind: 'governed',
      ecosystem: 'xrpl',
      address: 'rCouncil',
      source: 'registered',
      loading: false,
      quorum: 3,
      memberCount: 5,
    } as Authority)!;
    expect(a.kind).toBe('governed');
    expect(a.authority).toEqual({ type: 'quorum', quorum: 3, total: 5 });
  });

  it('the overview has no account representation', () => {
    expect(toAuthorityAccount({ id: 'all', kind: 'overview' } as Authority)).toBeNull();
  });
});

describe('staysPersonal — the classification rule', () => {
  it('marked without a registry pointer stays personal', () => {
    expect(staysPersonal({ marked: true })).toBe(true);
    expect(staysPersonal({ marked: true, registryId: undefined })).toBe(true);
  });

  it('a deliberate registry pointer WINS over the mark — filing is stronger', () => {
    expect(staysPersonal({ marked: true, registryId: 'row-1' })).toBe(false);
  });

  it('Unmarked keeps the default: a confirmed council operates as Legacy', () => {
    expect(staysPersonal({ marked: false })).toBe(false);
  });
});
