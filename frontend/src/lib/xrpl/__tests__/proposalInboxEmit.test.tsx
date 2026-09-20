/**
 * productizer it. 33 (B1 del cuadro final de la it. 32) — EL COORDINADOR ASÍNCRONO
 * EMITE UN 0xFE Y NO LE DECÍA EL HASH A NADIE.
 *
 * LA PERSONA. El miembro B pulsa «Combine & broadcast» en la bandeja de propuestas.
 * `emit` hacía `await submitAndConfirm(combined)`, que solo vuelve tras la
 * validación (o a los 20 s), y en NINGÚN punto del fichero se llamaba a
 * `notifyHandoffSigned`: el `/submitted` iba solo tras un tesSUCCESS validado. Entre
 * el nodo devolviendo el hash y el ledger validando, el servidor contaba ese 0xFE
 * como un BORRADOR sin firmar. El proponente A, que seguía viendo la fila `ready`,
 * la retiraba para recomponer; con el pin de la ceremonia `holderEndedCeremony`
 * sustituye el reloj, la ventana del memo se leía `absent` (el Payment aún no
 * había validado) y el asiento se soltaba con el Payment en vuelo. El siguiente
 * prepare componía otro 0xFE sobre el mismo nonce. XRP dos veces.
 *
 * LA FASE QUE SE PRUEBA: la bandeja REAL montada con un runtime de hooks que
 * ejecuta efectos (`miniReact`), la red fingida en el borde. Se pulsa el botón real;
 * `broadcast()` devuelve el hash y `awaitValidation` se queda pendiente — y en ESE
 * instante `/handoff/signed` ya recibió `{memoHex, txHash}`. La misma regla que la
 * ceremonia síncrona desde la it. 31: solo un submit que aún puede entrar
 * (`broadcastMayLand`) y solo un 0xFE.
 *
 * Mutación comprobada: quitar la línea `notifyHandoffSigned(...)` de
 * `ProposalInbox.emit` → (a) y (c) en rojo (cero POST a `/handoff/signed`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const HASH = 'CD'.repeat(32);
const API = 'http://localhost:4000';
const COUNCIL = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const MEMBER_A = 'rDarPNJEpCnpBZSfmcquydockkePkjPGA2';
const MEMBER_B = 'rLNaPoKeeBjZe2qs6x52yVPZpZ8td4dc6w';
const MEMO = 'FE000000000000030D40' + 'AB'.repeat(32);
const t = (s: string) => s;

/* ── the boundary: hooks, i18n, the wallets, the settlement machine, the API, the node ── */

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const { miniHooks } = await import('./miniReact');
  const dflt = (actual as unknown as { default?: object }).default ?? {};
  return { ...actual, ...miniHooks, default: { ...dflt, ...miniHooks } };
});
vi.mock('@/i18n/LanguageProvider', () => ({ useT: () => ({ t }) }));
vi.mock('@/hooks/useMyWallets', () => ({
  useMyWallets: () => ({ wallets: [{ id: 'w1', address: MEMBER_B }], loading: false, reload: () => undefined }),
}));
vi.mock('@/lib/wallet/useXrplWalletPartner', () => ({ useXrplWalletPartner: () => ({ address: MEMBER_B }) }));
vi.mock('@/lib/settlement/useSettlement', () => ({
  useSettlement: () => ({ state: null, track: () => undefined, reset: () => undefined }),
}));

const list = vi.fn();
const detail = vi.fn();
const submitted = vi.fn();
vi.mock('@/services/v1Api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/v1Api')>();
  return {
    ...actual,
    councilProposalsApi: {
      ...actual.councilProposalsApi,
      list: (...a: unknown[]) => list(...a),
      detail: (...a: unknown[]) => detail(...a),
      submitted: (...a: unknown[]) => submitted(...a),
    },
  };
});

const broadcast = vi.fn();
const awaitValidation = vi.fn();
vi.mock('@/lib/xrpl/councilSigning', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/xrpl/councilSigning')>();
  return {
    ...actual,
    broadcast: (...a: unknown[]) => broadcast(...a),
    awaitValidation: (...a: unknown[]) => awaitValidation(...a),
  };
});
vi.mock('xrpl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('xrpl')>();
  return { ...actual, multisign: () => 'COMBINED_BLOB' };
});

import ProposalInbox from '@/components/legacy/ProposalInbox';
import type { CouncilProposalRecord } from '@/services/v1Api';
import { findButton, mount, press, settle, type MiniInstance } from './miniReact';

function zeroFePayment(memoHex: string): Record<string, unknown> {
  return {
    TransactionType: 'Payment',
    Account: COUNCIL,
    Destination: 'rCoreVaultXXXXXXXXXXXXXXXXXXXXXXXX',
    Amount: '1000000',
    Sequence: 41,
    Fee: '36',
    SigningPubKey: '',
    Memos: [{ Memo: { MemoData: memoHex } }],
  };
}

/** A proposal that met its quorum: the row the inbox files under «Ready to emit». */
function readyProposal(txjson: Record<string, unknown>): CouncilProposalRecord {
  return {
    id: 'p1',
    account: COUNCIL,
    createdByUserId: 'user-a',
    title: 'Exit',
    txType: String(txjson.TransactionType),
    txjson,
    quorum: 2,
    signerList: [
      { account: MEMBER_A, weight: 1 },
      { account: MEMBER_B, weight: 1 },
    ],
    status: 'ready',
    txHash: null,
    createdAt: new Date(Date.now() - 3_600_000).toISOString(),
    expiresAt: new Date(Date.now() + 6 * 86_400_000).toISOString(),
    signatures: [
      { signerAccount: MEMBER_A, weight: 1, signedAt: new Date().toISOString() },
      { signerAccount: MEMBER_B, weight: 1, signedAt: new Date().toISOString() },
    ],
  };
}

