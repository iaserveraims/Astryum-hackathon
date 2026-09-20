'use client';

/**
 * ManagerProfileModal — el PERFIL de un gestor: sus bóvedas, cuánto capital
 * gobierna, el apoyo de la comunidad y su enlace de referidos.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, BadgeCheck, Copy, ExternalLink, Landmark, ShieldAlert, ThumbsUp, X } from 'lucide-react';

import { GhostButton, MicroLabel, Pill, PrimaryButton } from '../ui/primitives';
import { ModalOverlay } from '../ui/ModalPortal';
import { ManagerPublicProfile } from './ManagerPublicProfile';
import { useT } from '../../i18n/LanguageProvider';
import { fmtBase } from '../../lib/institutional/policyCatalog';
import { fmtExitWindow, shortAddr } from '../../lib/institutional/format';
import type { PoteCatalogEntry } from '../../lib/institutional/api';
import { ActorKindBadge, ManagerAvatar, isRealManager, withProfile, type ManagerIdentity } from './managerIdentity';
import { actorProfileHref } from './ActorChip';
import { patchActorEndorsement, useCommunity } from '../../lib/institutional/useCommunity';
import { refusalText } from '../../lib/institutional/format';
import { endorseManager } from '../../lib/institutional/api';
import { useAuthStore } from '../../stores/authStore';

// Explorador de cuentas XRPL: el MISMO en toda la mesa (xrpscan), no uno por fichero.
const XRPL_EXPLORER = 'https://xrpscan.com/account/';


/**
 * Capital por activo — solo se suma lo del MISMO activo, nunca peras+manzanas.
 *
 * La clave es la DIRECCIÓN del token, no su símbolo: dos tokens distintos
 * pueden llamarse igual (un USDC bridgeado y uno nativo conviven en Flare, y
 * un token falso puede ponerse el símbolo que quiera). Sumarlos por nombre
 * daría UNA cifra de capital que no existe en ninguna parte.
 */
function capitalLines(vaults: PoteCatalogEntry[]): { lines: string[]; skipped: number } {
  const byAsset = new Map<string, { units: bigint; decimals: number; symbol: string }>();
  let skipped = 0;
  for (const v of vaults) {
    if (!v.asset || v.totalAssets == null) {
      // Sin lectura no se suma — pero TAMPOCO se calla: una suma parcial
      // presentada como total es una cifra inventada por omisión.
      skipped++;
      continue;
    }
    try {
      const k = v.asset.address.toLowerCase();
      const prev = byAsset.get(k) ?? { units: BigInt(0), decimals: v.asset.decimals, symbol: v.asset.symbol };
      byAsset.set(k, { ...prev, units: prev.units + BigInt(v.totalAssets) });
    } catch {
      skipped++;
    }
  }
  return { lines: [...byAsset.values()].map((v) => `${fmtBase(v.units.toString(), v.decimals)} ${v.symbol}`), skipped };
}

