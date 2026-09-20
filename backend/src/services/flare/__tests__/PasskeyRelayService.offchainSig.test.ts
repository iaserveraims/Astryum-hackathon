/**
 * El relayer ya no paga gas por una firma que el contrato iba
 * a rechazar.
 */

const mockAccountFor = jest.fn();
const mockFactoryCreate = jest.fn();
const mockNonce = jest.fn();
const mockStaticCall = jest.fn();
const mockExecuteBatch = jest.fn();
const mockGetNetwork = jest.fn();

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  class MockProvider {
    getNetwork() {
      return mockGetNetwork();
    }
  }
  class MockWallet {}
  class MockContract {
    [k: string]: unknown;
    constructor(_address: string, abi: string[]) {
      if (abi.some((f) => f.includes('accountFor'))) {
        this.accountFor = (...a: unknown[]) => mockAccountFor(...a);
        this.create = (...a: unknown[]) => mockFactoryCreate(...a);
      } else {
        this.nonce = (...a: unknown[]) => mockNonce(...a);
        const exec = Object.assign((...a: unknown[]) => mockExecuteBatch(...a), {
          staticCall: (...a: unknown[]) => mockStaticCall(...a),
        });
        this.executeBatch = exec;
      }
    }
  }
  return {
    ...actual,
    ethers: { ...actual.ethers, JsonRpcProvider: MockProvider, Wallet: MockWallet, Contract: MockContract },
  };
});

import { createHash, generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'crypto';
import { ethers } from 'ethers';
import {
  __resetPasskeyRelayLimits,
  computeBatchChallenge,
  PasskeyRelayError,
  passkeyRelayErrorStatus,
  relayPasskeyBatch,
  type PasskeyRelayInput,
  type RelayCall,
  type WebAuthnSigInput,
} from '../PasskeyRelayService';

const FACTORY = '0xfac0000000000000000000000000000000000001';
const PREDICTED = '0x1111111111111111111111111111111111111111';
const FXRP = '0xad552a648c74d49e10027ab8a618a3ad4901c5be';
const POTE = '0xb0b0000000000000000000000000000000000001';
const FLARE = 14;
const P256_N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');

const CALLS: RelayCall[] = [
  { target: FXRP, value: '0', data: '0x095ea7b3' + '00'.repeat(64) },
  { target: POTE, value: '0', data: '0x6e553f65' + '11'.repeat(64) },
];

/**
 * The frontend's `computeBatchChallenge` (frontend/src/lib/institutional/
 * passkey.ts), restated here byte for byte — the backend cannot import it, and
 * this is the value the passkey actually signs.
 */
function frontendChallenge(chainId: number, account: string, nonce: bigint, calls: RelayCall[]): string {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const encoded = coder.encode(
    ['uint256', 'address', 'uint256', 'tuple(address target, uint256 value, bytes data)[]'],
    [
      BigInt(chainId),
      ethers.getAddress(account),
      BigInt(nonce),
      calls.map((c) => [ethers.getAddress(c.target), BigInt(c.value), c.data]),
    ]
  );
  return ethers.keccak256(encoded);
}

function newPasskey(): { privateKey: KeyObject; x: string; y: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  return {
    privateKey,
    x: '0x' + Buffer.from(jwk.x, 'base64url').toString('hex'),
    y: '0x' + Buffer.from(jwk.y, 'base64url').toString('hex'),
  };
}

/**
 * What a platform authenticator + the frontend produce: sign
 * authenticatorData ‖ sha256(clientDataJSON) with ES256, split clientDataJSON
 * around the base64url challenge (`splitClientData`), normalise to low-S
 * (`parseDerSignature`).
 */
function webauthnAssert(
  privateKey: KeyObject,
  challengeHex: string,
  opts: { flags?: number; highS?: boolean } = {}
): WebAuthnSigInput {
  const authenticatorData = Buffer.concat([
    createHash('sha256').update('astryum.xyz').digest(),
    Buffer.from([opts.flags ?? 0x05]), // UP | UV
    Buffer.from([0, 0, 0, 7]),
  ]);
  const b64 = Buffer.from(challengeHex.slice(2), 'hex').toString('base64url');
  const clientDataJSON = `{"type":"webauthn.get","challenge":"${b64}","origin":"https://astryum.xyz","crossOrigin":false}`;
  const signed = Buffer.concat([authenticatorData, createHash('sha256').update(clientDataJSON, 'utf8').digest()]);
  const rs = cryptoSign('sha256', signed, { key: privateKey, dsaEncoding: 'ieee-p1363' });
  const r = BigInt('0x' + rs.subarray(0, 32).toString('hex'));
  let s = BigInt('0x' + rs.subarray(32).toString('hex'));
  if (s > P256_N / 2n) s = P256_N - s; // low-S, as the frontend does
  if (opts.highS) s = P256_N - s;
  const idx = clientDataJSON.indexOf(b64);
  return {
    authenticatorData: '0x' + authenticatorData.toString('hex'),
    clientDataPre: clientDataJSON.slice(0, idx),
    clientDataPost: clientDataJSON.slice(idx + b64.length),
    r: '0x' + r.toString(16).padStart(64, '0'),
    s: '0x' + s.toString(16).padStart(64, '0'),
  };
}

function signedInput(
  pk: { privateKey: KeyObject; x: string; y: string },
  over: { nonce?: bigint; chainId?: number; calls?: RelayCall[]; account?: string; flags?: number; highS?: boolean } = {}
): PasskeyRelayInput {
  const calls = over.calls ?? CALLS;
  const challenge = frontendChallenge(over.chainId ?? FLARE, over.account ?? PREDICTED, over.nonce ?? 0n, calls);
  return {
    pubKeyX: pk.x,
    pubKeyY: pk.y,
    calls,
    sig: webauthnAssert(pk.privateKey, challenge, { flags: over.flags, highS: over.highS }),
  };
}

async function refusal(p: Promise<unknown>): Promise<PasskeyRelayError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof PasskeyRelayError) return e;
    throw e;
  }
  throw new Error('expected a PasskeyRelayError, the relay succeeded');
}

