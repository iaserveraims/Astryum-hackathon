/**
 * El verificador del bot-notario — puro, sin red, sin ledger.
 *
 * Lo que se fija: el binding solo vale en las DOS direcciones; «no pude leer»
 * jamás se convierte en «no controla la wallet»; el registro es config, y sin
 * config el check no pasa; el Domain que se compone es un dominio, no una URL.
 */

import {
  composeAccountSetDomain,
  decodeDomainHex,
  evaluateNotary,
  NotaryVerifierError,
  parseXrplTomlAccounts,
  registerFirms,
} from '../ManagerNotaryVerifier';

const ACCOUNT = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const OTHER = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe';
const FIRM = { name: 'Gestora Ejemplo SGIIC', domain: 'gestora.example', register: 'CNMV 999' };

describe('parseXrplTomlAccounts', () => {
  it('collects addresses only from [[ACCOUNTS]] blocks', () => {
    const toml = [
      '[[VALIDATORS]]',
      'public_key = "nHDG5CRU"',
      '[[ACCOUNTS]]',
      `address = "${ACCOUNT}"`,
      'desc = "ops"',
      '[[ACCOUNTS]]',
      `address = "${OTHER}"`,
      '[[PRINCIPALS]]',
      'address = "rNOTThisOne111111111111111111"',
    ].join('\n');
    expect(parseXrplTomlAccounts(toml)).toEqual([ACCOUNT, OTHER]);
  });

  it('ignores malformed lines and dedupes', () => {
    const toml = ['[[ACCOUNTS]]', `address = "${ACCOUNT}"`, `address = "${ACCOUNT}"`, 'address = not-quoted'].join('\n');
    expect(parseXrplTomlAccounts(toml)).toEqual([ACCOUNT]);
  });
});

describe('decodeDomainHex', () => {
  it('decodes ledger hex to a lowercase domain', () => {
    const hex = Buffer.from('Gestora.Example', 'utf8').toString('hex').toUpperCase();
    expect(decodeDomainHex(hex)).toBe('gestora.example');
  });

  it('returns null for unset or unprintable values', () => {
    expect(decodeDomainHex(null)).toBeNull();
    expect(decodeDomainHex('00ff00')).toBeNull();
  });
});

describe('evaluateNotary — las dos direcciones o nada', () => {
  it('passes only when domain, toml binding and register all agree', () => {
    const v = evaluateNotary({
      account: ACCOUNT,
      domain: FIRM.domain,
      tomlAccounts: [ACCOUNT],
      firms: [FIRM],
      nowMs: 1_787_300_000_000,
    });
    expect(v.ok).toBe(true);
    expect(v.firm?.name).toBe(FIRM.name);
    expect(v.checks.map((c) => c.ok)).toEqual([true, true, true]);
  });

  it('a toml that does not list the account fails the binding', () => {
    const v = evaluateNotary({ account: ACCOUNT, domain: FIRM.domain, tomlAccounts: [OTHER], firms: [FIRM] });
    expect(v.ok).toBe(false);
    expect(v.checks.find((c) => c.key === 'toml-binding')?.ok).toBe(false);
  });

  it('an UNREADABLE toml is a read failure, never an accusation', () => {
    const v = evaluateNotary({
      account: ACCOUNT,
      domain: FIRM.domain,
      tomlAccounts: null,
      tomlError: 'timeout',
      firms: [FIRM],
    });
    const binding = v.checks.find((c) => c.key === 'toml-binding');
    expect(v.ok).toBe(false);
    expect(binding?.ok).toBe(false);
    expect(binding?.detail).toContain('No se pudo leer');
    expect(binding?.detail).toContain('NO afirma');
  });

  it('without configured firms the register check cannot pass, and says so', () => {
    const v = evaluateNotary({ account: ACCOUNT, domain: FIRM.domain, tomlAccounts: [ACCOUNT], firms: [] });
    const reg = v.checks.find((c) => c.key === 'register-entry');
    expect(reg?.ok).toBe(false);
    expect(reg?.detail).toContain('MANAGER_REGISTER_FIRMS');
  });

  it('no domain set short-circuits binding and register honestly', () => {
    const v = evaluateNotary({ account: ACCOUNT, domain: null, tomlAccounts: null, firms: [FIRM] });
    expect(v.ok).toBe(false);
    expect(v.checks.every((c) => c.ok === false)).toBe(true);
  });
});

describe('registerFirms — config, jamás código', () => {
  const OLD = process.env.MANAGER_REGISTER_FIRMS;
  afterEach(() => {
    if (OLD === undefined) delete process.env.MANAGER_REGISTER_FIRMS;
    else process.env.MANAGER_REGISTER_FIRMS = OLD;
  });

  it('parses the JSON list and lowercases domains', () => {
    process.env.MANAGER_REGISTER_FIRMS = JSON.stringify([{ ...FIRM, domain: 'Gestora.EXAMPLE' }]);
    expect(registerFirms()).toEqual([{ ...FIRM, domain: 'gestora.example' }]);
  });

  it('bad JSON or missing fields yield an empty list, never a throw', () => {
    process.env.MANAGER_REGISTER_FIRMS = 'not-json';
    expect(registerFirms()).toEqual([]);
    process.env.MANAGER_REGISTER_FIRMS = JSON.stringify([{ name: 'x' }]);
    expect(registerFirms()).toEqual([]);
  });
});

describe('composeAccountSetDomain — un dominio, no una URL', () => {
  it('composes the subject-signed AccountSet with the domain in hex', () => {
    const tx = composeAccountSetDomain(ACCOUNT, 'Gestora.Example');
    expect(tx).toEqual({
      TransactionType: 'AccountSet',
      Account: ACCOUNT,
      Domain: Buffer.from('gestora.example', 'utf8').toString('hex').toUpperCase(),
    });
  });

  it('refuses URLs, schemes and oversized domains', () => {
    expect(() => composeAccountSetDomain(ACCOUNT, 'https://gestora.example')).toThrow(NotaryVerifierError);
    expect(() => composeAccountSetDomain(ACCOUNT, 'gestora.example/path')).toThrow(/dominio/);
    expect(() => composeAccountSetDomain(ACCOUNT, `${'a'.repeat(260)}.com`)).toThrow(NotaryVerifierError);
    expect(() => composeAccountSetDomain('nope', 'gestora.example')).toThrow(/r-address/);
  });
});
