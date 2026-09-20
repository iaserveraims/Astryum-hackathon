import { beforeEach, describe, expect, it } from 'vitest';
import {
  STALE_LOCK_HEADLINE,
  STALE_LOCK_WARNING_HEADLINE,
  clearStoredStaleLocks,
  composeKindOf,
  isExitComposeAction,
  readStoredStaleLocks,
  restoredStaleLock,
  staleLockBlocks,
  staleLockHeadline,
  writeStoredStaleLock,
  type StaleLockStoreLike,
  type StaleOrderFate,
} from '../singleSignVerdict';

/**
 * R3 3.1 (NUESTRA REGRESIÓN) y R5 5.5.
 *
 * El candado de la paraba TODO lo que compone una consola, con lo que una
 * SALIDA quedaba cerrada por una pantalla nuestra — exactamente lo que el mismo
 * commit prohibía en el backend. Y se armaba también con «no pude comprobarlo»,
 * o sea: le pedíamos a la persona que afirmara lo que el servidor se negó a
 * leer, que es la familia «no pude leer = permiso» del revés.
 */

const OUT: StaleOrderFate = { kind: 'already-out', txHash: 'A'.repeat(64) };
const FAILED: StaleOrderFate = { kind: 'out-failed', txHash: 'B'.repeat(64) };
const UNCHECKED: StaleOrderFate = { kind: 'unchecked' };

describe('qué es una salida', () => {
  it('las acciones que sacan capital', () => {
    for (const a of ['recall', 'evacuate', 'creator-exit', 'pote-exit', 'redeem', 'withdraw', 'unmint', 'out']) {
      expect(isExitComposeAction(a)).toBe(true);
      expect(composeKindOf(a)).toBe('exit');
    }
  });

  it('todo lo demás es «other» — una acción nueva no se exime en silencio', () => {
    for (const a of ['direct-to', 'create-pote', 'cede', 'set-payees', 'set-user-gate', 'propose-venue', '', null, undefined]) {
      expect(composeKindOf(a as string)).toBe('other');
    }
  });

  it('no distingue mayúsculas ni espacios', () => {
    expect(composeKindOf(' Recall ')).toBe('exit');
  });
});

describe('staleLockBlocks — una salida se avisa, jamás se para', () => {
  it('sin candado no para nada', () => {
    expect(staleLockBlocks(null, 'other')).toBe(false);
    expect(staleLockBlocks(null, 'exit')).toBe(false);
  });

  it('con el peor veredicto posible, una SALIDA sigue abierta', () => {
    expect(staleLockBlocks(OUT, 'exit')).toBe(false);
    expect(staleLockBlocks(FAILED, 'exit')).toBe(false);
    expect(staleLockBlocks(UNCHECKED, 'exit')).toBe(false);
  });

  it('una NO-salida sí se para con un veredicto que leímos', () => {
    expect(staleLockBlocks(OUT, 'other')).toBe(true);
    expect(staleLockBlocks(FAILED, 'other')).toBe(true);
  });

  it('«no pude comprobarlo» AVISA, nunca para: no se pide afirmar lo que el servidor no leyó', () => {
    expect(staleLockBlocks(UNCHECKED, 'other')).toBe(false);
  });

  it('la confirmación explícita compone — el botón «Compose it again anyway» estaba muerto', () => {
    expect(staleLockBlocks(OUT, 'other', { confirmed: true })).toBe(false);
    expect(staleLockBlocks(FAILED, 'other', { confirmed: true })).toBe(false);
    // y `confirmed` ausente o false no abre nada
    expect(staleLockBlocks(OUT, 'other', { confirmed: false })).toBe(true);
    expect(staleLockBlocks(OUT, 'other', {})).toBe(true);
  });

  it('el titular dice la verdad: «en pausa» solo cuando algo está en pausa', () => {
    expect(staleLockHeadline(true)).toBe(STALE_LOCK_HEADLINE);
    expect(staleLockHeadline(false)).toBe(STALE_LOCK_WARNING_HEADLINE);
  });
});

/* ── La consola, ejecutada ───────────────────────────────────────────────── */

/**
 * Las consolas reales no se pueden montar aquí (el entorno de vitest es 'node' y
 * no hay testing-library), así que su GUARDA se ejecuta tal y como está escrita
 * en las seis: `if (staleLock.blocks(composeKindOf(<acción>), { confirmed }))
 * return;`. Si esto pasa y el cable-trampa de
 * `components/xrpl/__tests__/councilOrderConsolesWiring` comprueba que la guarda
 * es esa, la salida se compone de verdad.
 */
function console_(lock: StaleOrderFate | null) {
  const composed: string[] = [];
  return {
    composed,
    compose(action: string, opts?: { confirmAnotherOrder?: boolean }) {
      if (staleLockBlocks(lock, composeKindOf(action), { confirmed: opts?.confirmAnotherOrder })) return;
      composed.push(action);
    },
  };
}

