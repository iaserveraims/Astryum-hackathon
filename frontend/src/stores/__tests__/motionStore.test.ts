import { describe, expect, it } from 'vitest';
import vm from 'node:vm';

/**
 * El nivel de movimiento (2026-09-10) — las reglas que sostienen el ajuste y
 * que nadie más vigila:
 *
 *   1. Hay TRES niveles y ningún «Sistema» (fundador: «no quiero que el
 *      selector tenga Sistema»). El dispositivo solo decide el PRIMER
 *      arranque: sin nada elegido, movimiento reducido → Mínimo; si no, lo de
 *      siempre.
 *   2. El script pre-pintado resuelve EXACTAMENTE igual que el store y
 *      sobrevive a un localStorage roto o ausente. Es JS en una cadena — el
 *      compilador no lo mira, así que se ejecuta aquí tal cual se inyecta.
 */

import {
  MOTION_ATTRIBUTE,
  MOTION_LEVELS,
  MOTION_STORAGE_KEY,
  defaultMotionLevel,
  framerReducedMotion,
  isMotionLevel,
} from '../../lib/motion/level';
import { motionPrepaintScript } from '../../lib/motion/prepaint';

describe('niveles', () => {
  it('son tres y ninguno es «system»', () => {
    expect(MOTION_LEVELS).toEqual(['full', 'calm', 'minimal']);
    expect(isMotionLevel('system')).toBe(false);
  });

  it('el primer arranque sigue al dispositivo — y solo el primer arranque', () => {
    expect(defaultMotionLevel(false)).toBe('full');
    expect(defaultMotionLevel(true)).toBe('minimal');
  });

  it('framer solo corta en minimal — en full y calm anima aunque el SO pida lo contrario', () => {
    expect(framerReducedMotion('minimal')).toBe('always');
    expect(framerReducedMotion('calm')).toBe('never');
    expect(framerReducedMotion('full')).toBe('never');
  });

  it('un valor desconocido no es un nivel', () => {
    for (const l of MOTION_LEVELS) expect(isMotionLevel(l)).toBe(true);
    expect(isMotionLevel('turbo')).toBe(false);
    expect(isMotionLevel(undefined)).toBe(false);
    expect(isMotionLevel(3)).toBe(false);
  });
});

/** Ejecuta el script inyectado contra un navegador de mentira. */
function runPrepaint(opts: { stored?: string | null; osReduced?: boolean; brokenStorage?: boolean }) {
  const attrs: Record<string, string> = {};
  const sandbox = {
    window: {
      localStorage: opts.brokenStorage
        ? {
            getItem() {
              throw new Error('SecurityError');
            },
          }
        : { getItem: (k: string) => (k === MOTION_STORAGE_KEY ? (opts.stored ?? null) : null) },
      matchMedia: (q: string) => ({ matches: q.includes('reduce') ? !!opts.osReduced : false }),
    },
    document: { documentElement: { setAttribute: (k: string, v: string) => void (attrs[k] = v) } },
  };
  vm.runInNewContext(motionPrepaintScript(), sandbox);
  return attrs[MOTION_ATTRIBUTE];
}

/** Lo que zustand/persist deja en localStorage. */
const persisted = (level: string) => JSON.stringify({ state: { level }, version: 0 });

describe('motionPrepaintScript', () => {
  it('sin nada guardado aplica la regla del primer arranque', () => {
    expect(runPrepaint({ stored: null, osReduced: false })).toBe(defaultMotionLevel(false));
    expect(runPrepaint({ stored: null, osReduced: true })).toBe(defaultMotionLevel(true));
  });

  it('con un nivel guardado lo estampa tal cual, diga lo que diga el SO', () => {
    for (const l of MOTION_LEVELS) {
      for (const os of [false, true]) {
        expect(runPrepaint({ stored: persisted(l), osReduced: os })).toBe(l);
      }
    }
  });

  it('un valor corrupto o inventado cae a la regla del primer arranque', () => {
    expect(runPrepaint({ stored: persisted('turbo'), osReduced: false })).toBe('full');
    expect(runPrepaint({ stored: persisted('system'), osReduced: true })).toBe('minimal');
    expect(runPrepaint({ stored: '{not json', osReduced: true })).toBe('minimal');
  });

  it('un localStorage que lanza no rompe la carga — y no estampa nada inventado', () => {
    expect(() => runPrepaint({ brokenStorage: true })).not.toThrow();
    expect(runPrepaint({ brokenStorage: true })).toBeUndefined();
  });
});
