import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * operationStore — las reglas que el fundador dictó a mano (2026-08-27 y
 * 2026-08-29) y que hasta ahora no vigilaba nadie:
 *
 *   «que se puedan abrir varias estrategias a la vez, concretamente tres,
 *    para no romper nada... recuerda que el legacy también cuenta como card»
 *   «si se minimiza no cuenta para el límite de tres estrategias, es decir
 *    que se podrían tener 4 estrategias minimizadas más el agente»
 *
 * Son invariantes de PRODUCTO, no detalles: el tope protege el rendimiento y
 * la cabeza del usuario, y la excepción del agente es una decisión explícita.
 * Un refactor que se lleve por delante cualquiera de las dos rompe algo que
 * se pidió por escrito — de ahí este fichero.
 *
 * La regla más delicada es la ÚLTIMA: al llegar al tope, la cuarta se
 * RECHAZA y la lista queda intacta. Jamás se cierra sola una operación con
 * estado dentro (importes escritos, una ceremonia a medias).
 */

// El aviso del tope sale del propio store (no hay React donde vivir): se
// espía en vez de renderizarse.
const toastSpy = vi.fn();
vi.mock('sonner', () => ({ toast: (...args: unknown[]) => toastSpy(...args) }));

import { useOperationStore, MAX_OPS } from '../operationStore';

const vault = (kind: string) => ({ kind, title: `vault-${kind}` }) as never;
const reset = () => useOperationStore.setState({ ops: [], activeId: null });
const kinds = () => useOperationStore.getState().ops.map((o) => o.kind);

describe('operationStore — la orden de estación del alta del gestor', () => {
  beforeEach(() => {
    reset();
    toastSpy.mockClear();
  });

  it('abrir el alta con una orden de estación la lleva en la ventana, y reabrir con otra la sustituye sin duplicar la ventana', () => {
    const st = useOperationStore.getState();
    expect(st.openManagerSetupOp()).toBe(true);
    const first = useOperationStore.getState().ops[0];
    expect(first.kind).toBe('manager-setup');
    expect(first.kind === 'manager-setup' && first.jump).toBeNull();

    expect(st.openManagerSetupOp({ step: 1, nonce: 7 })).toBe(true);
    const ops = useOperationStore.getState().ops;
    expect(ops).toHaveLength(1);
    const op = ops[0];
    expect(op.kind === 'manager-setup' && op.jump).toEqual({ step: 1, nonce: 7 });
    expect(useOperationStore.getState().activeId).toBe(op.id);
  });
});

describe('operationStore — el tope de tres', () => {
  beforeEach(() => {
    reset();
    toastSpy.mockClear();
  });

  it('admite exactamente tres operaciones y rechaza la cuarta', () => {
    const st = useOperationStore.getState();
    expect(st.openVaultOp(vault('e1'))).toBe(true);
    expect(st.openPaOp({ owner: '0xowner', legs: {} as never, action: 'derisk' as never, onChanged: () => {} })).toBe(true);
    expect(st.openCageOp({ account: 'rAcc', vaultTitle: 'v' })).toBe(true);
    expect(useOperationStore.getState().ops).toHaveLength(MAX_OPS);

    expect(st.openVaultOp(vault('e2'))).toBe(false);
    expect(useOperationStore.getState().ops).toHaveLength(MAX_OPS);
    expect(toastSpy).toHaveBeenCalledTimes(1);
  });

  it('constituir un Legacy CUENTA como una de las tres (pedido literal)', () => {
    const st = useOperationStore.getState();
    st.openConstituteOp();
    st.openVaultOp(vault('e1'));
    st.openPaOp({ owner: '0xowner', legs: {} as never, action: 'derisk' as never, onChanged: () => {} });
    expect(useOperationStore.getState().ops).toHaveLength(MAX_OPS);

    expect(st.openCageOp({ account: 'rAcc', vaultTitle: 'v' })).toBe(false);
    expect(kinds()).toContain('constitute');
  });

  it('la cuarta rechazada NO cierra ninguna de las tres vivas', () => {
    const st = useOperationStore.getState();
    st.openVaultOp(vault('e1'));
    st.openVaultOp(vault('e2'));
    st.openVaultOp(vault('e3'));
    const before = useOperationStore.getState().ops.map((o) => o.id);

    st.openConstituteOp();

    expect(useOperationStore.getState().ops.map((o) => o.id)).toEqual(before);
    // Y la activa sigue siendo la que estaba: el rechazo no roba el foco.
    expect(useOperationStore.getState().activeId).toBe(before[2]);
  });
});

