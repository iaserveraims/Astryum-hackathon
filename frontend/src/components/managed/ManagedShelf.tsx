'use client';

/**
 * ManagedShelf — los vaults donde un TERCERO gestiona el capital, vistos desde
 * el lado del cliente, dentro de Strategies.
 *
 * READ PATH (8-sep): `useMyManagedPositions` mira TODAS las direcciones
 * linkeadas — cada wallet EVM y la Personal Account de cada wallet XRPL — y
 * encuentra los potes donde hay shares (el depósito por XRP las deja en la PA).
 *
 * ES UNA VISTA DE POSICIÓN, NO DE CATÁLOGO (fundador 8-sep): aquí ya TIENES
 * capital dentro, así que no se muestra la ficha de «entrar» (venues, gestor,
 * «Enter this vault») — eso es para decidir entrar. Se muestra lo justo: qué
 * tienes (shares + dirección) y UN botón para SALIR. La info de la salida
 * (ventana, importe, a dónde vuelve) la da el propio modal antes de firmar.
 *
 * «NO PUDE LEER» ≠ «NO TIENES» (revisión 14-sep): con una lectura caída el
 * titular decía «You have no managed vaults» y el fallo iba en letra pequeña —
 * y lo que se lee es el titular. Ahora la vista la decide `managedShelfView`:
 * lectura fallida sin posiciones tiene SU titular y un Retry.
 *
 * COPY que se mantiene: el gestor es un tercero, nunca Astryum; lo que puede o
 * no hacer lo impone el CONTRATO; ni tasa ni proyección (invariante #9).
 */

import { useState } from 'react';
import { AlertTriangle, ExternalLink, LogOut, RefreshCw, ShieldCheck, Users } from 'lucide-react';

import { Card, GhostButton, MicroLabel } from '../ui/primitives';
import { AstryumLoader } from '../ui/AstryumLoader';
import { useT } from '../../i18n/LanguageProvider';
import { useMyManagedPositions, type ManagedPosition } from '../../lib/institutional/useMyManagedPositions';
import { managedShelfView } from '../../lib/institutional/managedReadState';
import { fmtBase } from '../../lib/institutional/policyCatalog';
import { useMyWallets } from '../../hooks/useMyWallets';
import { useWalletLabeler } from '../../lib/wallet/useWalletLabeler';
import { VaultEntryModal } from './VaultEntryModal';

const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const EXPLORER = 'https://flare-explorer.flare.network/address/';

function exitWindow(seconds: number | null, t: (s: string) => string): string {
  if (seconds == null) return '—';
  if (seconds === 0) return t('immediate');
  const h = seconds / 3600;
  return h >= 48 ? `${Math.round(h / 24)} d` : `${Math.round(h)} h`;
}

