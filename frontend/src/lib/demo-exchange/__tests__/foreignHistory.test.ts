/**
 * LA JAULA DE ESTA VIDA NO ES DE OTRA.
 *
 * La
 * regla era `jaula && !mesa`, y la jaula nace en la estación 4, antes que la
 * mesa (7): toda alta legítima caía en ella entre medias.
 *
 * Y sigue en pie: la raíz del gestor elegida como raíz del exchange
 * (jaula de antes, sin mesa y sin nada que la ate a esta alta) se avisa.
 *
 * Más abajo, la estación 7 deja de pintar el código `NOT_AN_ADMIN` y dice el
 * paso que la resuelve.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isForeignHistory } from '../foreignHistory';
import { adminDoorStep, describeRefusal } from '../api';

const t = (s: string) => s;

describe('isForeignHistory', () => {
  it('Una jaula que ya estaba, sin mesa y sin nada que la ate a esta alta, es de otra vida', () => {
    expect(isForeignHistory({ cage: true, existing: false, local: {}, appointed: false })).toBe(true);
  });

  it('La jaula nacida en esta alta no lo es — esta alta vio la raíz sin jaula', () => {
    expect(isForeignHistory({ cage: true, existing: false, local: { virginSeen: true }, appointed: false })).toBe(false);
  });

  it('ni si esta alta vio firmar su nacimiento', () => {
    expect(isForeignHistory({ cage: true, existing: false, local: { cageBornHere: true }, appointed: false })).toBe(false);
  });

  it('en otro dispositivo (sin memoria local) la designación del omnibus, leída del ledger, basta', () => {
    expect(isForeignHistory({ cage: true, existing: false, local: {}, appointed: true })).toBe(false);
  });

  it('sin jaula, o con la mesa ya creada, nunca hay historia ajena', () => {
    expect(isForeignHistory({ cage: false, existing: false, local: {}, appointed: false })).toBe(false);
    expect(isForeignHistory({ cage: true, existing: true, local: {}, appointed: false })).toBe(false);
  });
});

describe('el wizard usa la regla, también al aterrizar', () => {
  const WIZARD = readFileSync(join(__dirname, '..', '..', '..', 'components', 'demo-exchange', 'stage', 'ExchangeSetupWizard.tsx'), 'utf8');

  it('ya no decide con `jaula && !mesa` a secas', () => {
    expect(WIZARD).not.toMatch(/Boolean\(cage\) && !existing/);
    expect(WIZARD).not.toMatch(/r\.cage && !existing/);
    expect(WIZARD.match(/isForeignHistory\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('recuerda la raíz sin jaula y el nacimiento que vio', () => {
    expect(WIZARD).toContain('virginSeen: true');
    expect(WIZARD).toContain('cageBornHere: true');
  });
});

describe('la puerta de operador en la estación 7', () => {
  it.each(['NOT_AN_ADMIN', 'ADMIN_KEY_REQUIRED', 'ADMIN_SESSION_EXPIRED'])('%s se dice en frase, jamás el código', (error) => {
    const text = describeRefusal({ status: 403, error }, t);
    expect(text).not.toBe(error);
    expect(text).toMatch(/Nothing was changed\.$/);
  });

  it('NOT_AN_ADMIN lleva el paso: la llave del panel en esta pestaña', () => {
    const step = adminDoorStep({ error: 'NOT_AN_ADMIN' }, t);
    expect(step).toMatch(/panel key/);
    expect(step).toMatch(/same tab/);
  });

  it('y JAMÁS manda a entrar con Google/Apple: sobre una cuenta de contraseña sin verificar eso es una toma de posesión que pone su historia en cuarentena', () => {
    for (const error of ['NOT_AN_ADMIN', 'ADMIN_KEY_REQUIRED', 'ADMIN_SESSION_EXPIRED']) {
      const step = adminDoorStep({ error }, t) ?? '';
      expect(step).not.toMatch(/Google|Apple/);
    }
  });

  it('una negativa que no es de la puerta no inventa ese paso', () => {
    expect(adminDoorStep({ error: 'OMNIBUS_IS_THE_COUNCIL' }, t)).toBeNull();
    expect(adminDoorStep(null, t)).toBeNull();
  });
});
