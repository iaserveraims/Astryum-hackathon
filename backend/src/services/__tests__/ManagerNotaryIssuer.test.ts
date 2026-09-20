/**
 * El robot del notario — las piezas puras, sin red y sin seed.
 *
 * Lo que se fija: el UID se extrae de la URL o del crudo (y de nada más); el
 * reto es determinista y atado a (sujeto, atestación); una atestación solo
 * vale con el attester configurado, schema de la allowlist, sin revocar y sin
 * caducar; y el binding exige que firme EXACTAMENTE la wallet atestada.
 */

import { ethers } from 'ethers';
import {
  bindingMessage,
  discoverCoinbaseAttestation,
  evaluateAttestation,
  NotaryIssuerError,
  parseAttestationRef,
  verifyEvmBinding,
} from '../ManagerNotaryIssuer';

const SUBJECT = 'rNaFfVgbqWYotrR3Jz4RorirDUZgLfxhXt';
const UID = '0xe8d6b58ee9c121e4d01ded4ed8f98c8f263efd0a5dd2c0422413f373f74ca5ee';
const ATTESTER = '0x357458739F90461b99789350868CD7CF330Dd7EE';
const SCHEMA = '0xf8b05c79f090979bf4a80270aba232dff11a10d9ca55c4f88de95317970f0de9';

describe('parseAttestationRef', () => {
  it('extracts the uid from an easscan URL and from a raw uid', () => {
    expect(parseAttestationRef(`https://base.easscan.org/attestation/view/${UID}`)).toEqual({
      uid: UID,
      url: `https://base.easscan.org/attestation/view/${UID}`,
    });
    expect(parseAttestationRef(UID).uid).toBe(UID);
  });

  it('refuses anything without a 64-hex uid', () => {
    expect(() => parseAttestationRef('https://example.com/nada')).toThrow(NotaryIssuerError);
    expect(() => parseAttestationRef('0x1234')).toThrow(/easscan/);
  });
});

describe('bindingMessage — determinista y atado', () => {
  it('is stable and carries subject + attestation', () => {
    const m = bindingMessage(SUBJECT, UID);
    expect(m).toContain(SUBJECT);
    expect(m).toContain(UID);
    expect(bindingMessage(SUBJECT, UID)).toBe(m);
  });
});

describe('evaluateAttestation — hechos, no juicio', () => {
  const cfg = { attester: ATTESTER, kycSchemas: new Set([SCHEMA]) };
  const base = { uid: UID, schema: SCHEMA, attester: ATTESTER, recipient: '0xEAbcd745598916b0131ece397C8D6a332088462c', revocationTime: 0, expirationTime: 0 };

  it('accepts the configured attester + schema, unrevoked, unexpired', () => {
    expect(evaluateAttestation(base, cfg, 1_000)).toEqual({ ok: true });
  });

  it('rejects wrong attester, unknown schema, revoked and expired', () => {
    expect(evaluateAttestation({ ...base, attester: base.recipient }, cfg, 1_000).ok).toBe(false);
    expect(evaluateAttestation({ ...base, schema: UID }, cfg, 1_000).ok).toBe(false);
    expect(evaluateAttestation({ ...base, revocationTime: 5 }, cfg, 1_000).ok).toBe(false);
    expect(evaluateAttestation({ ...base, expirationTime: 999 }, cfg, 1_000).ok).toBe(false);
  });
});

describe('verifyEvmBinding — firma la wallet atestada o nadie', () => {
  it('accepts a real signature from the attested wallet and rejects another wallet', async () => {
    const attested = ethers.Wallet.createRandom();
    const stranger = ethers.Wallet.createRandom();
    const sig = await attested.signMessage(bindingMessage(SUBJECT, UID));
    expect(() => verifyEvmBinding({ subject: SUBJECT, uid: UID, signature: sig, recipient: attested.address })).not.toThrow();
    expect(() => verifyEvmBinding({ subject: SUBJECT, uid: UID, signature: sig, recipient: stranger.address })).toThrow(/misma wallet/);
    expect(() => verifyEvmBinding({ subject: SUBJECT, uid: UID, signature: '0xnope', recipient: attested.address })).toThrow(NotaryIssuerError);
  });
});

describe('discoverCoinbaseAttestation — sin pegar nada, la cadena confirma', () => {
  const cfg = {
    enabled: false,
    seed: '',
    baseRpcUrl: 'http://unused',
    easAddress: '0x4200000000000000000000000000000000000021',
    easGraphqlUrl: 'https://indexer.test/graphql',
    attester: ATTESTER,
    kycSchemas: new Set([SCHEMA]),
  };
  const RECIPIENT = '0x1111111111111111111111111111111111111111';
  const OLD = '0x' + 'a'.repeat(64);
  const NEW = '0x' + 'b'.repeat(64);
  const onChain: Record<string, { schema: string; attester: string; recipient: string; revocationTime: number; expirationTime: number }> = {
    // La más nueva está revocada on-chain aunque el indexador la traiga: se salta.
    [NEW]: { schema: SCHEMA, attester: ATTESTER, recipient: RECIPIENT, revocationTime: 1, expirationTime: 0 },
    [OLD]: { schema: SCHEMA, attester: ATTESTER, recipient: RECIPIENT, revocationTime: 0, expirationTime: 0 },
  };
  const read = async (uid: string) => ({ uid, ...onChain[uid] });
  const fetchWith = (attestations: Array<{ id: string; time: number }>) =>
    (async () => ({ ok: true, status: 200, json: async () => ({ data: { attestations } }) })) as unknown as typeof fetch;

  it('asks the indexer for the connected wallet and returns the newest attestation the chain confirms valid', async () => {
    const found = await discoverCoinbaseAttestation(
      { recipient: RECIPIENT },
      { cfg, fetchFn: fetchWith([{ id: OLD, time: 100 }, { id: NEW, time: 200 }]), read, nowSec: 1000 },
    );
    expect(found.uid).toBe(OLD);
    expect(found.url).toBe(`https://base.easscan.org/attestation/view/${OLD}`);
    expect(found.recipient).toBe(RECIPIENT);
  });

  it('says NOT_FOUND (with the Coinbase how-to) when nothing valid exists for that wallet', async () => {
    await expect(
      discoverCoinbaseAttestation({ recipient: RECIPIENT }, { cfg, fetchFn: fetchWith([]), read, nowSec: 1000 }),
    ).rejects.toMatchObject({ code: 'ATTESTATION_NOT_FOUND' });
  });

  it('reports the indexer being down as READ_FAILED, never as "you are not verified"', async () => {
    const down = (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    await expect(
      discoverCoinbaseAttestation({ recipient: RECIPIENT }, { cfg, fetchFn: down, read, nowSec: 1000 }),
    ).rejects.toMatchObject({ code: 'ATTESTATION_READ_FAILED' });
  });

  it('refuses a non-EVM recipient before touching the network', async () => {
    await expect(discoverCoinbaseAttestation({ recipient: 'rNotAnEvmAddress' }, { cfg, read })).rejects.toMatchObject({ code: 'BINDING_REJECTED' });
  });
});
