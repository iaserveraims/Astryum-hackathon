'use client';

/**
 * SidebarIntentsCard — the always-on "waiting for your signature" surface,
 * pinned to the bottom of the app sidebar (replaces the old /app/intents nav
 * row; the page itself is kept and still reachable by URL).
 *
 * Empty almost always → a QUIET ZONE MARKER, not a card (founder 2026-09-11:
 * «no quiero que te lo avise cuando no hay nada pendiente… más que fuera un
 * espacio de notificaciones»): one muted line — bell + «Notifications» — that
 * teaches WHERE things will appear, and nothing else. No title «To sign», no
 * verdict sentence, no bordered box. The moment something needs the user, the
 * card POPS into that same spot with its amber border, its count and a
 * breathing dot next to the title — the indicator that says «here, now». And
 * the in-flight operations (SidebarSettlements, right below) share the zone:
 * while one is settling, ITS card occupies the space and the marker steps
 * aside, so the user learns one place for everything that is waiting or
 * working. The moment an automation leaves a prepared intent, it shows up here
 * (which strategy/action + protocol) without the user having to navigate
 * anywhere. Pressing a row opens a modal
 * that EXPLAINS the intent and lets the user sign it in their OWN wallet — the
 * same WaitingCard + sign path the full page uses. Astryum never signs.
 *
 * Today only EVM-addressed intents reach this card (the backend intent list is
 * EVM-keyed — see useIntentWatcher / backend/src/routes/intents.ts), so the
 * signing modality here is the wallet request. When XRPL/Xaman automation
 * intents land, this is where a Xaman QR would slot in (see modal below).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bell,
  FileSignature,
  ChevronRight,
  X,
  Check,
  ExternalLink,
  Loader2,
  Wallet as WalletIcon,
  Hourglass,
  HandCoins,
} from 'lucide-react';
import { Card, EmptyState, PrimaryButton } from '../ui/primitives';
import { EASE_OUT, PulseDot, backdropFade, modalPop } from '../ui/motion';
import { useReducedMotion } from '../../stores/motionStore';
import { useResumePendingSettlements } from '../../lib/settlement/useResumePendingSettlements';
import { FriendlyError } from '../../lib/authError';
import { useT } from '../../i18n/LanguageProvider';
import { useAuthorities } from '../../hooks/useAuthorities';
import { describeServerRefusal, describeUnreadableRows, type ReadableRefusal } from '../../lib/errors/serverRefusal';
import { ServerRefusalBody } from '../ui/ServerRefusalBody';
import Link from 'next/link';
import { councilProposalsApi, type CouncilProposalRecord, type PreparedIntent } from '../../services/v1Api';
import type { VaultClaimEntry, VaultClaimsUnreadable } from '../../hooks/useVaultClaimsWatcher';
import { claimsQueueUnreadable } from '../../lib/earn/vaultClaimsTick';
import { VaultClaimModal } from '../positions/VaultClaimModal';
import type { ManagedTicket } from '../../lib/institutional/useMyManagedPositions';
import { VaultEntryModal } from '../managed/VaultEntryModal';
import { actionLabel, shortAddr, FLARESCAN_TX, WaitingCard } from './intentPresentation';
import { useIntentSigning } from './useIntentSigning';
import { UnconfirmedSignatureNotice } from '../settlement/UnconfirmedSignatureNotice';
import { useModalRegistration } from '../ui/ModalPortal';

const MAX_ROWS = 3;

/**
 * The council's live proposals, for the sidebar tray.
 *
 * The card was TITLED "Proposals" in Legacy mode and showed none of them
 * (founder 2026-08-03): it listed automation intents and vault claims, so a
 * decision waiting for three family signatures was invisible unless someone
 * opened the Legacy tab. Read-only, polled gently — the tray never signs.
 */
