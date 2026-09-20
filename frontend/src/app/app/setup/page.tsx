'use client';

/**
 * /app/setup — el hub de las ceremonias de configuración. Tres puertas,
 * una plantilla; cada una abre su ventana. La fila del menú la decide el
 * agente de menús: esta página no toca el nav.
 */

import { SetupHub } from '../../../components/setup/SetupHub';

export default function SetupPage() {
  return <SetupHub />;
}
