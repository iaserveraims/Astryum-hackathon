/**
 * catalogView — cómo se agrupa el catálogo en pantalla, fuera del componente.
 *
 * Vive aquí y no dentro de `EarnCatalog.tsx` por una lección que este repo ya
 * ha reaprendido cuatro veces: la lógica pura enterrada en un `.tsx` es lógica
 * SIN RED. No es intesteable por naturaleza, lo es por vecindad — nadie monta
 * un árbol de React para comprobar que una sección vacía se explica en vez de
 * esconderse. Sacada a `lib/`, cuesta un test de tres líneas.
 *
 * Lo que decide este fichero, y que puede romperse en silencio:
 *
 *   · Qué rutas se ofrecen: SOLO las que tienen ruta construida y están vivas
 *     en el catálogo de runtime. Una acción sin `kind` no se enseña nunca.
 *   · Que las dos vistas cubran el MISMO catálogo entero. «Por riesgo» reagrupa,
 *     no filtra: si una ruta se cae al cambiar de vista, se ha escondido dinero.
 *   · Que una sección vacía diga POR QUÉ lo está y adónde ir — que es lo que
 *     convierte un hueco en información sobre la forma del catálogo.
 */

import {
  ACTIONS,
  PROTOCOLS,
  RISK_BANDS,
  TYPOLOGIES,
  riskBand,
  type ProductAction,
} from './protocols';
import type { VaultKind } from '@/components/earn/FlareDemoEarn';

export type CatalogView = 'type' | 'risk';

/** Por qué una sección no tiene nada que enseñar. `null` = sí tiene. */
export type EmptyReason =
  /** Con este asset no, pero con OTRO sí — y se dice cuál. */
  | { code: 'try-other-asset'; asset: string }
  /** No hay ruta en ninguna parte para lo elegido. */
  | { code: 'nothing' };

export interface CatalogSection {
  key: string;
  /** Claves i18n — el componente traduce, este fichero no sabe de idiomas. */
  titleKey: string;
  subKey: string;
  rows: ProductAction[];
  emptyReason: EmptyReason | null;
}

/** El asset con el que se entra a una ruta. */
export function assetOf(a: ProductAction): string {
  return a.assets[0] ?? '';
}

/**
 * Lo que el catálogo puede ofrecer AHORA: con ruta construida y encendida por
 * los flags de runtime. Leer es más ancho que firmar, y esta función es la que
 * dice qué se puede firmar.
 */
export function liveActions(catalogue: VaultKind[]): ProductAction[] {
  return ACTIONS.filter((a) => a.kind !== null && catalogue.includes(a.kind));
}

/** Los assets que llevan a algún sitio, en el orden del catálogo (nunca ordenados
 *  por «el mejor» — invariante #9). */
export function assetsOf(live: ProductAction[]): string[] {
  const seen: string[] = [];
  for (const a of live) {
    const s = assetOf(a);
    if (s && !seen.includes(s)) seen.push(s);
  }
  return seen;
}

/**
 * Las secciones de la pantalla. `asset === null` es «todo»; con un asset
 * elegido, una sección que se queda sin filas NO desaparece: devuelve su
 * motivo, y si la ruta existe con otro asset, lo nombra.
 */
export function buildSections(
  view: CatalogView,
  live: ProductAction[],
  asset: string | null,
): CatalogSection[] {
  const shown = asset ? live.filter((a) => assetOf(a) === asset) : live;

  if (view === 'risk') {
    return RISK_BANDS.map((b) => {
      const rows = shown.filter((a) => riskBand(a) === b.id);
      return {
        key: b.id,
        titleKey: b.title,
        subKey: b.sub,
        rows,
        emptyReason: rows.length === 0 ? { code: 'nothing' as const } : null,
      };
    });
  }

  return TYPOLOGIES.filter((ty) => ty.live).map((ty) => {
    const rows = shown.filter((a) => a.typology === ty.id);
    let emptyReason: EmptyReason | null = null;
    if (rows.length === 0) {
      // ¿Existe esta tipología con OTRO asset? Entonces el hueco no es «no hay»,
      // es «no con este» — y eso enseña la forma del catálogo.
      const other = asset ? live.find((a) => a.typology === ty.id && assetOf(a) !== asset) : undefined;
      emptyReason = other ? { code: 'try-other-asset', asset: assetOf(other) } : { code: 'nothing' };
    }
    return { key: ty.id, titleKey: ty.title, subKey: ty.sub, rows, emptyReason };
  });
}

/** Cuántas rutas se están enseñando — el contador de la barra. */
export function shownCount(sections: CatalogSection[]): number {
  return sections.reduce((n, s) => n + s.rows.length, 0);
}

/* ── Resumen por venue: una card por sitio, no por estrategia ────────────── */

/**
 * Un sitio donde el dinero puede trabajar, con las estrategias que ofrece allí.
 * Upshift no es «earnXRP y Monarq»: es Upshift con dos bóvedas dentro — y esa
 * distinción es lo que evita que la pantalla crezca a lo ancho cada vez que un
 * venue añade un producto.
 */
export interface VenueGroup {
  /** El nombre del sitio — «Upshift», no «earnXRP». */
  venue: string;
  actions: ProductAction[];
}

/** Agrupa por venue conservando el orden del catálogo (nunca por «el mejor»). */
export function groupByVenue(rows: ProductAction[]): VenueGroup[] {
  const out: VenueGroup[] = [];
  for (const a of rows) {
    const venue = PROTOCOLS[a.protocol].venue;
    const hit = out.find((g) => g.venue === venue);
    if (hit) hit.actions.push(a);
    else out.push({ venue, actions: [a] });
  }
  return out;
}

/**
 * ¿Se enseña el resumen o el detalle? (fundador, 23-ago).
 *
 * Sin asset elegido, una card por venue y una puerta «ver todas»: la pantalla
 * abre con pocos sitios en vez de con todas las estrategias a la vez. En cuanto
 * el usuario elige un asset ya ha estrechado él, así que resumir otra vez sería
 * ponerle un clic de más delante de lo que acaba de pedir.
 */
export function shouldSummarise(asset: string | null, expanded: boolean): boolean {
  return asset === null && !expanded;
}
