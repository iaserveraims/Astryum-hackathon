import {
  detectCustodialKeys,
  assertNoCustodialKeys,
  productionDatabaseMarker,
  assertNotProductionDatabase,
} from '../bootGuards';

describe('bootGuards — invariant #1 (no custodial keys in env)', () => {
  const realKey = '0x' + 'a'.repeat(64);
  const realKeyNoPrefix = 'b'.repeat(64);

  it('passes on a clean env', () => {
    expect(detectCustodialKeys({})).toEqual([]);
    expect(() => assertNoCustodialKeys({})).not.toThrow();
  });

  it('ignores empty / placeholder values', () => {
    const env = {
      WALLET_PRIVATE_KEY_EVM: '',
      EVM_PRIVATE_KEY: '   ',
      PRIVATE_KEY: '<your-key>',
      SIGNER_PRIVATE_KEY: 'changeme',
    } as NodeJS.ProcessEnv;
    expect(detectCustodialKeys(env)).toEqual([]);
    expect(() => assertNoCustodialKeys(env)).not.toThrow();
  });

  it('detects a real 0x-prefixed private key in WALLET_PRIVATE_KEY_EVM', () => {
    const env = { WALLET_PRIVATE_KEY_EVM: realKey } as NodeJS.ProcessEnv;
    expect(detectCustodialKeys(env)).toEqual(['WALLET_PRIVATE_KEY_EVM']);
    expect(() => assertNoCustodialKeys(env)).toThrow(/invariant #1/i);
  });

  it('detects a raw (no-0x) private key and other aliases', () => {
    const env = {
      EVM_PRIVATE_KEY: realKeyNoPrefix,
      DEPLOYER_PRIVATE_KEY: realKey,
    } as NodeJS.ProcessEnv;
    expect(detectCustodialKeys(env).sort()).toEqual(
      ['DEPLOYER_PRIVATE_KEY', 'EVM_PRIVATE_KEY'].sort(),
    );
  });

  it('does NOT flag Turnkey credentials (allowed TEE rail)', () => {
    const env = {
      TURNKEY_API_PRIVATE_KEY: realKey,
      TURNKEY_API_PUBLIC_KEY: realKey,
    } as NodeJS.ProcessEnv;
    expect(detectCustodialKeys(env)).toEqual([]);
  });
});

describe('bootGuards — prod-database guard ("seguridad no ganada")', () => {
  const PROD = 'postgresql://user:pass@aws-0-eu-west-1.pooler.supabase.com:6543/postgres';
  const LOCAL = 'postgresql://postgres:postgres@localhost:5432/defibro';

  it('passes when DATABASE_URL is a local/dev DB', () => {
    expect(productionDatabaseMarker({ DATABASE_URL: LOCAL } as NodeJS.ProcessEnv)).toBeNull();
    expect(() => assertNotProductionDatabase({ DATABASE_URL: LOCAL } as NodeJS.ProcessEnv)).not.toThrow();
  });

  it('passes when there is no DATABASE_URL at all', () => {
    expect(() => assertNotProductionDatabase({} as NodeJS.ProcessEnv)).not.toThrow();
  });

  it('REFUSES a dev/local boot pointed at the prod DB (the incident)', () => {
    // The exact combination found on 2026-07-22: local backend, auth bypassed, prod DB.
    const env = { DATABASE_URL: PROD, ALLOW_NO_AUTH: '1' } as NodeJS.ProcessEnv;
    expect(productionDatabaseMarker(env)).toBe('supabase.com');
    expect(() => assertNotProductionDatabase(env)).toThrow(/PRODUCTION database/i);
  });

  it('REFUSES the prod DB when NODE_ENV is not production and no override', () => {
    const env = { DATABASE_URL: PROD, NODE_ENV: 'development' } as NodeJS.ProcessEnv;
    expect(() => assertNotProductionDatabase(env)).toThrow(/BOOT REFUSED/);
  });

  it('ALLOWS the prod DB for the genuine deploy (NODE_ENV=production, Dockerfile ENV)', () => {
    const env = { DATABASE_URL: PROD, NODE_ENV: 'production' } as NodeJS.ProcessEnv;
    expect(() => assertNotProductionDatabase(env)).not.toThrow();
  });

  it('ALLOWS a deliberate, eyes-open local run via CONFIRM_PROD_DB=1', () => {
    const env = { DATABASE_URL: PROD, ALLOW_NO_AUTH: '1', CONFIRM_PROD_DB: '1' } as NodeJS.ProcessEnv;
    expect(() => assertNotProductionDatabase(env)).not.toThrow();
  });
});
