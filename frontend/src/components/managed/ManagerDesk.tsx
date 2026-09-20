'use client';

/**
 * ManagerDesk — la mesa del gestor: UN sitio donde creas tu bóveda y luego la
 * gobiernas (fundador 2026-08-25: «lo haría todo en un mismo sitio, como lo de
 * create a council and govern; es lo mismo al final»).
 *
 * A MEDIDA, no la demo. `/app/institutional` es la demo del exchange y se queda
 * como está: allí Astryum hace de operador y la pantalla lo dice. Aquí el
 * operador es el usuario. Lo que se reutiliza es el RAÍL —las rutas
 * prepare-only y el catálogo on-chain—, nunca sus pantallas.
 *
 * ── DOS APARTADOS (fundador 2026-09-06) ─────────────────────────────────────
 * «La configuración de toda la cuenta para managed vaults tiene que ir en un
 * solo apartado… lo que sea post-verificación debe ir en otro.»
 *
 *   Configurar · el ALTA entera, al estilo Constitute del Legacy (estaciones):
 *                elegir la cuenta DEDICADA → primera verificación (KYC+AIFM) →
 *                constitución fácil (plantilla o documento; hash automático;
 *                cuenta auto-puesta) → jaula y primer vault. `ManagerSetupWizard`.
 *   Operar     · una GALERÍA de potes (como las cards de Earn): se elige uno con
 *                un clic y debajo aparece su gestión de capital (dirigir/
 *                recuperar por venue); el «+» abre el creador en modal. La
 *                renovación de credenciales, arriba y discreta.
 *                Desde el 13-sep (fundador, «el mismo rollo» que el catálogo:
 *                mejor repartido, el dinero delante, la imagen secundaria,
 *                no todo en horizontal) la sala es un MOSAICO de dos columnas:
 *                a la izquierda un recuadro VERTICAL —tus bóvedas apiladas,
 *                la elegida con sus cifras grandes (en la bóveda, desplegable,
 *                trabajando, suelo) y las tres puertas en columna—; a la
 *                derecha, en recuadros anchos, la pestaña elegida (el puente
 *                del capital y sus destinos, la constitución, la identidad).
 *
 * (La sala «Emisor» se retiró de la mesa el 6-sep: el gestor no la necesita —
 * la emisión de credenciales la lleva el robot notario; la ceremonia de demo,
 * si hace falta, vive en admin.)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useReducedMotion } from '../../stores/motionStore';
import { Coins, ExternalLink, ImageIcon, Loader2, Plus, RefreshCw, ScrollText, Wallet, X } from 'lucide-react';

import { Card, MicroLabel, SegmentedControl } from '../ui/primitives';
import { AstryumLoader } from '../ui/AstryumLoader';
import { EASE_OUT, RevealGroup, RevealItem } from '../ui/motion';
// El emblema de managed en toda la app (la puerta de Earn): la esfera armilar.
// La mesa lo hereda — misma identidad, mismo instrumento (2026-09-05).
import { ArmillaryScene } from '../earn/icons';
import { useT } from '../../i18n/LanguageProvider';
import { getCageOf, getPoteState, type PoteState } from '../../lib/institutional/api';
import { ModalOverlay } from '../ui/ModalPortal';
import { TokenLogo } from '../ui/TokenLogo';
import { venueIdentity } from '../../lib/institutional/venueIdentity';
import { fmtExitWindow, shortAddr } from '../../lib/institutional/format';
import { fmtBase } from '../../lib/institutional/policyCatalog';
import { clearPendingVaultImage, readPendingVaultImage } from '../../lib/institutional/pendingVaultImage';
import { saveVaultImage } from '../../lib/institutional/api';
import { patchVaultImage, useCommunity } from '../../lib/institutional/useCommunity';
import { ManagerAccountInXaman } from './ManagerAccountInXaman';
import { ManagerTitleLine } from './ManagerTitleLine';
import { WalletSelect } from '../wallet/WalletSelect';
import { useManagerAccount } from '../../hooks/useManagerAccount';
import { SetupDoorCard } from '../ui/SetupDoorCard';
import { useOperationStore } from '../../stores/operationStore';
import { Briefcase } from 'lucide-react';
import { ManagerConsole } from './ManagerConsole';
import { XamanSignBlockedNote } from '../xrpl/XamanSingleSign';
import { ManagerGovernance } from './ManagerGovernance';
import { VaultIdentityPane, useCopyReferral } from './VaultIdentityPane';
import { VaultTile } from './VaultTile';
import { managerOf } from './managerIdentity';
import { VaultCreator } from './VaultCreator';

const XRPSCAN_ACCOUNT = 'https://xrpscan.com/account/';

type Room = 'setup' | 'operate';
/** Lo que se lee del pote elegido: su capital (mover) o su constitución (leer). */
type Pane = 'capital' | 'rules' | 'identity';
/** Índice de la estación «Título» en el raíl del alta. */
const TITLE_STATION = 1;


