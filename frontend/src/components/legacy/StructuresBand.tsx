'use client';

/**
 * StructuresBand — the governed fleet on the Summary (E1, plan del mes §4;
 * built 2026-08-15). One row per structure: name + council shape, health,
 * "your signature is due", balance, and money in flight — the Summary now
 * answers «one signature, N structures» right under the personal wallets.
 *
 * This band SUPERSEDES, for itself only, the 2026-07-18/08-04 flattening
 * ("Legacy es una wallet más"): the hero organisms above still read the
 * ACTIVE authority; this band lists EVERY structure you govern, from any
 * product mode. The identity accent is the product token (--product-legacy,
 * indigo in both authorities by design) so a structure reads as Legacy even
 * from the Personal dashboard — and the WORD carries every state, color is
 * never the only indicator (CVD guardrail; danger↔volt pair prohibited).
 *
 * StructureFacts is exported on its own: the Home hub's Legacy shelf
 * (preview/home-hub, Builder A) can drop the same fact line into its cards —
 * one vocabulary for the same facts, never a second visual language.
 *
 * DOS PUERTAS, NINGUNA NAVEGA (fundador 2026-09-07: «cuando le das a una
 * estructura te manda a la pantalla de wallets»). Tocar la fila ACOTA la
 * pantalla que la contiene a esa estructura; «Gobernar» abre la ceremonia
 * sobre ella, en el host global de operaciones — el mismo camino que la
 * tarjeta de Wallets desde el 30-ago.
 *
 * Lo anterior —setActive + router.push('/app/wallets')— prometía dejar la
 * estructura «preseleccionada» y no lo hacía: AppShell resetea toda autoridad
 * gobernada en cuanto la ruta no es /app/legacy, y Wallets no lee la
 * autoridad activa (solo entiende ?add=1). Se perdía la página sin ganar
 * nada al llegar. Las puertas de demo/beta viajan con GOBERNAR, que es
 * entrar; acotar es leer capital propio y no pasa por ellas.
 */

import { useCallback } from 'react';
import { CalendarClock, ChevronRight, Landmark, Loader2, PenLine, Users } from 'lucide-react';
import { Card, MicroLabel, Pill } from '../ui/primitives';
import { useT } from '../../i18n/LanguageProvider';
import { useOperationStore } from '../../stores/operationStore';
import { useStructureOverview } from '../../hooks/useStructureOverview';
import { useBalanceVisibility, MASK } from '../../stores/balanceVisibilityStore';
import { useAuthStore } from '../../stores/authStore';
import { isDemoMode, openLegacyComingSoon } from '../../lib/demoMode';
import { fmtQtyActive } from '../../lib/format';
import { displayBaseUnits } from '../../lib/legacy/baseUnits';
import type { GovernedAuthority } from '../../lib/authority';
import { walletWash } from '@/lib/walletIdentity';
import { getLegacyNickname } from './legacyLocal';
import { headlineLabel, healthTone } from './MyLegaciesList';


/**
 * The fact line of ONE structure: council shape · XRP balance · caged
 * principal · proposals in flight · programmed transfers. Self-contained
 * (fires its own minute-cached capital read) so any surface can mount it.
 * Facts only appear once READ — loading shows an ellipsis, a dead read says
 * "could not read"; nothing is ever fabricated.
 */