const savedEnv = { ...process.env };

beforeEach(() => {
  for (const m of [mockAccountFor, mockFactoryCreate, mockNonce, mockStaticCall, mockExecuteBatch, mockGetNetwork]) {
    m.mockReset();
  }
  process.env.INSTITUTIONAL_POTES_ENABLED = 'true';
  process.env.PASSKEY_RELAYER_PK = '0x' + '42'.repeat(32);
  process.env.ASTRYUM_PASSKEY_FACTORY = FACTORY;
  process.env.RELAY_TARGET_ALLOWLIST = `${FXRP},${POTE}`;
  delete process.env.PASSKEY_RELAY_MAX_DEPLOYS_PER_DAY;
  __resetPasskeyRelayLimits();

  mockGetNetwork.mockResolvedValue({ chainId: 14n });
  mockAccountFor.mockResolvedValue([PREDICTED, false]);
  mockFactoryCreate.mockResolvedValue({ wait: () => Promise.resolve({ hash: '0xdeploy' }) });
  mockStaticCall.mockResolvedValue([]);
  mockExecuteBatch.mockResolvedValue({ hash: '0xexec', wait: () => Promise.resolve({ hash: '0xexec' }) });
});

afterAll(() => {
  process.env = savedEnv;
});

describe('the challenge is the one the passkey signed', () => {
  test('computeBatchChallenge is byte-identical to the frontend (and so to challengeForBatch)', () => {
    for (const nonce of [0n, 1n, 123456789n]) {
      expect(computeBatchChallenge({ chainId: 14n, account: PREDICTED, nonce, calls: CALLS })).toBe(
        frontendChallenge(FLARE, PREDICTED, nonce, CALLS)
      );
    }
  });
});

