'use client';

/**
 * VaultDetailPanel — lo que se despliega al elegir una bóveda del catálogo.
 *
 * El usuario escoge una bóveda como escogería cualquier estrategia de «Choose a
 * Strategy». El gestor no es un producto aparte: es una
 * PROPIEDAD de la bóveda, como su plazo de salida o su lista de destinos. Por
 * eso el panel se abre sobre la bóveda y el gestor aparece dentro, no al revés.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ExternalLink, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';

import { Card, GhostButton, MicroLabel, Pill, PrimaryButton } from '../ui/primitives';
import { useT } from '../../i18n/LanguageProvider';
import { useWalletPartner } from '../../lib/wallet/useWalletPartner';
import { useXrplWalletPartner } from '../../lib/wallet/useXrplWalletPartner';
import { resolvePersonalAccountOf } from '../../lib/wallet/paOwnership';
import { fmtBase } from '../../lib/institutional/policyCatalog';
import { fmtExitWindow, shortAddr } from '../../lib/institutional/format';
import { venueStory } from '../../lib/institutional/venueStory';
import { useVenueYields, venueYieldKey } from '../../lib/institutional/useVenueYields';
import { venueIdentity } from '../../lib/institutional/venueIdentity';
import { readableAsOf, readableNote, readableSource } from '../../lib/earn/rateSource';
import { getPoteState, type PoteCatalogEntry, type PoteState } from '../../lib/institutional/api';
import { decidePosition, type HolderRead, type PaResolution } from '../../lib/institutional/positionRead';
import { ManagedVaultNotice } from './ManagedVaultNotice';
import { VaultEntryModal, type EntryMode } from './VaultEntryModal';
import { ActorKindBadge, ManagerAvatar, managerOf, withProfile } from './managerIdentity';
import { useCommunity } from '../../lib/institutional/useCommunity';

const FLARE_EXPLORER = 'https://flare-explorer.flare.network/address/';

/** El tipo de venue, dicho en palabras: sale de la cadena, no de una lista nuestra. */
function kindLabel(kind: number, t: (s: string) => string): string {
  if (kind === 0) return t('Lending market');
  if (kind === 1) return t('Vault (immediate exit)');
  return t('Vault (exit through a queue)');
}