/** Every request that reached the network, in order. */
let calls: Array<{ url: string; body: Record<string, unknown> }> = [];
function stubNetwork(): void {
  calls = [];
  global.fetch = vi.fn(async (url: unknown, init?: { body?: string }) => {
    const u = String(url);
    calls.push({ url: u, body: JSON.parse(String(init?.body ?? '{}')) });
    if (u.endsWith('/flare-demo/handoff/signed')) return { ok: true, status: 202, json: async () => ({ status: 'PENDING_LEDGER' }) };
    return { ok: true, status: 200, json: async () => ({}) };
  }) as unknown as typeof fetch;
}
const signedCalls = () => calls.filter((c) => c.url.endsWith('/flare-demo/handoff/signed'));

let pendingValidation: { resolve: (v: unknown) => void } | null = null;
let mountedRoot: MiniInstance | null = null;

beforeEach(() => {
  stubNetwork();
  vi.stubGlobal('window', {
    localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  });
  process.env.NEXT_PUBLIC_API_URL = API;
  pendingValidation = null;
  list.mockReset();
  detail.mockReset();
  submitted.mockReset().mockResolvedValue({ ok: true, councilOrder: { isOrder: false } });
  broadcast.mockReset().mockResolvedValue({ engine: 'tesSUCCESS', hash: HASH });
  // Validation does not come back on its own: the 4-20 s gap of the incident.
  awaitValidation.mockReset().mockImplementation(
    () =>
      new Promise((resolve) => {
        pendingValidation = { resolve };
      }),
  );
});

afterEach(async () => {
  mountedRoot?.unmount();
  mountedRoot = null;
  await settle();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The inbox over ONE ready proposal, its «Combine & broadcast» on screen. */
async function openInboxOver(txjson: Record<string, unknown>): Promise<MiniInstance> {
  const row = readyProposal(txjson);
  list.mockResolvedValue({ proposals: [row], unreadable: [] });
  detail.mockResolvedValue({
    proposal: { ...row, signatures: row.signatures.map((s) => ({ ...s, blobHex: `BLOB_${s.signerAccount.slice(-4)}` })) },
  });
  const inbox = mount(ProposalInbox, { account: COUNCIL, onSettled: () => undefined });
  mountedRoot = inbox;
  await settle();
  expect(list).toHaveBeenCalledWith([COUNCIL]);
  expect(findButton(inbox.tree, 'Combine & broadcast')).not.toBeNull();
  return inbox;
}

describe('ProposalInbox.emit — el hash llega al registro del asiento EN CUANTO el nodo lo devuelve', () => {
  it('(a) tesSUCCESS con la validación aún pendiente: /handoff/signed ya recibió {memoHex, txHash}; /submitted todavía no', async () => {
    const inbox = await openInboxOver(zeroFePayment(MEMO));

    press(findButton(inbox.tree, 'Combine & broadcast'), 'Combine & broadcast');
    await settle();

    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith('COMBINED_BLOB');
    expect(awaitValidation).toHaveBeenCalledWith(HASH); // …and it has NOT answered
    // THE HALF THAT NEVER EXISTED HERE: the seat's register learns the hash
    // before validation, exactly when the proposer may still withdraw the row.
    expect(signedCalls()).toHaveLength(1);
    expect(signedCalls()[0].body).toEqual({ memoHex: MEMO, txHash: HASH });
    expect(submitted).not.toHaveBeenCalled(); // preliminary is not paid (it. 6)

    // The ledger answers: only now is the proposal reported as submitted.
    pendingValidation!.resolve({ validated: true, finalResult: 'tesSUCCESS' });
    await settle();
    expect(submitted).toHaveBeenCalledWith('p1', HASH);
    expect(signedCalls()).toHaveLength(1); // reported once, when the node answered
  });

  it('(b) tefPAST_SEQ — refused locally, it can never enter a ledger: nothing is reported, and no validation is awaited', async () => {
    broadcast.mockResolvedValue({ engine: 'tefPAST_SEQ', hash: HASH, message: 'This sequence number has already passed.' });
    const inbox = await openInboxOver(zeroFePayment(MEMO));

    press(findButton(inbox.tree, 'Combine & broadcast'), 'Combine & broadcast');
    await settle();

    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(signedCalls()).toHaveLength(0);
    expect(awaitValidation).not.toHaveBeenCalled();
    expect(submitted).not.toHaveBeenCalled();
  });

  it('(c) tec* — applied with the fee claimed, so it may land: the hash is reported like a tes', async () => {
    broadcast.mockResolvedValue({ engine: 'tecINSUFFICIENT_RESERVE', hash: HASH });
    const inbox = await openInboxOver(zeroFePayment(MEMO));

    press(findButton(inbox.tree, 'Combine & broadcast'), 'Combine & broadcast');
    await settle();

    expect(signedCalls()).toHaveLength(1);
    expect(signedCalls()[0].body).toEqual({ memoHex: MEMO, txHash: HASH });
  });

  it('(d) bytes without a 0xFE (a constitution) have no seat row to tell: nothing is sent', async () => {
    const inbox = await openInboxOver({ TransactionType: 'SignerListSet', Account: COUNCIL, Sequence: 41, SignerQuorum: 2 });

    press(findButton(inbox.tree, 'Combine & broadcast'), 'Combine & broadcast');
    await settle();

    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(signedCalls()).toHaveLength(0);
    expect(awaitValidation).toHaveBeenCalledWith(HASH); // the broadcast itself is unchanged
  });
});
