'use client';

/**
 * LA PORTADA — dos ficheros, una regla.
 *
 * Fundador, 2026-09-19, al preparar el release de la ventana a `main`: «en
 * staging se han hecho modificaciones a la landing sobre legacy e
 * institutional. Estas dos no deben aparecer en main production, debe
 * quedarse la landing tal cual está actualmente en main production».
 *
 * Esconder dos opciones del conmutador NO bastaba. La portada nueva
 * (`LandingPage`) cambia también lo que ve quien se queda en Personal: el
 * conmutador de tres mundos, el pie con «Volver arriba» y «Otros mundos», la
 * barra de itinerario solo en Personal, y Legacy como mundo propio en vez del
 * viaje solar recoloreado. Reproducir la portada de producción a base de
 * condicionales dentro de un fichero de cuatro mil líneas que se itera a diario
 * es exactamente cómo algo acaba filtrándose.
 *
 * Así que la portada de producción es un FICHERO: `LandingPageProduction` es
 * el `LandingPage.tsx` de `main` del 19-sep, byte a byte (lo fija un test, por
 * hash). Nada de lo que se toque en `LandingPage` puede llegar a producción, y
 * preview y local siguen viendo los mundos nuevos, que es donde se prueban.
 *
 * La regla es la única que hay para esto (`lib/nav/hackathonHub`): abre fuera
 * de producción y cierra dentro, en código, sin variable que la anule — una
 * variable clonada entre entornos ya publicó una vez lo que nadie decidió
 * publicar (14-sep). Es la misma en servidor y en cliente, porque
 * `NEXT_PUBLIC_VERCEL_ENV` y `NODE_ENV` se hornean en el build: no hay
 * desajuste de hidratación.
 *
 * Los dos van por `dynamic` para que cada despliegue CARGUE solo la suya: con
 * dos imports estáticos, producción se descargaría nueve mil líneas de mundos
 * que no pinta. El chunk de la otra existe en el build, pero ninguna página lo
 * pide.
 *
 * PUBLICAR los mundos nuevos = borrar `LandingPageProduction.tsx`, su test, y
 * dejar aquí el import directo de `LandingPage`. Nada se mueve de sitio.
 */

import dynamic from 'next/dynamic';
import { isProductionDeploy } from '@/lib/nav/hackathonHub';

const LandingPage = dynamic(() => import('@/components/landing/LandingPage'));
const LandingPageProduction = dynamic(() => import('@/components/landing/LandingPageProduction'));

export default function Page() {
  return isProductionDeploy() ? <LandingPageProduction /> : <LandingPage />;
}
