'use client';

/**
 * ExchangeStage — LA MESA DEL EXCHANGE, entera, en un sitio propio del menú.
 *
 * TRES SALAS, el patrón de la mesa del gestor:
 *   · Set up   — «Nace tu exchange»: la fase 1 del flujo, por estaciones.
 *   · Operate  — el rodaje v2: Exchange (E0…E8) · User · Behind the curtain ·
 *                Evidence · Runs. Con el TOUR al lado, si se quiere.
 *   · v1       — la generación anterior (/app/admin/institutional), como acta.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Link from 'next/link';
import { ArrowUpRight, Building2, Check, Compass, Eye, Layers, ListChecks, ScanFace } from 'lucide-react';
import { GhostButton, MicroLabel, SegmentedControl } from '../../ui/primitives';
import { StationProgress, StationRailLayout } from '../../ui/StationProgress';
import { HelpDot } from '../../ui/HelpDot';
import { useT } from '../../../i18n/LanguageProvider';
import { useReducedMotion } from '../../../stores/motionStore';
import { useDemoRun } from '../../../lib/demo-exchange/useDemoRun';
import { shortHash } from '../../../lib/demo-exchange/api';
import { useXrplWalletPartner } from '../../../lib/wallet/useXrplWalletPartner';
import { RunsPanel } from '../RunsPanel';
import { ExchangeDesk } from '../ExchangeDesk';
import { ClientApp } from '../ClientApp';
import { CurtainGraph } from '../CurtainGraph';
import { EvidencePanel } from '../EvidencePanel';
import { ExchangeStationContext } from './ExchangeStationContext';
import { EXCHANGE_STATIONS, useExchangeScript, type ScriptStep, type StageTab } from './useExchangeScript';
import { TourPanel } from './TourPanel';
import { HowTheDemoWorksButton, HowTheDemoWorksModal } from './HowTheDemoWorks';
import { SetupDoorCard } from '../../ui/SetupDoorCard';
import { useOperationStore } from '../../../stores/operationStore';
import { ExchangeAccountGate } from './ExchangeAccountGate';
import { InstitutionalV1Room } from './InstitutionalV1Room';

type Room = 'setup' | 'operate' | 'v1';

interface Prefs {
  guided: boolean;
  hints: boolean;
  all: boolean;
  seenIntro: boolean;
}
const PREFS_KEY = 'astryum:exchange:stage';
const DEFAULT_PREFS: Prefs = { guided: true, hints: false, all: false, seenIntro: false };
function readPrefs(): Prefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    // Siempre una COPIA: el efecto de la primera visita distingue «aún no leí
    // localStorage» (identidad DEFAULT_PREFS) de «leído, y es la primera vez».
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) } : { ...DEFAULT_PREFS };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export function ExchangeStage() {
  const { t } = useT();
  const reduced = useReducedMotion();
  const demo = useDemoRun();
  const { address: root } = useXrplWalletPartner();
  const steps = useExchangeScript();
  const openExchangeSetup = useOperationStore((st) => st.openExchangeSetupOp);
  const run = demo.run;
  const chain = demo.chain;

  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  useEffect(() => { setPrefs(readPrefs()); }, []);
  const patchPrefs = useCallback((p: Partial<Prefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...p };
      try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* sin memoria */ }
      return next;
    });
  }, []);

  // La sala se decide UNA vez, con los runs leídos: ¿hay mesa? Operar. Si no,
  // Set up. Después manda el clic.
  const [room, setRoom] = useState<Room>('setup');
  const roomChosen = useRef(false);
  useEffect(() => {
    if (roomChosen.current || demo.loading) return;
    if (demo.runs.length === 0 && !run) return;
    roomChosen.current = true;
    setRoom(run ? 'operate' : 'setup');
  }, [demo.runs.length, demo.loading, run]);
  // EL ALTA SE ESCONDE CUANDO ESTÁ TERMINADA: con mesa y pote para esta raíz, la sala «Set
  // up» deja de ser pestaña y queda un chip verde para revisarla.
  const mine = useMemo(() => demo.runs.find((r) => r.councilAddress === root), [demo.runs, root]);
  const setupDone = Boolean(mine?.poteAddress);

  // Operar: pestaña, estación del desk, paso del tour.
  const [tab, setTab] = useState<StageTab>('exchange');
  // A signing door of the desk is in flight / unconfirmed: the desk stays mounted
  // (always, hidden when another tab shows) and the tabs and rooms close, so its
  // pending signature is never lost and «Compose» never offers it twice.
  const [deskBlocked, setDeskBlocked] = useState(false);
  const [stationIdx, setStationIdx] = useState(0);
  const station = EXCHANGE_STATIONS[stationIdx];
  const [tourIdx, setTourIdx] = useState(0);
  const tourLanded = useRef(false);
  // Aterrizaje del tour: el primer paso no hecho, una vez por run.
  useEffect(() => {
    if (!run || tourLanded.current) return;
    tourLanded.current = true;
    const first = steps.findIndex((s) => !s.optional && !s.done(run, chain));
    setTourIdx(first === -1 ? steps.length - 1 : first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.runId]);

  // Primera visita: la explicación entera sale sola; después, detrás del botón.
  const [intro, setIntro] = useState(false);
  useEffect(() => {
    if (root && !prefs.seenIntro && prefs !== DEFAULT_PREFS) setIntro(true);
  }, [root, prefs]);
  const closeIntro = () => { setIntro(false); patchPrefs({ seenIntro: true }); };

  const stepByStation = useMemo(() => {
    const m = new Map<string, ScriptStep>();
    for (const s of steps) if (s.station && !m.has(s.station)) m.set(s.station, s);
    return m;
  }, [steps]);
  const rail = EXCHANGE_STATIONS.map((id) => {
    const s = stepByStation.get(id);
    return { label: s?.title ?? id, done: s ? s.done(run, chain) : false };
  });
  const currentStep = stepByStation.get(station);

  const goTo = useCallback((s: ScriptStep) => {
    // Blocked: ANY move is refused — also to another exchange station, because a
    // Step outside the current station renders null and unmounts its signing
    // door.
    if (deskBlocked) return;
    setRoom('operate');
    setTab(s.tab);
    if (s.tab === 'exchange' && s.station) {
      const i = EXCHANGE_STATIONS.indexOf(s.station as (typeof EXCHANGE_STATIONS)[number]);
      if (i >= 0) { setStationIdx(i); patchPrefs({ all: false }); }
    }
  }, [patchPrefs, deskBlocked]);

  // El FOCO: la estación que el tour señala se ilumina y entra en pantalla.
  const mainRef = useRef<HTMLDivElement | null>(null);
  const tourStep = steps[tourIdx];
  useEffect(() => {
    if (!prefs.guided || room !== 'operate' || !tourStep?.station || tourStep.tab !== tab) return;
    const el = mainRef.current?.querySelector<HTMLElement>(`[data-station="${tourStep.station}"]`);
    if (!el) return;
    el.classList.add('station-spot');
    el.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
    return () => el.classList.remove('station-spot');
  }, [prefs.guided, room, tab, tourStep, stationIdx, prefs.all, reduced]);

  const tabs: Array<[StageTab, string, typeof Building2]> = [
    ['exchange', t('Exchange'), Building2],
    ['user', t('Client (demo view)'), ScanFace],
    ['curtain', t('Behind the curtain'), Eye],
    ['evidence', t('Evidence'), ListChecks],
    ['runs', t('Runs'), Layers],
  ];

  const roomMeta: Record<Room, { label: string; purpose: string }> = {
    setup: { label: t('Set up'), purpose: t('Become a tenant, station by station: root, credentials, constitution, cage, pote, desk') },
    operate: { label: t('Operate'), purpose: t('The take, end to end: the exchange side, the client side, the curtain, the evidence') },
    v1: { label: t('Institutional (v1)'), purpose: t('The first generation, kept for the record') },
  };

  /* ── Operar: la columna lateral (raíl + tour) y la mesa ──────────────── */
  const operateAside =
    (tab === 'exchange' && run) || prefs.guided ? (
      <div className="space-y-4">
        {tab === 'exchange' && run ? (
          <StationProgress
            stations={rail}
            current={stationIdx}
            // Locked while a desk signature blocks: another
            // station renders its Step as null and unmounts the signing door.
            onSelect={(i) => { if (deskBlocked) return; setStationIdx(i); patchPrefs({ all: false }); }}
            ariaLabel={t('Exchange stations')}
            doneWord={t('done')}
            onBack={prefs.all || deskBlocked ? undefined : () => setStationIdx((i) => Math.max(0, i - 1))}
            onNext={prefs.all || deskBlocked ? undefined : () => setStationIdx((i) => Math.min(EXCHANGE_STATIONS.length - 1, i + 1))}
          />
        ) : null}
        {prefs.guided ? (
          <TourPanel
            steps={steps}
            index={tourIdx}
            onIndex={setTourIdx}
            run={run}
            chain={chain}
            tab={tab}
            station={prefs.all ? null : station}
            onGo={goTo}
            onExit={() => patchPrefs({ guided: false })}
          />
        ) : null}
      </div>
    ) : null;
  const operateMain = (
    <div ref={mainRef} className="min-w-0 space-y-4">

                <nav className="flex flex-wrap gap-2" aria-label={t('Operate')}>
                  {tabs.map(([key, label, Icon]) => {
                    const locked = deskBlocked && key !== 'exchange';
                    return (
                      <button
                        key={key}
                        type="button"
                        disabled={locked}
                        onClick={() => { if (!locked) setTab(key); }}
                        aria-current={tab === key ? 'page' : undefined}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${tab === key ? 'border-volt text-volt' : 'border-ink/10 text-ink/60 hover:border-ink/25 hover:text-ink'}`}
                      >
                        <Icon className="h-3.5 w-3.5" /> {label}
                      </button>
                    );
                  })}
                </nav>
                {deskBlocked ? (
                  <p className="text-[11px] text-tone-warning">{t('A signature of the exchange is in flight at the desk — the other tabs and rooms come back once the ledger settles or refuses it.')}</p>
                ) : null}

                {tab === 'exchange' && run ? (
                  <>
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      {!prefs.all && currentStep ? (
                        <>
                          <span className="font-mono text-[11px] text-volt/80">{station}</span>
                          <span className="text-[15px] font-semibold tracking-tight text-ink">{currentStep.title}</span>
                          <span className="min-w-0 flex-1 truncate text-[12px] text-ink/45">{currentStep.lede}</span>
                        </>
                      ) : (
                        <span className="text-[12px] text-ink/45">{t('Every station at once — the free path.')}</span>
                      )}
                      <span className="ml-auto flex items-center gap-1.5">
                        {/* «One at a time» hides every other station's Step: locked while a door blocks. */}
                        <button type="button" disabled={deskBlocked} onClick={() => { if (!deskBlocked) patchPrefs({ all: !prefs.all }); }} className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${prefs.all ? 'border-volt/40 bg-volt/[0.06] text-volt' : 'border-ink/10 text-ink/50 hover:border-ink/25 hover:text-ink'}`}>
                          {prefs.all ? t('One at a time') : t('All stations')}
                        </button>
                        <button type="button" onClick={() => patchPrefs({ hints: !prefs.hints })} className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${prefs.hints ? 'border-volt/40 bg-volt/[0.06] text-volt' : 'border-ink/10 text-ink/50 hover:border-ink/25 hover:text-ink'}`}>
                          {t('Notes')}
                        </button>
                        <HelpDot text={t('Notes = the short explanations inside each station. Off by default: the tour and the “Why” of each step carry the explanation; the free path stays clean.')} />
                      </span>
                    </div>
                  </>
                ) : null}

                {/* THE DESK NEVER UNMOUNTS with a tab or a station: its pending omnibus signatures live in its state, and
                    a remount offered «Compose» → a second payment. Hidden, not
                    removed; the server records the hand-off as well. */}
                <ExchangeStationContext.Provider value={{ station: prefs.all ? null : station, hints: prefs.hints }}>
                  <div hidden={tab !== 'exchange'}>
                    <ExchangeDesk demo={demo} onBlockedChange={setDeskBlocked} />
                  </div>
                </ExchangeStationContext.Provider>
                <ExchangeStationContext.Provider value={{ station: null, hints: prefs.hints }}>
                  <AnimatePresence mode="wait" initial={false}>
                    {tab !== 'exchange' ? (
                      <motion.div
                        key={tab}
                        initial={reduced ? false : { opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={reduced ? undefined : { opacity: 0, y: -6 }}
                        transition={{ duration: 0.22, ease: EASE_OUT }}
                      >
                        {tab === 'runs' ? <RunsPanel demo={demo} /> : null}
                        {tab === 'user' ? <ClientApp demo={demo} /> : null}
                        {tab === 'curtain' ? <CurtainGraph run={run} chain={chain} /> : null}
                        {tab === 'evidence' ? <EvidencePanel demo={demo} /> : null}
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </ExchangeStationContext.Provider>


    </div>
  );

  /* ── La puerta: sin cuenta XRPL elegida, no hay mesa ─────────────────── */
  if (!root) {
    return (
      <div className="space-y-6">
        <Header t={t} run={run} guided={prefs.guided} onGuided={() => undefined} showGuided={false} />
        <ExchangeAccountGate onChosen={() => undefined} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Header t={t} run={run} guided={prefs.guided} onGuided={() => patchPrefs({ guided: !prefs.guided })} showGuided={room === 'operate'} />
      {demo.error ? <p className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-xs text-danger">{demo.error}</p> : null}

      {/* Las salas. */}
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl<Room>
          layoutId="exchange-rooms"
          options={[
            ...(setupDone && room !== 'setup' ? [] : [{ key: 'setup' as Room, label: t('Set up') }]),
            { key: 'operate' as Room, label: t('Operate') },
            { key: 'v1' as Room, label: t('Institutional (v1)') },
          ]}
          value={room}
          onChange={(r) => { if (!deskBlocked) setRoom(r); }}
        />
        {setupDone && room !== 'setup' ? (
          <button
            type="button"
            disabled={deskBlocked}
            onClick={() => { if (!deskBlocked) setRoom('setup'); }}
            className="inline-flex items-center gap-1.5 rounded-full border border-tone-success/30 bg-tone-success/[0.05] px-2.5 py-1 text-[11px] text-tone-success transition-colors hover:border-tone-success/60"
          >
            <Check className="h-3 w-3" strokeWidth={2.5} /> {t('Setup complete · review')}
          </button>
        ) : null}
        <span className="text-[12px] text-ink/45">{roomMeta[room].purpose}</span>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={room}
          initial={reduced ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? undefined : { opacity: 0, y: -8 }}
          transition={{ duration: 0.28, ease: EASE_OUT }}
        >
          {/* El alta vive UNA vez, en su ventana
              (ExchangeSetupOperation, la plantilla del Legacy): aquí, la puerta. */}
          {room === 'setup' ? (
            <SetupDoorCard
              icon={Building2}
              eyebrow={t('Exchange')}
              title={t('Set up your exchange')}
              purpose={t('Two new accounts, the licence, the constitution, the KYC registry, the cage, the pote, the gate and the desk — become a tenant of the rail.')}
              stations={8}
              effort={t('~40 min · Xaman + MetaMask')}
              status={setupDone ? <span className="text-tone-success">{t('Setup complete for this root')}</span> : undefined}
              onOpen={() => openExchangeSetup()}
            />
          ) : null}

          {room === 'v1' ? <InstitutionalV1Room /> : null}

          {room === 'operate' ? (
            operateAside ? (
              /* LA COLUMNA LATERAL: el raíl de estaciones del desk y, debajo,
                 el tour — pegados arriba; la mesa a la derecha. La MISMA pieza
                 que el alta; el lado lo decide la caja (tira encima si es
                 estrecha). */
              <StationRailLayout railWidth="19rem" rail={operateAside}>
                {operateMain}
              </StationRailLayout>
            ) : (
              operateMain
            )
          ) : null}
        </motion.div>
      </AnimatePresence>

      {intro ? <HowTheDemoWorksModal onClose={closeIntro} /> : null}
    </div>
  );
}

/* ── La cabecera: qué es, qué es real, y el run en una línea ─────────────── */
function Header({
  t,
  run,
  guided,
  onGuided,
  showGuided,
}: {
  t: (s: string) => string;
  run: ReturnType<typeof useDemoRun>['run'];
  guided: boolean;
  onGuided: () => void;
  showGuided: boolean;
}) {
  return (
    <header className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <MicroLabel>{t('Exchange · operator desk')}</MicroLabel>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-[22px] font-semibold tracking-tight text-ink">{run ? run.label : t('Your exchange on the rail')}</h1>
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-tone-warning">
              {t('simulated exchange · real chain')}
            </span>
          </div>
          <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-ink/55">
            {t('The exchange adopts the whole rail with two NEW accounts — the root that governs and the omnibus where its clients deposit by tag — gets accredited, births its cage and operates. Astryum does not sign, custody or decide: it lays the rail and the mechanical doors.')}
          </p>
          <p className="mt-1 text-[11px] text-ink/40">
            <Link href="/app/exchange" className="inline-flex items-center gap-1 underline underline-offset-2 transition-colors hover:text-ink">{t('Client site')} <ArrowUpRight className="h-3 w-3" /></Link>
            <span className="mx-1.5">·</span>
            {t('what your clients see, in the menu')}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {showGuided ? (
            <GhostButton onClick={onGuided} className={guided ? 'border-volt/50 text-volt' : ''}>
              <Compass className="mr-1.5 inline h-3.5 w-3.5" /> {guided ? t('Guided tour: on') : t('Guided tour')}
            </GhostButton>
          ) : null}
          <HowTheDemoWorksButton />
        </div>
      </div>
      {run ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-ink/55">
          <span><span className="text-ink/35">{t('run')}</span> #{run.seq}</span>
          <span><span className="text-ink/35">{t('council')}</span> {shortHash(run.councilAddress, 8, 4)}</span>
          <span><span className="text-ink/35">{t('omnibus')}</span> {shortHash(run.omnibusAddress, 8, 4)}</span>
          <span><span className="text-ink/35">{t('pote')}</span> {run.poteAddress ? shortHash(run.poteAddress, 8, 4) : t('not born yet')}</span>
          <span><span className="text-ink/35">{t('policy')}</span> {run.policy}</span>
        </div>
      ) : null}
    </header>
  );
}

export default ExchangeStage;