export function ManagedShelf() {
  const { t } = useT();
  const { loading, positions, error, partial, reload } = useMyManagedPositions();
  const [exitPos, setExitPos] = useState<ManagedPosition | null>(null);
  // El APODO del dueño, nunca el hex crudo (igual que el picker y el claim): la
  // cuenta que tiene estas shares es del usuario, así que se dice por su nombre.
  const { wallets: labelWallets } = useMyWallets();
  const { nameOf } = useWalletLabeler(labelWallets, t);

  const view = managedShelfView({ loading, positionsCount: positions.length, error, partial });

  const retryButton = (
    <GhostButton onClick={reload} disabled={loading} className="mt-2">
      <RefreshCw className={`mr-1.5 inline h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
      {t('Try again')}
    </GhostButton>
  );

  return (
    <Card className="p-6">
      <MicroLabel>{t('Managed by a third party')}</MicroLabel>

      {view === 'loading' ? (
        /* Espera de sección con la marca (v-100%, 2026-09-08). */
        <div className="mt-4">
          <AstryumLoader size={48} label={t('Reading your positions from the chain…')} />
        </div>
      ) : view === 'list' || view === 'list-incomplete' ? (
        <div className="mt-3 space-y-3">
          <p className="max-w-[62ch] text-[13px] leading-relaxed text-ink/55">
            {t('Vaults where you hold shares — across all your linked wallets and their Smart Accounts. The manager is a third party; only your signature moves your capital.')}
          </p>
          {/* Lista PARCIAL: alguna lectura falló — se dice, no se esconde. */}
          {view === 'list-incomplete' && (
            <div>
              <p className="text-[11px] text-tone-warning">
                {t('Some vaults could not be read right now — the list may be incomplete. Try again in a moment.')}
              </p>
              {retryButton}
            </div>
          )}
          {positions.map((p) => (
            <div key={`${p.entry.pote}:${p.holder}`} className="rounded-xl border border-ink/10 bg-ink/[0.02] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">
                    {p.entry.name ?? shortAddr(p.entry.pote)}
                  </span>
                  <a
                    href={`${EXPLORER}${p.entry.pote}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-0.5 inline-flex items-center gap-1 font-mono text-[11px] text-ink/45 transition-colors hover:text-ink/70"
                  >
                    {shortAddr(p.entry.pote)} <ExternalLink className="h-3 w-3" />
                  </a>
                  {/* De QUÉ wallet es esta posición: dos wallets en el mismo pote
                      son dos filas, cada una con su dueña. */}
                  <span className="mt-0.5 block truncate text-[11px] text-ink/40">
                    {t('Your wallet')}: <span className="text-ink/70">{nameOf(p.ownerXrpl ?? p.holder)}</span>{' '}
                    <span className="font-mono text-ink/45">{shortAddr(p.ownerXrpl ?? p.holder)}</span>
                  </span>
                </div>
                <div className="shrink-0 text-right">
                  <span className="block font-mono text-sm text-ink">{fmtBase(p.sharesBase, p.shareDecimals)}</span>
                  <span className="block text-[10px] text-ink/40">{t('shares')}</span>
                </div>
              </div>

              {/* Lo justo para orientarse antes de salir — el resto lo da el modal. */}
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink/45">
                {p.entry.asset ? (
                  <span>{t('Asset')}: <span className="text-ink/70">{p.entry.asset.symbol}</span></span>
                ) : null}
                <span>{t('Exit window')}: <span className="text-ink/70">{exitWindow(p.entry.cooldownSeconds, t)}</span></span>
              </div>

              <GhostButton onClick={() => setExitPos(p)} className="mt-3 border-volt/40 text-volt">
                <LogOut className="mr-1.5 inline h-3.5 w-3.5" />
                {t('Leave this vault')}
              </GhostButton>
            </div>
          ))}
        </div>
      ) : view === 'unreadable' ? (
        /* «No pude leer» ≠ «no tienes» — también cuando el fallo fue por pote
           (partial) y no del catálogo entero (error). Titular propio + Retry. */
        <div className="mt-3 flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-tone-warning" strokeWidth={1.6} />
          <div className="min-w-0">
            <h3 className="text-base font-semibold tracking-tight text-ink">
              {t("Couldn't read your managed vaults")}
            </h3>
            <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-ink/55">
              {t('The chain could not be read right now — that is not the same as having none. Try again in a moment.')}
            </p>
            {error ? <p className="mt-1 font-mono text-[11px] text-ink/40">{error}</p> : null}
            {retryButton}
          </div>
        </div>
      ) : (
        <div className="mt-3 flex items-start gap-3">
          <Users className="mt-0.5 h-5 w-5 shrink-0 text-ink/35" strokeWidth={1.6} />
          <div className="min-w-0">
            <h3 className="text-base font-semibold tracking-tight text-ink">
              {t('You have no managed vaults')}
            </h3>
            <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-ink/55">
              {t(
                'When you enter a vault run by a manager, it shows up here: what it holds, what it did, and how to leave. The manager is a third party — never Astryum.',
              )}
            </p>
          </div>
        </div>
      )}

      {/* El mecanismo, no una tranquilización: lo que el contrato rechaza es la
          única razón por la que esta estantería puede existir. */}
      <div className="mt-5 flex items-start gap-3 rounded-xl border border-ink/10 bg-ink/[0.02] p-4">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-ink/35" strokeWidth={1.7} />
        <p className="max-w-[62ch] text-[13px] leading-relaxed text-ink/50">
          {t(
            'A manager moves your capital only between destinations the vault already allows. Adding a new one is possible but takes 30 days before a single token can go there, which is your window to walk out.',
          )}
        </p>
      </div>

      {/* SALIR: el modo exit del mismo modal — el picker elige la wallet (la PA
          por Xaman, o una Flare por redeem directo) y la info de la salida se ve
          antes de firmar. Astryum no firma. */}
      {exitPos && (
        <VaultEntryModal
          entry={exitPos.entry}
          mode="exit"
          sharesBase={exitPos.sharesBase}
          shareDecimals={exitPos.shareDecimals}
          /* La salida firma con la cuenta DUEÑA de estas shares: si son de una
             PA, su r-address XRPL (por Xaman); si es EVM, el redeem de siempre. */
          exitAccount={exitPos.ownerXrpl ?? undefined}
          onClose={() => setExitPos(null)}
          onChanged={reload}
        />
      )}
    </Card>
  );
}

export default ManagedShelf;
