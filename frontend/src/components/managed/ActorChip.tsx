'use client';

/**
 * ActorChip — QUIÉN, en un chip: la cara (foto del perfil si la hay), el
 * nombre, y si es persona o agente de IA. Es la pieza con la que cada
 * movimiento y cada bóveda «queda retratado» (fundador 8-sep: «no el
 * movimiento, sino el usuario o agente que lo ha ejecutado»). Un mismo chip
 * en la ficha, en la consola, en el catálogo y en la comunidad, para que la
 * misma cuenta se reconozca en todas.
 *
 * Con `link`, el chip lleva a la página de ese actor en la comunidad.
 */

import Link from 'next/link';
import { BadgeCheck } from 'lucide-react';
import { ActorKindBadge, ManagerAvatar, withProfile, type ManagerIdentity } from './managerIdentity';
import { useCommunity } from '../../lib/institutional/useCommunity';

export const actorProfileHref = (account: string) => `/app/community?actor=${encodeURIComponent(account)}`;

export function ActorChip({
  manager,
  size = 20,
  verified,
  link = true,
  className = '',
}: {
  manager: ManagerIdentity;
  size?: number;
  /** El tick del ledger, si quien pinta lo sabe. undefined = no se dice nada. */
  verified?: boolean;
  link?: boolean;
  className?: string;
}) {
  const { actors } = useCommunity();
  const who = withProfile(manager, manager.address ? actors.get(manager.address) : null);
  const body = (
    <>
      <ManagerAvatar manager={who} size={size} photo={who.photo} actorKind={who.actorKind} />
      <span className="truncate text-[12px] font-medium text-ink/85">{who.name}</span>
      <ActorKindBadge kind={who.actorKind} />
      {verified ? <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-tone-success" strokeWidth={2} aria-label="Verified" /> : null}
    </>
  );
  const cls = `inline-flex max-w-full items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.03] py-0.5 pl-0.5 pr-2 ${className}`;
  if (link && manager.kind === 'manager' && manager.address) {
    return (
      <Link href={actorProfileHref(manager.address)} className={`${cls} transition-colors hover:border-volt/40`}>
        {body}
      </Link>
    );
  }
  return <span className={cls}>{body}</span>;
}

export default ActorChip;