describe('a real passkey signature — verified BEFORE any gas', () => {
  test('a valid signature over THIS batch passes, and only then the account is deployed', async () => {
    const pk = newPasskey();
    const result = await relayPasskeyBatch(signedInput(pk), 'user-1');

    expect(result).toEqual({ account: PREDICTED, deployedNow: true, deployTxHash: '0xdeploy', execTxHash: '0xexec' });
    expect(mockFactoryCreate).toHaveBeenCalledTimes(1);
    expect(mockFactoryCreate).toHaveBeenCalledWith(BigInt(pk.x), BigInt(pk.y));
    // Counterfactual account: nonce 0, never read from a contract that has no code.
    expect(mockNonce).not.toHaveBeenCalled();
    expect(mockFactoryCreate.mock.invocationCallOrder[0]).toBeLessThan(mockStaticCall.mock.invocationCallOrder[0]);
  });

  test('a deployed account is checked against its CURRENT nonce()', async () => {
    const pk = newPasskey();
    mockAccountFor.mockResolvedValue([PREDICTED, true]);
    mockNonce.mockResolvedValue(5n);

    const result = await relayPasskeyBatch(signedInput(pk, { nonce: 5n }), 'user-1');

    expect(result.deployedNow).toBe(false);
    expect(mockFactoryCreate).not.toHaveBeenCalled();
    expect(mockExecuteBatch).toHaveBeenCalledTimes(1);
  });

  test('a high-S signature is accepted, like the RIP-7212 precompile does', async () => {
    const pk = newPasskey();
    await expect(relayPasskeyBatch(signedInput(pk, { highS: true }), 'user-1')).resolves.toMatchObject({
      deployedNow: true,
    });
  });

  test('TAMPERED CALLS → BAD_SIG_OFFCHAIN (400) and factory.create is never called', async () => {
    const pk = newPasskey();
    const input = signedInput(pk);
    input.calls = [CALLS[0], { ...CALLS[1], data: '0x6e553f65' + '22'.repeat(64) }];

    const e = await refusal(relayPasskeyBatch(input, 'user-1'));

    expect(e.code).toBe('BAD_SIG_OFFCHAIN');
    expect(passkeyRelayErrorStatus(e.code)).toBe(400);
    expect(mockFactoryCreate).not.toHaveBeenCalled();
    expect(mockStaticCall).not.toHaveBeenCalled();
    expect(mockExecuteBatch).not.toHaveBeenCalled();
  });

  test('TAMPERED NONCE on a counterfactual account (signed for nonce 1) → BAD_SIG_OFFCHAIN, no deploy', async () => {
    const pk = newPasskey();
    const e = await refusal(relayPasskeyBatch(signedInput(pk, { nonce: 1n }), 'user-1'));
    expect(e.code).toBe('BAD_SIG_OFFCHAIN');
    expect(mockFactoryCreate).not.toHaveBeenCalled();
  });

  test('a REPLAYED signature (older nonce) on a deployed account → BAD_SIG_OFFCHAIN, no preflight', async () => {
    const pk = newPasskey();
    mockAccountFor.mockResolvedValue([PREDICTED, true]);
    mockNonce.mockResolvedValue(5n);
    const e = await refusal(relayPasskeyBatch(signedInput(pk, { nonce: 4n }), 'user-1'));
    expect(e.code).toBe('BAD_SIG_OFFCHAIN');
    expect(mockStaticCall).not.toHaveBeenCalled();
    expect(mockExecuteBatch).not.toHaveBeenCalled();
  });

  test('a signature for another chain or another account → BAD_SIG_OFFCHAIN', async () => {
    const pk = newPasskey();
    const otherChain = await refusal(relayPasskeyBatch(signedInput(pk, { chainId: 114 }), 'user-1'));
    const otherAccount = await refusal(
      relayPasskeyBatch(signedInput(pk, { account: '0x2222222222222222222222222222222222222222' }), 'user-1')
    );
    expect(otherChain.code).toBe('BAD_SIG_OFFCHAIN');
    expect(otherAccount.code).toBe('BAD_SIG_OFFCHAIN');
    expect(mockFactoryCreate).not.toHaveBeenCalled();
  });

  test('THE DRAIN: a fresh public key with a signature from another key → BAD_SIG_OFFCHAIN, no deploy', async () => {
    const victimKey = newPasskey();
    const attacker = newPasskey();
    const input = signedInput(attacker);
    input.pubKeyX = victimKey.x;
    input.pubKeyY = victimKey.y;

    const e = await refusal(relayPasskeyBatch(input, 'user-1'));

    expect(e.code).toBe('BAD_SIG_OFFCHAIN');
    expect(mockFactoryCreate).not.toHaveBeenCalled();
  });

  test('authenticatorData without the User-Present bit → BAD_SIG_OFFCHAIN (the contract reverts on it too)', async () => {
    const pk = newPasskey();
    const e = await refusal(relayPasskeyBatch(signedInput(pk, { flags: 0x04 }), 'user-1'));
    expect(e.code).toBe('BAD_SIG_OFFCHAIN');
    expect(mockFactoryCreate).not.toHaveBeenCalled();
  });

  test('a point NOT on the curve → BAD_PUBKEY (400) before any RPC', async () => {
    const pk = newPasskey();
    const input = signedInput(pk);
    input.pubKeyX = '1';
    input.pubKeyY = '1';

    const e = await refusal(relayPasskeyBatch(input, 'user-1'));

    expect(e.code).toBe('BAD_PUBKEY');
    expect(passkeyRelayErrorStatus(e.code)).toBe(400);
    expect(mockAccountFor).not.toHaveBeenCalled();
    expect(mockFactoryCreate).not.toHaveBeenCalled();
  });

  test('a coordinate beyond uint256 → BAD_PUBKEY', async () => {
    const pk = newPasskey();
    const input = signedInput(pk);
    input.pubKeyX = '9'.repeat(78);
    const e = await refusal(relayPasskeyBatch(input, 'user-1'));
    expect(e.code).toBe('BAD_PUBKEY');
    expect(mockAccountFor).not.toHaveBeenCalled();
  });

  test('without a session nothing is relayed', async () => {
    const e = await refusal(relayPasskeyBatch(signedInput(newPasskey()), ''));
    expect(e.code).toBe('BAD_SESSION');
    expect(mockAccountFor).not.toHaveBeenCalled();
  });
});

