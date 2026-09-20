/**
 * Las dos vistas enseñan el MISMO catálogo — y una sección vacía se explica.
 *
 * Lo que estos tests protegen no es que el componente pinte: es que al
 * reagrupar no se pierda dinero de vista. «Por riesgo» reagrupa, no filtra; si
 * al cambiar de vista desaparece una ruta, hay capital escondido detrás de un
 * conmutador — y nadie lo notaría mirando la pantalla, porque lo que falta no
 * se ve.
 *
 * Y la otra mitad: con un asset elegido, la sección que se queda sin filas
 * tiene que decir POR QUÉ y adónde ir.
 */
import { describe, it, expect } from 'vitest';
import {
  assetOf,
  assetsOf,
  buildSections,
  groupByVenue,
  liveActions,
  shouldSummarise,
  shownCount,
} from '../catalogView';
import { ACTIONS } from '../protocols';
import type { VaultKind } from '@/components/earn/FlareDemoEarn';

const ALL: VaultKind[] = ['e1', 'e2', 'e3', 'v-firelight', 'v-earnxrp', 'v-monarq', 'em-carry', 'em-lend'];
/** El catálogo cuando el carril de Ethereum está apagado en runtime. */
const NO_ETH: VaultKind[] = ['e1', 'e2', 'e3', 'v-firelight', 'v-earnxrp', 'v-monarq'];

describe('solo se ofrece lo que se puede firmar', () => {
  it('con todo encendido, las ocho rutas', () => {
    expect(liveActions(ALL)).toHaveLength(8);
  });

  it('un flag apagado retira sus rutas de la pantalla', () => {
    const live = liveActions(NO_ETH);
    expect(live).toHaveLength(6);
    expect(live.some((a) => a.protocol === 'morpho')).toBe(false);
  });

  it('una acción sin ruta construida no se ofrece jamás', () => {
    // Hoy todas tienen `kind`; el día que se declare una sin ruta (leer sí,
    // firmar no), esta propiedad es la que impide que llegue a la pantalla.
    const live = liveActions(ALL);
    for (const a of live) expect(a.kind).not.toBeNull();
    expect(live.length).toBeLessThanOrEqual(ACTIONS.length);
  });
});

describe('las dos vistas cubren el mismo catálogo', () => {
  it('por tipo y por riesgo enseñan exactamente las mismas rutas', () => {
    const live = liveActions(ALL);
    const byType = buildSections('type', live, null).flatMap((s) => s.rows);
    const byRisk = buildSections('risk', live, null).flatMap((s) => s.rows);
    expect(byType).toHaveLength(8);
    expect(byRisk).toHaveLength(8);
    const key = (a: (typeof byType)[number]) => `${a.protocol}:${a.id}`;
    expect(new Set(byRisk.map(key))).toEqual(new Set(byType.map(key)));
  });

  it('ninguna ruta aparece dos veces dentro de una vista', () => {
    for (const view of ['type', 'risk'] as const) {
      const rows = buildSections(view, liveActions(ALL), null).flatMap((s) => s.rows);
      expect(new Set(rows.map((a) => `${a.protocol}:${a.id}`)).size).toBe(rows.length);
    }
  });

  it('el contador de la barra cuenta lo que hay en pantalla', () => {
    expect(shownCount(buildSections('type', liveActions(ALL), null))).toBe(8);
    expect(shownCount(buildSections('type', liveActions(ALL), 'FLR'))).toBe(1);
  });
});

