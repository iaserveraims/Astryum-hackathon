'use client';

/**
 * VaultTile — la IMAGEN de una bóveda en su carta: el
 * emblema que eligió el gestor, su foto de perfil, o el interrogante si
 * decidió no poner ninguna. Y si no decidió nada, tampoco se ve vacío: la
 * foto del perfil si existe, y si no, el identicon de siempre.
 *
 * La imagen SOLO se aplica si la puso el consejo que el catálogo dice que
 * gobierna el pote (vaultImageFor): una fila escrita sobre un pote ajeno es
 * inerte. Las bóvedas de la casa y las de consejo sin resolver no cambian.
 *
 * `shape='square'` (la cabecera de la carta): la foto llena el cuadrado con
 * esquinas redondeadas — se VE la cara, no un puntito.
 */

import { HelpCircle } from 'lucide-react';
import { ManagerAvatar, withProfile, type ManagerIdentity } from './managerIdentity';
import { emblemByKey, VaultEmblemIcon } from '../../lib/institutional/vaultEmblems';
import { useCommunity, vaultImageFor } from '../../lib/institutional/useCommunity';
import { TokenLogo } from '../ui/TokenLogo';

export function VaultTile({
  entry,
  manager,
  size = 22,
  shape = 'circle',
}: {
  entry: { pote: string; councilXrplAddress: string | null };
  manager: ManagerIdentity;
  size?: number;
  shape?: 'circle' | 'square';
}) {
  const { actors, images } = useCommunity();
  const who = withProfile(manager, manager.address ? actors.get(manager.address) : null);
  const img = manager.kind === 'manager' ? vaultImageFor(images, entry) : null;
  const square = shape === 'square';

  if (img?.kind === 'emblem') {
    const e = emblemByKey(img.emblem);
    if (e) return <VaultEmblemIcon emblem={e} size={size} square={square} />;
  }
  if (img?.kind === 'none') {
    return (
      <span
        className={`grid shrink-0 place-items-center border border-dashed border-ink/25 bg-ink/[0.03] text-ink/40 ${square ? 'rounded-xl' : 'rounded-full'}`}
        style={{ width: size, height: size }}
        aria-hidden
      >
        <HelpCircle style={{ width: size * 0.58, height: size * 0.58 }} strokeWidth={1.8} />
      </span>
    );
  }
  // 'profile' explícito, o nada decidido: la foto del perfil si la hay, y si
  // no, el identicon — nunca un hueco. En cuadrado, la foto llena el marco.
  if (square && who.photo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={who.photo} alt="" className="shrink-0 rounded-xl object-cover" style={{ width: size, height: size }} />
    );
  }
  return <ManagerAvatar manager={who} size={size} photo={who.photo} actorKind={who.actorKind} />;
}

/**
 * La CABECERA de la carta de una bóveda con gestor: la imagen a 48px y, al
 * lado, el token que usa con su logo y su símbolo legibles. Sustituye al icono de 22px con el
 * logo diminuto en la esquina.
 */
export function VaultCardTile({
  entry,
  manager,
  asset,
  accent,
}: {
  entry: { pote: string; councilXrplAddress: string | null };
  manager: ManagerIdentity;
  asset: string;
  accent: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div className={`grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl border ${accent}`}>
        <VaultTile entry={entry} manager={manager} size={48} shape="square" />
      </div>
      {asset ? (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.03] py-0.5 pl-0.5 pr-2">
          <TokenLogo symbol={asset} size="sm" />
          <span className="font-mono text-[11px] font-medium text-ink/80">{asset}</span>
        </span>
      ) : null}
    </div>
  );
}

export default VaultTile;
