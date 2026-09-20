import { describe, expect, it } from 'vitest';
import { GOVERNORS, GOVERNOR_BY_ID, VENUE_PASS, isGovernorId } from '../governors';

/**
 * Los cuatro a los mandos, vigilados palabra a palabra.
 *
 * La landing por gobernador dice mucho con poco texto, y ese poco texto pasa
 * por delante de un revisor de grants y de un abogado. Lo que INVARIANTS #8 y
 * #9 prohíben en el copy («el agente decide», «recomendamos», «garantizado»,
 * cualquier tipo prometido) no puede depender de que alguien se acuerde: si
 * una de esas palabras entra en `governors.ts`, este test la saca.
 */
function everyString(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => everyString(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => everyString(x, out));
  return out;
}

const FORBIDDEN = [
  /el agente decide/i,
  /the agent decides/i,
  /recomend/i,
  /recommend/i,
  /garantiz/i,
  /guarantee/i,
  /licenciad/i,
  /regulad/i,
  /licensed/i,
  /regulated/i,
  /\bAPY\b/i,
  /\d+(\.\d+)?\s?%\s?(anual|APR|APY|al año|per year)/i,
];

describe('governors', () => {
  it('son exactamente cuatro, en este orden', () => {
    expect(GOVERNORS.map((g) => g.id)).toEqual(['self', 'business', 'exchange', 'agent']);
    expect(Object.keys(GOVERNOR_BY_ID)).toHaveLength(4);
    expect(isGovernorId('legacy')).toBe(false);
  });

  it('cada uno declara su ruta, su escena, su material y su aviso honesto', () => {
    for (const g of GOVERNORS) {
      expect(g.route.startsWith('/')).toBe(true);
      expect(g.scene.es.length).toBeGreaterThan(0);
      expect(g.notice.es.length).toBeGreaterThan(0);
      expect(g.notice.en.length).toBeGreaterThan(0);
      expect([1, 2, 3, 4]).toContain(g.sobriety);
      expect(g.console.cta.href).toBe(g.route);
    }
  });

  it('solo Autocustodia está en vivo; los demás lo dicen', () => {
    expect(GOVERNOR_BY_ID.self.readiness).toBe('live');
    expect(GOVERNOR_BY_ID.agent.readiness).toBe('prep');
    expect(GOVERNOR_BY_ID.agent.notice.es).toMatch(/no disponible/);
  });

  it('el copy no promete, no recomienda y no da discreción al agente', () => {
    const strings = [...everyString(GOVERNORS), ...everyString(VENUE_PASS)];
    for (const s of strings) {
      for (const re of FORBIDDEN) {
        expect(s, `«${s}» contiene ${re}`).not.toMatch(re);
      }
    }
  });

  it('el agente se describe como designado, acotado y revocable', () => {
    const agent = everyString(GOVERNOR_BY_ID.agent).join(' ');
    expect(agent).toMatch(/designa/i);
    expect(agent).toMatch(/revoc/i);
    expect(agent).toMatch(/contrato/i);
  });
});
