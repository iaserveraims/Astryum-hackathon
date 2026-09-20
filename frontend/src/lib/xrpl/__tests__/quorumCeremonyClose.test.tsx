/**
 * productizer it. 29 (§1) → it. 31 (§1, §2, §3) — CERRAR UNA CEREMONIA, POR FASE.
 *
 * LO QUE it. 29 ARREGLÓ, Y LA PUERTA QUE ABRIÓ. it. 29 hizo que cerrar el diálogo
 * (Escape, el fondo, la X, desmontar el anfitrión) devolviera el asiento de nonce
 * del 0xFE — sin mirar en qué FASE estaba la ceremonia. El botón «Cancel» se
 * esconde en `submitting`/`done`; el bus no. Tras `broadcast()` con hash y una
 * validación que no llega en 20 s, la pantalla se queda en «Broadcast accepted —
 * still waiting for ledger validation» SIN botón: cerrar era la única salida, y
 * cerrar soltaba el asiento de un Payment YA EMITIDO. Y nadie reportaba el hash a
 * `/handoff/signed`. Consecuencia: el XRP se paga dos veces.
 *
 * Y EL TEST DE it. 29 NO LO CAZÓ porque fingía `useEffect` como un no-op: el código
 * bajo prueba —lo que pasa al DESMONTAR— no podía ejecutarse. Probaba la pieza,
 * no la fase. Aquí los hooks son un runtime mínimo que SÍ ejecuta efectos y
 * limpiezas (`miniReact`), y lo que se recorre es la cadena real: el manejador
 * del modal → el bus → el rechazo/resolución de la promesa → el modal deja de
 * pintar la ceremonia → `CouncilMultisigFlow` se desmonta → su limpieza decide
 * sobre el asiento. La red se finge en el borde (`fetch`).
 *
 * Las fases que se prueban son las que fallaron:
 *   (a) cerrar en `signing` libera; cerrar en `submitting` NO libera y el hash ya
 *       viajó a `/handoff/signed` en cuanto el nodo lo devolvió;
 *   (b) un anfitrión INLINE (las puertas que monta la salida del creador en
 *       `OperatorConsole`, sin bus) libera al desmontar — «Back»;
 *   (c) cerrar en `idle` pregunta por el asiento y, si sigue ocupado, la persona
 *       lo ve con la cuenta atrás del servidor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const HASH = 'AB'.repeat(32);
const API = 'http://localhost:4000';
const COUNCIL = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const MEMBER = 'rP49LEKattxJ9ppioRZVVRoZ7QeWvzYyuG';
const MEMO = 'FE000000000000030D40' + 'AB'.repeat(32);
const t = (s: string) => s;

/* ── the boundary: hooks, i18n, the coordinator, Xaman, the node ─────────── */

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const { miniHooks } = await import('./miniReact');
  const dflt = (actual as unknown as { default?: object }).default ?? {};
  return { ...actual, ...miniHooks, default: { ...dflt, ...miniHooks } };
});
vi.mock('@/i18n/LanguageProvider', () => ({ useT: () => ({ t }) }));

const multisignPrepare = vi.fn();
vi.mock('@/services/v1Api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/v1Api')>();
  return {
    ...actual,
    xrplLegacy: { ...actual.xrplLegacy, multisignPrepare: (...a: unknown[]) => multisignPrepare(...a) },
  };
});

const createMemberPayload = vi.fn();
const pollStatus = vi.fn();
const broadcast = vi.fn();
const awaitValidation = vi.fn();
vi.mock('@/lib/xrpl/councilSigning', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/xrpl/councilSigning')>();
  return {
    ...actual,
    createMemberPayload: (...a: unknown[]) => createMemberPayload(...a),
    pollStatus: (...a: unknown[]) => pollStatus(...a),
    broadcast: (...a: unknown[]) => broadcast(...a),
    awaitValidation: (...a: unknown[]) => awaitValidation(...a),
  };
});

vi.mock('@/lib/xrpl/verifySignerBlob', () => ({
  verifySignerBlob: () => undefined,
  BlobVerificationError: class BlobVerificationError extends Error {},
}));
// it. 33 (B3): combining is LOCAL arithmetic and can throw (a blob that does not
// parse). Controllable so a test can make it fail before anything leaves.
const multisignImpl = vi.fn((_blobs: string[]) => 'COMBINED_BLOB');
vi.mock('xrpl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('xrpl')>();
  return { ...actual, multisign: (blobs: string[]) => multisignImpl(blobs) };
});

const cancelPayloadAndDecide = vi.fn(async (_uuid: string, _onScreen: () => string | null | undefined) => ({
  action: 'none',
  cancelUi: 'idle' as const,
  result: { ok: true },
}));
vi.mock('@/lib/xaman/payloadBus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/xaman/payloadBus')>();
  return {
    ...actual,
    cancelPayloadAndDecide: (uuid: string, onScreen: () => string | null | undefined) => cancelPayloadAndDecide(uuid, onScreen),
  };
});

import {
  CEREMONY_ABANDONED,
  CEREMONY_CLOSED_IN_FLIGHT,
  abandonQuorumCeremony,
  onQuorumCeremony,
  requestQuorumCeremony,
} from '@/lib/xrpl/quorumCeremonyBus';
import { BroadcastUnconfirmedError, XRPSCAN_ACCOUNT, paymentMemoHex } from '@/lib/xrpl/councilSigning';
import { QuorumCeremonyModal } from '@/components/wallet/QuorumCeremonyModal';
import CouncilMultisigFlow, {
  CEREMONY_UNCONFIRMED_BROADCAST_SENTENCE,
  CouncilSigningDoors,
} from '@/components/legacy/CouncilMultisigFlow';
import { dismissLiveNotice, listLiveNotices, liveNoticeCountdown } from '@/lib/xaman/liveRequests';
import { findButton, findElement, mount, press, settle, textOf, type MiniInstance } from './miniReact';

function zeroFePayment(memoHex: string): Record<string, unknown> {
  return {
    TransactionType: 'Payment',
    Account: COUNCIL,
    Destination: 'rCoreVaultXXXXXXXXXXXXXXXXXXXXXXXX',
    Amount: '1000000',
    Memos: [{ Memo: { MemoData: memoHex } }],
  };
}

