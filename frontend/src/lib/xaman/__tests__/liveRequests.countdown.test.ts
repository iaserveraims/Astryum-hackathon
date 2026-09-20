import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  __resetLiveRequests,
  __setLiveRequestsDeps,
  listLiveNotices,
  liveNoticeCountdown,
  pushLiveNotice,
} from '../liveRequests';

/**
 * productizer it. 21 (it. 20 §3.4) — LA CUENTA ATRÁS NO CONTABA.
 *
 * `pushLiveNotice` no caducaba y el banner imprimía los `secondsLeft` del
 * servidor VERBATIM mientras el aviso viviera: «se libera en 287 segundos»
 * cinco minutos después de que el asiento se hubiera liberado solo. Un número
 * que no se mueve es peor que ninguno — es una promesa que la persona ve
 * pudrirse, y la manda a esperar algo que ya ocurrió.
 *
 * La medición se convierte en un INSTANTE al empujar el aviso, y el banner
 * deriva lo que queda del reloj. Al llegar a cero no imprime 0: cambia de frase
 * (y sin prometer que preparar otra vez gana la carrera — it. 20 §3.9).
 */

const FRONTEND_SRC = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(FRONTEND_SRC, rel), 'utf8');

const T0 = 1_700_000_000_000;

beforeEach(() => {
  __setLiveRequestsDeps({ now: () => T0 });
});

afterEach(() => {
  __resetLiveRequests();
});

describe('liveNoticeCountdown — el reloj, no el número congelado', () => {
  it('la medición del servidor se guarda como instante', () => {
    const n = pushLiveNotice({ kind: 'seat-release-refused', detail: 'x', memoHex: 'FE01', freesInSeconds: 300 });
    expect(n.freesAt).toBe(T0 + 300_000);
  });

  it('decrece con el reloj', () => {
    const n = pushLiveNotice({ kind: 'seat-release-refused', detail: 'x', freesInSeconds: 300 });
    expect(liveNoticeCountdown(n, T0).secondsLeft).toBe(300);
    expect(liveNoticeCountdown(n, T0 + 60_000).secondsLeft).toBe(240);
    expect(liveNoticeCountdown(n, T0 + 299_000).secondsLeft).toBe(1);
  });

  it('al pasar la ventana no imprime 0: queda marcado como caducado', () => {
    const n = pushLiveNotice({ kind: 'seat-release-refused', detail: 'x', freesInSeconds: 300 });
    const c = liveNoticeCountdown(n, T0 + 300_001);
    expect(c.expired).toBe(true);
    expect(c.secondsLeft).toBe(0);
  });

  it('la constante del cliente también cuenta — «unos 5 minutos» tampoco puede congelarse', () => {
    const n = pushLiveNotice({ kind: 'seat-release-refused', detail: 'x', freesInMinutes: 5 });
    expect(n.freesAt).toBe(T0 + 300_000);
    expect(liveNoticeCountdown(n, T0 + 120_000).secondsLeft).toBe(180);
  });

  it('sin medición no se inventa una ventana: ni cuenta ni caduca', () => {
    const n = pushLiveNotice({ kind: 'seat-release-refused', detail: 'x' });
    expect(n.freesAt).toBeUndefined();
    const c = liveNoticeCountdown(n, T0 + 10_000_000);
    expect(c.secondsLeft).toBeNull();
    expect(c.expired).toBe(false);
  });

  it('el aviso sigue siendo descartable a mano: caducar no es borrarlo a espaldas', () => {
    pushLiveNotice({ kind: 'seat-release-refused', detail: 'x', freesInSeconds: 1 });
    expect(listLiveNotices()).toHaveLength(1);
  });
});

describe('el cable: el banner lee el reloj', () => {
  const src = read('components/xrpl/LiveXamanRequests.tsx');

  it('LiveXamanRequests tiquea y deriva, en vez de imprimir el número guardado', () => {
    expect(src).toContain('liveNoticeCountdown(n, now)');
    expect(src).toContain('setInterval(() => setNow(Date.now()), 1000)');
    // El número congelado ya no se pinta.
    expect(src).not.toContain('{n.freesInSeconds}');
  });

  it('a cero cambia de frase, y esa frase no promete ganar la carrera', () => {
    expect(src).toContain('expired');
    const flip = 'Its signing window has passed, so the seat should be free now';
    expect(src).toContain(flip);
    const i = src.indexOf(flip);
    expect(src.slice(i, i + 400)).toContain('not reserved for you');
  });
});