describe('elegir un asset estrecha, y lo que queda fuera se explica', () => {
  const live = liveActions(ALL);

  it('con FXRP quedan las seis rutas de XRP', () => {
    const rows = buildSections('type', live, 'FXRP').flatMap((s) => s.rows);
    expect(rows).toHaveLength(6);
    for (const a of rows) expect(assetOf(a)).toBe('FXRP');
  });

  it('con FLR solo queda la delegación, y vive dentro de earn', () => {
    const earn = buildSections('type', live, 'FLR').find((s) => s.key === 'earn')!;
    expect(earn.rows).toHaveLength(1);
    expect(earn.rows[0].protocol).toBe('ftso');
  });

  it('con FLR, «saca efectivo» tampoco desaparece: apunta a FXRP', () => {
    const cash = buildSections('type', live, 'FLR').find((s) => s.key === 'cash')!;
    expect(cash.rows).toHaveLength(0);
    expect(cash.emptyReason).toEqual({ code: 'try-other-asset', asset: 'FXRP' });
  });

  it('sin asset elegido no hay secciones vacías que explicar', () => {
    for (const s of buildSections('type', live, null)) {
      expect(s.rows.length, `${s.key} no debería estar vacía sin filtro`).toBeGreaterThan(0);
      expect(s.emptyReason).toBeNull();
    }
  });

  it('un asset sin rutas apunta a los que sí las tienen, en vez de decir «nada»', () => {
    // No es alcanzable desde la barra (solo ofrece assets que llevan a algún
    // sitio), pero la respuesta correcta si llega es útil, no un callejón.
    for (const s of buildSections('type', live, 'DOGE')) {
      expect(s.rows).toHaveLength(0);
      expect(s.emptyReason).toMatchObject({ code: 'try-other-asset' });
    }
  });

  it('cuando de verdad no hay adónde ir, no se inventa una salida', () => {
    // Un catálogo con solo la delegación: «efectivo» no existe con ningún
    // asset, así que decir «prueba con X» sería mandar a una pantalla igual de
    // vacía.
    const only = liveActions(['e2']);
    const sections = buildSections('type', only, 'FLR');
    expect(sections.find((s) => s.key === 'earn')!.rows).toHaveLength(1);
    expect(sections.find((s) => s.key === 'cash')!.emptyReason).toEqual({ code: 'nothing' });
  });
});

describe('la barra ofrece los assets que llevan a algún sitio', () => {
  it('los tres firmables de hoy, en orden de catálogo', () => {
    expect(assetsOf(liveActions(ALL))).toEqual(['FXRP', 'RLUSD', 'FLR']);
  });

  it('si un carril se apaga, su asset desaparece de la barra', () => {
    // Sin el carril de Ethereum no hay ninguna ruta de RLUSD: ofrecer el chip
    // sería ofrecer un filtro que sólo lleva a pantallas vacías.
    expect(assetsOf(liveActions(NO_ETH))).toEqual(['FXRP', 'FLR']);
  });
});

describe('las tipologías sin producto no ocupan sitio todavía', () => {
  it('solo se dibujan las dos vivas', () => {
    const keys = buildSections('type', liveActions(ALL), null).map((s) => s.key);
    expect(keys).toEqual(['earn', 'cash']);
    // `fixed` y `liquidity` están declaradas para cuando Ēnosys y Spectra
    // tengan conector — un estante que aparece con producto, no un hueco.
    expect(keys).not.toContain('fixed');
    expect(keys).not.toContain('liquidity');
  });
});

describe('el resumen: una card por SITIO, no por estrategia', () => {
  const live = liveActions(ALL);

  it('sin asset elegido se resume; con asset elegido, no', () => {
    // Elegir un asset ya es estrechar: volver a resumir sería poner un clic de
    // más delante de lo que el usuario acaba de pedir.
    expect(shouldSummarise(null, false)).toBe(true);
    expect(shouldSummarise('FXRP', false)).toBe(false);
    expect(shouldSummarise(null, true)).toBe(false);
  });

  it('Upshift aparece UNA vez, con sus dos bóvedas dentro', () => {
    const earn = buildSections('type', live, null).find((s) => s.key === 'earn')!;
    const venues = groupByVenue(earn.rows);
    const upshift = venues.find((v) => v.venue === 'Upshift')!;
    expect(upshift.actions).toHaveLength(2);
    // El orden es el del catálogo, no una clasificación: Kinetic y Morpho van
    // primero porque sus dos patas abren la lista, no porque valgan más.
    expect(venues.map((v) => v.venue)).toEqual(['Kinetic', 'Morpho', 'Firelight', 'Upshift', 'FTSO']);
  });

  it('el resumen no pierde ni una estrategia', () => {
    for (const sec of buildSections('type', live, null)) {
      const total = groupByVenue(sec.rows).reduce((n, v) => n + v.actions.length, 0);
      expect(total).toBe(sec.rows.length);
    }
  });

  it('«saca efectivo» resume dos sitios, uno por venue', () => {
    const cash = buildSections('type', live, null).find((s) => s.key === 'cash')!;
    expect(groupByVenue(cash.rows).map((v) => v.venue)).toEqual(['Kinetic', 'Morpho']);
  });
});
