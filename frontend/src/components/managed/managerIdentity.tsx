'use client';

/**
 * managerIdentity — quién lleva una bóveda, con cara.
 *
 * EL GESTOR ES UNA PROPIEDAD DE LA BÓVEDA (fundador 26-ago), pero desde el
 * 29-ago también es su TOQUE DISTINTIVO: cada card del catálogo lleva el
 * avatar y el nombre de quien la gobierna, y ese avatar abre camino a su
 * perfil. Aquí vive la única regla de identidad, para que card, ficha y
 * perfil digan siempre el mismo nombre.
 *
 * ── TRES IDENTIDADES, NO DOS ────────────────────────────────────────────────
 * La primera versión tenía dos («gestor» / «Astryum made») y el fallback caía
 * en Astryum siempre que `councilXrplAddress` era null. Eso era un fallo
 * grave, porque ese null significa DOS cosas distintas que el backend junta a
 * propósito: «este pote no tiene consejo» y «no pude resolverlo»
 * (`resolveCouncilAddresses` se traga un queryFilter fallido y devuelve el
 * mapa vacío — «cada pote se queda sin dueño visible, nunca un dueño
 * equivocado»). Con un 429 del RPC de Flare —el incidente del 17-ago— TODAS
 * las bóvedas de terceros habrían aparecido con el logo de Astryum como
 * gestor, y sus capitales sumados en un perfil de una entidad que no existe.
 *
 * Así que:
 *  · 'astryum'  — SOLO si la bóveda está declarada de la casa por env
 *                 (NEXT_PUBLIC_ASTRYUM_MADE_POTES por dirección del pote, o
 *                 NEXT_PUBLIC_ASTRYUM_MADE_COUNCILS por cuenta del consejo).
 *                 Es una afirmación, y una afirmación necesita que alguien la
 *                 firme — aquí, la configuración del despliegue.
 *  · 'unknown'  — consejo sin resolver. No se agrupa, no se le abre perfil y
 *                 no se le suma capital: no sabemos quién es.
 *  · 'manager'  — una cuenta XRPL real.
 *
 * ── EL AVATAR ES DETERMINISTA, NO UNA FOTO ──────────────────────────────────
 * No existe (todavía) ningún raíl donde un gestor suba imagen o alias: lo
 * único verificable es su cuenta XRPL. Así que el avatar se DERIVA de la
 * dirección — tono y dos letras, siempre iguales para la misma cuenta — y el
 * nombre es la dirección abreviada. Cuando el backend de perfiles exista,
 * esta función es el único sitio a cambiar. Inventar alias bonitos aquí sería
 * exactamente la cara que pondría un gestor falso.
 *
 * ── «ASTRYUM MADE» NO ES «GESTIONADA POR ASTRYUM» ───────────────────────────
 * Astryum jamás gestiona capital de nadie (invariantes #1/#8). El copy de esta
 * identidad dice SIEMPRE «bóveda de demostración, sin gestor externo» — nunca
 * «la lleva Astryum». Por eso la frase de la card la construye quien la pinta
 * a partir de `kind`, y no concatenando «Run by» + este nombre.
 */

import { Bot, HelpCircle } from 'lucide-react';

import { LogoMark } from '../ui/Logo';
import { useT } from '../../i18n/LanguageProvider';
import type { ActorKind, CommunityActor } from '../../lib/institutional/api';

export type ManagerKind = 'manager' | 'astryum' | 'unknown';

export interface ManagerIdentity {
  /** Clave estable: la cuenta XRPL, 'astryum', o 'unknown' (no agrupa). */
  key: string;
  /** El nombre que se pinta — HOY la dirección abreviada (ver cabecera). */
  name: string;
  kind: ManagerKind;
  address: string | null;
}

/** Un gestor con identidad propia: el único que tiene perfil y puede recibir apoyo. */
export const isRealManager = (m: ManagerIdentity) => m.kind === 'manager';

const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