export function StructureFacts({
  structure,
  className = '',
}: {
  structure: GovernedAuthority;
  className?: string;
}) {
  const { t, lang } = useT();
  const hidden = useBalanceVisibility((s) => s.hidden);
  const ov = useStructureOverview(structure.address);

  const nextRelease = ov.nextReleaseISO
    ? new Date(ov.nextReleaseISO).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US')
    : null;

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink/45 ${className}`}>
      {typeof structure.quorum === 'number' && typeof structure.memberCount === 'number' && (
        <span className="inline-flex items-center gap-1">
          <Users size={11} aria-hidden />
          {structure.quorum}/{structure.memberCount} {t('signers')}
        </span>
      )}
      {ov.spendable && (
        <span className="font-mono text-ink/60">
          {hidden ? MASK : fmtQtyActive(ov.spendable.balanceXrp, 2)} XRP
        </span>
      )}
      {ov.vault && (
        <span className="font-mono text-ink/60">
          {hidden ? MASK : displayBaseUnits(ov.vault.totalPrincipal, ov.vault.asset.decimals)}{' '}
          {ov.vault.asset.symbol}
          <span className="ml-1 font-sans text-ink/40">· {t('In the vault')}</span>
        </span>
      )}
      {typeof structure.liveProposals === 'number' && structure.liveProposals > 0 && (
        <span className="inline-flex items-center gap-1">
          <PenLine size={11} aria-hidden />
          {structure.liveProposals} {t('in progress')}
        </span>
      )}
      {/* productizer it. 27 (6) — «NO PUDE LEER» NO ES «NO HAY NADA». El recuento se
          queda `undefined` a propósito cuando la lectura se rechazó o vino a medias
          (it. 25), y esta banda solo pintaba con un número positivo: un Legacy con
          decisiones en vuelo que nadie consiguió leer se veía idéntico a uno sin
          nada. La marca la pone el hook y solo después de INTENTARLO, así que esto
          jamás aparece durante la primera lectura. */}
      {structure.proposalsUnread && typeof structure.liveProposals !== 'number' && (
        <span className="inline-flex items-center gap-1 text-tone-warning">
          <PenLine size={11} aria-hidden />
          {t('in progress')}: {t('could not read')}
        </span>
      )}
      {ov.escrows && ov.escrows.length > 0 && (
        <span className="inline-flex items-center gap-1">
          <CalendarClock size={11} aria-hidden />
          {ov.escrows.length} {t('programmed')}
          {nextRelease && (
            <span className="text-ink/40">
              · {t('next')} {nextRelease}
            </span>
          )}
        </span>
      )}
      {ov.loading && <span aria-hidden>…</span>}
      {ov.error && <span>{t('could not read')}</span>}
    </div>
  );
}

function StructureRow({
  structure,
  onOpen,
  onGovern,
}: {
  structure: GovernedAuthority;
  onOpen: (g: GovernedAuthority) => void;
  onGovern: (g: GovernedAuthority) => void;
}) {
  const { t } = useT();
  // El nombre JAMÁS es la dirección (fundador 2026-08-22); sin bautizar se
  // llama 'Legacy' a secas — el índigo y el Landmark dicen qué es.
  const name = structure.label || getLegacyNickname(structure.address) || t('Legacy');
  return (
    // La fila ya no es UN botón: lleva dos acciones (acotar y gobernar), y un
    // <button> dentro de otro es HTML inválido. El recuadro entero sigue
    // índigo — misma receta walletWash sobre el token del producto.
    <div
      className="flex w-full items-center gap-3 border-t px-5 py-2.5 transition hover:brightness-110"
      style={walletWash('hsl(var(--product-legacy))')}
    >
      <button
        type="button"
        onClick={() => onOpen(structure)}
        aria-label={`${t('Show only this Legacy')} · ${name}`}
        title={t('Show only this Legacy')}
        className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none"
      >
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
        style={{
          background: 'hsl(var(--product-legacy) / 0.14)',
          color: 'hsl(var(--product-legacy))',
        }}
        aria-hidden
      >
        <Landmark size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-[13px] font-semibold text-ink">{name}</span>
          {structure.loading ? (
            <Loader2 size={12} className="animate-spin text-ink/40" aria-hidden />
          ) : structure.error ? (
            <Pill tone="warning">{t('could not read')}</Pill>
          ) : structure.hasCouncil && structure.health ? (
            <Pill tone={healthTone(structure.health.level)}>
              {headlineLabel(structure.health.headline, t)}
            </Pill>
          ) : (
            <Pill tone="neutral">{t('not a council yet')}</Pill>
          )}
          {typeof structure.pendingSignatures === 'number' && structure.pendingSignatures > 0 && (
            <Pill tone="warning">
              <PenLine size={10} className="mr-1 inline" aria-hidden />
              {t('To sign')} · {structure.pendingSignatures}
            </Pill>
          )}
          {/* it. 27 (6): el mismo silencio, sobre la firma que a esta persona le
              toca. Una píldora que solo sale con un número positivo convierte «no
              lo pude leer» en «no te toca firmar nada», que es la reducción de
              la que nadie se entera hasta que la propuesta caduca. */}
          {structure.proposalsUnread && typeof structure.pendingSignatures !== 'number' && (
            <Pill tone="warning">
              <PenLine size={10} className="mr-1 inline" aria-hidden />
              {t('To sign')} · {t('could not read')}
            </Pill>
          )}
        </div>
        <StructureFacts structure={structure} className="mt-1" />
      </div>
      </button>
      {/* Gobernar: la ceremonia se abre SOBRE esta pantalla (host global),
          igual que desde la tarjeta de Wallets. */}
      <button
        type="button"
        onClick={() => onGovern(structure)}
        aria-label={`${t('Govern')} · ${name}`}
        title={t('Govern')}
        className="shrink-0 rounded-lg border border-ink/10 px-2.5 py-1 text-[11px] text-ink/60 transition-colors hover:border-ink/25 hover:text-ink"
      >
        {t('Govern')}
      </button>
      <ChevronRight size={14} className="shrink-0 text-ink/30" aria-hidden />
    </div>
  );
}

export default function StructuresBand({
  legacies,
  onScope,
}: {
  legacies: GovernedAuthority[];
  /** Acotar la página a esta estructura. Sin esto la fila no hace nada más
   *  que su puerta de gobernanza — jamás vuelve a navegar. */
  onScope?: (address: string) => void;
}) {
  const { t } = useT();
  const openGovernOp = useOperationStore((st) => st.openGovernOp);

  // ── LA FILA YA NO TELETRANSPORTA (fundador 2026-09-07: «cuando le das a
  // una estructura te manda a la pantalla de wallets»). Tocar una estructura
  // ACOTA el Portfolio a ella y te quedas leyendo lo que viniste a leer.
  //
  // Lo que había —setActive + router.push('/app/wallets')— prometía dejarla
  // «preseleccionada» y no lo hacía: AppShell resetea cualquier autoridad
  // gobernada en cuanto la ruta no es /app/legacy, y Wallets ni siquiera lee
  // la autoridad activa (no acepta más parámetro que ?add=1). Es decir: se
  // perdía la página Y no se ganaba nada al llegar.
  const openStructure = useCallback(
    (g: GovernedAuthority) => {
      // Acotar es LEER capital propio: no pasa por las puertas de demo/beta,
      // que existen para ENTRAR a gobernar. Decisión, no descuido.
      onScope?.(g.address);
    },
    [onScope],
  );

  // Gobernar abre la ceremonia SOBRE esta pantalla — el mismo host global y
  // la misma operación que la tarjeta de Wallets desde el 30-ago; aquí sí
  // aplican las puertas de demo/beta, que viven dentro de esa puerta.
  const governStructure = useCallback(
    (g: GovernedAuthority) => {
      if (isDemoMode() || !useAuthStore.getState().legacyAccess) {
        openLegacyComingSoon(isDemoMode() ? undefined : 'beta');
        return;
      }
      openGovernOp(g.address, getLegacyNickname(g.address) ?? g.label ?? null);
    },
    [openGovernOp],
  );

  return (
    <Card padded={false} className="overflow-hidden">
      <div className="px-5 pt-3.5 pb-2.5">
        <MicroLabel>{t('Structures')}</MicroLabel>
      </div>
      <div>
        {legacies.map((g) => (
          <StructureRow key={g.address} structure={g} onOpen={openStructure} onGovern={governStructure} />
        ))}
      </div>
    </Card>
  );
}
