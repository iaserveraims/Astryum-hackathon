/**
 * productizer it. 17 (L3 / R5 5.1) — la declaración de la run ES la lista.
 *
 * Lo que se prueba aquí es el CABLE, no la pieza: que el omnibus que una run
 * declara llega al constructor del 0xFE como fuente adicional de «cuenta
 * operativa», sin ninguna variable de entorno; que un extraño no entra en esa
 * lista; y que «no pude leer el almacén» conserva lo último que sí se leyó en
 * vez de declarar libre un asiento que no lo está.
 */

const setResolver = jest.fn();
/** Lo registrado, guardado aparte: `mockClear()` borra las llamadas, no esto. */
const mockRegistered: { fn?: (a: string) => boolean | 'unknown' | Promise<boolean | 'unknown'>; opts?: { ready?: () => boolean } } = {};
jest.mock('../../../connectors/protocols/flare/FlareDirectMintService', () => ({
  setOperationalAccountResolver: (fn: (a: string) => boolean | 'unknown' | Promise<boolean | 'unknown'>, opts?: { ready?: () => boolean }) => {
    mockRegistered.fn = fn;
    mockRegistered.opts = opts;
    setResolver(fn, opts);
  },
}));

import * as Store from '../DemoExchangeStore';
import {
  DECLARED_OMNIBUS_STALE_MS,
  _resetDeclaredOmnibusForTests,
  declaredOmnibusReadState,
  declaredOmnibusResolverInstalled,
  declaredRunOmnibusAccounts,
  declaredRunOmnibusForBuilder,
  declaredRunOmnibusVerdict,
  isDeclaredRunOmnibus,
  registerRunOmnibusOperationalResolver,
  rememberDeclaredOmnibus,
  resyncDeclaredOmnibus,
} from '../operationalOmnibus';

const { __resetDemoExchangeMemoryForTests, saveRun } = Store;

const OMNIBUS = 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7';
const STRANGER = 'rK4tsuGhmbhaNQuvucL8n1RKLtARBCp3qm';
const T0 = new Date(0).toISOString();

function run(runId: string, omnibusAddress: string): Store.DemoRun {
  return {
    runId,
    seq: Number(runId.replace(/\D/g, '')) || 1,
    label: runId,
    councilAddress: 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG',
    omnibusAddress,
    policy: 'A',
    createdAt: T0,
    status: 'open',
    clients: [],
    receipts: [],
    appliedTxHashes: [],
  };
}