describe('operationStore — el agente vive fuera del tope', () => {
  beforeEach(() => {
    reset();
    toastSpy.mockClear();
  });

  it('entra aunque el tope de tres esté lleno', () => {
    const st = useOperationStore.getState();
    st.openVaultOp(vault('e1'));
    st.openVaultOp(vault('e2'));
    st.openVaultOp(vault('e3'));

    expect(st.openAgentOp('pon mis FXRP a rentar')).toBe(true);
    expect(useOperationStore.getState().ops).toHaveLength(MAX_OPS + 1);
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('y no consume sitio: con el agente abierto siguen cabiendo tres', () => {
    const st = useOperationStore.getState();
    st.openAgentOp('hola');
    expect(st.openVaultOp(vault('e1'))).toBe(true);
    expect(st.openVaultOp(vault('e2'))).toBe(true);
    expect(st.openVaultOp(vault('e3'))).toBe(true);
    expect(st.openCageOp({ account: 'rAcc', vaultTitle: 'v' })).toBe(false);
    expect(kinds().filter((k) => k !== 'agent')).toHaveLength(MAX_OPS);
  });
});

describe('operationStore — identidad y foco', () => {
  beforeEach(() => {
    reset();
    toastSpy.mockClear();
  });

  it('reabrir la MISMA estrategia no duplica: restaura y refresca su payload', () => {
    const st = useOperationStore.getState();
    st.openVaultOp(vault('e1'), { amount: '100' });
    st.openVaultOp(vault('e2'));
    expect(useOperationStore.getState().activeId).toBe('vault:e2');

    st.openVaultOp(vault('e1'), { amount: '250' });

    expect(useOperationStore.getState().ops).toHaveLength(2);
    expect(useOperationStore.getState().activeId).toBe('vault:e1');
    const e1 = useOperationStore.getState().ops.find((o) => o.id === 'vault:e1');
    expect(e1 && e1.kind === 'vault' ? e1.initial?.amount : null).toBe('250');
  });

  it('una frase nueva al agente vivo es un mensaje más, no un chat nuevo', () => {
    const st = useOperationStore.getState();
    st.openAgentOp('primera');
    const first = useOperationStore.getState().ops[0];
    st.openAgentOp('segunda');
    const after = useOperationStore.getState().ops;

    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(first.id);
    expect(after[0].kind === 'agent' ? after[0].seed : null).toBe('segunda');
    // La seedKey cambia: es lo que hace que el chat re-siembre la frase.
    expect(after[0].kind === 'agent' && first.kind === 'agent' ? after[0].seedKey !== first.seedKey : false).toBe(true);
  });

  it('cerrar una operación PLEGADA no le roba el foco a la desplegada', () => {
    const st = useOperationStore.getState();
    st.openVaultOp(vault('e1'));
    st.openVaultOp(vault('e2'));
    expect(useOperationStore.getState().activeId).toBe('vault:e2');

    st.close('vault:e1');

    expect(useOperationStore.getState().activeId).toBe('vault:e2');
    expect(useOperationStore.getState().ops).toHaveLength(1);
  });

  it('cerrar la ACTIVA deja a las demás plegadas, sin elegir sucesora por su cuenta', () => {
    const st = useOperationStore.getState();
    st.openVaultOp(vault('e1'));
    st.openVaultOp(vault('e2'));

    st.close('vault:e2');

    expect(useOperationStore.getState().activeId).toBeNull();
    expect(useOperationStore.getState().ops).toHaveLength(1);
  });

  it('minimizeActive pliega la desplegada sin cerrar nada', () => {
    const st = useOperationStore.getState();
    st.openVaultOp(vault('e1'));
    st.minimizeActive();

    expect(useOperationStore.getState().activeId).toBeNull();
    expect(useOperationStore.getState().ops).toHaveLength(1);
  });
});
