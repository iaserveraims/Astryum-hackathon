/**
 * La MESA DEL GESTOR, a la vista durante el hackathon (fundador 2026-09-10:
 * «tenemos que mostrar el menú managed vaults, o sea el managed desk, ya que
 * es una herramienta que actúa en el XRPL hackathon y se tiene que poder
 * acceder fácilmente POR AHORA»).
 *
 * El estado de reposo es el que dejó el compañero ese mismo día: la mesa no
 * tiene fila en el sidebar y se abre desde Earn → Managed vaults, con un botón
 * con nombre para quien se declaró gestor y una puerta discreta para el resto.
 * Eso es lo correcto para un usuario normal — y es invisible para un jurado
 * que entra por primera vez y tiene tres minutos.
 *
 * Con la mesa ABIERTA:
 *   · vuelve la fila «Manager desk» al sidebar, para todos, y entra en ⌘K;
 *   · en Managed vaults el botón con nombre se enseña a todos, no solo a los
 *     declarados (la puerta discreta sobra: se retira).
 * Lo que NO cambia: la declaración de gestor. Quien no se declaró sigue
 * encontrando la declaración al abrir la mesa —un clic, y el flag viaja a su
 * cuenta— porque descubrir una puerta no es lo mismo que fingir un permiso.
 *
 * ── CERRADA EN PRODUCCIÓN (fundador 2026-09-13) ──────────────────────────
 *
 * «Todo esto que no está probado no quiero que lo tenga la gente que está en
 * producción». La regla vieja (`!== 'false'`) abría la mesa en cualquier
 * despliegue que no definiera la variable, producción incluida. Ahora abre
 * fuera de producción y se queda cerrada dentro, salvo que alguien la abra a
 * mano — la misma regla, y el mismo interruptor de emergencia, que el hub
 * (`openOutsideProduction`, lib/nav/hackathonHub.ts).
 *
 * Dato que pesa: el backend de PRODUCCIÓN (Railway) no sirve todavía
 * `/api/institutional` — contesta 404 — así que en producción esta mesa no
 * tendría de dónde leer ni potes ni jaulas. Enseñarla allí no es adelantar
 * trabajo: es enseñar una pantalla que no puede funcionar.
 *
 * Para enseñarla en producción: `NEXT_PUBLIC_MANAGER_DESK_OPEN=true` en Vercel
 * (scope Production) y **redeploy** — `NEXT_PUBLIC_*` se hornea en el build.
 */
import { openOutsideProduction } from './hackathonHub';

export const MANAGER_DESK_OPEN = openOutsideProduction(process.env.NEXT_PUBLIC_MANAGER_DESK_OPEN);

/**
 * La puerta «Managed vaults» de Earn — la OTRA entrada a lo mismo.
 *
 * Se publicó el 2026-08-25 («va a estar disponible para su uso cuando
 * despleguemos la web») y desde entonces vive sin envoltorio. Cerrar sólo la
 * fila del sidebar habría sido cosmético: esta puerta lleva al mismo sitio, y
 * en producción lleva a una pantalla cuyo backend contesta 404.
 *
 * Interruptor propio a propósito, para poder devolver el catálogo a producción
 * sin devolver la mesa del gestor: `NEXT_PUBLIC_MANAGED_VAULTS=true` + redeploy.
 */
export const MANAGED_VAULTS_DOOR_OPEN = openOutsideProduction(
  process.env.NEXT_PUBLIC_MANAGED_VAULTS,
);