export function ManagerProfileModal({
  manager,
  vaults,
  onPickVault,
  onClose,
}: {
  manager: ManagerIdentity;
  /** Las bóvedas de ESTE gestor, ya filtradas del catálogo. */
  vaults: PoteCatalogEntry[];
  onPickVault: (pote: string) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  // La comunidad: perfil (nombre, foto, persona/agente) y el recuento PÚBLICO.
  const { actors } = useCommunity();
  const actor = manager.address ? actors.get(manager.address) ?? null : null;
  const who = withProfile(manager, actor);
  const endorsed = actor?.endorsedByMe ?? false;
  const tally = actor?.endorsements ?? 0;
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [voteBusy, setVoteBusy] = useState(false);
  const [voteError, setVoteError] = useState('');
  async function vote(on: boolean) {
    if (!manager.address) return;
    setVoteBusy(true);
    setVoteError('');
    try {
      const res = await endorseManager({ account: manager.address, on });
      if (!res.ok) { setVoteError(refusalText(res.refusal)); return; }
      // Lo que el servidor devolvió, en sitio: sin re-descargar la comunidad.
      patchActorEndorsement(res.data.account, res.data.endorsements, res.data.endorsedByMe);
    } catch (e) {
      // Red caída / fetch rechazado: se dice y el botón vuelve a estar vivo.
      setVoteError(e instanceof Error ? e.message : String(e));
    } finally {
      setVoteBusy(false);
    }
  }
  const [copied, setCopied] = useState(false);
  /** El clipboard falló o no existe: el enlace se enseña para copiar a mano. */
  const [linkFallback, setLinkFallback] = useState<string | null>(null);

  // La credencial, en TRES estados honestos. «Verificado» solo si TODAS sus
  // bóvedas llevan el tick: con lecturas mixtas, un verde en la cabecera
  // contradiría el ámbar que el catálogo pinta en sus otras cards.
  const withCred = vaults.filter((v) => v.credential?.issuer).length;
  const credState: 'all' | 'some' | 'none' =
    vaults.length > 0 && withCred === vaults.length ? 'all' : withCred > 0 ? 'some' : 'none';
  const issuer = vaults.find((v) => v.credential?.issuer)?.credential?.issuer ?? null;
  const capital = useMemo(() => capitalLines(vaults), [vaults]);

  // El enlace de REFERIDOS: abre Earn ya puesto sobre este perfil. Es la
  // herramienta de captación del gestor — el deep-link ?view=managers existe
  // desde antes; &manager= lo lee el catálogo al montar.
  function copyLink() {
    const url = `${window.location.origin}/app/asset-production?view=managers&manager=${encodeURIComponent(manager.key)}`;
    if (!navigator.clipboard?.writeText) {
      // Sin clipboard (permisos, iframes, navegadores viejos) el botón no
      // puede quedarse mudo: se enseña el enlace y se copia a mano.
      setLinkFallback(url);
      return;
    }
    navigator.clipboard.writeText(url).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2500);
      },
      () => setLinkFallback(url),
    );
  }

  return (
    <ModalOverlay
      onEscape={onClose}
      lockScroll
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
    >
      <div className="my-auto flex max-h-[min(90dvh,44rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-ink/10 bg-surface-1 shadow-2xl">
        {/* Cabecera: quién es, con su cara y su estado de acreditación. */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-ink/5 px-6 py-5">
          <div className="flex min-w-0 items-center gap-3">
            <ManagerAvatar manager={who} size={56} photo={who.photo} actorKind={who.actorKind} />
            <div className="min-w-0">
              <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold tracking-tight text-ink">
                <span className="truncate">{who.name}</span>
                <ActorKindBadge kind={who.actorKind} />
              </h2>
              {manager.kind === 'astryum' ? (
                <p className="mt-0.5 text-[11px] text-ink/45">
                  {t('Demo vaults by Astryum — no third-party manager runs these.')}
                </p>
              ) : (
                <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-ink/45">
                  {manager.address && (
                    <a
                      href={`${XRPL_EXPLORER}${manager.address}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-mono transition-colors hover:text-ink/80"
                    >
                      {shortAddr(manager.address)} <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {credState === 'all' ? (
                    <span className="inline-flex items-center gap-1 text-tone-success">
                      <BadgeCheck className="h-3.5 w-3.5" strokeWidth={2} />
                      {t('Verified by')} {issuer ? shortAddr(issuer) : ''}
                    </span>
                  ) : credState === 'some' ? (
                    <span className="inline-flex items-center gap-1 text-ink/50">
                      <BadgeCheck className="h-3.5 w-3.5" strokeWidth={2} />
                      {`${t('Credential on')} ${withCred}/${vaults.length} ${t('vaults')}`}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-tone-warning">
                      <ShieldAlert className="h-3.5 w-3.5" strokeWidth={2} /> {t('Not accredited')}
                    </span>
                  )}
                </p>
              )}
            </div>
          </div>
          <button onClick={onClose} aria-label={t('Close')} className="mt-1 shrink-0 text-ink/40 transition-colors hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-5">
          {/* El perfil PÚBLICO: lo auto-declarado por el dueño
              probado de la cuenta + las credenciales vigentes con su prueba.
              El cliente lo revisa ANTES de poner capital. */}
          {manager.address ? (
            <div className="mb-4">
              <ManagerPublicProfile account={manager.address} />
            </div>
          ) : null}

          {/* Los hechos del gestor — solo lo que la chain sabe. */}
          <div className="grid grid-cols-3 gap-3">
            {([
              [t('Vaults'), String(vaults.length)],
              [
                t('Capital inside'),
                capital.lines.length
                  ? capital.lines.join(' · ') + (capital.skipped > 0 ? ' +?' : '')
                  : '—',
              ],
              [t('Depositors'), '—'],
            ] as Array<[string, string]>).map(([k, v]) => (
              <div key={k} className="min-w-0 rounded-xl border border-ink/10 bg-ink/[0.02] px-3 py-2.5">
                <p className="truncate font-mono text-[9px] uppercase tracking-[0.12em] text-ink/30">{k}</p>
                <p className="mt-0.5 truncate font-mono text-[13px] text-ink/80">{v}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-ink/35">
            {capital.skipped > 0 && (
              <>
                {`+? — ${capital.skipped} ${t('vaults could not be read and are not in the sum.')} `}
              </>
            )}
            {t('How many accounts sit in each vault is not on the public chain read yet — the slot will fill when that read lands. Nothing here is a performance figure: vaults, capital and accreditation are chain facts, not results.')}
          </p>

          {/* Sus bóvedas — cada fila abre la ficha en el catálogo. */}
          <div className="mt-5">
            <MicroLabel>{t('The vaults this manager runs')}</MicroLabel>
            {vaults.length === 0 ? (
              <p className="mt-2 text-sm text-ink/45">{t('No open vaults right now.')}</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {vaults.map((v) => (
                  <li key={v.pote}>
                    <button
                      onClick={() => onPickVault(v.pote)}
                      className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-ink/10 px-3 py-2 text-left transition-colors hover:border-volt/35 hover:bg-volt/[0.04]"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Landmark className="h-4 w-4 shrink-0 text-ink/35" strokeWidth={1.7} />
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-medium text-ink">
                            {v.name ?? shortAddr(v.pote)}
                          </span>
                          <span className="block text-[11px] text-ink/40">
                            {(v.asset?.symbol ?? '—') + ' · ' + t('exit') + ' ' + fmtExitWindow(v.cooldownSeconds, t)}
                          </span>
                        </span>
                      </span>
                      {v.totalAssets != null && v.asset ? (
                        <span className="shrink-0 font-mono text-[12px] text-ink/60">
                          {fmtBase(v.totalAssets, v.asset.decimals)} {v.asset.symbol}
                        </span>
                      ) : (
                        <Pill tone="neutral">—</Pill>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* El apoyo de la comunidad — el voto del fundador:
              quien mejor lo haga gana visibilidad. Visibilidad VOTADA POR
              USUARIOS y elegida como orden, nunca ranking por defecto (#9).
              Solo gestores REALES: apoyar a «Astryum made» no significa nada
              (no compite) y a un desconocido, menos. */}
          {isRealManager(manager) && (
            <div className="mt-5 rounded-xl border border-ink/10 bg-ink/[0.02] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <MicroLabel>{t('Community support')}</MicroLabel>
                <span className="font-mono text-[12px] text-ink/70">
                  <ThumbsUp className="mr-1 inline h-3.5 w-3.5 text-volt" strokeWidth={2} />
                  {tally} {t('supporters')}
                </span>
              </div>
              <p className="mt-2 max-w-[62ch] text-[12px] leading-relaxed text-ink/50">
                {t('Supporting a manager is a community vote, counted on the server — one per account. It surfaces managers through a sort you choose, never as Astryum vouching for anyone.')}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {!isAuthenticated ? (
                  <p className="text-[11px] text-ink/45">{t('Log in to support this manager.')}</p>
                ) : endorsed ? (
                  <GhostButton onClick={() => void vote(false)} disabled={voteBusy}>
                    <ThumbsUp className="mr-1.5 inline h-3.5 w-3.5" /> {t('Supported by you — withdraw')}
                  </GhostButton>
                ) : (
                  <PrimaryButton onClick={() => void vote(true)} disabled={voteBusy}>
                    <ThumbsUp className="mr-1.5 inline h-3.5 w-3.5" /> {t('Support this manager')}
                  </PrimaryButton>
                )}
                {manager.address ? (
                  <Link href={actorProfileHref(manager.address)} className="inline-flex items-center gap-1 text-[11px] text-volt hover:underline">
                    {t('Open full profile')} <ArrowUpRight className="h-3 w-3" />
                  </Link>
                ) : null}
              </div>
              {voteError ? <p className="mt-2 text-[11px] text-tone-warning">{voteError}</p> : null}
            </div>
          )}

          {/* El enlace de referidos: la herramienta de captación del gestor.
              Solo para gestores reales — el perfil de la casa no capta. */}
          {isRealManager(manager) && (
            <div className="mt-4 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <GhostButton onClick={copyLink}>
                  <Copy className="mr-1.5 inline h-3.5 w-3.5" />
                  {copied ? t('Link copied') : t('Copy profile link')}
                </GhostButton>
                <p className="text-[10px] leading-relaxed text-ink/40">
                  {t('The link opens Earn directly on this profile — how a manager brings their own clients.')}
                </p>
              </div>
              {linkFallback && (
                <div className="rounded-lg border border-ink/10 bg-ink/[0.02] p-2">
                  <p className="mb-1 text-[10px] text-ink/45">{t('Copying failed here — select the link by hand:')}</p>
                  <input
                    readOnly
                    value={linkFallback}
                    onFocus={(e) => e.currentTarget.select()}
                    className="w-full bg-transparent font-mono text-[11px] text-ink/70 outline-none"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </ModalOverlay>
  );
}

export default ManagerProfileModal;