interface CouncilUnreadableNotice {
  /** The sentence to put in front of the councillor. */
  text: string;
  /**
   * it. 25 (1): TRUE when the listing DID arrive and only some rows inside it
   * could not be read. The whole-read failure gets the «could not be read»
   * headline; a partial one already carries its own count, and prefixing it
   * would claim the whole tray failed when it did not.
   */
  partial: boolean;
  /**
   * it. 34 (agente D): el rechazo ENTERO cuando falló la lectura completa —
   * `headline`, `ways[]` y la puerta que `serverRefusalText` tiraba. El 403
   * NOT_A_COUNCIL_MEMBER de esta bandeja dice «register the wallet that holds
   * your seat» y no había nada que pulsar. Ausente en la lectura parcial, que
   * ya trae su propia frase con su cuenta.
   */
  refusal?: ReadableRefusal;
}

/**
 * productizer it. 25 (1) — QUÉ DICE LA BANDEJA CUANDO LA LECTURA LLEGA A MEDIAS.
 *
 * El `then` del éxito hacía `setUnreadable(null)` a secas. it. 23 hizo que la fila
 * que el servidor no pudo decidir viajase NOMBRADA en `unreadable[]` DENTRO del 200,
 * con su código y su frase — así que un 200 parcial no solo tiraba esas filas:
 * apagaba la advertencia que hubiese puesta. La bandeja volvía a decir «nada te
 * espera» sobre una lectura incompleta, que es el fallo exacto que esta tarjeta
 * existe para no cometer.
 *
 * Pura y de primitivos a propósito: es la pieza que un test puede sujetar, y la que
 * hace fallar a quien vuelva a poner un `null` ahí.
 */
function councilTrayUnreadable(landed: { unreadable?: unknown } | null, t: (s: string) => string): CouncilUnreadableNotice | null {
  const partial = describeUnreadableRows(landed?.unreadable, t);
  return partial ? { text: partial.text, partial: true } : null;
}