/** Every request that reached the network, in order. */
let calls: Array<{ url: string; body: Record<string, unknown>; keepalive?: boolean }> = [];
let releaseAnswer: () => unknown = () => ({ released: true, seat: { released: true, reason: 'ceremony-ended' } });
function stubNetwork(): void {
  calls = [];
  global.fetch = vi.fn(async (url: unknown, init?: { body?: string; keepalive?: boolean }) => {
    const u = String(url);
    calls.push({ url: u, body: JSON.parse(String(init?.body ?? '{}')), keepalive: init?.keepalive });
    if (u.endsWith('/xrpl-defi/multisign/release')) return { ok: true, json: async () => releaseAnswer() };
    if (u.endsWith('/flare-demo/handoff/signed')) return { ok: true, status: 202, json: async () => ({ status: 'PENDING_LEDGER' }) };
    return { ok: true, status: 200, json: async () => ({}) };
  }) as unknown as typeof fetch;
}
const releaseCalls = () => calls.filter((c) => c.url.endsWith('/xrpl-defi/multisign/release'));
const signedCalls = () => calls.filter((c) => c.url.endsWith('/flare-demo/handoff/signed'));

/** A rejection is an expected outcome here; the test reads it instead of letting it escape. */
function outcomeOf(p: Promise<string>): { value: () => string | null; error: () => Error | null; settled: () => boolean } {
  let value: string | null = null;
  let error: Error | null = null;
  let settled = false;
  p.then(
    (v) => {
      value = v;
      settled = true;
    },
    (e: Error) => {
      error = e;
      settled = true;
    },
  );
  return { value: () => value, error: () => error, settled: () => settled };
}

/* ── driving a sitting through its phases ────────────────────────────────── */

const PREPARE = {
  council: { quorum: 1, masterKeyDisabled: true, signers: [{ account: MEMBER, weight: 1 }] },
  multisigTx: { ...zeroFePayment(MEMO), Sequence: 41, Fee: '24', SigningPubKey: '' },
  fee: { drops: '24', baseFeeDrops: 12, signerCount: 1 },
  preflight: { available: true, willSucceed: true, engineResult: 'tesSUCCESS', balanceChanges: [] },
};

let pendingValidation: { resolve: (v: unknown) => void } | null = null;

function xamanAndNodeBehave(): void {
  multisignPrepare.mockReset().mockResolvedValue(PREPARE);
  createMemberPayload.mockReset().mockResolvedValue({ uuid: 'payload-1', qrPng: 'data:', pushed: false });
  pollStatus.mockReset().mockResolvedValue({ signed: true, hex: 'SIGNED_HEX' });
  broadcast.mockReset().mockResolvedValue({ engine: 'tesSUCCESS', hash: HASH });
  // Validation does not come back during the test: the exact «still waiting for
  // ledger validation» screen of the incident.
  awaitValidation.mockReset().mockImplementation(
    () =>
      new Promise((resolve) => {
        pendingValidation = { resolve };
      }),
  );
  cancelPayloadAndDecide.mockClear();
  multisignImpl.mockReset().mockImplementation(() => 'COMBINED_BLOB');
}

/**
 * «Sign now, all together» → the coordinator pins → one QR on the member's phone.
 * With `signed`, the member's signature arrives on the first poll tick and the
 * quorum is met (the QR is then ANSWERED — nothing left to kill); without it the
 * request stays live on the phone, which is what a close must kill.
 */
async function driveToSigning(flow: MiniInstance, opts: { signed: boolean } = { signed: true }): Promise<void> {
  if (!opts.signed) pollStatus.mockReset().mockResolvedValue({});
  press(findButton(flow.tree, 'Sign now, all together'), 'Sign now');
  await settle();
  expect(multisignPrepare).toHaveBeenCalledTimes(1);
  expect(multisignPrepare.mock.calls[0][0]).toBe(COUNCIL);
  expect(createMemberPayload).toHaveBeenCalledTimes(1);
  // The poll runs every 3 s.
  await vi.advanceTimersByTimeAsync(3000);
  await settle();
  const combine = findButton(flow.tree, opts.signed ? 'Combine & broadcast' : 'Waiting for the quorum…');
  expect(combine).not.toBeNull();
  expect(findButton(flow.tree, 'Cancel this ceremony')).not.toBeNull();
}

/** «Combine & broadcast» → the node hands the hash back → validation still pending. */
async function driveToSubmitting(flow: MiniInstance): Promise<void> {
  press(findButton(flow.tree, 'Combine & broadcast'), 'Combine & broadcast');
  await settle();
  expect(broadcast).toHaveBeenCalledTimes(1);
  expect(findButton(flow.tree, 'Cancel this ceremony')).toBeNull(); // the button hides here — the bus must too
}

let mountedRoot: MiniInstance | null = null;
let hostOff: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  stubNetwork();
  releaseAnswer = () => ({ released: true, seat: { released: true, reason: 'ceremony-ended' } });
  xamanAndNodeBehave();
  pendingValidation = null;
  vi.stubGlobal('window', {
    localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  });
  process.env.NEXT_PUBLIC_API_URL = API;
  for (const n of listLiveNotices()) dismissLiveNotice(n.id); // the banner is module state
});

