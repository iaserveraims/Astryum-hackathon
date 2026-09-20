/**
 * La MESA DEL GESTOR, a la vista durante el hackathon.
 *
 * El estado de reposo es el que dejó el compañero ese mismo día: la mesa no
 * tiene fila en el sidebar y se abre desde Earn → Managed vaults, con un botón
 * con nombre para quien se declaró gestor y una puerta discreta para el resto.
 * Eso es lo correcto para un usuario normal — y es invisible para un jurado
 * que entra por primera vez y tiene tres minutos.
 */
import { openOutsideProduction } from './hackathonHub';

export const MANAGER_DESK_OPEN = openOutsideProduction(process.env.NEXT_PUBLIC_MANAGER_DESK_OPEN);

/**
 * La puerta «Managed vaults» de Earn — la OTRA entrada a lo mismo.
 *
 * Se publicó («va a estar disponible para su uso cuando
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
