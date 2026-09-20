/**
 * El flujo avanza solo, y se PARA donde tiene que pararse.
 *
 * Lo que estos tests protegen no es el orden de los pasos (eso ya lo fija
 * fxrpOrigin), sino las dos transiciones que cuestan dinero si se equivocan:
 *
 *  · avanzar desde un paso que no terminó → el usuario cree que entró y no entró
 *  · reintentar uno «sin confirmar» → cada tramo mueve dinero de verdad (el
 *    puente cobra entrega, la entrada paga gas), así que reintentar a ciegas
 *    es pagar dos veces. Es el mismo error que en este repo ya costó un doble
 *    depósito.
 */
import { describe, it, expect } from 'vitest';
import {
  buildEntryFlow, currentStep, isComplete, advance, setStatus, retry, isBlocked,
  remainingSignatures,
} from '../borrowFlow';
import { FLARE_CHAIN_ID, type FxrpOrigin } from '../fxrpOrigin';

const EOA = '0xDE1fAf781d98B3844c60e78D43b1E3c18Dd18135';
const XRPL = 'rNaFfVgbqWYotrR3Jz4RorirDUZgLfxhXt';

const fromEthereum: FxrpOrigin = {
  kind: 'evm-ethereum', address: EOA, chainId: 1, signer: EOA, id: `${EOA}:1`,
};
const fromFlare: FxrpOrigin = {
  kind: 'evm-flare', address: EOA, chainId: 14, signer: EOA, id: `${EOA}:14`,
};
const fromPa: FxrpOrigin = {
  kind: 'smart-account', address: '0xc837aB1234567890AbcDef1234567890aBcDe3b1',
  chainId: FLARE_CHAIN_ID, signer: XRPL, id: 'pa',
};

describe('el flujo se deriva del origen', () => {
  it('desde Ethereum es un solo paso', () => {
    const flow = buildEntryFlow(fromEthereum, EOA);
    expect(flow.steps.map((s) => s.kind)).toEqual(['enter-market']);
    expect(remainingSignatures(flow)).toBe(1);
  });

  it('desde Flare son dos, y el primero es el puente', () => {
    const flow = buildEntryFlow(fromFlare, EOA);
    expect(flow.steps.map((s) => s.kind)).toEqual(['bridge', 'enter-market']);
    expect(currentStep(flow)?.kind).toBe('bridge');
  });

  it('desde la Smart Account son tres, y el primero lo firma Xaman', () => {
    const flow = buildEntryFlow(fromPa, EOA);
    expect(flow.steps.map((s) => s.kind)).toEqual(['pa-withdraw', 'bridge', 'enter-market']);
    expect(currentStep(flow)?.signer).toBe(XRPL);
    expect(currentStep(flow)?.rail).toBe('xrpl');
  });

  it('prestar el RLUSD en Sentora no añade pasos: alarga el último (misma firma)', () => {
    const flow = buildEntryFlow(fromPa, EOA, { lendBorrowed: true });
    expect(flow.steps.map((s) => s.kind)).toEqual(['pa-withdraw', 'bridge', 'enter-market']);
    expect(flow.steps[2].txCount).toBe(5);
    expect(remainingSignatures(flow)).toBe(3);
  });

  it('todos empiezan pendientes y el cursor en el primero', () => {
    const flow = buildEntryFlow(fromPa, EOA);
    expect(flow.steps.every((s) => s.status === 'pending')).toBe(true);
    expect(flow.cursor).toBe(0);
    expect(isComplete(flow)).toBe(false);
  });
});

describe('avanzar', () => {
  it('recorre los tres pasos hasta terminar', () => {
    let flow = buildEntryFlow(fromPa, EOA);
    for (let i = 0; i < 3; i++) {
      expect(isComplete(flow)).toBe(false);
      flow = advance(setStatus(flow, 'done'));
    }
    expect(isComplete(flow)).toBe(true);
    expect(currentStep(flow)).toBeNull();
    expect(remainingSignatures(flow)).toBe(0);
  });

  it('NO avanza desde un paso a medias — ni firmando ni asentando', () => {
    const flow = buildEntryFlow(fromFlare, EOA);
    for (const status of ['pending', 'preparing', 'ready', 'signing', 'settling'] as const) {
      expect(advance(setStatus(flow, status)).cursor).toBe(0);
    }
  });

  it('NO avanza desde un fallo', () => {
    const flow = setStatus(buildEntryFlow(fromFlare, EOA), 'failed', 'revert');
    expect(advance(flow).cursor).toBe(0);
    expect(isBlocked(flow)).toBe(true);
  });

  it('setStatus no muta el estado anterior', () => {
    const before = buildEntryFlow(fromFlare, EOA);
    const after = setStatus(before, 'done');
    expect(before.steps[0].status).toBe('pending');
    expect(after.steps[0].status).toBe('done');
  });
});

describe('«salió y no sé si entró» no se reintenta', () => {
  it('un paso sin confirmar bloquea el flujo', () => {
    const flow = setStatus(buildEntryFlow(fromFlare, EOA), 'unconfirmed', '0xabc');
    expect(isBlocked(flow)).toBe(true);
    expect(advance(flow).cursor).toBe(0);
  });

  it('y NO se puede reintentar — reintentar aquí es pagar el peaje dos veces', () => {
    const flow = setStatus(buildEntryFlow(fromFlare, EOA), 'unconfirmed', '0xabc');
    expect(retry(flow).steps[0].status).toBe('unconfirmed');
  });

  it('un fallo limpio SÍ se reintenta: ahí nada salió', () => {
    const flow = setStatus(buildEntryFlow(fromFlare, EOA), 'failed', 'user rejected');
    expect(retry(flow).steps[0].status).toBe('pending');
  });

  it('el detalle del paso sobrevive para poder enseñar el hash', () => {
    const flow = setStatus(buildEntryFlow(fromFlare, EOA), 'unconfirmed', '0xabc');
    expect(currentStep(flow)?.detail).toBe('0xabc');
  });
});