/** Una fila de hecho: la etiqueta y el dato, sin adornos. */
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-ink/5 py-2 last:border-0">
      <span className="text-[12px] text-ink/45">{k}</span>
      <span className="truncate font-mono text-[12px] text-ink/80">{v}</span>
    </div>
  );
}

export function ManagerDesk() {
  const { t } = useT();
  const reduced = useReducedMotion() ?? false;
  // LA MESA LEE DESDE LAS WALLETS DE LA CUENTA, NO SOLO DESDE LA SESIÓN VIVA
  // (fundador 2026-09-14: «desde la wallet que marca como managed no puedo
  // acceder»). La cuenta que gobierna es una de las XRPL ENLAZADAS a la
  // cuenta; la sesión viva de Xaman es de ESTE navegador y se pierde al cambiar
  // de dominio o de sesión. Leer el ledger de una cuenta no exige que esté
  // conectada; firmar sí, y XamanSingleSign ya pide la firma A ESA cuenta (la
  // orden lleva su Account: Xaman exige esa cuenta). Prioridad: la elegida a
  // mano, luego la conectada, luego la primera enlazada. La regla vive en
  // useManagerAccount, COMPARTIDA con la ceremonia del alta (15-sep: la
  // ventana miraba solo la sesión viva y «perdía» el proceso en otro navegador).
  const {
    address: xrplAddress,
    liveConnected,
    options: accountOptions,
    choose: chooseAccount,
    resolving: accountResolving,
  } = useManagerAccount();
  const [potes, setPotes] = useState<PoteState[] | null>(null);
  const [failed, setFailed] = useState(false);
  /** Potes de la jaula cuyo estado NO se pudo leer: se dicen, no se esconden. */
  const [unreadable, setUnreadable] = useState(0);
  /** Para qué cuenta es la lectura que hay en `potes` (la sala se decide con una lectura REAL). */
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [room, setRoom] = useState<Room>('setup');
  // Operar = galería: qué pote está seleccionado para gestionarlo, y si el
  // modal del creador está abierto (el «+»).
  const [selectedPote, setSelectedPote] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // The creator has a Xaman request that can no longer be dropped (live QR,
  // confirming, unconfirmed): its modal Close would unmount it — hidden meanwhile.
  const [creatorBlocked, setCreatorBlocked] = useState(false);
  // The console's council-order signature can no longer be dropped: switching
  // pane, vault, room or account would unmount (or re-point) ManagerConsole,
  // and XamanSingleSign's unmount cancel is blind — a signature made in that
  // gap is followed by nobody and the console re-offers it (productizer-it6).
  const [consoleBlocked, setConsoleBlocked] = useState(false);
  const signBlocked = consoleBlocked || creatorBlocked;
  // El pote elegido en DOS paneles (8-sep): antes consola y constitución iban
  // apiladas — diez tarjetas de scroll por pote. Capital es lo diario;
  // la constitución se consulta.
  const [pane, setPane] = useState<Pane>('capital');
  // El enlace de captación (la barra vacía del puente y la pestaña Identidad lo ofrecen).
  const referral = useCopyReferral(xrplAddress ?? '');
  const openManagerSetup = useOperationStore((st) => st.openManagerSetupOp);
  // Renovar el título desde Operar: se abre la ceremonia CON la orden de ir a
  // la estación Título (antes la orden se quedaba en la mesa y la ventana,
  // que vive aparte, aterrizaba donde le parecía).
  const goToTitle = () => { openManagerSetup({ step: TITLE_STATION, nonce: Date.now() }); };
  // La sala inicial se decide UNA vez con el catálogo leído (¿tienes bóveda?);
  // después manda el clic del usuario, jamás una recarga de datos.
  const roomChosen = useRef(false);

  // Lectura DIRIGIDA (fundador 6-sep, arregla la lentitud): en vez del catálogo
  // ENTERO (todos los gestores, dos generaciones), se resuelve SOLO la jaula de
  // esta cuenta (llamadas directas al contrato, sin escanear eventos) y el
  // estado de sus potes. Para un gestor con 1 jaula y 1-2 potes son 2-3
  // lecturas, no cientos.
  const loadSeq = useRef(0);
  // UNA RELECTURA FALLIDA NO DESMONTA UNA FIRMA (productizer-it7). `failed` y
  // `potes === null` sustituyen la mesa entera por un aviso — y con ella la
  // ManagerConsole o el VaultCreator con su firma de Xaman viva. Mientras una
  // firma bloquea, un Refresh/Retry que falla (o que ya no trae el pote elegido)
  // CONSERVA la última lectura y lo dice en una línea; al resolverse, la próxima
  // lectura manda como siempre.
  const [refreshFailed, setRefreshFailed] = useState(false);
  const holdRef = useRef({ signBlocked, potes, selectedPote });
  holdRef.current = { signBlocked, potes, selectedPote };
  /** true = keep the last reading instead of this one (a signature is open over it). */
  const keepLastReading = (next: PoteState[] | null) => {
    const h = holdRef.current;
    if (!h.signBlocked || h.potes === null) return false;
    if (next === null) return true;
    return !!h.selectedPote && h.potes.some((p) => p.pote === h.selectedPote) && !next.some((p) => p.pote === h.selectedPote);
  };
  const load = useCallback(async () => {
    const mine = ++loadSeq.current;
    if (!xrplAddress) { setPotes(null); setLoadedFor(null); setFailed(false); return; }
    const failRead = () => {
      if (keepLastReading(null)) { setRefreshFailed(true); return; }
      setPotes(null); setFailed(true); setLoadedFor(xrplAddress);
    };
    try {
      const r = await getCageOf(xrplAddress);
      if (mine !== loadSeq.current) return; // llegó tarde: otra cuenta manda ya
      const cage = r.cage;
      if (cage && 'unreadable' in cage) { failRead(); return; }
      if (!cage) {
        if (keepLastReading([])) { setRefreshFailed(true); return; }
        setPotes([]); setUnreadable(0); setFailed(false); setRefreshFailed(false); setLoadedFor(xrplAddress); return;
      } // sin jaula = lista vacía, no error
      const addrs = cage.potes ?? [];
      const states = await Promise.all(addrs.map((a) => getPoteState(a).catch(() => null)));
      if (mine !== loadSeq.current) return;
      const ok = states.filter((s): s is PoteState => s !== null);
      // «No pude leer» ≠ «no tienes» también POR POTE (revisión 10-sep): los
      // ilegibles se cuentan y se dicen; si TODOS fallan, la lectura entera falló.
      if (addrs.length > 0 && ok.length === 0) { failRead(); return; }
      if (keepLastReading(ok)) { setRefreshFailed(true); return; }
      setUnreadable(addrs.length - ok.length);
      setPotes(ok);
      setFailed(false);
      setRefreshFailed(false);
      setLoadedFor(xrplAddress);
    } catch {
      if (mine !== loadSeq.current) return;
      failRead();
    }
    // keepLastReading reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xrplAddress]);

  useEffect(() => { void load(); }, [load]);

  // El creador avisa cuando su orden quedó relayada: se relee la jaula para que
  // el pote recién abierto aparezca sin recargar la página.
  const reload = () => { void load(); };

  // Tus bóvedas: las de TU jaula (ya vienen filtradas por la lectura dirigida).
  const mine = useMemo(() => potes ?? [], [potes]);
  const selected = useMemo(() => mine.find((p) => p.pote === selectedPote) ?? null, [mine, selectedPote]);
  // LAS CIFRAS del recuadro vertical (13-sep): hechos del contrato, con la
  // misma aritmética que la consola (suelo = total·bps/10000; desplegable =
  // libre − suelo; trabajando = suma de los destinos). Nada de rentabilidad.
  const money = useMemo(() => {
    if (!selected) return null;
    const big = (x: string | undefined) => { try { return BigInt(x ?? '0'); } catch { return BigInt(0); } };
    const total = big(selected.totalAssets);
    const free = big(selected.freeBalance);
    const floor = (total * BigInt(selected.bufferFloorBps)) / BigInt(10000);
    const deployableRaw = free - floor;
    const deployable = deployableRaw > BigInt(0) ? deployableRaw : BigInt(0);
    const working = (selected.venues ?? []).reduce((acc, v) => acc + big(v.value), BigInt(0));
    return { total, free, floor, deployable, working };
  }, [selected]);
  const selectedVenueNames = useMemo(() => {
    if (!selected) return [] as string[];
    const names = (selected.venues ?? []).filter((v) => !v.retired).map((v) => { const id = venueIdentity(v.target); return id.known && id.name ? id.name : shortAddr(v.target); });
    return [...new Set(names)];
  }, [selected]);

  // La sala se decide UNA vez, con una lectura REAL de ESTA cuenta — no con la
  // lista vacía que dejó la ausencia de cuenta (eso encerraba en «Configurar»
  // a gestores con bóvedas, revisión 10-sep).
  useEffect(() => {
    if (roomChosen.current || !xrplAddress || potes === null || loadedFor !== xrplAddress) return;
    roomChosen.current = true;
    setRoom(mine.length > 0 ? 'operate' : 'setup');
  }, [xrplAddress, potes, mine.length, loadedFor]);

  // LA IMAGEN ELEGIDA EN EL CREADOR se aplica cuando el pote aparece: la
  // dirección no existía al elegir. Una sola vez por espera, y solo si nadie
  // eligió ya otra desde Operar.
  const { images } = useCommunity();
  const applyingImage = useRef(false);
  useEffect(() => {
    if (!xrplAddress || mine.length === 0 || applyingImage.current) return;
    const pending = readPendingVaultImage(xrplAddress);
    if (!pending) return;
    const target = mine.find((p) => (p.name ?? '') === pending.name && (p.symbol ?? '').toUpperCase() === pending.symbol.toUpperCase());
    if (!target) return;
    if (images.has(target.pote.toLowerCase())) { clearPendingVaultImage(xrplAddress); return; }
    applyingImage.current = true;
    saveVaultImage({ account: xrplAddress, pote: target.pote, kind: pending.kind, emblem: pending.emblem })
      .then((res) => {
        if (res.ok) patchVaultImage({ pote: res.data.pote, account: xrplAddress, kind: res.data.kind, emblem: res.data.emblem });
        clearPendingVaultImage(xrplAddress);
      })
      .catch(() => undefined)
      .finally(() => { applyingImage.current = false; });
  }, [xrplAddress, mine, images]);

  // Selecciona el primer pote por defecto cuando la lista carga (o mantiene el
  // que ya estaba, si sigue siendo tuyo).
  useEffect(() => {
    if (mine.length === 0) { setSelectedPote(null); return; }
    if (!selectedPote || !mine.some((p) => p.pote === selectedPote)) setSelectedPote(mine[0].pote);
  }, [mine, selectedPote]);

  // Cada apartado con su nombre y la PREGUNTA que responde — el patrón de
  // orientación del Legacy: saber a qué has entrado es la mitad de no perderse.
  const roomMeta: Record<Room, { label: string; purpose: string }> = useMemo(
    () => ({
      setup: { label: t('Configure the account'), purpose: t('The whole setup, station by station: dedicated account, first verification, constitution, cage and first vault') },
      operate: { label: t('Operate'), purpose: t('Your vaults — pick one to move its capital, or open a new one') },
    }),
    [t],
  );

  // Mientras las wallets de la cuenta se leen por primera vez, «ninguna» no se
  // sabe todavía: la marca dibujándose, no la pantalla de conectar (que a un
  // gestor con cuenta enlazada le diría durante un segundo que no la tiene).
  if (!xrplAddress && accountResolving) {
    return (
      <Card className="p-8">
        <AstryumLoader size={56} label={t('Reading your wallets…')} />
      </Card>
    );
  }

  // Sin cuenta conectada, la mesa ES la sala Cuenta: conectar o crear en Xaman.
  // Las demás salas hablan del ledger de UNA cuenta — sin ella no hay pregunta.
  if (!xrplAddress) {
    return (
      <RevealGroup className="space-y-5">
        <RevealItem className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[15px] font-semibold tracking-tight text-ink">{t('XRPL account')}</span>
          <span className="text-[12px] text-ink/45">{t('The account that governs — connect it, or create a fresh one')}</span>
        </RevealItem>
        <RevealItem>
          {/* La escena de la puerta de Managed preside también la mesa vacía:
              group para que la armilar reaccione al ratón como en su puerta. */}
          <Card className="group p-6">
            <div className="flex flex-wrap items-center gap-6">
              <div className="min-w-0 flex-1">
                <MicroLabel>{t('Your desk')}</MicroLabel>
                <div className="mt-3 flex items-start gap-3">
                  <Wallet className="mt-0.5 h-5 w-5 shrink-0 text-ink/35" strokeWidth={1.6} />
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold tracking-tight text-ink">
                      {t('Connect your XRPL account')}
                    </h3>
                    <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-ink/55">
                      {t('A vault is governed by one XRPL account — yours. Connect it and this desk shows the vault it runs, or what it takes to open one.')}
                    </p>
                  </div>
                </div>
              </div>
              <div className="hidden shrink-0 sm:block" aria-hidden>
                <ArmillaryScene width={150} height={118} />
              </div>
            </div>
          </Card>
        </RevealItem>
        <RevealItem>
          <ManagerAccountInXaman />
        </RevealItem>
      </RevealGroup>
    );
  }

  if (potes === null && !failed) {
    // Espera de PANTALLA, no de fila: la marca dibujándose (AstryumLoader),
    // no un spinner genérico (v-100%, fundador 2026-09-08).
    return (
      <Card className="p-8">
        <AstryumLoader size={56} label={t('Reading your vault from the chain…')} />
      </Card>
    );
  }

  // «No pude leer» nunca es «no tienes». Decirlo al revés le diría a un gestor
  // con bóveda que no la tiene, que es la peor frase posible en esta pantalla.
  if (failed) {
    return (
      <Card className="p-6">
        <p className="max-w-[62ch] text-sm leading-relaxed text-tone-warning/80">
          {t('Your vault could not be read right now, so this desk cannot tell whether you already run one. That is not the same as you not having one.')}
        </p>
      </Card>
    );
  }

  return (
    <RevealGroup className="space-y-5">
      <RevealItem>
        <SegmentedControl<Room>
          layoutId="manager-desk-room"
          className="overflow-x-auto scrollbar-hide"
          value={room}
          onChange={(r) => { if (!signBlocked) setRoom(r); }}
          options={(['setup', 'operate'] as Room[]).map((r) => ({
            key: r,
            label: roomMeta[r].label,
          }))}
        />
        {signBlocked ? (
          <div className="mt-2 space-y-0.5">
            <p className="text-[11px] leading-relaxed text-tone-warning">
              {t('Other sections, vaults and accounts stay closed until this signature is resolved.')}
            </p>
            <XamanSignBlockedNote />
          </div>
        ) : null}
      </RevealItem>

      {/* La tira de identidad: con qué cuenta estás. En TODAS las salas — es
          orientación, no contenido de una pestaña. El punto que late dice
          «cuenta viva» sin una palabra (v-tema 2026-09-05). */}
      <RevealItem>
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-ink/[0.07] bg-ink/[0.02] px-4 py-2.5">
          <span
            className="live-beat relative inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-tone-success text-tone-success"
            aria-hidden
          />
          <MicroLabel>{t('XRPL account')}</MicroLabel>
          {/* EL SWITCH (fundador 2026-09-13: «debe haber un botón para hacer
              el switch a las que están conectadas para que el user escoja»):
              con más de una Xaman conectada, la tira es el selector de la
              casa — elegirla aquí ES elegir quién firma (setActiveWallet, el
              mismo primitivo que sigue useXrplWalletPartner). Con una sola,
              la dirección de siempre. */}
          {accountOptions.length > 1 ? (
            <span className="min-w-[220px]">
              <WalletSelect
                value={xrplAddress}
                disabled={signBlocked}
                onChange={(addr) => {
                  if (signBlocked) return;
                  // Una conectada pasa a ser la activa (quien firma sin QR
                  // nuevo); una solo enlazada se elige para leer, y al firmar
                  // Xaman pedirá esa cuenta. La elección es compartida con la
                  // ceremonia del alta (useManagerAccount).
                  chooseAccount(addr);
                }}
                options={accountOptions}
              />
            </span>
          ) : (
            <span className="font-mono text-sm text-ink/80">{shortAddr(xrplAddress)}</span>
          )}
          {!liveConnected && (
            <span className="text-[11px] text-ink/45">
              {t('Linked to your account, not connected in this browser — Xaman will ask for this account when you sign.')}
            </span>
          )}
          <a
            className="text-ink/40 transition-colors hover:text-ink/70"
            href={`${XRPSCAN_ACCOUNT}${xrplAddress}`}
            target="_blank"
            rel="noreferrer"
            aria-label="XRPScan"
          >
            <ExternalLink size={13} />
          </a>
          {/* EN OPERAR, la tira es el puesto de mando entero (11-sep: «menos
              caos»): el título del gestor, Refrescar y Nueva bóveda viven aquí —
              una fila, no cuatro. */}
          {room === 'operate' ? (
            <>
              <span className="hidden h-4 w-px bg-ink/10 sm:inline-block" aria-hidden />
              <ManagerTitleLine account={xrplAddress} onGoToTitle={goToTitle} />
              <span className="ml-auto flex items-center gap-2">
                <button type="button" onClick={reload} className="inline-flex items-center gap-1 text-[11px] text-ink/45 transition-colors hover:text-ink">
                  <RefreshCw className="h-3 w-3" /> {t('Refresh')}
                </button>
                <button type="button" onClick={() => setCreating(true)} className="inline-flex items-center gap-1 rounded-lg border border-volt/40 bg-volt/[0.08] px-2.5 py-1 text-[11px] font-medium text-volt transition-colors hover:bg-volt/[0.14]">
                  <Plus className="h-3.5 w-3.5" /> {t('New vault')}
                </button>
              </span>
            </>
          ) : null}
        </div>
      </RevealItem>

      {/* CADA SALA ENTRA COMO UNA SALA (v-tema 2026-09-05: «aplica el tema
          general… añade animaciones»): al cambiar de sala, la saliente se
          despide hacia arriba y la nueva sube a escena — el patrón de
          transición de la casa, nunca un corte seco. La cabecera viaja DENTRO
          del bloque animado: pertenece a la sala, no al marco. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={room}
          initial={reduced ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? undefined : { opacity: 0, y: -8 }}
          transition={{ duration: 0.28, ease: EASE_OUT }}
          className="space-y-5"
        >
      {/* ── APARTADO «CONFIGURAR»: el alta entera, en estaciones (el gemelo
          del Constitute del Legacy, con los colores de managed). Todo lo de la
          primera vez vive AQUÍ y solo aquí. ── */}
      {/* Desde el 12-sep el alta vive UNA vez, en su ventana
          (ManagerSetupOperation, la plantilla del Legacy): aquí queda la
          puerta. Renovar el título desde Operar abre esa ventana en la
          estación Título. */}
      {room === 'setup' && (
        <SetupDoorCard
          icon={Briefcase}
          eyebrow={t('Managed vaults')}
          title={t('Set up your manager account')}
          purpose={t('A dedicated account, its title, its constitution, its cage and its first vault — and the public card clients read before depositing.')}
          stations={6}
          effort={t('~30 min · Xaman + your signatures')}
          status={mine.length > 0 ? <span className="text-tone-success">{mine.length} {t('vault(s) already open on this account')}</span> : undefined}
          onOpen={() => openManagerSetup()}
        />
      )}

      {/* ── APARTADO «OPERAR»: lo post-verificación — renovación de
          credenciales, tus bóvedas con sus consolas, y las órdenes de la
          cuenta a su jaula. ── */}
      {room === 'operate' && (
        <>
          {mine.length === 0 ? (
            <Card className="p-6">
              <MicroLabel>{t('Your desk')}</MicroLabel>
              <h3 className="mt-2 text-base font-semibold tracking-tight text-ink">{t('No vault yet')}</h3>
              <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-ink/55">
                {t('Open your first vault from here, or finish the setup in “Configure the account”. Once it exists, this desk becomes its bridge: capital, rules and identity in one place.')}
              </p>
              <button type="button" onClick={() => setCreating(true)} className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-volt/40 bg-volt/[0.08] px-3 py-1.5 text-[12px] font-medium text-volt">
                <Plus className="h-3.5 w-3.5" /> {t('New vault')}
              </button>
            </Card>
          ) : null}
          {refreshFailed ? (
            <p className="max-w-[62ch] text-[12px] leading-relaxed text-tone-warning/80">
              {t('Your vaults could not be read again right now. What you see is the last reading, kept on screen while a signature is open.')}
              {' '}<button type="button" onClick={reload} className="underline underline-offset-2 hover:text-ink">{t('Retry')}</button>
            </p>
          ) : null}
          {unreadable > 0 ? (
            <p className="max-w-[62ch] text-[12px] leading-relaxed text-tone-warning/80">
              {unreadable} {unreadable === 1 ? t('vault of your cage could not be read right now and is not shown — that is not the same as it not existing.') : t('vaults of your cage could not be read right now and are not shown — that is not the same as them not existing.')}
              {' '}<button type="button" onClick={reload} className="underline underline-offset-2 hover:text-ink">{t('Retry')}</button>
            </p>
          ) : null}

          {/* EL MOSAICO DE OPERAR (13-sep). Izquierda, un recuadro VERTICAL:
              tus bóvedas apiladas (si hay varias), la elegida con su dinero
              en grande y las tres puertas en columna. Derecha, recuadros
              ANCHOS: la pestaña elegida — el puente del capital con sus
              destinos (11-sep, intacto), la constitución o la identidad.
              En pantallas estrechas la columna cae encima. */}
          {selected && money ? (
            <div className="grid gap-4 lg:grid-cols-[19rem_minmax(0,1fr)] lg:items-start">
              <aside className="space-y-3 lg:sticky lg:top-4">
                {/* Varias bóvedas: apiladas, una debajo de otra, cada una con
                    su cifra. La elegida enciende su borde. */}
                {mine.length > 1 ? (
                  <div className="space-y-1.5" role="tablist" aria-label={t('Your vaults')}>
                    {mine.map((v) => {
                      const on = v.pote === selectedPote;
                      return (
                        <button
                          key={v.pote}
                          type="button"
                          role="tab"
                          aria-selected={on}
                          disabled={signBlocked && !on}
                          onClick={() => { if (!signBlocked) setSelectedPote(v.pote); }}
                          className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${on ? 'border-volt/50 bg-volt/[0.06]' : 'border-ink/10 bg-surface-1 hover:border-ink/25'}`}
                        >
                          <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-lg border border-ink/10">
                            <VaultTile entry={{ pote: v.pote, councilXrplAddress: xrplAddress }} manager={managerOf({ pote: v.pote, councilXrplAddress: xrplAddress })} size={28} shape="square" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12px] font-medium text-ink">{v.name || shortAddr(v.pote)}</span>
                            <span className="block truncate font-mono text-[10px] text-ink/45">
                              {v.totalAssets != null && v.asset ? `${fmtBase(v.totalAssets, v.asset.decimals, 2)} ${v.asset.symbol}` : '—'}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {/* La bóveda elegida, en vertical: el nombre manda, la imagen
                    queda pequeña arriba a la derecha, y el DINERO en grande. */}
                <Card className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-[16px] font-semibold leading-snug tracking-tight text-ink">{selected.name || shortAddr(selected.pote)}</h3>
                      <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-ink/10 bg-ink/[0.03] py-0.5 pl-0.5 pr-1.5 font-mono text-[10px] text-ink/60">
                        {selected.asset ? <TokenLogo symbol={selected.asset.symbol} size="xs" /> : null}
                        {selected.symbol || shortAddr(selected.pote)}
                      </span>
                    </div>
                    <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg border border-ink/10">
                      <VaultTile entry={{ pote: selected.pote, councilXrplAddress: xrplAddress }} manager={managerOf({ pote: selected.pote, councilXrplAddress: xrplAddress })} size={36} shape="square" />
                    </span>
                  </div>

                  <div className="mt-4 space-y-3">
                    <div>
                      <span className="block text-[10px] uppercase tracking-[0.12em] text-ink/40">{t('In the vault')}</span>
                      <span className="block truncate font-mono text-[24px] leading-tight tabular-nums text-ink">
                        {fmtBase(money.total, selected.asset.decimals, 2)} <span className="text-[13px] font-sans text-ink/45">{selected.asset.symbol}</span>
                      </span>
                    </div>
                    <div>
                      <span className="block text-[10px] uppercase tracking-[0.12em] text-ink/40">{t('Deployable now')}</span>
                      <span className="block truncate font-mono text-[18px] leading-tight tabular-nums text-volt">
                        {fmtBase(money.deployable, selected.asset.decimals, 2)} <span className="text-[11px] font-sans text-ink/45">{selected.asset.symbol}</span>
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="min-w-0">
                        <span className="block text-[10px] uppercase tracking-[0.12em] text-ink/40">{t('Working')}</span>
                        <span className="block truncate font-mono text-[13px] tabular-nums text-ink/80">{fmtBase(money.working, selected.asset.decimals, 2)}</span>
                      </div>
                      <div className="min-w-0">
                        <span className="block text-[10px] uppercase tracking-[0.12em] text-ink/40">{t('Untouchable floor')}</span>
                        <span className="block truncate font-mono text-[13px] tabular-nums text-ink/80">{fmtBase(money.floor, selected.asset.decimals, 2)} <span className="text-ink/35">· {selected.bufferFloorBps / 100}%</span></span>
                      </div>
                    </div>
                  </div>

                  <dl className="mt-4 space-y-1 border-t border-ink/5 pt-3 text-[11px] leading-snug text-ink/50">
                    <div className="flex gap-1.5">
                      <dt className="shrink-0 text-ink/35">{t('Exit')}</dt>
                      <dd className="text-ink/70">{fmtExitWindow(selected.cooldownSeconds, t)}</dd>
                    </div>
                    <div className="flex min-w-0 gap-1.5">
                      <dt className="shrink-0 text-ink/35">{t('to')}</dt>
                      <dd className="line-clamp-2 text-ink/70">{selectedVenueNames.length > 0 ? selectedVenueNames.join(' · ') : t('no destination yet')}</dd>
                    </div>
                  </dl>
                </Card>

                {/* Las tres puertas, en columna: dónde estás se ve de un vistazo. */}
                <nav className="overflow-hidden rounded-xl border border-ink/10 bg-surface-1" aria-label={t('This vault')}>
                  {(
                    [
                      { key: 'capital' as Pane, label: t('Capital'), hint: t('move it'), Icon: Coins },
                      { key: 'rules' as Pane, label: t('Constitution'), hint: t('read it'), Icon: ScrollText },
                      { key: 'identity' as Pane, label: t('Identity'), hint: t('image, link, public page'), Icon: ImageIcon },
                    ]
                  ).map(({ key, label, hint, Icon }) => {
                    const on = pane === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={on}
                        disabled={signBlocked && !on}
                        onClick={() => { if (!signBlocked) setPane(key); }}
                        className={`relative flex w-full items-center gap-2.5 border-b border-ink/5 px-3 py-2.5 text-left transition-colors last:border-b-0 disabled:cursor-not-allowed disabled:opacity-50 ${on ? 'bg-volt/[0.06] text-ink' : 'text-ink/65 hover:bg-ink/[0.03] hover:text-ink'}`}
                      >
                        <span aria-hidden className={`absolute bottom-2 left-0 top-2 w-[3px] rounded-full transition-colors ${on ? 'bg-volt' : 'bg-transparent'}`} />
                        <Icon className={`h-4 w-4 shrink-0 ${on ? 'text-volt' : 'text-ink/40'}`} strokeWidth={1.8} />
                        <span className="min-w-0">
                          <span className="block text-[13px] font-medium">{label}</span>
                          <span className="block text-[10.5px] text-ink/40">{hint}</span>
                        </span>
                      </button>
                    );
                  })}
                </nav>
              </aside>

              <div className="min-w-0 space-y-4">
                {pane === 'capital' ? (
                  <ManagerConsole pote={selected.pote} council={xrplAddress} onShare={referral.copy} onBlockedChange={setConsoleBlocked} />
                ) : pane === 'rules' ? (
                  <ManagerGovernance pote={selected.pote} />
                ) : (
                  <VaultIdentityPane account={xrplAddress} pote={selected.pote} />
                )}
                {referral.copied ? <p className="text-[11px] text-tone-success">{t('Link copied')}</p> : null}
              </div>
            </div>
          ) : null}

          {/* El creador, EN MODAL (el «+»). Al abrir un pote, se cierra y relee. */}
          {creating ? (
            <ModalOverlay className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm">
              <div className="my-auto w-full max-w-3xl">
                <div className="mb-2 flex justify-end">
                  {creatorBlocked ? null : (
                    <button type="button" onClick={() => setCreating(false)} className="rounded-lg border border-ink/10 bg-surface-1 p-2 text-ink/60 hover:text-ink" aria-label={t('Close')}>
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <VaultCreator account={xrplAddress} onOpened={() => { setCreating(false); reload(); }} onBlockedChange={setCreatorBlocked} />
              </div>
            </ModalOverlay>
          ) : null}
        </>
      )}
        </motion.div>
      </AnimatePresence>
    </RevealGroup>
  );
}