export function VaultDetailPanel({
  entry,
  onOpenManager,
  onChanged,
}: {
  entry: PoteCatalogEntry;
  /** Abre el PERFIL del gestor (sus bóvedas, su apoyo, su enlace). Opcional:
   *  la ficha vive también donde no hay catálogo al que volver. */
  onOpenManager?: () => void;
  /** Aviso a quien monta la ficha (p.ej. el estante) de que la posición cambió. */
  onChanged?: () => void;
}) {
  const { t } = useT();
  const evm = useWalletPartner();
  const xrpl = useXrplWalletPartner();
  const mgr = managerOf(entry);
  // El perfil público delante: nombre, foto y persona/agente.
  const { actors } = useCommunity();
  // El tipo actual de cada destino, como lo publica el protocolo.
  const venueYields = useVenueYields();
  const who = withProfile(mgr, mgr.address ? actors.get(mgr.address) : null);
  const ready = entry.venues.filter((v) => !v.retired);
  const [modal, setModal] = useState<EntryMode | null>(null);
  const [claimTicket, setClaimTicket] = useState<number | null>(null);

  // El holder de tus shares puede ser tu wallet EVM (depósito directo) O la
  // Personal Account de tu wallet XRPL (depósito por XRP — ahí van por defecto).
  // Resolvemos la PA para poder mirar las DOS y no perder la posición.
  //
  // Un fallo al resolverla YA NO se traga: con la PA desconocida, las
  // shares que viven allí son desconocidas, y decir «no estás en esta bóveda»
  // sería afirmar algo que nadie sabe. El backend siempre devuelve la PA
  // determinista de una r-address, así que `null` aquí es «no se pudo leer».
  const [pa, setPa] = useState<string | null>(null);
  const [paStatus, setPaStatus] = useState<PaResolution>('none');
  const [paAttempt, setPaAttempt] = useState(0);
  useEffect(() => {
    if (!xrpl.address) { setPa(null); setPaStatus('none'); return; }
    let alive = true;
    setPaStatus('resolving');
    resolvePersonalAccountOf(xrpl.address)
      .then((r) => { if (!alive) return; setPa(r); setPaStatus(r ? 'resolved' : 'failed'); })
      .catch(() => { if (alive) setPaStatus('failed'); });
    return () => { alive = false; };
  }, [xrpl.address, paAttempt]);

  /**
   * Tu posicion dentro. `pote-state` la devuelve cuando se le pasa la cuenta:
   * sin ella el usuario no sabe si ya esta dentro. Se mira en TODOS tus holders
   * (EVM + PA) y manda el que tenga shares — el depósito por XRP las deja en la
   * PA, así que mirar solo la EVM las perdía.
   *
   * Cada lectura guarda su resultado —ok o FALLIDA— y `decidePosition` decide:
   * antes un fallo se convertía en `null` y `null` pintaba «You are
   * not in this vault.» escondiendo la salida.
   */
  // Secuencia (revisión): la PA llega después que la wallet EVM y las
  // dos lecturas se solapan; la más antigua no puede pisar a la más nueva.
  const reloadSeq = useRef(0);
  const holdersKey = [pa, evm.address].filter((a): a is string => !!a).join('|').toLowerCase();
  const [readsFor, setReadsFor] = useState<{ key: string; reads: HolderRead[] }>({ key: '', reads: [] });
  const [reloading, setReloading] = useState(false);
  const reload = useCallback(() => {
    const mine = ++reloadSeq.current;
    const holders = [pa, evm.address].filter((a): a is string => !!a);
    const key = holders.join('|').toLowerCase();
    if (holders.length === 0) { setReadsFor({ key, reads: [] }); setReloading(false); return; }
    setReloading(true);
    Promise.all(
      holders.map((h) =>
        getPoteState(entry.pote, h).then(
          (s): HolderRead => ({ status: 'ok', state: s }),
          (): HolderRead => ({ status: 'failed' }),
        ),
      ),
    ).then((rs) => {
      if (mine !== reloadSeq.current) return;
      setReadsFor({ key, reads: rs });
      setReloading(false);
    });
  }, [entry.pote, pa, evm.address]);
  useEffect(() => () => { reloadSeq.current += 1; }, []);

  useEffect(() => { reload(); }, [reload]);

  function retryRead() {
    if (paStatus === 'failed') setPaAttempt((n) => n + 1);
    reload();
  }

  // Lecturas de OTRO conjunto de holders (la wallet cambió) no valen: pendientes.
  const reads: HolderRead[] =
    readsFor.key === holdersKey
      ? readsFor.reads
      : holdersKey.split('|').filter(Boolean).map((): HolderRead => ({ status: 'pending' }));
  const position = decidePosition({ pa: paStatus, reads });
  const state: PoteState | null =
    position.kind === 'in' || position.kind === 'out' || position.kind === 'failed' ? position.state : null;
  const shares = position.kind === 'in' ? (position.state.holder?.shares ?? null) : null;
  const hasPosition = position.kind === 'in';

  /**
   * Salidas pedidas y sin cobrar, TUYAS.
   *
   * En una boveda con plazo, pedir la salida no devuelve el dinero: abre un
   * ticket que madura. Sin esta lista el usuario pide salir, pasan las horas y
   * su capital no aparece en ninguna parte de la interfaz — no es una funcion
   * que falte, es dinero que parece perdido.
   */
  const holderKeys = new Set(
    [pa, evm.address].filter((a): a is string => !!a).map((a) => a.toLowerCase()),
  );
  const myTickets = (state?.tickets ?? []).filter(
    (tk) => !tk.claimed && holderKeys.has(tk.receiver.toLowerCase()),
  );

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <MicroLabel>{t('This vault')}</MicroLabel>
          <h3 className="mt-1 text-base font-semibold tracking-tight text-ink">
            {entry.name ?? shortAddr(entry.pote)}
          </h3>
          <a
            href={`${FLARE_EXPLORER}${entry.pote}`}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 font-mono text-[11px] text-ink/40 transition-colors hover:text-ink/70"
          >
            {shortAddr(entry.pote)} <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        {entry.gated && <Pill tone="neutral">{t('Entry gated')}</Pill>}
      </div>

      {/* Siempre a la vista: no es una boveda normal, hay alguien decidiendo. */}
      <ManagedVaultNotice className="mt-4" />

      {entry.unreadable && (
        <p className="mt-3 text-[13px] leading-relaxed text-tone-warning/80">
          {t('Its state could not be read right now — that is not the same as empty.')}
        </p>
      )}

      {/* Los hechos con los que se decide, antes que nada. */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([
          [t('Asset'), entry.asset?.symbol ?? '—'],
          [t('Exit window'), fmtExitWindow(entry.cooldownSeconds, t)],
          [t('Max per venue'), entry.maxVenueBps == null ? '—' : `${entry.maxVenueBps / 100}%`],
          [t('Untouchable floor'), entry.bufferFloorBps == null ? '—' : `${entry.bufferFloorBps / 100}%`],
        ] as Array<[string, string]>).map(([k, v]) => (
          <div key={k} className="min-w-0">
            <p className="truncate font-mono text-[9px] uppercase tracking-[0.12em] text-ink/30">{k}</p>
            <p className="truncate font-mono text-[13px] text-ink/80">{v}</p>
          </div>
        ))}
      </div>

      {/* ── QUÉ PASA CON TUS TOKENS. No es un préstamo ni
          hay colateral: se dice el mecanismo entero en cuatro frases, y lo
          que produce cada destino como MECANISMO, nunca como cifra (#9). ── */}
      <div className="mt-6 rounded-xl border border-ink/10 bg-ink/[0.02] p-4">
        <MicroLabel>{t('What happens to your tokens here')}</MicroLabel>
        <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-ink/65">
          <li>
            <span className="font-medium text-ink/85">{t('Not a loan, no collateral.')}</span>{' '}
            {entry.asset?.symbol
              ? `${t('You deposit')} ${entry.asset.symbol} ${t('and receive shares')}${entry.symbol ? ` (${entry.symbol})` : ''} ${t('in your own wallet — one proportional slice of the vault.')}`
              : t('You deposit the vault’s asset and receive shares in your own wallet — one proportional slice of the vault.')}
          </li>
          <li>
            {ready.length > 0
              ? t('The manager can only move the pooled capital into the destinations below. What those destinations produce stays in the vault, pro-rata to your shares.')
              : t('This vault has no destination yet: your capital would sit idle inside it until the manager proposes one — and any new destination waits 30 days, which is your month to leave.')}
          </li>
          <li>
            {t('The manager’s fee applies to what the vault produces — never to your principal. Exit:')}{' '}
            {fmtExitWindow(entry.cooldownSeconds, t)}
            {entry.bufferFloorBps != null ? ` · ${entry.bufferFloorBps / 100}% ${t('always stays liquid for exits.')}` : ''}
          </li>
          <li className="text-ink/45">
            {t('Why there is no single APY here: what the vault earns is the mix of what the manager places at each destination, and when. Below, each destination shows the rate its protocol publishes right now — that protocol’s number, not Astryum’s, and it changes constantly. A destination can also lose money.')}
          </li>
        </ul>
      </div>

      {/* ── La lista de destinos, entera ── */}
      <div className="mt-6">
        <MicroLabel>{t('Where this vault may take your capital')}</MicroLabel>
        <p className="mt-2 max-w-[70ch] text-[12px] leading-relaxed text-ink/45">
          {t('This list is the whole cage: anywhere outside it, the contract reverts. Adding a new one takes 30 days, which is your month to leave if you do not like it.')}
        </p>

        {ready.length === 0 ? (
          <p className="mt-3 text-sm text-ink/45">{t('No venues allowed yet.')}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {ready.map((v) => {
              const waitMs = v.readyInSeconds * 1000;
              return (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink/10 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    {/* Nombre verificado (mapa on-chain de venueIdentity) cuando lo
                        hay; si no, SOLO la dirección — jamás un nombre inventado. */}
                    {(() => { const st = venueStory(v.target, v.kind, t); return (
                      <>
                        <p className="flex flex-wrap items-center gap-x-2 text-[13px] font-medium text-ink">
                          {st.known ? st.label : null}
                          <a
                            href={`${FLARE_EXPLORER}${v.target}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 font-mono text-[11px] font-normal text-ink/50 transition-colors hover:text-ink"
                          >
                            {shortAddr(v.target)} <ExternalLink className="h-3 w-3" />
                          </a>
                        </p>
                        <p className="mt-0.5 text-[11px] text-ink/40">{kindLabel(v.kind, t)}</p>
                        <p className="mt-1 max-w-[60ch] text-[11px] leading-relaxed text-ink/55">{st.does}</p>
                        {/* EL TIPO DE HOY, del protocolo, con su fuente y su hora (#9).
                            Sin lectura: sin número, y el enlace para comprobarlo allí. */}
                        {(() => {
                          const key = venueYieldKey(v.target);
                          const y = key && venueYields.yields ? venueYields.yields[key] : undefined;
                          const site = venueIdentity(v.target).website;
                          if (!key) return null;
                          if (!venueYields.yields) return venueYields.loading ? <p className="mt-1 text-[11px] text-ink/35">{t('Reading today’s rate from the protocol…')}</p> : null;
                          if (!y || y.kind === 'none') {
                            return (
                              <p className="mt-1 text-[11px] text-ink/45">
                                {y && y.kind === 'none' ? t(y.label) : t('Live rate unavailable — check the protocol')}
                                {site ? <> · <a href={site} target="_blank" rel="noopener noreferrer" className="text-volt hover:underline">{t('check it there')}</a></> : null}
                              </p>
                            );
                          }
                          const src = readableSource(y.source);
                          const asOf = readableAsOf(venueYields.asOf);
                          const note = readableNote(y.note);
                          return (
                            <p className="mt-1 text-[11px] leading-relaxed text-ink/55">
                              <span className="font-mono text-[12px] text-ink/85">{y.pct.toFixed(2)}% {y.kind.toUpperCase()}</span>
                              <span className="text-ink/40"> · {t('today, at')} {st.label.split(' · ')[0]}</span>
                              {src ? <span className="text-ink/40" title={src.tech}> · {t(src.text)}</span> : null}
                              {asOf ? <span className="text-ink/35"> · {asOf}</span> : null}
                              {note ? <span className="block text-ink/40">{note}</span> : null}
                              <span className="block text-ink/35">{t('The protocol’s figure, not a promise: it moves every block and applies only to what the manager places there.')}</span>
                            </p>
                          );
                        })()}
                      </>
                    ); })()}
                  </div>
                  {waitMs > 0 ? (
                    <Pill tone="warning">{`${t('opens in')} ${Math.ceil(waitMs / 86400000)} d`}</Pill>
                  ) : (
                    <Pill tone="success">{t('open')}</Pill>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* HUECO MARCADO: cuando la jaula v2 este en mainnet, cada destino podra
            decir si esta en el AstryumRegistry. Esa —y no un nombre bonito— es
            la senal que separa un venue real de un vault falso. */}
        {/* El tono importa: esto no es una nota al pie. Un destino que no se
            puede reconocer es exactamente la cara del vault falso que en el
            pote v1 funciona (AstryumCage.t.sol), asi que va en ambar y no en
            gris — el gris se lee como «detalle tecnico» y se salta. */}
        <div className="mt-3 flex items-start gap-3 rounded-xl border border-tone-warning/30 bg-tone-warning/[0.06] p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-tone-warning" strokeWidth={1.8} />
          <p className="max-w-[70ch] text-[12px] leading-relaxed text-ink/65">
            {t('Astryum does not vouch for these destinations and does not name them: a familiar name over an address that is not really it is exactly what a fake venue would look like. Open each one in the explorer and check it yourself before putting money in.')}
          </p>
        </div>
      </div>

      {/* ── Quién la lleva ── */}
      <div className="mt-6">
        <MicroLabel>{t('Who runs it')}</MicroLabel>

        {/* EL GESTOR CON CARA: avatar, nombre y la
            puerta a su perfil — sus otras bóvedas, el apoyo de la comunidad y
            su enlace. Tres identidades: gestor real, «Astryum made» (bóveda
            de demostración declarada por env — jamás «gestionada por
            Astryum», invariantes #1/#8) y DESCONOCIDO (consejo sin resolver:
            no se afirma dueño, no hay perfil que abrir). */}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink/10 bg-ink/[0.02] p-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <ManagerAvatar manager={who} size={32} photo={who.photo} actorKind={who.actorKind} />
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium text-ink">
                <span className="truncate">{who.name}</span>
                <ActorKindBadge kind={who.actorKind} />
              </p>
              <p className="text-[11px] text-ink/40">
                {mgr.kind === 'astryum'
                  ? t('Demo vault — no third-party manager runs it')
                  : mgr.kind === 'unknown'
                    ? t('The governing account could not be resolved for this vault.')
                    : t('Manager of this vault')}
              </p>
            </div>
          </div>
          {onOpenManager && mgr.kind !== 'unknown' && (
            <GhostButton onClick={onOpenManager} className="shrink-0 text-xs">
              {t('See profile')} →
            </GhostButton>
          )}
        </div>

        {entry.councilXrplAddress ? (
          <>
            <p className="mt-3 font-mono text-[12px] text-ink/70">{entry.councilXrplAddress}</p>
            <p className="mt-1 max-w-[70ch] text-[12px] leading-relaxed text-ink/45">
              {t('The XRPL account that governs this vault. In a managed vault the manager is also its council, so this same account is the one that can add a destination — with the 30-day notice above.')}
            </p>
            {entry.credential?.issuer ? (
              <p className="mt-2 text-[12px] text-tone-success">
                {t('Verified by')} {shortAddr(entry.credential.issuer)}
              </p>
            ) : (
              // Ausencia de tick = ausencia de afirmacion. El backend junta «no
              // tiene credencial» y «no se pudo leer» a proposito: pintar «sin
              // verificar» seria afirmar algo que nadie sabe.
              // La credencial es REQUISITO, asi que su ausencia
              // ya no es silencio: es una señal. Pero el backend junta «no
              // tiene» y «no se pudo leer» en el mismo null, asi que la palabra
              // es «sin acreditar» — cubre los dos casos sin acusar de ninguno.
              <p className="mt-2 inline-flex items-start gap-1.5 text-[12px] leading-relaxed text-tone-warning/90">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
                <span className="max-w-[62ch]">
                  {t('This account shows no accreditation. A manager is required to hold one, so treat a vault without it as unresolved — not as approved.')}
                </span>
              </p>
            )}
          </>
        ) : (
          <p className="mt-2 text-[12px] text-ink/45">
            {t('The governing account could not be resolved for this vault.')}
          </p>
        )}
      </div>

      {/* ── Lo tuyo, y las dos puertas ── */}
      <div className="mt-6 border-t border-ink/5 pt-5">
        <MicroLabel>{t('Your position')}</MicroLabel>
        {/* La posición puede vivir en la wallet EVM o en la Personal Account de
            la Xaman: si existe, se enseña — sin pedir una wallet de Flare a
            quien entró con XRP (revisión). */}
        {/* Tres estados, jamás dos: leyendo, NO SE PUDO LEER, leído.
            «No se pudo leer» nunca se pinta como «no estás dentro»: quien cree
            que no tiene nada puede no intentar salir nunca. */}
        {position.kind === 'in' ? (
          <>
            <p className="mt-2 font-mono text-sm text-ink/80">
              {fmtBase(shares ?? '0', position.state.shareDecimals)} <span className="text-ink/40">{t('shares')}</span>
            </p>
            {position.incomplete && (
              <p className="mt-1 text-[11px] leading-relaxed text-tone-warning/80">
                {paStatus === 'failed'
                  ? t('The Flare account of your XRPL wallet could not be resolved — shares held there are not counted here.')
                  : t('One of your accounts could not be read — this may not be your whole position.')}
              </p>
            )}
          </>
        ) : position.kind === 'no-wallet' ? (
          <p className="mt-2 text-[12px] text-ink/45">
            {t('Connect your wallet (Xaman or Flare) to see whether you are already in this vault.')}
          </p>
        ) : position.kind === 'reading' ? (
          <p className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-ink/45">
            <Loader2 className="h-3 w-3 animate-spin" /> {t('Reading your position…')}
          </p>
        ) : position.kind === 'failed' ? (
          <div className="mt-2 space-y-2 rounded-xl border border-tone-warning/30 bg-tone-warning/[0.06] p-3">
            <p className="text-[12px] leading-relaxed text-ink/70">
              {position.reason === 'personal-account'
                ? t('Could not resolve the Flare account of your XRPL wallet, so shares held there cannot be seen right now. That is not the same as not being in this vault.')
                : t('Could not read your position in this vault right now. That is not the same as not being in it — your capital is where it was.')}
            </p>
            <p className="text-[11px] leading-relaxed text-ink/50">
              {t('You can still open the exit below: the contract checks what you hold, not this screen.')}
            </p>
            <GhostButton onClick={retryRead} disabled={reloading} className="text-xs">
              {reloading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} {t('Retry')}
            </GhostButton>
          </div>
        ) : (
          <p className="mt-2 text-[12px] text-ink/45">{t('You are not in this vault.')}</p>
        )}

        {/* Los tickets: lo que pediste sacar y todavia no has cobrado. */}
        {myTickets.length > 0 && state && (
          <ul className="mt-4 space-y-2">
            {myTickets.map((tk) => {
              const matureMs = tk.maturity * 1000;
              const ready = matureMs <= Date.now();
              return (
                <li
                  key={tk.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink/10 bg-ink/[0.02] px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-[12px] text-ink/75">
                      {fmtBase(tk.assets, state.asset.decimals)} {state.asset.symbol}
                    </p>
                    <p className="mt-0.5 text-[11px] text-ink/40">
                      {ready
                        ? t('ready to claim')
                        : `${t('claimable on')} ${new Date(matureMs).toLocaleString()}`}
                    </p>
                  </div>
                  {ready ? (
                    <PrimaryButton
                      onClick={() => { setClaimTicket(tk.id); setModal('claim'); }}
                      className="shrink-0 text-xs"
                    >
                      {t('Claim')}
                    </PrimaryButton>
                  ) : (
                    <Pill tone="warning">{t('waiting')}</Pill>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <PrimaryButton onClick={() => setModal('deposit')}>{t('Enter this vault')}</PrimaryButton>
          {/* La salida también se ofrece cuando NO se pudo leer: la puerta no
              depende de que esta pantalla sepa leer. */}
          {(hasPosition || position.kind === 'failed') && (
            <GhostButton onClick={() => setModal('exit')}>{t('Leave this vault')}</GhostButton>
          )}
        </div>
        <p className="mt-2 text-[11px] text-ink/35">
          {t('Astryum builds the call; your wallet signs it. It never signs for you.')}
        </p>
      </div>

      {modal && (
        <VaultEntryModal
          entry={entry}
          mode={modal}
          sharesBase={shares ?? undefined}
          shareDecimals={state?.shareDecimals}
          ticketId={claimTicket ?? undefined}
          /* Si el ticket que se cobra es de la PA (su receiver), el cobro va por
             0xFE (Xaman) con la r-address que la controla; si es de la wallet
             EVM, se queda en el claim EVM (claimAccount undefined). */
          claimAccount={
            modal === 'claim' && claimTicket != null && pa &&
            state?.tickets[claimTicket]?.receiver?.toLowerCase() === pa.toLowerCase()
              ? (xrpl.address ?? undefined)
              : undefined
          }
          onClose={() => { setModal(null); setClaimTicket(null); }}
          onChanged={() => { reload(); onChanged?.(); }}
        />
      )}
    </Card>
  );
}

export default VaultDetailPanel;