function useCouncilProposals(account: string | null): {
  rows: CouncilProposalRecord[];
  /** The refusal, as prose, when the council's tray could NOT be read (whole or in part). */
  unreadable: CouncilUnreadableNotice | null;
} {
  const { t } = useT();
  const [rows, setRows] = useState<CouncilProposalRecord[]>([]);
  const [unreadable, setUnreadable] = useState<CouncilUnreadableNotice | null>(null);
  // The reader must not re-run the poll every time the dictionary identity
  // changes; the sentence is only built inside the catch.
  const tRef = useRef(t);
  tRef.current = t;
  useEffect(() => {
    if (!account) {
      setRows([]);
      setUnreadable(null);
      return;
    }
    let alive = true;
    const load = () => {
      void councilProposalsApi
        .list([account], true)
        .then((r) => {
          if (!alive) return;
          setRows(r.proposals ?? []);
          // it. 25 (1): el aviso del 200 MANDA — si la respuesta trae filas que no se
          // pudieron leer, se dicen; solo una lectura COMPLETA apaga la advertencia.
          setUnreadable(councilTrayUnreadable(r, tRef.current));
        })
        .catch((e: unknown) => {
          // prosa-y-lectores — "THE TRAY DEGRADES TO EMPTY" WAS THE BUG.
          // This catch was empty, so any refusal left `rows` at [] and the
          // card printed "Nothing waiting for your signature" — a verdict, over
          // a read that never happened. The round-4 permission floor makes it
          // routine: `GET /council/proposals` answers 403 NOT_A_COUNCIL_MEMBER
          // whenever the session holds no registered wallet on this account's
          // signer list, so a councillor whose Xaman was never registered is
          // told, on every paint, that the family has nothing to decide —
          // while a proposal with a seven-day deadline runs out. The rows are
          // left ALONE (a stale list is still a list that was read); only the
          // sentence is set, and the existing 60 s poll clears it by itself —
          // no retry is offered here.
          if (alive) {
            const refusal = describeServerRefusal(e, tRef.current);
            setUnreadable({ text: refusal.text, partial: false, refusal });
          }
        });
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [account]);
  return { rows, unreadable };
}

/**
 * prosa-y-lectores — MAY THIS ZONE GO QUIET (the all-clear marker)?
 *
 * The quiet marker is a VERDICT about the council — «nothing needs you» — and
 * the card used to print its placeholder on `!hasAnything` alone, i.e. also
 * when the proposals read had been refused and swallowed. With the round-4
 * permission floor that is not an edge case: `GET /council/proposals` answers
 * 403 to any session holding no registered wallet on this account's signer
 * list, so the tray told a councillor "nothing to decide" on every paint while
 * a proposal counted down its seven days. A read we did not get is not an
 * emptiness we observed: when the council was unreadable the card STAYS, with
 * the server's own sentence in it, and the zone never goes quiet.
 *
 * (2026-09-11: the sentence «Nothing waiting for your signature» itself left
 * the sidebar with the quiet marker — this guard now decides the marker.)
 *
 * it. 31 — the SAME hole, for the claim queue. This guard knew the council
 * could be unreadable and not the withdrawal queue: with `/vault-claims`
 * answering 502 (the it. 29 refusal), the watcher had no rows, this said
 * «quiet», and the money in Firelight's queue — shares already burned —
 * vanished from the tray with its Claim button, one floor above where it. 29
 * fixed it. A queue we could not read is not a queue we saw empty.
 * Pure and primitive-only on purpose: this is the piece a test can hold.
 */
function mayClaimNothingWaiting(hasAnything: boolean, councilUnreadable: boolean, claimsUnreadable = false): boolean {
  return !hasAnything && !councilUnreadable && !claimsUnreadable;
}

/** Days left, floored at 0 — "expires today" reads better than "-1 days". */
function daysLeft(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

/** Short local "day month, HH:mm" for the in-flight ETA. */
function etaLabel(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function SidebarIntentsCard({
  waiting,
  refresh,
  claims = [],
  refreshClaims,
  claimsUnreadable = [],
  managedTickets = [],
  refreshManagedTickets,
  onBeforeOpen,
}: {
  /** Waiting intents from the shared AppShell poller (useIntentWatcher). */
  waiting: PreparedIntent[];
  /** Force an immediate re-poll after the user signs or dismisses. */
  refresh: () => void;
  /** Money in flight — queued vault exits of the ACTIVE authority (useVaultClaimsWatcher). */
  claims?: VaultClaimEntry[];
  /** Re-poll the claim queue (after a claim signature). */
  refreshClaims?: () => void;
  /** it. 31 — owners whose withdrawal queue the watcher could not (fully) read
   *  on its last tick. Non-empty ⇒ the tray never goes quiet, and says why. */
  claimsUnreadable?: VaultClaimsUnreadable[];
  /** Tickets de salida pendientes en managed vaults (requestRedeem) — «pending to withdraw». */
  managedTickets?: ManagedTicket[];
  /** Re-lee los tickets de managed tras cobrar. */
  refreshManagedTickets?: () => void;
  /** Called right before the modal opens — closes the mobile drawer so the modal isn't behind it. */
  onBeforeOpen?: () => void;
}) {
  const { t } = useT();
  // In Legacy (a governed authority is active) this same surface IS the council
  // proposals tray → title it "Proposals"; in Personal it is what it does:
  // things waiting for the user's signature ("intent" is architecture, R3).
  const { activeGoverned } = useAuthorities();
  const cardTitle = activeGoverned ? t('Proposals') : t('To sign');
  const [open, setOpen] = useState(false);
  /** The queued exit being claimed right now (opens VaultClaimModal). */
  const [claimOpen, setClaimOpen] = useState<VaultClaimEntry | null>(null);
  /** El ticket de managed vault que se está cobrando (abre VaultEntryModal claim). */
  const [managedClaim, setManagedClaim] = useState<ManagedTicket | null>(null);

  // The modal is portalled to <body>: the sidebar <aside> carries a CSS
  // transform (translate-x), which would otherwise become the containing block
  // for a position:fixed child and trap the modal inside the 256px rail.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Optimistically drop an intent the user just signed/dismissed so the count
  // and list update instantly; `refresh` then reconciles with the backend.
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    // Prune ids that are no longer waiting (backend already advanced them).
    setHiddenIds((s) => {
      if (s.size === 0) return s;
      const live = new Set(waiting.map((i) => i.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of s) {
        if (live.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : s;
    });
  }, [waiting]);

  const visible = useMemo(() => waiting.filter((i) => !hiddenIds.has(i.id)), [waiting, hiddenIds]);
  const claimableNow = useMemo(() => claims.filter((c) => c.claimable).length, [claims]);
  const managedClaimable = useMemo(() => managedTickets.filter((tk) => tk.claimable).length, [managedTickets]);
  const { rows: proposals, unreadable: councilUnreadable } = useCouncilProposals(
    activeGoverned?.address ?? null,
  );
  // The badge counts everything that needs the user: signatures, ready claims
  // (Earn queues + managed tickets) and the council's live proposals.
  const count = visible.length + claimableNow + managedClaimable + proposals.length;
  const hasAnything =
    visible.length > 0 || claims.length > 0 || managedTickets.length > 0 || proposals.length > 0;

  const signing = useIntentSigning((intentId) => {
    setHiddenIds((s) => new Set(s).add(intentId));
    refresh();
  });

  const openModal = () => {
    onBeforeOpen?.();
    signing.clearError();
    setOpen(true);
  };

  // LA ZONA (cabecera del fichero): en reposo, un marcador mudo; con algo que
  // firmar, cobrar o decidir —o con el consejo ilegible—, la tarjeta. Si lo
  // único vivo es una operación liquidándose, SidebarSettlements ocupa el
  // sitio y el marcador se aparta: mismo espacio, una sola cosa a la vez.
  const queueUnread = claimsQueueUnreadable(claimsUnreadable);
  const quiet = mayClaimNothingWaiting(hasAnything, !!councilUnreadable, queueUnread);
  const { resumed } = useResumePendingSettlements();
  const settlementsLive = resumed.length > 0;
  const reduced = useReducedMotion();

  return (
    <>
      <AnimatePresence initial={false} mode="wait">
        {!quiet ? (
      <motion.div
        key="tray"
        initial={reduced ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduced ? undefined : { opacity: 0, y: 4 }}
        transition={{ duration: 0.35, ease: EASE_OUT }}
        className={`rounded-2xl border px-3.5 py-3 transition-colors ${
          count > 0
            ? 'border-amber-500/25 bg-amber-500/[0.05]'
            : 'border-ink/[0.06] bg-ink/[0.02]'
        }`}
      >
        {/* cabecera — con algo que firmar, el punto que respira junto al
            título es el indicador de «aquí, ahora». */}
        <div className="flex items-center gap-2">
          <FileSignature
            className={`w-4 h-4 shrink-0 ${count > 0 ? 'text-tone-warning' : 'text-ink/40'}`}
            strokeWidth={1.8}
          />
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/55">
            {cardTitle}
          </span>
          {count > 0 ? (
            <>
              <PulseDot size={6} className="bg-tone-warning" />
              <span className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-none shadow-[0_0_10px_rgba(239,68,68,0.45)]">
                {count > 9 ? '9+' : count}
              </span>
            </>
          ) : null}
        </div>

        {/* prosa-y-lectores — a refusal is never folded into the placeholder.
            "Nothing waiting for your signature" is a statement about the
            council, and we may only make it when the council's tray was
            actually read. When it was not, the server's own sentence takes
            that slot; the intents and claims below still paint normally,
            because those reads DID succeed. */}
        {councilUnreadable && (
          <div className="mt-2 text-[11px] leading-snug text-tone-warning/90" role="alert">
            {/* it. 25 (1): la cabecera «no se pudieron leer» solo cuando falló la
                lectura ENTERA. Un 200 con filas ilegibles ya trae su propia cuenta
                («2 of this council’s proposals could not be read…»), y anteponerle
                esta frase afirmaría que falló toda la bandeja, que es falso. */}
            {councilUnreadable.partial ? null : <p>{t('The council’s proposals could not be read.')}</p>}
            {/* it. 34 (agente D): la lectura entera rechazada se pinta con el
                cuerpo completo — frase, salidas y puerta —, no con la frase sola. */}
            {councilUnreadable.refusal ? (
              <ServerRefusalBody refusal={councilUnreadable.refusal} t={t} />
            ) : (
              <p>{councilUnreadable.text}</p>
            )}
          </div>
        )}

        {/* it. 31 — the withdrawal queue that could not be read is SAID here,
            in the same slot: the rows below (if any) are the last good read,
            and «nothing waiting» is never printed over this. The server's own
            code stays out of the sentence; its detail joins only in English. */}
        {queueUnread && (
          <p className="mt-2 text-[11px] leading-snug text-tone-warning/90" role="alert">
            {claimsUnreadable.some((u) => u.kind === 'all')
              ? t('The withdrawal queue of one of your accounts could not be read just now. Anything you queued is still queued — what you see here is the last read, not a fresh one. It retries on its own.')
              : t('Part of the withdrawal queue could not be read just now. The entries shown are real; anything queued in an unread period is still queued — it retries on its own.')}
          </p>
        )}

        {!hasAnything ? null : (
          <div className="mt-2.5 space-y-3">
            {/* The council's live proposals — what the family has to decide,
                with the three facts that decide whether to act now: WHAT it
                moves (the order's own summary), how many signatures are in,
                and how long is left before it expires. */}
            {proposals.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-[0.1em] text-ink/35 px-1 mb-1">
                  {t('Council proposals')}
                </div>
                <div className="space-y-0.5">
                  {proposals.slice(0, MAX_ROWS).map((p) => {
                    const signed = p.signatures.reduce((s, x) => s + x.weight, 0);
                    const days = daysLeft(p.expiresAt);
                    return (
                      <Link
                        key={p.id}
                        href="/app/legacy"
                        onClick={() => onBeforeOpen?.()}
                        className="group block rounded-lg px-2 py-1.5 hover:bg-ink/[0.06] transition-colors"
                        title={t('Open the proposal inbox')}
                      >
                        <div className="flex items-center gap-2">
                          <span className="flex-1 min-w-0 truncate text-[12px] text-ink/90">
                            {p.title || p.txType}
                          </span>
                          <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-medium text-volt opacity-80 group-hover:opacity-100">
                            {p.status === 'ready' ? t('Emit') : t('Sign')}
                            <ChevronRight className="w-3 h-3" />
                          </span>
                        </div>
                        <div className="text-[10px] text-ink/40 truncate">
                          {signed}/{p.quorum} {t('signed')} ·{' '}
                          {days === 0 ? t('expires today') : `${days} ${t('days left')}`}
                        </div>
                      </Link>
                    );
                  })}
                  {proposals.length > MAX_ROWS && (
                    <Link
                      href="/app/legacy"
                      onClick={() => onBeforeOpen?.()}
                      className="block px-2 py-1 text-[11px] text-ink/45 hover:text-ink/75 transition-colors"
                    >
                      +{proposals.length - MAX_ROWS} {t('more')}
                    </Link>
                  )}
                </div>
              </div>
            )}

            {/* Waiting signatures — automation-prepared intents. */}
            {visible.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-[0.1em] text-ink/35 px-1 mb-1">
                  {t('To sign')}
                </div>
                <div className="space-y-0.5">
                  {visible.slice(0, MAX_ROWS).map((intent) => (
                    <button
                      key={intent.id}
                      onClick={openModal}
                      className="group w-full text-left rounded-lg px-2 py-1.5 hover:bg-ink/[0.06] transition-colors"
                      title={t('Review and sign')}
                    >
                      <div className="flex items-center gap-2">
                        <span className="flex-1 min-w-0 truncate text-[12px] text-ink/90">
                          {t(actionLabel(intent.action))}
                        </span>
                        <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-medium text-volt opacity-80 group-hover:opacity-100">
                          {t('Sign')}
                          <ChevronRight className="w-3 h-3" />
                        </span>
                      </div>
                      <div className="text-[10px] text-ink/40 truncate">{intent.protocolId}</div>
                    </button>
                  ))}
                  {visible.length > MAX_ROWS ? (
                    <button
                      onClick={openModal}
                      className="w-full text-left px-2 py-1 text-[11px] text-ink/45 hover:text-ink/75 transition-colors"
                    >
                      +{visible.length - MAX_ROWS} {t('more')}
                    </button>
                  ) : null}
                </div>
              </div>
            )}

            {/* Money in flight — vault exits queued in a withdrawal period
                (Firelight ~24h). Nothing to do until the period ends; then the
                row turns into the one-tap Claim. The info lives HERE directly
                (founder 2026-07-19) — no navigation needed. */}
            {claims.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-[0.1em] text-ink/35 px-1 mb-1">
                  {t('In flight')}
                </div>
                <div className="space-y-0.5">
                  {claims.map((c) => {
                    const est =
                      c.estFxrpBase != null ? `≈ ${(Number(c.estFxrpBase) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 4 })} FXRP` : 'FXRP';
                    return c.claimable ? (
                      <button
                        key={`${c.owner}-${c.period}`}
                        onClick={() => {
                          onBeforeOpen?.();
                          setClaimOpen(c);
                        }}
                        className="group w-full text-left rounded-lg px-2 py-1.5 bg-volt/[0.07] hover:bg-volt/[0.12] border border-volt/20 transition-colors"
                        title={t('Release the FXRP to your account')}
                      >
                        <div className="flex items-center gap-2">
                          <HandCoins className="w-3.5 h-3.5 shrink-0 text-volt" strokeWidth={1.8} />
                          <span className="flex-1 min-w-0 truncate text-[12px] text-ink/90">{est}</span>
                          <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-semibold text-volt">
                            {t('Claim')}
                            <ChevronRight className="w-3 h-3" />
                          </span>
                        </div>
                        <div className="text-[10px] text-ink/40 truncate">
                          {c.vaultLabel} · {t('ready to release')}
                        </div>
                      </button>
                    ) : (
                      <div key={`${c.owner}-${c.period}`} className="rounded-lg px-2 py-1.5">
                        <div className="flex items-center gap-2">
                          <Hourglass className="w-3.5 h-3.5 shrink-0 text-tone-warning/80" strokeWidth={1.8} />
                          <span className="flex-1 min-w-0 truncate text-[12px] text-ink/85">{est}</span>
                        </div>
                        <div className="text-[10px] text-ink/40 truncate">
                          {c.vaultLabel} · {t('arrives')} {etaLabel(c.claimableAt) || t('when the period ends')}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Pending to withdraw — tickets de salida de managed vaults
                (requestRedeem en potes de cola). Mientras madura, un reloj; al
                vencer, el cobro de un toque (firma en Xaman por la PA). */}
            {managedTickets.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-[0.1em] text-ink/35 px-1 mb-1">
                  {t('Pending to withdraw')}
                </div>
                <div className="space-y-0.5">
                  {managedTickets.map((tk) => {
                    const est = `≈ ${(Number(tk.estFxrpBase) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${tk.assetSymbol}`;
                    const label = tk.entry.name ?? `${tk.entry.pote.slice(0, 6)}…${tk.entry.pote.slice(-4)}`;
                    return tk.claimable ? (
                      <button
                        key={`${tk.entry.pote}-${tk.ticketId}`}
                        onClick={() => { onBeforeOpen?.(); setManagedClaim(tk); }}
                        className="group w-full text-left rounded-lg px-2 py-1.5 bg-volt/[0.07] hover:bg-volt/[0.12] border border-volt/20 transition-colors"
                        title={t('Collect it to your account')}
                      >
                        <div className="flex items-center gap-2">
                          <HandCoins className="w-3.5 h-3.5 shrink-0 text-volt" strokeWidth={1.8} />
                          <span className="flex-1 min-w-0 truncate text-[12px] text-ink/90">{est}</span>
                          <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-semibold text-volt">
                            {t('Claim')}
                            <ChevronRight className="w-3 h-3" />
                          </span>
                        </div>
                        <div className="text-[10px] text-ink/40 truncate">{label} · {t('ready to release')}</div>
                      </button>
                    ) : (
                      <div key={`${tk.entry.pote}-${tk.ticketId}`} className="rounded-lg px-2 py-1.5">
                        <div className="flex items-center gap-2">
                          <Hourglass className="w-3.5 h-3.5 shrink-0 text-tone-warning/80" strokeWidth={1.8} />
                          <span className="flex-1 min-w-0 truncate text-[12px] text-ink/85">{est}</span>
                        </div>
                        <div className="text-[10px] text-ink/40 truncate">
                          {label} · {t('arrives')} {etaLabel(tk.claimableAtISO) || t('when the window ends')}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </motion.div>
        ) : !settlementsLive ? (
          /* El marcador mudo de la zona: dónde aparecerán las cosas, y nada
             más. Sin caja, sin título «To sign», sin veredicto. */
          <motion.div
            key="quiet"
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduced ? undefined : { opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="flex items-center gap-2 px-2 py-1.5"
            aria-label={t('Notifications')}
          >
            <Bell className="h-3.5 w-3.5 shrink-0 text-ink/25" strokeWidth={1.8} />
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/30">{t('Notifications')}</span>
            <span aria-hidden className="ml-auto h-1.5 w-1.5 rounded-full bg-ink/15" />
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* SIN <AnimatePresence>, y aquí el precio de dejarlo era el peor de
          todos: IntentSignModal llama a useModalRegistration, así que el nodo
          que no se desmontaba se quedaba ADEMÁS con el scroll del body
          bloqueado. Ver la nota de LegalAcceptGate — mismo defecto, misma
          cura: el hijo directo de la frontera de presencia tiene que ser un
          motion.*, o no hay frontera. */}
      {mounted && open
        ? createPortal(
            <IntentSignModal intents={visible} signing={signing} onClose={() => setOpen(false)} />,
            document.body,
          )
        : null}

      {/* The one-tap Claim — same portal reasoning as the sign modal (the
          sidebar's transform would trap a fixed overlay inside the rail). */}
      {mounted && claimOpen
        ? createPortal(
            <VaultClaimModal
              claim={{
                vault: claimOpen.vault,
                vaultLabel: claimOpen.vaultLabel,
                owner: claimOpen.owner,
                period: claimOpen.period,
                claimable: claimOpen.claimable,
                claimableAt: claimOpen.claimableAt,
                estFxrpBase: claimOpen.estFxrpBase,
              }}
              onClose={() => setClaimOpen(null)}
              onChanged={() => refreshClaims?.()}
            />,
            document.body,
          )
        : null}

      {/* El cobro del ticket de managed vault: el modo claim del modal (se
          auto-portaliza vía OperationSurface, no necesita createPortal). Por la
          PA firma en Xaman; el destino no lo cambia nadie. */}
      {managedClaim && (
        <VaultEntryModal
          entry={managedClaim.entry}
          mode="claim"
          ticketId={managedClaim.ticketId}
          claimAccount={managedClaim.ownerXrpl ?? undefined}
          onClose={() => setManagedClaim(null)}
          onChanged={() => refreshManagedTickets?.()}
        />
      )}
    </>
  );
}

function IntentSignModal({
  intents,
  signing,
  onClose,
}: {
  intents: PreparedIntent[];
  signing: ReturnType<typeof useIntentSigning>;
  onClose: () => void;
}) {
  const { t } = useT();
  const {
    evm,
    sign,
    dismiss,
    signingId,
    busyId,
    actionError,
    lastSigned,
    settling,
    unconfirmed,
    isBlocked,
    closeUnconfirmedNotice,
  } = signing;

  // Own portal (AnimatePresence lives outside), so register by hand: the page
  // scroll stays locked and background pollers hold still while this is up.
  useModalRegistration();

  return (
    <motion.div
      variants={backdropFade}
      initial="hidden"
      animate="shown"
      exit="exit"
      className="fixed inset-0 z-[110] flex items-start justify-center pt-[8vh] px-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        variants={modalPop}
        initial="hidden"
        animate="shown"
        exit="exit"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-ink/10 bg-surface-1 overflow-hidden max-h-[85vh] flex flex-col"
        style={{ boxShadow: '0 30px 90px rgba(0,0,0,0.6)' }}
      >
        <div className="flex items-start justify-between gap-3 px-6 py-5 border-b border-ink/5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl grid place-items-center border text-volt border-volt/30 bg-volt/10 shrink-0">
              <FileSignature className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-ink">{t('Waiting for your signature')}</h2>
              <p className="text-xs text-ink/40 mt-0.5">
                {t('Prepared by your automation — review and sign in your wallet. Astryum never signs.')}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-ink/40 hover:text-ink transition-colors shrink-0" aria-label={t('Close')}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4 overflow-y-auto">
          {!evm.isConnected && (
            <Card className="flex items-center justify-between gap-3 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0">
                  <WalletIcon className="w-4 h-4 text-tone-warning" />
                </div>
                <p className="text-sm text-ink/70">
                  {t('Connect your EVM wallet to sign intents waiting for you.')}
                </p>
              </div>
              <PrimaryButton onClick={evm.openConnect}>{t('Connect wallet')}</PrimaryButton>
            </Card>
          )}

          {settling && settling.status !== 'settled' && settling.status !== 'failed' && (
            <Card className="flex items-center gap-3 py-3 border-amber-500/25">
              <div className="w-8 h-8 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0">
                <Loader2 className="w-4 h-4 text-tone-warning animate-spin" />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-ink/85">
                  {settling.status === 'stalled'
                    ? t('Signed — taking longer than normal, still watching the chain.')
                    : t('Signed — settling on Flare…')}
                </p>
                <span className="text-xs text-ink/55 break-all select-all">
                  {t('Receipt')}: <span className="font-mono">{shortAddr(settling.ref)}</span>
                </span>
              </div>
            </Card>
          )}

          {lastSigned && (
            <Card className="flex items-center gap-3 py-3 border-emerald-500/25">
              <div className="w-8 h-8 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center shrink-0">
                <Check className="w-4 h-4 text-tone-success" />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-ink/85">{t('Signed and settled on-chain.')}</p>
                <a
                  href={`${FLARESCAN_TX}${lastSigned.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-volt hover:text-volt inline-flex items-center gap-1"
                >
                  {shortAddr(lastSigned.txHash)} <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </Card>
          )}

          {actionError && <FriendlyError message={actionError} />}

          {unconfirmed && (
            <UnconfirmedSignatureNotice
              rail="evm"
              chainId={unconfirmed.chainId}
              unconfirmed={unconfirmed}
              onClose={closeUnconfirmedNotice}
            />
          )}

          {intents.length === 0 ? (
            <EmptyState
              bare
              icon={<FileSignature className="w-8 h-8 text-ink/40" />}
              title={t('Nothing waiting for your signature')}
              hint={t('Automations leave prepared intents here when they fire.')}
            />
          ) : (
            <div className="space-y-4">
              {intents.map((intent) => (
                <WaitingCard
                  key={intent.id}
                  intent={intent}
                  signing={signingId === intent.id}
                  busy={signingId === intent.id || busyId === intent.id || isBlocked(intent.id)}
                  onSign={sign}
                  onDismiss={dismiss}
                />
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
