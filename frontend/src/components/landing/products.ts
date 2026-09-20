/**
 * LOS TRES MUNDOS DE LA LANDING.
 *
 * Hasta hoy la página tenía DOS productos y un conmutador que solo cambiaba el
 * tinte: Legacy era la misma página en índigo — mismo titular, mismo asteroide,
 * mismo sistema solar, mismas paradas (comprobado con capturas).
 * Desde aquí, cada producto es un MUNDO: su narrativa, su
 * escena, su material y sus animaciones.
 */

export type LandingProduct = 'personal' | 'legacy' | 'institutional';

/** Los dos que hoy recorre el viaje solar. Tipar el subconjunto evita que
 *  alguien pase 'institutional' a un componente que no lo sabe pintar. */
export type SolarProduct = 'personal' | 'legacy';

export interface ProductDef {
  id: LandingProduct;
  label: string;
  /** El token de color del producto (globals.css). Nunca un hex. */
  accent: string;
  ink: string;
  /** El aviso honesto bajo el conmutador, si lo hay. Un producto que todavía
   *  no está abierto LO DICE — es la regla que ya cumplía Legacy, y la que impide que una narrativa bonita se lea como una
   *  promesa de producto. */
  notice?: { es: string; en: string };
}

export const PRODUCTS: Record<LandingProduct, ProductDef> = {
  personal: {
    id: 'personal',
    label: 'Personal',
    accent: 'hsl(var(--product-personal))',
    ink: 'hsl(var(--product-personal-ink))',
  },
  legacy: {
    id: 'legacy',
    label: 'Legacy',
    accent: 'hsl(var(--product-legacy))',
    ink: 'hsl(var(--product-legacy-ink))',
    notice: {
      es: 'En validación en mainnet · abre pronto',
      en: 'Validating on mainnet · opening soon',
    },
  },
  institutional: {
    id: 'institutional',
    label: 'Institutional',
    accent: 'hsl(var(--product-institutional))',
    ink: 'hsl(var(--product-institutional-ink))',
    // LA LÍNEA MÁS IMPORTANTE DE ESTE FICHERO. El panel de revisión lo dijo
    // con todas las letras: la narrativa institucional enseña una mesa que
    // hoy no existe (el catálogo del pote está agotado). Enseñar el mundo
    // está bien; venderlo como producto abierto, no. El aviso dice dónde
    // estamos, y el interruptor de abajo decide si el segmento se ve.
    notice: {
      es: 'Para entidades · en preparación',
      en: 'For entities · in preparation',
    },
  },
};

/**
 * EL INTERRUPTOR DEL TERCER SEGMENTO — una CONSTANTE EN CÓDIGO, jamás una
 * variable de entorno.
 *
 * Una variable clonada
 * entre entornos publicó «Lend your RLUSD» en producción sin que nadie lo
 * decidiera, y de ahí salió la regla que hoy está escrita — lo
 * que decide si algo se VE vive en código, en un commit que dice qué se probó
 * y cuándo. El fundador lo enciende aquí cuando sepa qué ofrece Institucional.
 */
export const SHOW_INSTITUTIONAL = true;

/** Los segmentos que se pintan hoy, en orden. */
export function visibleProducts(): ProductDef[] {
  const out: ProductDef[] = [PRODUCTS.personal, PRODUCTS.legacy];
  if (SHOW_INSTITUTIONAL) out.push(PRODUCTS.institutional);
  return out;
}

/** Un valor guardado (localStorage) que ya no existe no puede dejar la página
 *  sin mundo: cae a Personal. */
export function isLandingProduct(v: unknown): v is LandingProduct {
  return v === 'personal' || v === 'legacy' || (v === 'institutional' && SHOW_INSTITUTIONAL);
}
