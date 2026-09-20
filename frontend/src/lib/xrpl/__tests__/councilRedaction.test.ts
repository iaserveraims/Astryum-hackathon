import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { councilRedactionSentence, readCouncilRedaction } from '../councilSigning';

/**
 * LA REDACCIÓN SE PRESENTABA COMO UN HECHO.
 *
 * Sirve al cosignatario solo REGISTRADO el material de firma entero
 * y nada de la deliberación: `title: null`, `positions: []`, con `access` y
 * `redacted` dichos en la respuesta. El frontend no leía ninguno de los dos
 * campos (grep: cero), así que al cosignatario se le pintaba «nadie ha fijado
 * posición» y se le ofrecía fijar la suya — una firma que da en su wallet y que
 * el servidor rechaza, porque el mismo suelo cierra esa puerta.
 */

const t = (s: string) => s;
const read = (rel: string) => readFileSync(join(process.cwd(), 'src', rel), 'utf8');

describe('readCouncilRedaction — qué se ocultó', () => {
  it('una lectura completa no oculta nada', () => {
    expect(readCouncilRedaction({ access: 'proven' })).toEqual({
      redacted: false,
      positionsHidden: false,
      titleHidden: false,
    });
    expect(readCouncilRedaction(null).redacted).toBe(false);
    expect(readCouncilRedaction({}).redacted).toBe(false);
  });

  it('`redacted` nombra los campos, y se leen', () => {
    const r = readCouncilRedaction({ access: 'registered', redacted: ['title', 'positions'] });
    expect(r).toEqual({ redacted: true, positionsHidden: true, titleHidden: true });
  });

  it('`access: registered` basta aunque la lista no haya llegado: el silencio no es «completo»', () => {
    const r = readCouncilRedaction({ access: 'registered' });
    expect(r.redacted).toBe(true);
    expect(r.positionsHidden).toBe(true);
  });

  it('basura en `redacted` no inventa nada', () => {
    expect(readCouncilRedaction({ access: 'proven', redacted: [1, null] }).redacted).toBe(false);
  });
});

describe('la frase: se dice qué se ocultó y por qué, sin tocar la firma', () => {
  const said = councilRedactionSentence(readCouncilRedaction({ access: 'registered', redacted: ['title', 'positions'] }), t) ?? '';

  it('no se lee como «no eres miembro» — lo es, por eso tiene los bytes', () => {
    expect(said).toContain('not a verdict about you');
    expect(said).toContain('recognises this address as one of the signers');
  });

  it('dice que el material de firma sigue entero: esto jamás es una puerta a la salida', () => {
    expect(said).toContain('Everything you need in order to sign is here and unchanged');
  });

  it('y dice la cura exacta', () => {
    expect(said).toContain('bind it with a signature');
  });

  it('sin redacción, no hay frase', () => {
    expect(councilRedactionSentence(readCouncilRedaction({ access: 'proven' }), t)).toBeNull();
  });
});

describe('el cable: las dos superficies lo leen', () => {
  // ESTE TEST CONSAGRABA EL FALLO. Exigía en el fuente la puerta
  // `&& !hidden`, que apagaba «Fix my position» para el cosignatario
  // REGISTRADO. El servidor nunca cerró esa puerta: `POST /:id/positions` no
  // tiene suelo de lectura, comprueba la SignerList, la coherencia del JSON
  // firmado y verifica el blob criptográficamente — y `redactActaForRegistered`
  // oculta `title` y `positions`, pero deja entero el material de firma
  // (txjson, signerList, quorum, blobs). Quitarle a alguien algo que funciona,
  // porque nosotros le escondemos la deliberación, es peor que nombrarle la
  // limitación: la firma que él puede dar es válida, y sin ella el quórum no
  // sale. Lo que sí se comprueba ahora es que la redacción se LEA y se DIGA.
  it('FormalPositions dice qué está redactado y NO apaga la firma que el servidor acepta', () => {
    const src = read('components/legacy/FormalPositions.tsx');
    expect(src).toContain('readCouncilRedaction(proposal)');
    expect(src).toContain('councilRedactionSentence(redaction, t)');
    expect(src).not.toContain('canFixPosition(proposal.status, seatUnresolved) && !hidden');
  });

  it('la bandeja no pinta la etiqueta genérica como si fuera el nombre que puso la familia', () => {
    const src = read('components/legacy/ProposalInbox.tsx');
    expect(src).toContain('readCouncilRedaction(p).titleHidden');
  });

  it('y el tipo declara los dos campos, o nadie podría leerlos', () => {
    const api = read('services/v1Api.ts');
    expect(api).toContain("access?: 'proven' | 'registered' | 'none' | 'unreadable'");
    expect(api).toContain('redacted?: string[]');
  });
});
