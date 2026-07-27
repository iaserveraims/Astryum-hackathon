import {
  TurnkeyEmbeddedService,
  TurnkeyNotConfiguredError,
  type PasskeyAttestation,
  type TurnkeySubOrgClient,
} from '../TurnkeyEmbeddedService';

const ENV_KEYS = ['TURNKEY_ORG_ID', 'TURNKEY_API_PUBLIC_KEY', 'TURNKEY_API_PRIVATE_KEY'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function configure() {
  process.env.TURNKEY_ORG_ID = 'org_1';
  process.env.TURNKEY_API_PUBLIC_KEY = 'pub_1';
  process.env.TURNKEY_API_PRIVATE_KEY = 'priv_1';
}

const PASSKEY: PasskeyAttestation = {
  challenge: 'ch',
  attestation: { credentialId: 'cid', clientDataJson: 'cdj', attestationObject: 'ao' },
};

describe('TurnkeyEmbeddedService', () => {
  test('not configured when env keys are missing', () => {
    for (const k of ENV_KEYS) delete process.env[k];
    const svc = new TurnkeyEmbeddedService();
    expect(svc.isConfigured()).toBe(false);
    expect(svc.unavailableReason()).toMatch(/TURNKEY_/);
  });

  test('configured when all keys present', () => {
    configure();
    const svc = new TurnkeyEmbeddedService();
    expect(svc.isConfigured()).toBe(true);
    expect(svc.unavailableReason()).toBeNull();
  });

  test('createWallet refuses (no fake wallet) when Turnkey is not configured', async () => {
    for (const k of ENV_KEYS) delete process.env[k];
    const svc = new TurnkeyEmbeddedService();
    await expect(svc.createWallet('u1', PASSKEY)).rejects.toBeInstanceOf(TurnkeyNotConfiguredError);
  });

  test('createWallet requires a passkey attestation', async () => {
    configure();
    const svc = new TurnkeyEmbeddedService(async () => ({ createSubOrgWithWallet: jest.fn() }));
    await expect(svc.createWallet('u1', {} as PasskeyAttestation)).rejects.toThrow(/PASSKEY_ATTESTATION_REQUIRED/);
  });

  test('createWallet forwards only the public passkey attestation — never a private key', async () => {
    configure();
    let received: any;
    const fakeClient: TurnkeySubOrgClient = {
      createSubOrgWithWallet: async (input) => {
        received = input;
        return { subOrgId: 'sub_1', address: '0xabc' };
      },
    };
    const svc = new TurnkeyEmbeddedService(async () => fakeClient);

    const out = await svc.createWallet('u1', PASSKEY);

    expect(out).toEqual({ subOrgId: 'sub_1', address: '0xabc' });
    expect(received).toEqual({ userId: 'u1', passkey: PASSKEY });
    // The input that crosses into Turnkey carries ONLY the public attestation —
    // there is no private key field anywhere in what the backend handles.
    expect(JSON.stringify(received)).not.toMatch(/privateKey|secret|mnemonic|seed/i);
  });
});
