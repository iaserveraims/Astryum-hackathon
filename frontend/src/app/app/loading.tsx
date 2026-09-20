/**
 * loading.tsx del segmento /app — la primera ruta con loader de marca
 * (2026-09-08). Antes no existía NINGÚN loading.tsx: las transiciones de
 * ruta esperaban en blanco. Server component a propósito: sin useT (el
 * loader no necesita texto — el logo dibujándose ES el mensaje).
 */
import { AstryumLoader } from '@/components/ui/AstryumLoader';

export default function AppLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      {/* tone='auto' (2026-09-13): el cometa toma el color de la autoridad activa —
          índigo al entrar al Legacy, oro al volver — y es el ÚNICO logo del
          cambio de sitio (el cruce ya no pinta el suyo encima). */}
      <AstryumLoader tone="auto" />
    </div>
  );
}
