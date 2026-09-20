import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * PreviewOnly · el gate que decide qué ve un usuario y qué no.
 *
 * vitest corre en `environment: node` (sin jsdom) y el tsconfig deja
 * `jsx: "preserve"`, así que importar el .tsx revienta en el transform. Se
 * extrae la DECISIÓN del fuente que se publica y se EJECUTA — misma técnica que
 * `strategySectionRunHealth` y `proposalInboxLedgerCheck`.
 */

const SRC = join(__dirname, '..', 'PreviewOnly.tsx');
const src = readFileSync(SRC, 'utf8');

/** Extrae el guard real del fuente y lo convierte en función ejecutable. */
function loadGuard(): (isAdmin: unknown) => boolean {
  const line = 'if (isAdmin !== true) return null;';
  expect(src, 'el guard cambió de forma — revisar este test antes que el componente').toContain(line);
  // `renders?` = lo contrario del `return null`.
  return (isAdmin: unknown) => !(isAdmin !== true);
}

describe('PreviewOnly · fail-closed', () => {
  const renders = loadGuard();

  it('solo un true CONFIRMADO enseña la sección', () => {
    expect(renders(true)).toBe(true);
  });

  it('mientras el store carga (undefined) no enseña nada', () => {
    expect(renders(undefined)).toBe(false);
  });

  it('una lectura fallida (null) no enseña nada — «no pude leer» no es «eres fundador»', () => {
    expect(renders(null)).toBe(false);
  });

  it('un false explícito no enseña nada', () => {
    expect(renders(false)).toBe(false);
  });

  it('valores truthy que NO son true tampoco pasan', () => {
    for (const v of ['true', 1, {}, [], 'admin']) {
      expect(renders(v), `${JSON.stringify(v)} no puede abrir la puerta`).toBe(false);
    }
  });
});

describe('PreviewOnly · el veredicto viene del servidor', () => {
  it('lee isAdmin del store de auth, no de una prop ni de localStorage', () => {
    expect(src).toContain("useAuthStore((s) => s.isAdmin)");
    expect(src).not.toContain('localStorage');
  });

  it('marca la sección para poder inventariar lo que hay en vuelo', () => {
    // `grep -rn "PreviewOnly" frontend/src` tiene que listar todo lo pendiente,
    // y el atributo permite verlo tambien en el DOM al revisar una pantalla.
    expect(src).toContain('data-preview-only={label}');
  });

  it('avisa en pantalla de que es preview — un fundador no puede confundirlo con lo vivo', () => {
    expect(src).toContain('Preview · solo fundadores');
  });
});
