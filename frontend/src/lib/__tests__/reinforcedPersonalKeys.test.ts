/**
 * reinforcedPersonalKeys — quién sigue siendo una wallet personal después de
 * ponerle un quórum.
 *
 * EL FALLO QUE CIERRA (fundador, 21-ago-2026). La pantalla de Wallets daba por
 * consejo a CUALQUIER dirección con SignerList y la sacaba de la lista. Como
 * una cuenta personal reforzada también tiene SignerList, terminar la ceremonia
 * hacía DESAPARECER la wallet justo de la pantalla donde la función promete
 * que se queda — y reaparecer como un Legacy.
 *
 * La regla: el ledger dice si hay quórum; el DUEÑO dice de qué lado vive. Y
 * `hardenedQuorum` sólo existe cuando hubo lectura real del ledger, así que una
 * marca sin SignerList no pinta nada (familia «éxito no ganado»).
 */

import { describe, expect, it } from 'vitest';
import { reinforcedPersonalKeys } from '../authority/personalQuorum';
import type { Authority } from '../authority';

const A = 'rNaFfVgbqWYotrR3Jz4RorirDUZgLfxhXt';
const B = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';

function single(address: string, hardenedQuorum?: Record<string, unknown>): Authority {
  return {
    id: `wallet:${address}`,
    kind: 'single',
    wallet: { id: address, address, ecosystem: 'xrpl', isActive: true },
    ...(hardenedQuorum ? { hardenedQuorum } : {}),
  } as Authority;
}

function governed(address: string): Authority {
  return { id: `governed:${address}`, kind: 'governed', address, hasCouncil: true } as Authority;
}

describe('reinforcedPersonalKeys', () => {
  it('incluye una wallet personal cuyo quórum confirmó el ledger', () => {
    const keys = reinforcedPersonalKeys([single(A, { hasCouncil: true, quorum: 2, memberCount: 3 })]);
    expect(keys.has(A)).toBe(true);
  });

  it('NO incluye una wallet sin quórum — no hay nada que reforzar todavía', () => {
    expect(reinforcedPersonalKeys([single(A)]).size).toBe(0);
  });

  it('NO incluye una lectura de ledger que dice que NO hay consejo', () => {
    // El caso «éxito no ganado»: la marca existe, la SignerList no.
    const keys = reinforcedPersonalKeys([single(A, { hasCouncil: false })]);
    expect(keys.size).toBe(0);
  });

  it('NO incluye una lectura todavía en vuelo', () => {
    const keys = reinforcedPersonalKeys([single(A, { loading: true })]);
    expect(keys.size).toBe(0);
  });

  it('NO incluye un Legacy: un consejo de personas no es una wallet personal', () => {
    expect(reinforcedPersonalKeys([governed(B)]).size).toBe(0);
  });

  it('separa las dos cosas cuando conviven', () => {
    const keys = reinforcedPersonalKeys([single(A, { hasCouncil: true }), governed(B)]);
    expect([...keys]).toEqual([A]);
  });

  it('sin autoridades devuelve un conjunto vacío, nunca undefined', () => {
    expect(reinforcedPersonalKeys([])).toEqual(new Set());
  });
});
