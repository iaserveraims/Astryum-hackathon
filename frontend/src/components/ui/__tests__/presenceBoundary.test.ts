import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * LA FRONTERA DE PRESENCIA SOLO ACEPTA `motion.*` COMO HIJO DIRECTO.
 *
 * El fallo que este test impide volvió a aparecer el 2026-09-14 y costó una
 * reproducción en navegador (fundador: «cuando desaparece el popup se queda
 * la página sin poder usarse hasta que recargas»):
 *
 *   <AnimatePresence>{open && <LegalSignCeremony … />}</AnimatePresence>
 *
 * La ceremonia pinta un `fixed inset-0` y su animación de SALIDA corría —el
 * overlay llegaba a opacity 0— pero framer nunca lo desmontaba, porque quien
 * avisa de «ya he salido» es el hijo DIRECTO de la frontera, y un componente
 * normal no lo hace. El resultado: un overlay invisible con
 * pointer-events:auto comiéndose todos los clics hasta recargar. Un `key` NO
 * lo arregla (comprobado en navegador); lo que lo arregla es que el hijo sea
 * un `motion.*`, o no poner frontera y montar/desmontar a secas.
 *
 * Con `mode="wait"` el mismo defecto es aún más silencioso: el que entra
 * espera a que el anterior avise de que salió, y como no avisa nunca, la
 * pantalla se queda con el contenido viejo (el formulario de login no volvía).
 *
 * La regla ya estaba escrita en ui/ModalPortal.tsx desde hace meses. Escrita
 * no bastó — de ahí este test, que la comprueba.
 */

const SRC = join(__dirname, '..', '..', '..');

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.next') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) tsxFiles(p, out);
    else if (e.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/**
 * Cada `<AnimatePresence …>` con el primer elemento JSX que lo sigue.
 *
 * Dos precauciones que costaron un falso positivo cada una: los COMENTARIOS se
 * borran antes de buscar (media docena de ficheros explican este mismo defecto
 * citando `<AnimatePresence>` en prosa), y la búsqueda del hijo se corta en el
 * `</AnimatePresence>` que cierra (si no, la ventana se cuela en el componente
 * de al lado y acusa al inocente).
 */
function stripComments(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/[^\n]*$/gm, '');
}

function offenders(rawSource: string): Array<{ line: number; child: string }> {
  const source = stripComments(rawSource);
  const found: Array<{ line: number; child: string }> = [];
  const re = /<AnimatePresence[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const from = m.index + m[0].length;
    const close = source.indexOf('</AnimatePresence>', from);
    const inside = source.slice(from, close === -1 ? from + 600 : close);
    const el = inside.match(/<([A-Za-z][\w.]*)/);
    if (!el) continue;
    const child = el[1];
    if (child.startsWith('motion.') || child === 'AnimatePresence') continue;
    // Un elemento HTML normal (div, span…) tampoco avisa, pero sin animación
    // de salida no hay nada que esperar: framer lo quita en el acto.
    if (child[0] === child[0].toLowerCase()) continue;
    found.push({ line: source.slice(0, m.index).split('\n').length, child });
  }
  return found;
}

describe('AnimatePresence: el hijo directo tiene que ser motion.*', () => {
  it('ningún componente propio cuelga directamente de una frontera de presencia', () => {
    const bad: string[] = [];
    for (const file of tsxFiles(SRC)) {
      if (file.includes('__tests__')) continue;
      for (const o of offenders(readFileSync(file, 'utf8'))) {
        bad.push(`${file.slice(file.indexOf('src/'))}:${o.line} → <${o.child}>`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('el detector reconoce el patrón que congeló la página', () => {
    const frozen = `<AnimatePresence>\n  {open && (\n    <LegalSignCeremony lang="es" />\n  )}\n</AnimatePresence>`;
    expect(offenders(frozen).map((o) => o.child)).toEqual(['LegalSignCeremony']);
  });

  it('y no se queja de lo que sí es correcto', () => {
    expect(offenders(`<AnimatePresence>{open && <motion.div key="a" exit={{opacity:0}} />}</AnimatePresence>`)).toEqual([]);
    expect(offenders(`<AnimatePresence mode="wait">\n  {/* <Foo /> en un comentario no cuenta */}\n  <motion.span key="b" />\n</AnimatePresence>`)).toEqual([]);
    expect(offenders(`<AnimatePresence><div /></AnimatePresence>`)).toEqual([]);
  });
});
