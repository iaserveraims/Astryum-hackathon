import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { useAuthStore } from './authStore';
import { getApiBase } from '../lib/env';

/**
 * managerStore — quién se ha declarado GESTOR de bóvedas, y sus apoyos.
 *
 * El flag decide DESCUBRIMIENTO, no permisos: enseña la entrada «Manager desk»
 * del sidebar y la sección de Settings. Crear una jaula lo gobierna la chain
 * (una firma de la cuenta XRPL), y el circuito de certificación lo gobernará
 * el backend de KYC cuando exista — forjar este flag no abre nada que la
 * página no enseñe ya por URL.
 */

/**
 * La clave de identidad, y por qué NO es `user.id`: ese campo lleva el
 * sessionId del backend — un cuid NUEVO en cada login (authStore construye
 * `{ id: sessionId }` en todos los flujos). Clavar aquí duraría exactamente
 * una sesión: cada re-login «perdería» el flag y los apoyos.
 *
 * Anclas estables, en orden: el email (login email/OAuth) y la dirección
 * (passkey). Sin ninguna de las dos (XRP Identity hoy no trae ni email ni
 * address al user) la clave es null ⇒ el bucket 'volatile': funciona en la
 * sesión pero NO SE PERSISTE (ver partialize) — mejor un flag que dura la
 * pestaña que un bucket compartido que el siguiente usuario del navegador
 * hereda, que es la lección.
 */
const VOLATILE = 'volatile';
function userKey(): string {
  const u = useAuthStore.getState().user;
  if (u?.email) return `email:${u.email.toLowerCase()}`;
  if (u?.address) return `addr:${u.address.toLowerCase()}`;
  return VOLATILE;
}

/** El bucket efímero fuera del disco: lo persistido es solo lo anclado. */
function omitVolatile<T>(rec: Record<string, T>): Record<string, T> {
  if (!(VOLATILE in rec)) return rec;
  const { [VOLATILE]: _drop, ...rest } = rec;
  return rest;
}

interface ManagerState {
  /** userKey → se declaró gestor (caché local; la verdad es el servidor). */
  managers: Record<string, boolean>;
  /**
   * userKey → claves de gestor que ESTE usuario apoya (el voto de la
   * comunidad, fundador). LOCAL hasta que exista el raíl del
   * recuento público: tu apoyo se recuerda aquí y viajará al recuento cuando
   * el backend lo tenga. El recuento global JAMÁS se inventa desde esto — un
   * número de comunidad fabricado en un navegador es la definición de fake.
   * Invariante #9: el apoyo ordena solo como GESTO del usuario (un sort que
   * se elige), nunca el orden por defecto — visibilidad votada por usuarios,
   * no recomendación de Astryum.
   */
  endorsed: Record<string, string[]>;
  /**
   * Declara (o retira) el modo gestor: escribe local al instante y lo
   * persiste EN LA CUENTA (POST /auth/manager-mode). Devuelve false si el
   * servidor no lo aceptó — el flag revierte y la UI debe decirlo: un toggle
   * que parece guardado pero solo vive en este navegador es exactamente el
   * bug que motivó esto.
   */
  setManager: (v: boolean) => Promise<boolean>;
  toggleEndorsement: (managerKey: string) => void;
}

export const useManagerStore = create<ManagerState>()(
  persist(
    (set) => ({
      managers: {},
      endorsed: {},
      setManager: async (v) => {
        const key = userKey();
        const before = useManagerStore.getState().managers[key];
        // Local primero: el sidebar responde al clic, no al round-trip.
        set((s) => ({ managers: { ...s.managers, [key]: v } }));

        // Sin sesión no hay cuenta a la que seguir: lo local (o volátil) es
        // todo lo que existe, y eso ES el resultado correcto aquí.
        const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
        if (!token || token === 'dev-bypass-no-jwt') return true;

        try {
          const res = await fetch(`${getApiBase()}/auth/manager-mode`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ enabled: v }),
          });
          if (!res.ok) throw new Error(`http_${res.status}`);
          return true;
        } catch {
          // El servidor no lo tiene ⇒ otros navegadores tampoco lo tendrán.
          // Se revierte y la UI lo cuenta — un «guardado» a medias es el bug.
          set((s) => ({ managers: { ...s.managers, [key]: before ?? false } }));
          return false;
        }
      },
      toggleEndorsement: (managerKey) =>
        set((s) => {
          const mine = s.endorsed[userKey()] ?? [];
          const next = mine.includes(managerKey)
            ? mine.filter((k) => k !== managerKey)
            : [...mine, managerKey];
          return { endorsed: { ...s.endorsed, [userKey()]: next } };
        }),
    }),
    {
      name: 'astryum:manager',
      // El bucket 'volatile' (sesiones sin ancla estable) jamás toca el disco:
      // persistirlo sería el bucket compartido del navegador otra vez.
      partialize: (s) => ({
        managers: omitVolatile(s.managers),
        endorsed: omitVolatile(s.endorsed),
      }),
      // V1: PURGA de los borradores de KYC. La rebanada `kyc`
      // guardaba PII (nombre legal, licencia, jurisdicción) y murió con el
      // giro a referral — ni creamos ni custodiamos documentos, tampoco en
      // el localStorage del usuario. migrate corre al hidratar y lo escrito
      // se re-persiste ya sin `kyc`: el borrador viejo desaparece del disco.
      version: 1,
      migrate: (persisted) => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        delete p.kyc;
        return p as { managers: Record<string, boolean>; endorsed: Record<string, string[]> };
      },
    },
  ),
);

/**
 * Adopta el veredicto del servidor (GET /auth/me → managerMode) en la caché
 * local del usuario actual. Lo llama refreshMe (authStore) vía import
 * dinámico — la dirección estática ya va managerStore→authStore y un ciclo
 * aquí rompería el arranque. `email` viene de la propia respuesta de /me
 * (profile.email): ancla el dato aunque el user del store aún esté a medias.
 * EL SERVIDOR GANA: es lo único que comparten todos los navegadores — la
 * caché local solo manda mientras /me no ha respondido.
 */
export function adoptServerManagerFlag(enabled: boolean, email?: string | null): void {
  const key = email ? `email:${email.toLowerCase()}` : userKey();
  useManagerStore.setState((s) =>
    s.managers[key] === enabled ? s : { managers: { ...s.managers, [key]: enabled } },
  );
}

/** La misma clave que escriben los setters, reactiva al usuario del store.
 *  Exportada: managerAccountStore guarda la cuenta elegida bajo la MISMA
 *  clave por usuario (y con el mismo bucket volátil fuera del disco). */
export function managerUserKey(user: { email?: string; address?: string } | null): string {
  if (user?.email) return `email:${user.email.toLowerCase()}`;
  if (user?.address) return `addr:${user.address.toLowerCase()}`;
  return VOLATILE;
}
const keyOf = managerUserKey;
/** El bucket efímero: lo que va aquí jamás se persiste. */
export const MANAGER_VOLATILE_KEY = VOLATILE;

/** El flag del usuario ACTUAL, reactivo a login/logout y al propio flag. */
export function useIsManager(): boolean {
  const user = useAuthStore((s) => s.user);
  const managers = useManagerStore((s) => s.managers);
  return managers[keyOf(user)] === true;
}

/** Los gestores que el usuario ACTUAL apoya. */
export function useMyEndorsements(): string[] {
  const user = useAuthStore((s) => s.user);
  const endorsed = useManagerStore((s) => s.endorsed);
  return endorsed[keyOf(user)] ?? [];
}