describe('deploys per SIWE user — the residual a self-generated key leaves', () => {
  test('default 3 per rolling 24 h: the 4th deploy is DEPLOY_LIMIT (429) and create is not called', async () => {
    for (let i = 0; i < 3; i++) {
      await relayPasskeyBatch(signedInput(newPasskey()), 'user-1');
    }
    expect(mockFactoryCreate).toHaveBeenCalledTimes(3);

    const e = await refusal(relayPasskeyBatch(signedInput(newPasskey()), 'user-1'));

    expect(e.code).toBe('DEPLOY_LIMIT');
    expect(passkeyRelayErrorStatus(e.code)).toBe(429);
    expect(mockFactoryCreate).toHaveBeenCalledTimes(3);
    expect(mockExecuteBatch).toHaveBeenCalledTimes(3);
  });

  test('the limit is per user, and a batch on an ALREADY-deployed account never counts', async () => {
    process.env.PASSKEY_RELAY_MAX_DEPLOYS_PER_DAY = '1';
    await relayPasskeyBatch(signedInput(newPasskey()), 'user-1');
    expect((await refusal(relayPasskeyBatch(signedInput(newPasskey()), 'user-1'))).code).toBe('DEPLOY_LIMIT');

    // Another session still deploys.
    await expect(relayPasskeyBatch(signedInput(newPasskey()), 'user-2')).resolves.toMatchObject({ deployedNow: true });

    // user-1's existing account keeps working: no deploy, no slot.
    mockAccountFor.mockResolvedValue([PREDICTED, true]);
    mockNonce.mockResolvedValue(1n);
    await expect(relayPasskeyBatch(signedInput(newPasskey(), { nonce: 1n }), 'user-1')).resolves.toMatchObject({
      deployedNow: false,
    });
  });

  test('a rejected signature does not spend a slot', async () => {
    process.env.PASSKEY_RELAY_MAX_DEPLOYS_PER_DAY = '1';
    const bad = signedInput(newPasskey(), { nonce: 9n });
    expect((await refusal(relayPasskeyBatch(bad, 'user-1'))).code).toBe('BAD_SIG_OFFCHAIN');
    await expect(relayPasskeyBatch(signedInput(newPasskey()), 'user-1')).resolves.toMatchObject({ deployedNow: true });
  });

  test('the window is rolling: 24 h later the user can deploy again', async () => {
    process.env.PASSKEY_RELAY_MAX_DEPLOYS_PER_DAY = '1';
    const t0 = Date.now();
    const now = jest.spyOn(Date, 'now').mockReturnValue(t0);
    try {
      await relayPasskeyBatch(signedInput(newPasskey()), 'user-1');
      now.mockReturnValue(t0 + 23 * 60 * 60 * 1000);
      expect((await refusal(relayPasskeyBatch(signedInput(newPasskey()), 'user-1'))).code).toBe('DEPLOY_LIMIT');
      now.mockReturnValue(t0 + 24 * 60 * 60 * 1000 + 1);
      await expect(relayPasskeyBatch(signedInput(newPasskey()), 'user-1')).resolves.toMatchObject({ deployedNow: true });
    } finally {
      now.mockRestore();
    }
  });
});

describe('status table and the empty allowlist', () => {
  test('400/409 still mean "never broadcast"; DEPLOY_LIMIT is 429; config failures 503', () => {
    expect(passkeyRelayErrorStatus('WOULD_REVERT')).toBe(409);
    expect(passkeyRelayErrorStatus('DEPLOY_LIMIT')).toBe(429);
    for (const c of ['BAD_SIG', 'BAD_SIG_OFFCHAIN', 'BAD_PUBKEY', 'BAD_TARGET', 'EMPTY_BATCH', 'BATCH_TOO_LARGE', 'TARGET_NOT_ALLOWED']) {
      expect(passkeyRelayErrorStatus(c)).toBe(400);
    }
    expect(passkeyRelayErrorStatus('RELAYER_UNCONFIGURED')).toBe(503);
  });

  test('an empty allowlist still relays (config decision) but warns ONCE', async () => {
    const keys = ['RELAY_TARGET_ALLOWLIST', 'FXRP_TOKEN', 'KINETIC_KFXRP_ISO', 'FIRELIGHT_STXRP'];
    const saved = keys.map((k) => process.env[k]);
    for (const k of keys) delete process.env[k];
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await relayPasskeyBatch(signedInput(newPasskey()), 'user-1');
      await relayPasskeyBatch(signedInput(newPasskey()), 'user-2');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('VACÍA');
    } finally {
      warn.mockRestore();
      keys.forEach((k, i) => {
        if (saved[i] === undefined) delete process.env[k];
        else process.env[k] = saved[i];
      });
    }
  });
});
