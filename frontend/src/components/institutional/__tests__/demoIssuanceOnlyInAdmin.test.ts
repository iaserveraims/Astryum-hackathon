import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * La emisión de credenciales de DEMO vive SOLO en la consola admin · tripwire.
 *
 * Y «hay que reubicar los issuing de credentials demo
 * en la consola admin».
 *
 * El backend ya lo exige (`requireAdmin` en POST notary/issue-aifm-demo). Este
 * test vigila la otra mitad: que la interfaz no vuelva a ENSEÑAR esa puerta en
 * una mesa del producto. Tenía cuatro entradas —dos botones «sin link» y dos
 * paste-link en el alta del exchange, el paste-link del AIFM en la mesa del
 * gestor, y la casilla «el servidor firma» de la ceremonia— y ninguna llevaba
 * puerta de fundadores. Lee el fuente, como ui/__tests__/previewOnly.test.ts.
 */

const SRC = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const rel = (p: string) => relative(SRC, p).split(sep).join('/');

describe('emisión de demo · quién la puede llamar', () => {
  it('solo la ceremonia (con permiso del caller) y el componente desmontado tocan el endpoint de demo', () => {
    const callers = walk(SRC)
      .filter((p) => /requestNotaryAifmDemo\(/.test(readFileSync(p, 'utf8')))
      .map(rel)
      .sort();
    expect(callers).toEqual([
      'components/institutional/CredentialCeremonyModal.tsx',
      // Desmontado; se queda en el repo, inerte (ver su cabecera).
      'components/managed/LicenseRegisterLink.tsx',
      'lib/xrpl/credentialsApi.ts',
    ]);
  });

  it('el paste-link de rodaje no está montado en ninguna pantalla', () => {
    const mounts = walk(SRC).filter((p) => /<LicenseRegisterLink\b/.test(readFileSync(p, 'utf8'))).map(rel);
    expect(mounts).toEqual([]);
  });

  it('el alta del exchange y la mesa del gestor no llevan botones de demo', () => {
    for (const f of ['components/demo-exchange/stage/ExchangeSetupWizard.tsx', 'components/managed/ManagerTitleStation.tsx']) {
      const src = read(f);
      expect(src, f).not.toContain('requestNotaryAifmDemo');
      expect(src, f).not.toContain('without a link (demo)');
      expect(src, f).not.toMatch(/function issueDemo\b/);
    }
  });
});

describe('la ceremonia · el modo demo es un permiso del caller', () => {
  const modal = read('components/institutional/CredentialCeremonyModal.tsx');

  it('por defecto no se permite, y sin permiso la casilla ni se pinta ni cuenta', () => {
    expect(modal).toContain('allowDemoServerIssue = false,');
    expect(modal).toContain('const demoServerIssue = allowDemoServerIssue && demoChecked;');
    expect(modal).toContain('{allowDemoServerIssue && DEMO_LICENSE_TYPES.includes(credType.trim().toUpperCase()) ? (');
  });

  it('solo la consola admin concede ese permiso', () => {
    const granting = walk(SRC)
      .filter((p) => /<CredentialCeremonyModal\b[\s\S]{0,400}?\ballowDemoServerIssue\b/.test(readFileSync(p, 'utf8')))
      .map(rel);
    expect(granting).toEqual(['app/app/admin/page.tsx']);
  });
});

describe('las dos mesas · puerta de página', () => {
  it('la mesa del operador del exchange va entera tras PreviewOnly', () => {
    const src = read('app/app/exchange/operator/page.tsx');
    expect(src).toMatch(/<PreviewOnly[\s\S]{0,300}?<OperatorRoom \/>\s*<\/PreviewOnly>/);
    expect(src).toContain('function OperatorRoom() {');
  });

  it('la mesa del gestor decide la PÁGINA con MANAGER_DESK_OPEN, no solo la fila del menú', () => {
    const src = read('app/app/manager/page.tsx');
    expect(src).toContain('if (MANAGER_DESK_OPEN) return <ManagerRoom />;');
    expect(src).toMatch(/<PreviewOnly[\s\S]{0,300}?<ManagerRoom \/>\s*<\/PreviewOnly>/);
  });

  it('la nota de «solo fundadores» espera al veredicto del servidor', () => {
    for (const f of ['app/app/exchange/operator/page.tsx', 'app/app/manager/page.tsx']) {
      expect(read(f), f).toContain('{meAnswered && !isAdmin ? (');
    }
  });
});