describe('una consola con el candado puesto COMPONE la salida y no la entrada', () => {
  it('recall y evacuate salen; direct-to y create-pote no', () => {
    const c = console_(OUT);
    c.compose('recall');
    c.compose('evacuate');
    c.compose('direct-to');
    c.compose('create-pote');
    expect(c.composed).toEqual(['recall', 'evacuate']);
  });

  it('la salida del creador («creator-exit») y el «Pull out» del gestor también salen', () => {
    const c = console_(FAILED);
    c.compose('creator-exit');
    c.compose('pull-out');
    expect(c.composed).toEqual(['creator-exit', 'pull-out']);
  });

  it('con «no pude comprobarlo» compone TODO, avisando', () => {
    const c = console_(UNCHECKED);
    c.compose('direct-to');
    c.compose('recall');
    expect(c.composed).toEqual(['direct-to', 'recall']);
  });

  it('«Compose it again anyway» compone la entrada que el candado paraba', () => {
    const c = console_(OUT);
    c.compose('direct-to');
    expect(c.composed).toEqual([]);
    c.compose('direct-to', { confirmAnotherOrder: true });
    expect(c.composed).toEqual(['direct-to']);
  });
});

/* ── R5 5.5: el candado sobrevive al F5 ──────────────────────────────────── */

function memoryStore(): StaleLockStoreLike & { dump(): Record<string, string> } {
  const data: Record<string, string> = {};
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
    dump: () => data,
  };
}

describe('el candado persiste POR MEMO y vuelve tras un F5', () => {
  let store: ReturnType<typeof memoryStore>;
  beforeEach(() => {
    store = memoryStore();
  });

  it('lo que se guarda se restaura', () => {
    writeStoredStaleLock(store, 'ab'.repeat(32), OUT);
    expect(restoredStaleLock(store)).toEqual(OUT);
  });

  it('dos órdenes distintas no se pisan', () => {
    writeStoredStaleLock(store, 'a'.repeat(64), OUT);
    writeStoredStaleLock(store, 'b'.repeat(64), FAILED);
    expect(readStoredStaleLocks(store)).toHaveLength(2);
    // el más nuevo es el que se restaura
    expect(restoredStaleLock(store)).toEqual(FAILED);
  });

  it('el mismo memo se sobrescribe, no se acumula', () => {
    writeStoredStaleLock(store, 'a'.repeat(64), UNCHECKED);
    writeStoredStaleLock(store, 'a'.repeat(64), OUT);
    expect(readStoredStaleLocks(store)).toHaveLength(1);
    expect(restoredStaleLock(store)).toEqual(OUT);
  });

  it('el memo no distingue mayúsculas: el mismo asiento es el mismo asiento', () => {
    writeStoredStaleLock(store, 'ab'.repeat(32), OUT);
    writeStoredStaleLock(store, 'AB'.repeat(32), FAILED);
    expect(readStoredStaleLocks(store)).toHaveLength(1);
  });

  it('«checking» no se guarda: al recargar nadie está leyendo ese destino', () => {
    writeStoredStaleLock(store, 'a'.repeat(64), { kind: 'checking' });
    expect(readStoredStaleLocks(store)).toHaveLength(0);
    expect(restoredStaleLock(store)).toBeNull();
  });

  it('soltar el candado olvida TODO lo de la sesión — la persona dijo que lo comprobó', () => {
    writeStoredStaleLock(store, 'a'.repeat(64), OUT);
    writeStoredStaleLock(store, 'b'.repeat(64), FAILED);
    clearStoredStaleLocks(store);
    expect(restoredStaleLock(store)).toBeNull();
  });

  it('un `null` olvida solo ese memo', () => {
    writeStoredStaleLock(store, 'a'.repeat(64), OUT);
    writeStoredStaleLock(store, 'b'.repeat(64), FAILED);
    writeStoredStaleLock(store, 'b'.repeat(64), null);
    expect(restoredStaleLock(store)).toEqual(OUT);
  });

  it('sin almacén (SSR, ventana privada) no revienta y el candado vive solo en memoria', () => {
    expect(() => writeStoredStaleLock(null, 'a'.repeat(64), OUT)).not.toThrow();
    expect(restoredStaleLock(null)).toBeNull();
    expect(readStoredStaleLocks(undefined)).toEqual([]);
  });

  it('un almacén que lanza se trata como ausente, jamás como «no hay candado» a medias', () => {
    const angry: StaleLockStoreLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(restoredStaleLock(angry)).toBeNull();
    expect(() => writeStoredStaleLock(angry, 'a'.repeat(64), OUT)).not.toThrow();
    expect(() => clearStoredStaleLocks(angry)).not.toThrow();
  });

  it('basura en el almacén no arma un candado inventado', () => {
    store.setItem('astryum.staleOrderLock.v1', 'not json');
    expect(restoredStaleLock(store)).toBeNull();
    store.setItem('astryum.staleOrderLock.v1', JSON.stringify([{ memo: 1, fate: { kind: 'nonsense' } }]));
    expect(restoredStaleLock(store)).toBeNull();
  });
});