afterEach(async () => {
  // Never leave a ceremony live — nor a host mounted — on the module bus between
  // tests: a leaked listener keeps the bus from ever seeing «the last host left».
  mountedRoot?.unmount();
  mountedRoot = null;
  abandonQuorumCeremony();
  hostOff?.();
  hostOff = null;
  await settle();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * The bus-hosted modal, mounted the way `WalletProvider` mounts it, with the
 * real flow expanded inside it. Returns the modal root and the caller's promise.
 */
async function openBusCeremony(tx: Record<string, unknown>) {
  const modal = mount(QuorumCeremonyModal, {}, [CouncilMultisigFlow]);
  mountedRoot = modal;
  const promise = requestQuorumCeremony(tx, COUNCIL);
  const outcome = outcomeOf(promise);
  await settle();
  const flow = modal.child(CouncilMultisigFlow);
  if (!flow) throw new Error('the modal did not mount the ceremony over a live request');
  const overlay = modal.tree!;
  return { modal, flow, overlay, outcome };
}

describe('(a) el cierre del modal, POR FASE', () => {
  it('en `signing` — Escape libera el asiento con la cuenta y el memo, mata los QR y el que llamó recibe ABANDONED', async () => {
    const { modal, flow, overlay, outcome } = await openBusCeremony(zeroFePayment(MEMO));
    await driveToSigning(flow, { signed: false }); // the member has not signed yet: a live QR on the phone
    expect(releaseCalls()).toHaveLength(0); // nothing is handed back while the sitting is live

    (overlay.props as { onEscape: () => void }).onEscape();
    await settle();

    expect(outcome.error()?.message).toBe(CEREMONY_ABANDONED);
    // The chain: the modal dropped the request, the flow unmounted, its cleanup released.
    expect(modal.child(CouncilMultisigFlow)).toBeNull();
    expect(releaseCalls()).toHaveLength(1);
    expect(releaseCalls()[0].body).toEqual({ account: COUNCIL, memoHex: MEMO, sittingId: null }); // it. 34: a sitting the server did not name
    expect(releaseCalls()[0].keepalive).toBe(true);
    // …and the member's request on the phone was killed on the way out.
    expect(cancelPayloadAndDecide).toHaveBeenCalledWith('payload-1', expect.any(Function));
    expect(signedCalls()).toHaveLength(0);
  });

  it('en `submitting` — el hash ya viajó a /handoff/signed cuando el nodo lo devolvió, y cerrar NO libera: el que llamó recibe el hash', async () => {
    const { modal, flow, overlay, outcome } = await openBusCeremony(zeroFePayment(MEMO));
    await driveToSigning(flow);
    await driveToSubmitting(flow);

    // THE HALF THAT NEVER EXISTED: the seat's register learns the hash the moment
    // the node hands it back — before validation, as XamanSingleSign does.
    expect(signedCalls()).toHaveLength(1);
    expect(signedCalls()[0].body).toEqual({ memoHex: MEMO, txHash: HASH });
    expect(outcome.settled()).toBe(false); // validation has not come back

    (overlay.props as { onEscape: () => void }).onEscape();
    await settle();

    // The bytes may be on the ledger: the seat is NOT touched from any close path.
    expect(modal.child(CouncilMultisigFlow)).toBeNull();
    expect(releaseCalls()).toHaveLength(0);
    // The caller gets what a single Xaman signature returns after submit — the
    // hash — so its settlement watcher takes over instead of a «nothing left».
    expect(outcome.value()).toBe(HASH);
    expect(outcome.error()).toBeNull();
  });

  it('en `submitting` ANTES de que el nodo conteste — cerrar no libera y el que llamó recibe «en vuelo», jamás ABANDONED', async () => {
    let answerNode: ((v: unknown) => void) | null = null;
    broadcast.mockReset().mockImplementation(() => new Promise((resolve) => (answerNode = resolve)));
    const { modal, flow, overlay, outcome } = await openBusCeremony(zeroFePayment(MEMO));
    await driveToSigning(flow);
    press(findButton(flow.tree, 'Combine & broadcast'), 'Combine & broadcast');
    await settle();
    expect(broadcast).toHaveBeenCalledTimes(1);

    (overlay.props as { onEscape: () => void }).onEscape();
    await settle();

    expect(modal.child(CouncilMultisigFlow)).toBeNull();
    expect(releaseCalls()).toHaveLength(0);
    const err = outcome.error() as (Error & { code?: string }) | null;
    expect(err?.message).toContain(CEREMONY_CLOSED_IN_FLIGHT);
    expect(err?.code).toBe('RECEIPT_UNREAD');

    // …and when the node finally answers, the hash STILL reaches the register:
    // the report does not depend on a screen that no longer exists.
    answerNode!({ engine: 'tesSUCCESS', hash: HASH });
    await settle();
    expect(signedCalls()).toHaveLength(1);
    expect(signedCalls()[0].body).toEqual({ memoHex: MEMO, txHash: HASH });
    expect(releaseCalls()).toHaveLength(0);
  });

  it('el fondo y la X son el mismo cierre: en `signing` liberan, en `submitting` no', async () => {
    {
      const { flow, overlay } = await openBusCeremony(zeroFePayment(MEMO));
      await driveToSigning(flow);
      const onMouseDown = (overlay.props as { onMouseDown: (e: unknown) => void }).onMouseDown;
      const card = {};
      onMouseDown({ target: card, currentTarget: {} }); // started inside the card: not a close
      await settle();
      expect(releaseCalls()).toHaveLength(0);
      const backdrop = {};
      onMouseDown({ target: backdrop, currentTarget: backdrop });
      await settle();
      expect(releaseCalls()).toHaveLength(1);
      mountedRoot?.unmount();
      mountedRoot = null;
      await settle();
    }
    stubNetwork();
    xamanAndNodeBehave();
    {
      const { flow, overlay, outcome } = await openBusCeremony(zeroFePayment(MEMO));
      await driveToSigning(flow);
      await driveToSubmitting(flow);
      const closeButton = findElement(
        overlay,
        (el) => el.type === 'button' && (el.props as Record<string, unknown>)['aria-label'] === 'Close',
      );
      press(closeButton, 'the X');
      await settle();
      expect(releaseCalls()).toHaveLength(0);
      expect(outcome.value()).toBe(HASH);
    }
  });

  it('desmontar el anfitrión en `submitting` tampoco libera', async () => {
    const { modal, flow, outcome } = await openBusCeremony(zeroFePayment(MEMO));
    await driveToSigning(flow);
    await driveToSubmitting(flow);

    modal.unmount(); // WalletProvider goes away: the last listener leaving the bus is the close
    mountedRoot = null;
    await settle();

    expect(releaseCalls()).toHaveLength(0);
    expect(outcome.value()).toBe(HASH);
  });

  it('una ceremonia que TERMINA validada no suelta nada, y el cierre posterior no manda nada', async () => {
    awaitValidation.mockReset().mockResolvedValue({ validated: true, finalResult: 'tesSUCCESS' });
    const { modal, flow, outcome } = await openBusCeremony(zeroFePayment(MEMO));
    await driveToSigning(flow);
    press(findButton(flow.tree, 'Combine & broadcast'), 'Combine & broadcast');
    await settle();

    expect(outcome.value()).toBe(HASH); // onSettled → resolve
    expect(modal.child(CouncilMultisigFlow)).toBeNull(); // the request cleared, the modal closed itself
    abandonQuorumCeremony();
    await settle();
    expect(releaseCalls()).toHaveLength(0);
    expect(signedCalls()).toHaveLength(1);
  });
});

/**
 * productizer it. 33 (B2 + B3 del cuadro final de la it. 32) — EL `error` DESPUÉS DE
 * COMPROMETER LOS BYTES.
 *
 * LA PERSONA. Caída de red móvil a mitad del submit: el primer nodo aplicó la tx
 * y la respuesta se perdió; los otros dos fallaron; `broadcast()` lanza (solo lanza
 * si fallan los TRES) y la ceremonia cae en `error` — la misma fase que un QR que
 * Xaman rechazó antes de mandar nada. Allí se ofrecía «Cancel this ceremony», el
 * texto invitaba a pulsarlo, y `abandon()` liberaba el asiento SIN consultar
 * `committedRef`. Y al acabar emitía `abandoned`, que el bus reducía a «nunca
 * empezó»: el Escape siguiente liberaba OTRA vez y decía «nothing left» sobre un
 * Payment que puede estar en el ledger. El gemelo, construido por nuestro botón.
 *
 * Lo que se recorre es la cadena real: el flujo → `broadcast()` que revienta →
 * fase `error` → lo que la pantalla ofrece → un clic rezagado en el Cancel que ya
 * no está → Escape por el bus → la limpieza de desmontaje.
 */
describe('(d) it. 33 — un broadcast que NINGÚN nodo confirmó: `error` comprometido', () => {
  const unconfirmed = () =>
    new BroadcastUnconfirmedError([
      { node: 'https://xrplcluster.com', reason: 'Failed to fetch', kind: 'unanswered' },
      { node: 'https://xrpl.link', reason: 'HTTP 502', kind: 'unanswered' },
      { node: 'https://s1.ripple.com:51234', reason: 'Failed to fetch', kind: 'unanswered' },
    ]);

  it('no ofrece «Cancel» sino el explorador; un clic rezagado en Cancel NO libera; Escape NO libera y el que llamó recibe «en vuelo», jamás ABANDONED', async () => {
    broadcast.mockReset().mockRejectedValue(unconfirmed());
    const { modal, flow, overlay, outcome } = await openBusCeremony(zeroFePayment(MEMO));
    await driveToSigning(flow);
    // The Cancel that IS on screen in `signing`, captured as a browser would hold
    // a click already dispatched: a press delivered a frame after the button is
    // withdrawn still calls this very handler.
    const staleCancel = findButton(flow.tree, 'Cancel this ceremony');
    expect(staleCancel).not.toBeNull();

    press(findButton(flow.tree, 'Combine & broadcast'), 'Combine & broadcast');
    await settle();
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(signedCalls()).toHaveLength(0); // no hash: no node answered

    // THE SCREEN: no Cancel, the ledger instead — named, with the account's explorer page.
    expect(findButton(flow.tree, 'Cancel this ceremony')).toBeNull();
    const check = findElement(flow.tree, (el) => el.type === 'a' && textOf(el).includes('Check the ledger'));
    expect(check).not.toBeNull();
    expect((check!.props as { href: string }).href).toBe(`${XRPSCAN_ACCOUNT}${COUNCIL}`);
    expect(textOf(flow.tree)).toContain(CEREMONY_UNCONFIRMED_BROADCAST_SENTENCE);
    // …and the failure names EVERY node, not only the last one (which always fails on CORS).
    expect(textOf(flow.tree)).toMatch(/xrplcluster\.com: Failed to fetch; xrpl\.link: HTTP 502; s1\.ripple\.com:51234: Failed to fetch/);
    expect(textOf(flow.tree)).toMatch(/may still have entered/);

    // THE STALE CLICK: `abandon()` reads the commitment and does nothing.
    press(staleCancel, 'a Cancel delivered after the button was withdrawn');
    await settle();
    expect(releaseCalls()).toHaveLength(0);
    expect(findButton(flow.tree, 'Sign now, all together')).toBeNull(); // not reset to idle either
    expect(outcome.settled()).toBe(false);

    // THE CLOSE: the bus knows the sitting committed and that no node confirmed.
    (overlay.props as { onEscape: () => void }).onEscape();
    await settle();
    expect(modal.child(CouncilMultisigFlow)).toBeNull(); // the flow unmounted — its cleanup did not release either
    expect(releaseCalls()).toHaveLength(0);
    const err = outcome.error() as (Error & { code?: string; txHash?: string }) | null;
    expect(err).not.toBeNull();
    expect(err!.message).not.toBe(CEREMONY_ABANDONED);
    expect(err!.message).toContain(CEREMONY_CLOSED_IN_FLIGHT);
    expect(err!.message).toMatch(/No XRPL node confirmed taking the submission/);
    expect(err!.message).toMatch(/may still have entered/);
    expect(err!.code).toBe('RECEIPT_UNREAD');
    expect(err!.txHash).toBeUndefined();

    // A second close over the same request must not find a seat to hand back either.
    abandonQuorumCeremony();
    await settle();
    expect(releaseCalls()).toHaveLength(0);
  });

  it('el bus no olvida la emisión por un `abandoned` rezagado: Escape después sigue sin liberar', async () => {
    broadcast.mockReset().mockRejectedValue(unconfirmed());
    const { flow, overlay, outcome } = await openBusCeremony(zeroFePayment(MEMO));
    await driveToSigning(flow);
    press(findButton(flow.tree, 'Combine & broadcast'), 'Combine & broadcast');
    await settle();

    // The report the old `abandon()` sent at its end, replayed against the bus
    // through the modal's own reporter — the flow no longer sends it, and the
    // bus refuses it anyway (`dispatchReportAdmissible`).
    const { reportQuorumCeremonyDispatch, quorumCeremonyDispatch } = await import('@/lib/xrpl/quorumCeremonyBus');
    const seen: unknown[] = [];
    hostOff = onQuorumCeremony((r) => seen.push(r));
    const req = seen.at(-1) as Parameters<typeof reportQuorumCeremonyDispatch>[0];
    hostOff();
    hostOff = null;
    reportQuorumCeremonyDispatch(req, { stage: 'abandoned' });
    expect(quorumCeremonyDispatch(req)?.committed).toBe(true);

    (overlay.props as { onEscape: () => void }).onEscape();
    await settle();
    expect(releaseCalls()).toHaveLength(0);
    expect((outcome.error() as (Error & { code?: string }) | null)?.code).toBe('RECEIPT_UNREAD');
  });

  it('«Back» en un anfitrión INLINE tras el broadcast sin confirmar tampoco libera', async () => {
    broadcast.mockReset().mockRejectedValue(unconfirmed());
    const doors = mount(
      CouncilSigningDoors,
      { xrplTx: zeroFePayment(MEMO), account: COUNCIL, onSettled: () => undefined },
      [CouncilMultisigFlow],
    );
    mountedRoot = doors;
    const flow = doors.child(CouncilMultisigFlow)!;
    await driveToSigning(flow);
    press(findButton(flow.tree, 'Combine & broadcast'), 'Combine & broadcast');
    await settle();
    expect(findButton(flow.tree, 'Cancel this ceremony')).toBeNull();
    // The async door beside it reads the hold as COMMITTED («already sent a
    // transaction»), never as exitable — it must not promise a Cancel that is gone.
    expect(textOf(doors.tree)).toContain('This council’s seat is committed to the sitting above');

    doors.unmount(); // «Back»
    mountedRoot = null;
    await settle();
    expect(releaseCalls()).toHaveLength(0);
  });

  /**
   * B3 (corolario): `committed` se estampaba ANTES de `multisign()`. Combinar es
   * aritmética local: si revienta, nada salió del navegador, y el cierre daba
   * RECEIPT_UNREAD («puede estar fuera») cuando debía dar ABANDONED (nada quedó).
   */
  it('B3 — si `multisign` revienta ANTES de emitir, nada salió: «Cancel» sigue ahí, Escape libera y el que llamó recibe ABANDONED', async () => {
    multisignImpl.mockImplementation(() => {
      throw new Error('Non-hex blob: a signature that does not parse');
    });
    const { modal, flow, overlay, outcome } = await openBusCeremony(zeroFePayment(MEMO));
    await driveToSigning(flow);

    press(findButton(flow.tree, 'Combine & broadcast'), 'Combine & broadcast');
    await settle();
    expect(broadcast).not.toHaveBeenCalled(); // nothing left this browser
    expect(findButton(flow.tree, 'Cancel this ceremony')).not.toBeNull(); // a pre-broadcast error: the exit stays
    expect(findElement(flow.tree, (el) => el.type === 'a' && textOf(el).includes('Check the ledger'))).toBeNull();

    (overlay.props as { onEscape: () => void }).onEscape();
    await settle();
    expect(modal.child(CouncilMultisigFlow)).toBeNull();
    expect(outcome.error()?.message).toBe(CEREMONY_ABANDONED);
    expect(releaseCalls()).toHaveLength(1); // the flow's unmount cleanup handed the pinned seat back
    expect(releaseCalls()[0].body).toEqual({ account: COUNCIL, memoHex: MEMO, sittingId: null }); // it. 34: a sitting the server did not name
  });
});

describe('(b) un anfitrión INLINE, sin bus: las puertas que monta la salida del creador', () => {
  /**
   * `OperatorConsole` renders `<CouncilSigningDoors xrplTx account exitToken
   * onStaleFate onSettled defaultTitle />` under «Withdraw the creator's genesis
   * capital» with a «Back» that does `setCreatorExit(null)` — i.e. unmounts the
   * doors. Sixteen hosts mount the flow this way and none of them touches the
   * bus; before it. 31 the flow's own unmount DECLINED to release («the bus does
   * it now»), so Back under an EXIT kept the council's seat for 24 h.
   */
  it('«Back» en `signing` — desmontar las puertas libera el asiento con la cuenta y el memo', async () => {
    const doors = mount(
      CouncilSigningDoors,
      {
        xrplTx: zeroFePayment(MEMO),
        account: COUNCIL,
        exitToken: 'exit-token',
        onStaleFate: () => undefined,
        onSettled: () => undefined,
        defaultTitle: 'Sign the council order',
      },
      [CouncilMultisigFlow],
    );
    mountedRoot = doors;
    const flow = doors.child(CouncilMultisigFlow);
    if (!flow) throw new Error('the doors did not mount the flow');
    await driveToSigning(flow, { signed: false });
    expect(multisignPrepare).toHaveBeenCalledWith(COUNCIL, expect.anything(), { exitToken: 'exit-token' });
    expect(releaseCalls()).toHaveLength(0);

    doors.unmount(); // «Back»
    mountedRoot = null;
    await settle();

    expect(releaseCalls()).toHaveLength(1);
    expect(releaseCalls()[0].body).toEqual({ account: COUNCIL, memoHex: MEMO, sittingId: null }); // it. 34: a sitting the server did not name
    expect(releaseCalls()[0].keepalive).toBe(true);
    expect(cancelPayloadAndDecide).toHaveBeenCalledWith('payload-1', expect.any(Function));
  });

  it('«Back» en `submitting` — NO libera, y el hash ya está reportado', async () => {
    const doors = mount(
      CouncilSigningDoors,
      { xrplTx: zeroFePayment(MEMO), account: COUNCIL, onSettled: () => undefined },
      [CouncilMultisigFlow],
    );
    mountedRoot = doors;
    const flow = doors.child(CouncilMultisigFlow)!;
    await driveToSigning(flow);
    await driveToSubmitting(flow);
    expect(signedCalls()).toHaveLength(1);

    doors.unmount();
    mountedRoot = null;
    await settle();

    expect(releaseCalls()).toHaveLength(0);
  });

  it('«Back» en `idle` (nunca se pulsó «Sign now») — el flujo no pinó nada y no manda nada', async () => {
    const doors = mount(
      CouncilSigningDoors,
      { xrplTx: zeroFePayment(MEMO), account: COUNCIL, onSettled: () => undefined },
      [CouncilMultisigFlow],
    );
    mountedRoot = doors;
    expect(doors.child(CouncilMultisigFlow)).not.toBeNull();

    doors.unmount();
    mountedRoot = null;
    await settle();

    expect(releaseCalls()).toHaveLength(0);
    expect(multisignPrepare).not.toHaveBeenCalled();
  });

  it('desmontar mientras el coordinador aún está pinando — el pin que aterriza tarde vuelve solo', async () => {
    let answerPrepare: ((v: unknown) => void) | null = null;
    multisignPrepare.mockReset().mockImplementation(() => new Promise((resolve) => (answerPrepare = resolve)));
    const doors = mount(
      CouncilSigningDoors,
      { xrplTx: zeroFePayment(MEMO), account: COUNCIL, onSettled: () => undefined },
      [CouncilMultisigFlow],
    );
    mountedRoot = doors;
    const flow = doors.child(CouncilMultisigFlow)!;
    press(findButton(flow.tree, 'Sign now, all together'), 'Sign now');
    await settle();
    expect(multisignPrepare).toHaveBeenCalledTimes(1);

    doors.unmount(); // «Back» during `preparing`
    mountedRoot = null;
    await settle();
    const duringPreparing = releaseCalls().length; // the cleanup asks (nothing may be pinned yet)

    answerPrepare!(PREPARE); // …and the coordinator answers into a dead sitting
    await settle();

    expect(releaseCalls().length).toBeGreaterThan(duringPreparing);
    expect(releaseCalls().at(-1)!.body).toEqual({ account: COUNCIL, memoHex: MEMO, sittingId: null }); // it. 34: a sitting the server did not name
    expect(createMemberPayload).not.toHaveBeenCalled(); // no QR is minted for a dead sitting
  });
});

describe('(c) cerrar en `idle`: el asiento del dispatch preparado, y lo que la persona ve', () => {
  it('Escape antes de «Sign now» pregunta por el asiento y, si sigue ocupado, la persona ve la cuenta atrás del servidor', async () => {
    // What the server answers for a row whose sitting never started: no lease,
    // no coordinator pin, so the ordinary rule — its payload is still signable.
    releaseAnswer = () => ({
      released: false,
      reason: 'no-seat',
      seat: {
        released: false,
        reason: 'not-pinned-by-us',
        pin: 'none',
        code: 'WAIT_FOR_PAYLOAD_EXPIRY',
        secondsLeft: 86_100,
        detail: 'We have no record that this app’s multisig coordinator pinned these bytes.',
      },
    });
    const { modal, overlay, outcome } = await openBusCeremony(zeroFePayment(MEMO));

    (overlay.props as { onEscape: () => void }).onEscape();
    await settle();

    expect(outcome.error()?.message).toBe(CEREMONY_ABANDONED);
    expect(modal.child(CouncilMultisigFlow)).toBeNull();
    expect(releaseCalls()).toHaveLength(1);
    expect(releaseCalls()[0].body).toEqual({ account: COUNCIL, memoHex: MEMO, sittingId: null }); // it. 34: a sitting the server did not name
    // it. 31 (§3): the seat's own answer is READ — the banner says it is still
    // held, with the server's countdown, instead of a silence the person takes
    // for «free».
    const notice = listLiveNotices().find((n) => n.memoHex === MEMO);
    expect(notice?.kind).toBe('seat-release-refused');
    expect(notice?.unreadable).toBeUndefined();
    const { secondsLeft } = liveNoticeCountdown(notice!);
    expect(secondsLeft).toBeGreaterThan(86_000);
    expect(secondsLeft).toBeLessThanOrEqual(86_100);
  });

  it('…y cuando el servidor SÍ soltó el asiento, ningún aviso', async () => {
    const { overlay } = await openBusCeremony(zeroFePayment(MEMO));
    (overlay.props as { onEscape: () => void }).onEscape();
    await settle();
    expect(releaseCalls()).toHaveLength(1);
    expect(listLiveNotices().find((n) => n.memoHex === MEMO)).toBeUndefined();
  });

  it('unos bytes sin 0xFE (una constitución) mandan la cuenta (y el sitting, sin nombre) — nunca un asiento', async () => {
    const constitution = { TransactionType: 'SignerListSet', Account: COUNCIL, SignerQuorum: 2 };
    expect(paymentMemoHex(constitution)).toBeNull();
    const { overlay, outcome } = await openBusCeremony(constitution);

    (overlay.props as { onEscape: () => void }).onEscape();
    await settle();

    expect(outcome.error()?.message).toBe(CEREMONY_ABANDONED);
    expect(releaseCalls()).toHaveLength(1);
    expect(releaseCalls()[0].body).toEqual({ account: COUNCIL, sittingId: null }); // it. 34: the account and the (unnamed) sitting — never a seat
  });

  it('cerrar sin ceremonia viva no manda nada', async () => {
    abandonQuorumCeremony();
    await settle();
    expect(releaseCalls()).toHaveLength(0);
  });

  it('un servidor que no contesta no rompe el cierre: la promesa se rechaza igual', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const { overlay, outcome } = await openBusCeremony(zeroFePayment(MEMO));
    (overlay.props as { onEscape: () => void }).onEscape();
    await settle();
    expect(outcome.error()?.message).toBe(CEREMONY_ABANDONED);
  });
});

/**
 * productizer it. 34 (E) — LA CARRERA DEL BUS: UNA LIBERACIÓN TARDÍA SUELTA EL
 * ASIENTO BAJO UNA CEREMONIA VIVA PORQUE EL SERVIDOR NO DISTINGUÍA SITTINGS.
 *
 * LA PERSONA. Escape en `signing` → la limpieza de desmontaje dispara
 * `/multisign/release` fire-and-forget con `keepalive`, y el bus rechaza
 * ABANDONED, que desde it. 31 se lee como 'review': la superficie ofrece firmar
 * otra vez → `sendIntent` → nuevo sitting → `/multisign/prepare` de la misma
 * sesión y los mismos bytes. Si la liberación del PRIMERO aterriza después, el
 * servidor soltaba el arriendo y el pin del SEGUNDO: la familia seguía firmando
 * sobre un nonce que el servidor daba por libre.
 *
 * EL ARREGLO tiene dos mitades y aquí se prueba la del cliente: cada liberación
 * lleva el `sittingId` que `/multisign/prepare` devolvió a SU sitting — la de la
 * limpieza (Escape/fondo/X/«Back»), la de «Cancel this ceremony» y la del prepare
 * que aterriza tarde (it. 31 §2). Un sitting sin nombre (cerró en `idle` o en
 * `preparing`) lo dice: `sittingId: null`. La mitad del servidor (un id ajeno
 * es un no-op, `stale-sitting`) vive en `xrplDefi.ceremonySitting.test.ts`.
 *
 * LA FASE, con la red retenida en el borde: la liberación del sitting #1 queda
 * EN VUELO (el `fetch` fingido no contesta), la persona firma otra vez, el
 * prepare #2 vuelve con otro nombre, y SOLO ENTONCES se suelta la respuesta del
 * #1. Lo que se comprueba es qué nombre llevaba cada petición cuando SALIÓ.
 * Mutación: quitar el transporte del id en la limpieza (o no guardarlo al volver
 * el prepare) → la tardía sale sin nombre / con `null` → rojo.
 */
describe('(e) it. 34 — la carrera del bus: cada liberación lleva el nombre de SU sitting', () => {
  /** A network where the release answers only when the test lets it. */
  let heldReleases: Array<{ body: Record<string, unknown>; answer: (v: unknown) => void }> = [];
  function stubNetworkHoldingReleases(): void {
    calls = [];
    heldReleases = [];
    global.fetch = vi.fn(async (url: unknown, init?: { body?: string; keepalive?: boolean }) => {
      const u = String(url);
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      calls.push({ url: u, body, keepalive: init?.keepalive });
      if (u.endsWith('/xrpl-defi/multisign/release')) {
        return new Promise((resolve) => {
          heldReleases.push({ body, answer: (v: unknown) => resolve({ ok: true, json: async () => v }) });
        });
      }
      if (u.endsWith('/flare-demo/handoff/signed')) return { ok: true, status: 202, json: async () => ({ status: 'PENDING_LEDGER' }) };
      return { ok: true, status: 200, json: async () => ({}) };
    }) as unknown as typeof fetch;
  }
  const STALE = { released: false, reason: 'stale-sitting', seat: { released: false, reason: 'stale-sitting', pin: 'row', detail: 'A newer sitting has pinned these bytes since this one was opened. Nothing was changed.' } };

  it('(a) Escape en `signing` con la liberación EN VUELO → firmar otra vez → prepare #2 con otro nombre → la tardía del #1 lleva el nombre del #1, y el #2 libera con el suyo', async () => {
    stubNetworkHoldingReleases();
    multisignPrepare
      .mockReset()
      .mockResolvedValueOnce({ ...PREPARE, sittingId: 'sitting-1' })
      .mockResolvedValueOnce({ ...PREPARE, sittingId: 'sitting-2' });

    // Sitting #1: the family is signing (a live QR on the member's phone).
    const first = await openBusCeremony(zeroFePayment(MEMO));
    await driveToSigning(first.flow, { signed: false });
    expect(releaseCalls()).toHaveLength(0);

    // Escape: the flow unmounts, its cleanup fires the release — and the network HOLDS it.
    (first.overlay.props as { onEscape: () => void }).onEscape();
    await settle();
    expect(first.outcome.error()?.message).toBe(CEREMONY_ABANDONED); // 'review' for the surface
    expect(first.modal.child(CouncilMultisigFlow)).toBeNull();
    expect(releaseCalls()).toHaveLength(1);
    expect(releaseCalls()[0].body).toEqual({ account: COUNCIL, memoHex: MEMO, sittingId: 'sitting-1' });
    expect(releaseCalls()[0].keepalive).toBe(true);
    expect(heldReleases).toHaveLength(1); // in flight: not answered yet

    // The surface offers to sign again: a NEW request over the SAME bytes, and «Sign now».
    const promise2 = requestQuorumCeremony(zeroFePayment(MEMO), COUNCIL);
    const outcome2 = outcomeOf(promise2);
    await settle();
    const flow2 = first.modal.child(CouncilMultisigFlow);
    expect(flow2).not.toBeNull();
    createMemberPayload.mockReset().mockResolvedValue({ uuid: 'payload-2', qrPng: 'data:', pushed: false });
    pollStatus.mockReset().mockResolvedValue({});
    press(findButton(flow2!.tree, 'Sign now, all together'), 'Sign now (again)');
    await settle();
    expect(multisignPrepare).toHaveBeenCalledTimes(2); // prepare #2 landed: the server re-pinned these bytes under 'sitting-2'
    expect(findButton(flow2!.tree, 'Cancel this ceremony')).not.toBeNull(); // sitting #2 is live and signing

    // NOW the late release of sitting #1 is answered — after prepare #2. What the
    // server saw when it arrived was the name of sitting #1, never the live one.
    expect(releaseCalls()).toHaveLength(1); // nothing else went out meanwhile
    heldReleases[0].answer(STALE);
    await settle();
    // A stale answer is an answer, not a refusal: no banner is painted over sitting #2.
    expect(listLiveNotices().find((n) => n.memoHex === MEMO)).toBeUndefined();
    expect(outcome2.settled()).toBe(false); // sitting #2 is untouched

    // And sitting #2 hands ITS seat back by ITS name.
    (first.modal.tree!.props as { onEscape: () => void }).onEscape();
    await settle();
    expect(outcome2.error()?.message).toBe(CEREMONY_ABANDONED);
    expect(releaseCalls()).toHaveLength(2);
    expect(releaseCalls()[1].body).toEqual({ account: COUNCIL, memoHex: MEMO, sittingId: 'sitting-2' });
    heldReleases[1].answer({ released: true, seat: { released: true, reason: 'ceremony-ended' } });
    await settle();
  });

  it('(b) «Back» en `preparing` + «Sign now» antes de que vuelva el prepare #1 → la limpieza dice `null`, la tardía del #1 dice #1, y ninguna dice #2', async () => {
    stubNetworkHoldingReleases();
    let answerPrepare1: ((v: unknown) => void) | null = null;
    multisignPrepare
      .mockReset()
      .mockImplementationOnce(() => new Promise((resolve) => (answerPrepare1 = resolve)))
      .mockResolvedValueOnce({ ...PREPARE, sittingId: 'sitting-2' });

    // Doors #1: «Sign now» → prepare #1 in flight (1-3 s of ledger reads).
    const doors1 = mount(
      CouncilSigningDoors,
      { xrplTx: zeroFePayment(MEMO), account: COUNCIL, onSettled: () => undefined },
      [CouncilMultisigFlow],
    );
    mountedRoot = doors1;
    press(findButton(doors1.child(CouncilMultisigFlow)!.tree, 'Sign now, all together'), 'Sign now');
    await settle();
    expect(multisignPrepare).toHaveBeenCalledTimes(1);

    // «Back» during `preparing`: the cleanup releases — a sitting with no name yet.
    doors1.unmount();
    mountedRoot = null;
    await settle();
    const duringPreparing = releaseCalls();
    for (const c of duringPreparing) expect(c.body).toEqual({ account: COUNCIL, memoHex: MEMO, sittingId: null });

    // «Sign now» again, on fresh doors, BEFORE prepare #1 came back: prepare #2 lands first.
    const doors2 = mount(
      CouncilSigningDoors,
      { xrplTx: zeroFePayment(MEMO), account: COUNCIL, onSettled: () => undefined },
      [CouncilMultisigFlow],
    );
    mountedRoot = doors2;
    const flow2 = doors2.child(CouncilMultisigFlow)!;
    createMemberPayload.mockReset().mockResolvedValue({ uuid: 'payload-2', qrPng: 'data:', pushed: false });
    pollStatus.mockReset().mockResolvedValue({});
    press(findButton(flow2.tree, 'Sign now, all together'), 'Sign now (again)');
    await settle();
    expect(multisignPrepare).toHaveBeenCalledTimes(2);
    expect(findButton(flow2.tree, 'Cancel this ceremony')).not.toBeNull(); // sitting #2 is live

    // …and only now does prepare #1 land, in a dead sitting: it hands back ITS seat, by ITS name.
    answerPrepare1!({ ...PREPARE, sittingId: 'sitting-1' });
    await settle();
    const late = releaseCalls().slice(duringPreparing.length);
    expect(late).toHaveLength(1);
    expect(late[0].body).toEqual({ account: COUNCIL, memoHex: MEMO, sittingId: 'sitting-1' });
    expect(createMemberPayload).toHaveBeenCalledTimes(1); // only sitting #2 minted a QR
    // Nothing that went out so far named the live sitting.
    expect(releaseCalls().some((c) => c.body.sittingId === 'sitting-2')).toBe(false);

    // The live sitting's own «Back» names itself.
    doors2.unmount();
    mountedRoot = null;
    await settle();
    expect(releaseCalls().at(-1)!.body).toEqual({ account: COUNCIL, memoHex: MEMO, sittingId: 'sitting-2' });
    for (const h of heldReleases) h.answer(STALE);
    await settle();
  });

  it('«Cancel this ceremony» libera con el nombre de su sitting', async () => {
    multisignPrepare.mockReset().mockResolvedValue({ ...PREPARE, sittingId: 'sitting-9' });
    const { flow } = await openBusCeremony(zeroFePayment(MEMO));
    await driveToSigning(flow, { signed: false });

    press(findButton(flow.tree, 'Cancel this ceremony'), 'Cancel');
    await settle();

    expect(releaseCalls()).toHaveLength(1);
    expect(releaseCalls()[0].body).toEqual({ account: COUNCIL, memoHex: MEMO, sittingId: 'sitting-9' });
  });

  it('un cierre en `idle` (el bus) dice que su sitting no tiene nombre: `sittingId: null`', async () => {
    const { overlay } = await openBusCeremony(zeroFePayment(MEMO));
    (overlay.props as { onEscape: () => void }).onEscape();
    await settle();
    expect(releaseCalls()).toHaveLength(1);
    expect(releaseCalls()[0].body).toEqual({ account: COUNCIL, memoHex: MEMO, sittingId: null });
  });

  it('(c) control: un servidor ANTERIOR al campo no devuelve nombre → la liberación dice `null` (que ese servidor ignora) y todo lo demás es igual', async () => {
    // PREPARE has no `sittingId`: the answer of a server from before it. 34.
    const { modal, flow, overlay, outcome } = await openBusCeremony(zeroFePayment(MEMO));
    await driveToSigning(flow, { signed: false });

    (overlay.props as { onEscape: () => void }).onEscape();
    await settle();

    expect(outcome.error()?.message).toBe(CEREMONY_ABANDONED);
    expect(modal.child(CouncilMultisigFlow)).toBeNull();
    expect(releaseCalls()).toHaveLength(1);
    expect(releaseCalls()[0].body).toEqual({ account: COUNCIL, memoHex: MEMO, sittingId: null });
    expect(releaseCalls()[0].keepalive).toBe(true);
    expect(cancelPayloadAndDecide).toHaveBeenCalledWith('payload-1', expect.any(Function));
  });

  it('una respuesta `stale-sitting` a «Cancel» no se pinta como «no se pudo confirmar»: el sitting simplemente ya no tenía nada', async () => {
    releaseAnswer = () => STALE;
    multisignPrepare.mockReset().mockResolvedValue({ ...PREPARE, sittingId: 'sitting-1' });
    const { flow } = await openBusCeremony(zeroFePayment(MEMO));
    await driveToSigning(flow, { signed: false });

    press(findButton(flow.tree, 'Cancel this ceremony'), 'Cancel');
    await settle();

    expect(releaseCalls()[0].body.sittingId).toBe('sitting-1');
    expect(textOf(flow.tree)).not.toMatch(/could not be reached/); // the `seatUnreleased` sentence
    expect(findButton(flow.tree, 'Sign now, all together')).not.toBeNull(); // back to idle, cleanly
    expect(listLiveNotices().find((n) => n.memoHex === MEMO)).toBeUndefined();
  });

  it('las piezas puras: el cuerpo de la liberación y la lectura del nombre', async () => {
    const { ceremonyReleaseBody } = await import('@/lib/wallet/handoffRelease');
    const { prepareSittingId } = await import('@/components/legacy/CouncilMultisigFlow');
    expect(ceremonyReleaseBody(COUNCIL, MEMO, 'sitting-1')).toEqual({ account: COUNCIL, memoHex: MEMO, sittingId: 'sitting-1' });
    expect(ceremonyReleaseBody(COUNCIL, MEMO, null)).toEqual({ account: COUNCIL, memoHex: MEMO, sittingId: null });
    expect(ceremonyReleaseBody(COUNCIL, MEMO, '')).toEqual({ account: COUNCIL, memoHex: MEMO, sittingId: null });
    expect(ceremonyReleaseBody(COUNCIL, MEMO, undefined)).toEqual({ account: COUNCIL, memoHex: MEMO }); // a caller from before: no key
    expect(ceremonyReleaseBody(COUNCIL, '', 'sitting-1')).toEqual({ account: COUNCIL, sittingId: 'sitting-1' }); // a constitution: no memo
    expect(prepareSittingId({ ...PREPARE, sittingId: ' sitting-1 ' })).toBe('sitting-1');
    expect(prepareSittingId(PREPARE)).toBeNull();
    expect(prepareSittingId({ sittingId: '' })).toBeNull();
    expect(prepareSittingId({ sittingId: 42 })).toBeNull();
    expect(prepareSittingId(null)).toBeNull();
  });
});

describe('(§6) el bus: una sesión abandonada no borra a la que la sustituyó', () => {
  it('resolver/rechazar una petición que ya no es la viva no vacía el bus', async () => {
    const seen: unknown[] = [];
    hostOff = onQuorumCeremony((r) => seen.push(r));
    const first = requestQuorumCeremony(zeroFePayment(MEMO), COUNCIL);
    const firstOutcome = outcomeOf(first);
    const firstReq = seen.at(-1) as { resolve: (h: string) => void; reject: (e: Error) => void };
    abandonQuorumCeremony(); // the first sitting is closed…
    await settle();
    expect(firstOutcome.error()?.message).toBe(CEREMONY_ABANDONED);

    const second = requestQuorumCeremony(zeroFePayment(MEMO), COUNCIL); // …and a second one opens
    const secondOutcome = outcomeOf(second);
    const secondReq = seen.at(-1);
    expect(secondReq).not.toBeNull();

    firstReq.resolve(HASH); // the late continuation of the first sitting
    await settle();
    expect(seen.at(-1)).toBe(secondReq); // the second is still on the bus
    expect(secondOutcome.settled()).toBe(false);

    abandonQuorumCeremony();
    await settle();
    expect(secondOutcome.error()?.message).toBe(CEREMONY_ABANDONED);
  });
});
