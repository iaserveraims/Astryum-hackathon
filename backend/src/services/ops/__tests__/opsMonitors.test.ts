/**
 * Las dos piezas que cierran los silencios de 3-ago: el latido de los agentes
 * que no publican salud y la ventana de 5xx de la API.
 *
 * Lo que se fija:
 *  · Un agente que solo late cuando acierta es indistinguible de uno muerto:
 *    el latido se registra SIEMPRE, con su bandera de fallo.
 *  · Solo se vigila a quien se anunció alguna vez (un carril apagado por flag
 *    no puede echarse de menos) — de ahí que el registro empiece vacío.
 *  · La ráfaga de 5xx se agrupa por RUTA normalizada: sin eso, mil URLs con
 *    hash distinto parecerían mil problemas distintos en vez de uno.
 *  · Nada de lo que se guarda identifica a nadie (#2).
 */

import {
  _resetAgentTicksForTests,
  agentTicks,
  markAgentTick,
} from '../agentHeartbeats';
import {
  _resetHttpErrorsForTests,
  httpErrorWindow,
  normalizeRoute,
  recordHttpError,
} from '../httpErrorMonitor';

const T0 = 1_700_000_000_000;

beforeEach(() => {
  _resetAgentTicksForTests();
  _resetHttpErrorsForTests();
});

describe('latido de los agentes', () => {
  it('empieza vacío: lo que nunca se anunció, no se vigila', () => {
    expect(agentTicks()).toEqual([]);
  });

  it('registra el latido también cuando el tick falla, y cuenta los fallos seguidos', () => {
    markAgentTick('automation', { title: 'Automatización', everyMs: 60_000, now: T0 });
    expect(agentTicks()[0]).toMatchObject({ ok: true, failures: 0 });

    markAgentTick('automation', { title: 'Automatización', everyMs: 60_000, ok: false, detail: 'boom', now: T0 + 1000 });
    markAgentTick('automation', { title: 'Automatización', everyMs: 60_000, ok: false, detail: 'boom', now: T0 + 2000 });
    expect(agentTicks()[0]).toMatchObject({ ok: false, failures: 2, detail: 'boom' });

    // Un tick bueno limpia la racha: el problema se cerró solo.
    markAgentTick('automation', { title: 'Automatización', everyMs: 60_000, now: T0 + 3000 });
    expect(agentTicks()[0]).toMatchObject({ ok: true, failures: 0 });
  });

  it('cada agente lleva su propia cadencia esperada', () => {
    markAgentTick('automation', { title: 'Automatización', everyMs: 60_000, now: T0 });
    markAgentTick('xrpl-watch', { title: 'Vigía XRPL', everyMs: 24 * 3_600_000, now: T0 });
    const byId = Object.fromEntries(agentTicks().map((a) => [a.id, a.everyMs]));
    expect(byId).toEqual({ automation: 60_000, 'xrpl-watch': 24 * 3_600_000 });
  });
});

describe('ventana de errores 5xx', () => {
  it('enmascara lo que identifica a alguien o a algo concreto', () => {
    expect(normalizeRoute('/api/wallets/mine/cm4x9k2p0000abcd1234efgh')).toBe('/api/wallets/mine/:id');
    expect(normalizeRoute('/api/flare-demo/tx/7BFC65AA11223344556677889900AABBCCDDEEFF00112233445566778899AABB'))
      .toBe('/api/flare-demo/tx/:hash');
    expect(normalizeRoute('/api/xrpl/rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH/balance')).toBe('/api/xrpl/:xrpl/balance');
    expect(normalizeRoute('/api/positions/42?full=1')).toBe('/api/positions/:n');
  });

  it('calla por debajo del umbral y agrupa la ráfaga por ruta', () => {
    for (let i = 0; i < 3; i++) recordHttpError('POST', `/api/flare-demo/prepare/${i}`, 500, T0 + i);
    recordHttpError('GET', '/api/portfolio', 503, T0 + 10);

    const w = httpErrorWindow(15 * 60_000, T0 + 60_000);
    expect(w.total).toBe(4);
    // Las tres del prepare son UN problema, no tres: misma ruta normalizada.
    expect(w.top[0]).toMatchObject({ method: 'POST', route: '/api/flare-demo/prepare/:n', count: 3 });
    expect(w.top[1]).toMatchObject({ route: '/api/portfolio', count: 1, lastStatus: 503 });
  });

  it('la ventana olvida lo viejo: una ráfaga de ayer no alarma hoy', () => {
    recordHttpError('GET', '/api/portfolio', 500, T0);
    expect(httpErrorWindow(15 * 60_000, T0 + 60_000).total).toBe(1);
    expect(httpErrorWindow(15 * 60_000, T0 + 20 * 60_000).total).toBe(0);
  });

  it('no crece sin límite ni con la API entera fallando', () => {
    for (let i = 0; i < 1_000; i++) recordHttpError('GET', '/api/x', 500, T0 + i);
    expect(httpErrorWindow(15 * 60_000, T0 + 1_000).total).toBeLessThanOrEqual(300);
  });
});