const SAVED_DB = process.env.DATABASE_URL;
beforeAll(() => { delete process.env.DATABASE_URL; });
afterAll(() => { if (SAVED_DB === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = SAVED_DB; });
beforeEach(async () => {
  __resetDemoExchangeMemoryForTests();
  _resetDeclaredOmnibusForTests();
  setResolver.mockClear();
  await saveRun(run('run1', OMNIBUS));
});
afterEach(() => jest.restoreAllMocks());

describe('the declaration reaches the 0xFE builder', () => {
  it('registers an async predicate that answers for a declared omnibus and not for a stranger', async () => {
    await registerRunOmnibusOperationalResolver();
    expect(declaredOmnibusResolverInstalled()).toBe('yes');
    expect(setResolver).toHaveBeenCalledTimes(1);
    const resolver = setResolver.mock.calls[0][0] as (a: string) => Promise<boolean>;
    expect(await resolver(OMNIBUS)).toBe(true);
    expect(await resolver(STRANGER)).toBe(false);
    // El extraño sigue fuera aunque la run exista: la lista es de omnibus
    // declarados, no una puerta abierta a cualquier r-address del mundo.
    expect(await resolver('')).toBe(false);
  });

  it('registering again never installs a second resolver (the router may be imported more than once)', async () => {
    // El primer test ya instaló: desde aquí, cada llamada es un no-op.
    setResolver.mockClear();
    await registerRunOmnibusOperationalResolver();
    await registerRunOmnibusOperationalResolver();
    expect(setResolver).not.toHaveBeenCalled();
    expect(declaredOmnibusResolverInstalled()).toBe('yes');
  });
});

describe('a run created a moment ago is covered a moment ago', () => {
  it('rememberDeclaredOmnibus closes the window between saveRun and the next snapshot', async () => {
    // Snapshot leído: solo run1.
    expect(await isDeclaredRunOmnibus(STRANGER)).toBe(false);
    // Una run nueva, declarada en el mismo tick que se guarda.
    await saveRun(run('run2', STRANGER));
    rememberDeclaredOmnibus(STRANGER);
    expect(await isDeclaredRunOmnibus(STRANGER)).toBe(true);
    expect(await declaredRunOmnibusAccounts()).toEqual(new Set([OMNIBUS, STRANGER]));
  });
});

describe('it. 19 (R1 1.4) — «nunca leí las runs» no es «no es un omnibus»', () => {
  it('con el primer listRuns caído, el veredicto es «unknown» y el asiento NO se regala', async () => {
    _resetDeclaredOmnibusForTests();
    const spy = jest.spyOn(Store, 'listRuns').mockRejectedValue(new Error('pooler down'));

    expect(declaredOmnibusReadState()).toBe('never');
    // Distinguible: no es «no», es «no lo sé».
    expect(await declaredRunOmnibusVerdict(OMNIBUS)).toBe('unknown');
    expect(await declaredRunOmnibusVerdict(STRANGER)).toBe('unknown');
    // Y eso es literalmente lo que recibe el constructor: JAMÁS un `false`, que
    // es lo que regalaba el asiento del omnibus a cualquier sesión.
    expect(await declaredRunOmnibusForBuilder(OMNIBUS)).toBe('unknown');
    expect(await declaredRunOmnibusForBuilder(STRANGER)).toBe('unknown');
    // Una cadena vacía no es una cuenta: no hay nada que dudar.
    expect(await declaredRunOmnibusForBuilder('')).toBe(false);
    expect(spy).toHaveBeenCalled();

    // En cuanto hay UNA lectura buena, «no» vuelve a poder decirse.
    spy.mockRestore();
    expect(await declaredRunOmnibusVerdict(STRANGER)).toBe('no');
    expect(await declaredRunOmnibusForBuilder(STRANGER)).toBe(false);
    expect(await isDeclaredRunOmnibus(STRANGER)).toBe(false);
    expect(declaredOmnibusReadState()).toBe('fresh');
  });

  it('el constructor recibe el TRIESTADO y el hook `ready`, no un booleano a secas', async () => {
    // La instalación se memoiza (ocurrió en el primer describe): se lee la que
    // se hizo, no una nueva.
    await registerRunOmnibusOperationalResolver();
    expect(typeof mockRegistered.fn).toBe('function');
    expect(typeof mockRegistered.opts?.ready).toBe('function');
    _resetDeclaredOmnibusForTests();
    // `ready` es «¿llegué a leer alguna vez?» — con el proceso recién reiniciado, no.
    expect(mockRegistered.opts!.ready!()).toBe(false);
    const resolver = mockRegistered.fn as (a: string) => Promise<boolean | 'unknown'>;
    const spy = jest.spyOn(Store, 'listRuns').mockRejectedValue(new Error('pooler down'));
    // Lo que el constructor recibe durante el apagón: «no lo sé», jamás `false`.
    expect(await resolver(OMNIBUS)).toBe('unknown');
    spy.mockRestore();
    expect(await resolver(OMNIBUS)).toBe(true);
    expect(mockRegistered.opts!.ready!()).toBe(true);
  });

  it('un snapshot demasiado viejo que no se puede refrescar deja de contestar «no»', async () => {
    expect(await declaredRunOmnibusVerdict(STRANGER)).toBe('no');
    const spy = jest.spyOn(Store, 'listRuns').mockRejectedValue(new Error('pooler down'));
    const muchLater = Date.now() + DECLARED_OMNIBUS_STALE_MS + 60_000;
    expect(declaredOmnibusReadState(muchLater)).toBe('stale');
    expect(await declaredRunOmnibusVerdict(STRANGER, muchLater)).toBe('unknown');
    // Lo que SÍ sabíamos no se olvida por una lectura fallida.
    expect(await declaredRunOmnibusVerdict(OMNIBUS, muchLater)).toBe('yes');
    spy.mockRestore();
  });

  it('la instalación del resolver CALIENTA la primera lectura (la ventana de «unknown» dura el arranque)', async () => {
    _resetDeclaredOmnibusForTests();
    expect(declaredOmnibusReadState()).toBe('never');
    await registerRunOmnibusOperationalResolver();
    expect(declaredOmnibusReadState()).toBe('fresh');
  });
});

describe('it. 19 (3.5) — el conjunto operativo OLVIDA una run retirada', () => {
  it('la cuenta de una run borrada deja de ser operativa; la de una run que sigue existiendo, jamás', async () => {
    await saveRun(run('run2', STRANGER));
    rememberDeclaredOmnibus(STRANGER);
    expect(await isDeclaredRunOmnibus(STRANGER)).toBe(true);

    // La run se retira: su omnibus ya no es de nadie.
    await Store.deleteRun('run2');
    await resyncDeclaredOmnibus();
    expect(await declaredRunOmnibusVerdict(STRANGER)).toBe('no');
    // …y el de la run que sigue viva no se toca ni por un instante.
    expect(await declaredRunOmnibusVerdict(OMNIBUS)).toBe('yes');
  });

  it('una cuenta registrada DURANTE la lectura no se poda (su run puede no estar en ese snapshot)', async () => {
    // Registrada con una marca de tiempo futura: la lectura que ya empezó no
    // pudo verla, así que la poda no puede retirarla.
    rememberDeclaredOmnibus(STRANGER, Date.now() + 60_000);
    await resyncDeclaredOmnibus();
    expect(await declaredRunOmnibusVerdict(STRANGER)).toBe('yes');
  });
});

describe('«no pude leer» nunca declara libre un asiento', () => {
  it('keeps the last snapshot it actually read when the store throws, and retries next time', async () => {
    expect(await isDeclaredRunOmnibus(OMNIBUS)).toBe(true);
    const spy = jest.spyOn(Store, 'listRuns').mockRejectedValue(new Error('pooler down'));
    // Pasado el TTL, la lectura falla: se conserva lo último bueno.
    const later = Date.now() + 60_000;
    expect(await declaredRunOmnibusAccounts(later)).toEqual(new Set([OMNIBUS]));
    expect(spy).toHaveBeenCalled();
    // …y no se sella la marca de tiempo: la siguiente consulta vuelve a intentarlo.
    spy.mockRestore();
    await saveRun(run('run3', STRANGER));
    expect(await declaredRunOmnibusAccounts(later + 1)).toEqual(new Set([OMNIBUS, STRANGER]));
  });
});