function envSet(raw: string | undefined): Set<string> {
  return new Set((raw ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
}

/**
 * La identidad de quien lleva un pote.
 *
 * Recibe el pote entero (no solo el consejo) porque una bóveda de la casa se
 * puede declarar por SU dirección — la de prueba de hoy no necesita tener un
 * consejo especial para llevar el perfil de Astryum.
 */
// Las declaraciones de la casa se leen del env UNA vez por carga (revisión
// 10-sep): managerOf corre dentro de comparadores de sort y por carta por
// render — reconstruir dos Sets en cada llamada era trabajo tirado.
const HOUSE_POTES = envSet(process.env.NEXT_PUBLIC_ASTRYUM_MADE_POTES);
const HOUSE_COUNCILS = envSet(process.env.NEXT_PUBLIC_ASTRYUM_MADE_COUNCILS);

export function managerOf(entry: { pote?: string | null; councilXrplAddress: string | null }): ManagerIdentity {
  const council = entry.councilXrplAddress;
  const housePotes = HOUSE_POTES;
  const houseCouncils = HOUSE_COUNCILS;
  const declaredHouse =
    (entry.pote != null && housePotes.has(entry.pote.toLowerCase())) ||
    (council != null && houseCouncils.has(council.toLowerCase()));

  if (declaredHouse) {
    return { key: 'astryum', name: 'Astryum made', kind: 'astryum', address: council };
  }
  if (!council) {
    // NO se dice «Astryum» ni «sin gestor»: no lo sabemos, y decir cualquiera
    // de las dos cosas es afirmar algo que el backend se negó a afirmar.
    return { key: 'unknown', name: 'Manager unknown', kind: 'unknown', address: null };
  }
  return { key: council, name: shortAddr(council), kind: 'manager', address: council };
}

/**
 * EL NOMBRE Y LA CARA, con el perfil público delante (8-sep). El raíl de
 * perfiles ya existe (lo escribe el dueño PROBADO de la r-address), así que
 * cuando hay perfil, manda: su nombre y su foto — al 100%, la misma en la
 * carta, la ficha, la mesa y la comunidad. Sin perfil, lo de siempre: la
 * dirección abreviada y el identicon. La casa y lo desconocido no cambian.
 */
export function withProfile(mgr: ManagerIdentity, actor: CommunityActor | null | undefined): ManagerIdentity & { photo: string | null; actorKind: ActorKind | null } {
  if (mgr.kind !== 'manager' || !actor?.profile) return { ...mgr, photo: null, actorKind: null };
  return {
    ...mgr,
    name: actor.profile.displayName || mgr.name,
    photo: actor.profile.avatarUrl ?? null,
    actorKind: actor.profile.actorKind ?? 'human',
  };
}

/** La marca de agente de IA: pequeña, siempre la misma, nunca escondida. */
export function ActorKindBadge({ kind, className = '' }: { kind: ActorKind | null | undefined; className?: string }) {
  const { t } = useT();
  if (kind === 'agent') {
    return (
      <span className={`inline-flex items-center gap-1 rounded-full border border-violet-400/40 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-300 ${className}`}>
        <Bot className="h-3 w-3 shrink-0" strokeWidth={2} /> {t('AI agent')}
      </span>
    );
  }
  if (kind === 'human') {
    return (
      <span className={`inline-flex items-center rounded-full border border-ink/10 bg-ink/[0.03] px-1.5 py-0.5 text-[10px] text-ink/50 ${className}`}>
        {t('Person')}
      </span>
    );
  }
  return null;
}

/** Tono estable a partir de la dirección: misma cuenta, mismo color, siempre. */
function hueOf(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function ManagerAvatar({
  manager,
  size = 24,
  className = '',
  photo,
  actorKind,
}: {
  manager: ManagerIdentity;
  size?: number;
  className?: string;
  /** La foto del perfil público (https o data URL). Con foto, se respeta siempre. */
  photo?: string | null;
  /** Con 'agent', un punto con el robot en la esquina: se ve que es una IA sin leer. */
  actorKind?: ActorKind | null;
}) {
  if (manager.kind === 'manager' && photo) {
    return (
      <span className={`relative inline-block shrink-0 ${className}`} style={{ width: size, height: size }} aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo} alt="" className="h-full w-full rounded-full object-cover" style={{ width: size, height: size }} />
        {actorKind === 'agent' && size >= 20 ? (
          <span
            className="absolute -bottom-0.5 -right-0.5 grid place-items-center rounded-full border border-surface-1 bg-violet-500 text-white"
            style={{ width: Math.max(10, size * 0.42), height: Math.max(10, size * 0.42) }}
          >
            <Bot style={{ width: '70%', height: '70%' }} strokeWidth={2.4} />
          </span>
        ) : null}
      </span>
    );
  }
  if (manager.kind === 'astryum') {
    return (
      <span
        className={`grid shrink-0 place-items-center rounded-full border border-volt/30 bg-surface-1 ${className}`}
        style={{ width: size, height: size }}
        aria-hidden
      >
        <LogoMark height={Math.round(size * 0.62)} glow={false} />
      </span>
    );
  }
  if (manager.kind === 'unknown') {
    // Un hueco declarado, no una cara inventada: el identicon de una dirección
    // que no tenemos sería una identidad fabricada.
    return (
      <span
        className={`grid shrink-0 place-items-center rounded-full border border-dashed border-ink/25 bg-ink/[0.03] text-ink/35 ${className}`}
        style={{ width: size, height: size }}
        aria-hidden
      >
        <HelpCircle style={{ width: size * 0.55, height: size * 0.55 }} strokeWidth={1.8} />
      </span>
    );
  }
  const hue = hueOf(manager.key);
  // Las dos letras tras la 'r' de la dirección: reconocible sin fingir alias.
  const initials = manager.key.slice(1, 3).toUpperCase();
  return (
    <span className={`relative inline-block shrink-0 ${className}`} style={{ width: size, height: size }} aria-hidden>
      <span
        className="grid h-full w-full select-none place-items-center rounded-full font-semibold text-white/90"
        style={{
          fontSize: Math.max(8, Math.round(size * 0.36)),
          background: `linear-gradient(135deg, hsl(${hue} 62% 46%), hsl(${(hue + 46) % 360} 60% 30%))`,
        }}
      >
        {initials}
      </span>
      {actorKind === 'agent' && size >= 20 ? (
        <span
          className="absolute -bottom-0.5 -right-0.5 grid place-items-center rounded-full border border-surface-1 bg-violet-500 text-white"
          style={{ width: Math.max(10, size * 0.42), height: Math.max(10, size * 0.42) }}
        >
          <Bot style={{ width: '70%', height: '70%' }} strokeWidth={2.4} />
        </span>
      ) : null}
    </span>
  );
}
