'use client';

/**
 * ExchangeConsole — la consola de gestión del exchange, PRODUCTIZADA.
 *
 * Seis pestañas: Resumen · Clientes · Omnibus · Potes · Perfil · Auditoría.
 * Y arriba, la SECCIÓN DE EXCHANGES: elegir con qué
 * exchange se trabaja y crear otro con el alta completa (la misma ventana de
 * siempre, ExchangeSetupOperation).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  BadgeCheck,
  Building2,
  Check,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { Card, EmptyState, GhostButton, MicroLabel, Pill, PrimaryButton, SegmentedControl } from '../../ui/primitives';
import { RevealGroup, RevealItem } from '../../ui/motion';
import { SetupDoorCard } from '../../ui/SetupDoorCard';
import { useT } from '../../../i18n/LanguageProvider';
import { useOperationStore } from '../../../stores/operationStore';
import { useWalletStore } from '../../../stores/walletStore';
import { useMyWallets } from '../../../hooks/useMyWallets';
import { isXrplWallet } from '../../../lib/walletIdentity';
import { useXrplWalletPartner } from '../../../lib/wallet/useXrplWalletPartner';
import { useDemoRun, type DemoRunApi } from '../../../lib/demo-exchange/useDemoRun';
import { demoApi, describeRefusal, dropsToXrp, shortHash, type AutopilotStatus, type DemoRun, type RunCredentialRow } from '../../../lib/demo-exchange/api';
import { fmtBase } from '../../../lib/institutional/policyCatalog';
import { venueIdentity } from '../../../lib/institutional/venueIdentity';
import { getCageOf, getPoteState, prepareCredentialAccept, prepareCredentialIssue, readManagerProfile, type PoteState } from '../../../lib/institutional/api';
import { CredentialCeremonyModal } from '../../institutional/CredentialCeremonyModal';
import { XamanSingleSign } from '../../xrpl/XamanSingleSign';
import { ManagerPublicProfile } from '../../managed/ManagerPublicProfile';
import { ManagerConsole } from '../../managed/ManagerConsole';
import { ManagerGovernance } from '../../managed/ManagerGovernance';
import { VaultCreator } from '../../managed/VaultCreator';
import { EvidencePanel } from '../EvidencePanel';
import { StructuresPanel } from './StructuresPanel';
// La mesa del operador está PUBLICADA: una pestaña nueva aquí la ve
// cualquiera. Exchange 2.0 va tapada — envoltorio dentro Y la pestaña fuera del
// raíl para quien no sea fundador (el veredicto es del servidor, fail-closed).
import { PreviewOnly } from '../../ui/PreviewOnly';
import { useAuthStore } from '../../../stores/authStore';
import { DeskDepositQr } from '../DepositXamanQr';
import { ExchangeStaleLockScope } from '../ExchangeStaleLockScope';
// El autopilot fuera de la vista; cada movimiento lo firma el omnibus con un QR.
import { AUTOPILOT_UI } from '../../../lib/demo-exchange/autopilotVisibility';
import { DeskRequestQueue, pendingDeskWork } from './DeskRequestQueue';

type ConsoleTab = 'overview' | 'clients' | 'structures' | 'omnibus' | 'potes' | 'profile' | 'audit';

/* ── Lecturas compartidas por las pestañas ───────────────────────────────── */
function useRunKyc(run: DemoRun | null) {
  const [rows, setRows] = useState<Map<string, RunCredentialRow>>(new Map());
  const [required, setRequired] = useState(true);
  const [nonce, setNonce] = useState(0);
  const runId = run?.runId;
  const count = run?.clients.length ?? 0;
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    void demoApi.runCredentials(runId).then((r) => {
      // Una lectura fallida deja la última buena: nunca pinta «sin KYC» por no poder leer.
      if (!cancelled && r.ok) {
        setRequired(r.data.required);
        setRows(new Map(r.data.clients.map((c) => [c.clientId, c])));
      }
    });
    return () => { cancelled = true; };
  }, [runId, count, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { rows, required, reload };
}
type RunKyc = ReturnType<typeof useRunKyc>;

function useAutopilot(enabled: boolean) {
  const [status, setStatus] = useState<AutopilotStatus | null>(null);
  useEffect(() => {
    // Oculto (AUTOPILOT_UI), ni se pregunta: nada de la consola lo lee.
    if (!enabled) return;
    let alive = true;
    const load = () => void demoApi.autopilot().then((r) => { if (alive && r.ok) setStatus(r.data); });
    load();
    const id = window.setInterval(load, 20_000);
    return () => { alive = false; window.clearInterval(id); };
  }, [enabled]);
  return status;
}

function autopilotOn(run: DemoRun, status: AutopilotStatus | null): boolean {
  return Boolean(run.autopilot && status?.enabled && status.running && status.signerAddress === run.omnibusAddress);
}

/* ── La consola ──────────────────────────────────────────────────────────── */
export function ExchangeConsole() {
  const { t } = useT();
  const demo = useDemoRun();
  const { address: connectedRoot } = useXrplWalletPartner();
  const openSetup = useOperationStore((s) => s.openExchangeSetupOp);
  const [tab, setTab] = useState<ConsoleTab>('overview');
  const isFounder = useAuthStore((st) => st.isAdmin) === true;
  const [blocked, setBlocked] = useState(false);
  const [approveFor, setApproveFor] = useState<string | null>(null);
  const autopilot = useAutopilot(AUTOPILOT_UI);
  const run = demo.run;
  const kyc = useRunKyc(run);

  // Al entrar, si la wallet conectada gobierna un exchange, ese es el primero que se abre.
  const [landed, setLanded] = useState(false);
  useEffect(() => {
    // `loading`: el arranque de useDemoRun puede estar reabriendo el último exchange
    // elegido — no se pisa.
    if (landed || demo.runs.length === 0 || demo.loading) return;
    setLanded(true);
    const mine = connectedRoot ? demo.runs.find((r) => r.councilAddress === connectedRoot) : undefined;
    // Sin la raíz conectada en Xaman y sin ningún exchange abierto todavía, la consola
    // pintaba «Set up your exchange» con el exchange existente olvidado en la lista
    // de arriba. Si hay UNO
    // solo abierto, es ese; con varios, se elige arriba. Leer no exige ser la raíz:
    // firmar sí, y la consola ya lo dice.
    const open = demo.runs.filter((r) => r.status === 'open');
    const target = mine ?? (!run?.runId && open.length === 1 ? open[0] : undefined);
    if (target && run?.runId !== target.runId) void demo.loadRun(target.runId).then(() => demo.refreshChain());
  }, [landed, demo, connectedRoot, run?.runId]);

  // La cadena (pote, participaciones) al día sin pulsar nada.
  const refreshChain = demo.refreshChain;
  useEffect(() => {
    if (!run?.runId) return;
    void refreshChain();
    const id = window.setInterval(() => void refreshChain(), 30_000);
    return () => window.clearInterval(id);
  }, [run?.runId, refreshChain]);

  if (demo.loading && !run && demo.runs.length === 0) return <EmptyState variant="loading" title={t('Opening your exchange…')} />;

  return (
    <ExchangeStaleLockScope>
      <div className="space-y-5">
        <ExchangeSwitcher demo={demo} blocked={blocked} connectedRoot={connectedRoot} onCreate={() => openSetup()} />

        {!run ? (
          <SetupDoorCard
            icon={Building2}
            eyebrow={t('Exchange')}
            title={t('Set up your exchange')}
            purpose={t('Two new accounts, the licence, the constitution, the cage, the pote and the desk — become a tenant of the rail.')}
            stations={7}
            effort={t('~40 min · Xaman')}
            onOpen={() => openSetup()}
          />
        ) : (
          <>
            <ConsoleHeader run={run} autopilot={autopilot} connectedRoot={connectedRoot} />
            {run.councilAddress !== connectedRoot ? (
              <p className="rounded-xl border border-tone-warning/30 bg-tone-warning/[0.06] p-3 text-[12.5px] text-tone-warning">
                {t('The XRPL wallet connected here is not the root of this exchange. You can read everything; to sign its orders in Xaman, connect {root}.').replace('{root}', shortHash(run.councilAddress, 6, 4))}
              </p>
            ) : null}
            <SegmentedControl<ConsoleTab>
              layoutId="exchange-console-tabs"
              value={tab}
              onChange={(k) => { if (!blocked) setTab(k); }}
              options={[
                { key: 'overview', label: t('Overview') },
                { key: 'clients', label: t('Clients') },
                ...(isFounder ? [{ key: 'structures' as const, label: t('Structures') }] : []),
                { key: 'omnibus', label: t('Omnibus') },
                { key: 'potes', label: t('Potes') },
                { key: 'profile', label: t('Profile') },
                { key: 'audit', label: t('Audit') },
              ]}
            />
            {blocked ? <p className="text-[12px] text-tone-warning">{t('A signature of the exchange is waiting in Xaman — the other tabs come back once it settles or is refused.')}</p> : null}
            {demo.error ? <p className="rounded-xl border border-tone-warning/30 bg-tone-warning/[0.06] p-3 text-[12.5px] text-tone-warning">{demo.error}</p> : null}

            <RevealGroup key={`${run.runId}:${tab}`} className="space-y-4" stagger={0.05}>
              {tab === 'overview' ? <OverviewPanel demo={demo} run={run} kyc={kyc} autopilot={autopilot} onApprove={(id) => { setApproveFor(id); setTab('clients'); }} go={setTab} onBlockedChange={setBlocked} /> : null}
              {tab === 'clients' ? <ClientsPanel demo={demo} run={run} kyc={kyc} selected={approveFor} onSelect={setApproveFor} onBlockedChange={setBlocked} /> : null}
              {tab === 'structures' ? (
                <PreviewOnly label="Exchange 2.0 · estructuras" pending="falta el ensayo de mainnet">
                  <StructuresPanel run={run} onBlockedChange={setBlocked} />
                </PreviewOnly>
              ) : null}
              {tab === 'omnibus' ? <OmnibusPanel demo={demo} run={run} /> : null}
              {tab === 'potes' ? <PotesPanel demo={demo} run={run} connectedRoot={connectedRoot} onBlockedChange={setBlocked} /> : null}
              {tab === 'profile' ? <ProfilePanel run={run} kyc={kyc} /> : null}
              {tab === 'audit' ? <RevealItem><Card className="p-5"><EvidencePanel demo={demo} /></Card></RevealItem> : null}
            </RevealGroup>
          </>
        )}
      </div>
    </ExchangeStaleLockScope>
  );
}

/* ── La sección de exchanges: elegir y crear ─────────────────────────────── */
function ExchangeSwitcher({ demo, blocked, connectedRoot, onCreate }: { demo: DemoRunApi; blocked: boolean; connectedRoot: string | null; onCreate: () => void }) {
  const { t } = useT();
  const open = demo.runs.filter((r) => r.status === 'open');
  if (demo.runs.length === 0) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MicroLabel>{t('Your exchanges')}</MicroLabel>
        <GhostButton onClick={onCreate}><Plus className="h-4 w-4" /> {t('New exchange')}</GhostButton>
      </div>
    );
  }
  return (
    <Card className="flex flex-wrap items-center gap-3 p-3 pl-4">
      <MicroLabel tone="muted">{t('Your exchanges')}</MicroLabel>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {(open.length ? open : demo.runs).map((r) => {
          const on = demo.run?.runId === r.runId;
          const governs = connectedRoot === r.councilAddress;
          return (
            <button
              key={r.runId}
              type="button"
              disabled={blocked}
              onClick={() => { if (!blocked && !on) void demo.loadRun(r.runId).then(() => demo.refreshChain()); }}
              aria-pressed={on}
              className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${on ? 'border-volt/45 bg-volt/[0.08] text-ink' : 'border-ink/10 text-ink/60 hover:border-ink/25 hover:text-ink'}`}
            >
              <Building2 className={`h-3.5 w-3.5 ${on ? 'text-volt' : 'text-ink/40'}`} strokeWidth={1.8} />
              {r.label}
              <span className="font-mono text-[11px] text-ink/35">{r.clients}</span>
              {governs ? <span className="h-1.5 w-1.5 rounded-full bg-tone-success" title={t('Your connected wallet governs this exchange')} /> : null}
            </button>
          );
        })}
      </div>
      <GhostButton onClick={onCreate} disabled={blocked} className="py-2"><Plus className="h-4 w-4" /> {t('New exchange')}</GhostButton>
    </Card>
  );
}

function ConsoleHeader({ run, autopilot, connectedRoot }: { run: DemoRun; autopilot: AutopilotStatus | null; connectedRoot: string | null }) {
  const { t } = useT();
  const on = autopilotOn(run, autopilot);
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <div className="mb-2 text-xs font-medium text-ink/40">{t('Exchange · operator console')}</div>
        <h1 className="text-[24px] font-semibold leading-[1.15] tracking-tight text-ink md:text-[28px]">{run.label}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink/55">
          {AUTOPILOT_UI
            ? t('Your clients, their KYC, the omnibus and your potes. The autopilot executes what your clients ask; you approve KYC and direct the capital.')
            : t('Your clients, their KYC, the omnibus and your potes. Your clients ask; you sign each movement from the omnibus with a QR in Xaman.')}
        </p>
      </div>
      <div className="flex flex-col items-start gap-2 md:items-end">
        <div className="flex flex-wrap items-center gap-2">
          {AUTOPILOT_UI ? (on ? <Pill tone="success"><Zap className="h-3 w-3" /> {t('Autopilot on')}</Pill> : <Pill tone="warning"><Zap className="h-3 w-3" /> {autopilot ? t('Autopilot not running') : t('Reading autopilot…')}</Pill>) : null}
          <Pill mono>{t('root')} {shortHash(run.councilAddress, 5, 4)}{connectedRoot === run.councilAddress ? ' · Xaman' : ''}</Pill>
          {AUTOPILOT_UI ? null : <Pill mono>{t('omnibus')} {shortHash(run.omnibusAddress, 5, 4)}</Pill>}
        </div>
        {AUTOPILOT_UI && autopilot?.lastTickAt ? <span className="text-[12px] text-ink/40">{t('last cycle')} {new Date(autopilot.lastTickAt).toLocaleTimeString()} · {t('every {s} s').replace('{s}', String(Math.round(autopilot.intervalMs / 1000)))}</span> : null}
      </div>
    </div>
  );
}

/* ── Resumen ─────────────────────────────────────────────────────────────── */
function Kpi({ label, value, unit, hint, tone }: { label: string; value: string; unit?: string; hint?: string; tone?: 'warning' }) {
  return (
    <Card className="p-5">
      <p className="mb-3 text-[12px] text-ink/45">{label}</p>
      <p className="font-mono text-[26px] font-semibold leading-none tracking-tight text-ink">{value}{unit ? <span className="ml-1.5 text-[13px] text-ink/45">{unit}</span> : null}</p>
      {hint ? <p className={`mt-3 text-[12px] ${tone === 'warning' ? 'text-tone-warning' : 'text-ink/40'}`}>{hint}</p> : null}
    </Card>
  );
}

function OverviewPanel({ demo, run, kyc, autopilot, onApprove, go, onBlockedChange }: { demo: DemoRunApi; run: DemoRun; kyc: RunKyc; autopilot: AutopilotStatus | null; onApprove: (clientId: string) => void; go: (tab: ConsoleTab) => void; onBlockedChange: (blocked: boolean) => void }) {
  const { t } = useT();
  const clientsXrp = run.clients.reduce((s, c) => s + BigInt(c.xrpOnExchangeDrops || '0'), BigInt(0));
  const pending = run.clients.filter((c) => kyc.required && kyc.rows.get(c.id)?.ok === false);
  const pote = demo.chain?.pote ?? null;
  const dec = pote?.asset?.decimals ?? 6;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function turnOn() {
    setErr('');
    setBusy(true);
    const r = await demoApi.patchRun(run.runId, { autopilot: true });
    setBusy(false);
    if (!r.ok) return setErr(describeRefusal(r.refusal, t));
    demo.setRun(r.data.run);
  }

  return (
    <>
      <RevealItem>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label={t('XRP of your clients')} value={dropsToXrp(clientsXrp.toString(), 2)} unit="XRP" hint={t('credited to their tags at the exchange')} />
          <Kpi label={t('Clients')} value={String(run.clients.length)} hint={pending.length ? t('{n} waiting for your KYC').replace('{n}', String(pending.length)) : t('all with KYC in force')} tone={pending.length ? 'warning' : undefined} />
          <Kpi label={t('In the pote')} value={pote ? fmtBase(pote.totalAssets, dec) : '—'} unit={pote?.asset?.symbol ?? 'FXRP'} hint={pote ? t('{n} venues allowed').replace('{n}', String(pote.venues.filter((v) => !v.retired).length)) : run.poteAddress ? t('reading…') : t('no pote yet')} />
          {/* EL TEXTO DECÍA LO CONTRARIO DE LO QUE HACE EL CÓDIGO.
              Este hint sale cuando el gasto de hoy NO se pudo leer, y decía que
              «el tope de N XRP/día sigue negando antes de firmar». Desde la
              eso es falso para la mitad que importa: el tope acota NUESTRA llave
              operativa, así que una entrada (`put-to-work`) falla cerrada y
              visible — `SPEND_LEDGER_UNREADABLE`, DemoExchangeAutopilot — pero el
              payout de un cliente SALE igual y se anota en los recibos del run
              (`noteCapUnread`, «the payout went out anyway»). LA SALIDA JAMAS SE
              GATEA por una lectura nuestra, y la consola no puede decir que sí. */}
          {!AUTOPILOT_UI ? (
            <Kpi
              label={t('Client requests')}
              value={String(pendingDeskWork(run))}
              hint={t('each one signed by the omnibus with a QR')}
              tone={pendingDeskWork(run) ? 'warning' : undefined}
            />
          ) : <Kpi label={t('Autopilot today')} value={autopilot && typeof autopilot.spentTodayXrp === 'number' ? String(autopilot.spentTodayXrp) : autopilot ? t('not read') : '—'} unit={autopilot && typeof autopilot.spentTodayXrp === 'number' ? `/ ${autopilot.dailyCapXrp} XRP` : undefined} hint={autopilot ? (typeof autopilot.spentTodayXrp === 'number' ? t('cap {n} XRP per payment').replace('{n}', String(autopilot.maxTxXrp)) : t("today's spend could not be read — entries stop until it can be; a client's payout still goes out and is written into the receipts")) : undefined} tone={autopilot && typeof autopilot.spentTodayXrp !== 'number' ? 'warning' : undefined} />}
        </div>
      </RevealItem>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <RevealItem>
          <Card className="p-5">
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-[15px] font-semibold tracking-tight text-ink">{t('Omnibus, live')}</h2>
              <button onClick={() => go('omnibus')} className="ml-auto text-[12px] text-volt hover:underline">{t('See all')} →</button>
            </div>
            <OmnibusFeed demo={demo} run={run} limit={6} compact />
          </Card>
        </RevealItem>

        <div className="space-y-4">
          <RevealItem>
            <Card className="p-5">
              <div className="flex items-center gap-2">
                <h2 className="text-[15px] font-semibold tracking-tight text-ink">{t('Waiting for you')}</h2>
                {pending.length ? <Pill tone="warning" size="sm">{pending.length} KYC</Pill> : null}
              </div>
              {pending.length === 0 ? (
                <p className="mt-3 text-[13px] text-ink/45">{kyc.required ? t('Nothing pending. New clients appear here as soon as they sign up.') : t('The KYC gate is off on this environment.')}</p>
              ) : (
                <ul className="mt-2 divide-y divide-ink/[0.05]">
                  {pending.slice(0, 5).map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] text-ink">{c.label}</p>
                        <p className="text-[12px] text-ink/45">{t('tag')} {c.tag} · {new Date(c.createdAt).toLocaleDateString()}</p>
                      </div>
                      <PrimaryButton onClick={() => onApprove(c.id)} className="px-3 py-1.5 text-[12.5px]">{t('Approve KYC')}</PrimaryButton>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </RevealItem>

          {!AUTOPILOT_UI ? (
            <RevealItem>
              <DeskRequestQueue demo={demo} run={run} onBlockedChange={onBlockedChange} />
            </RevealItem>
          ) : (
          <RevealItem>
            <Card className="p-5">
              <div className="flex items-center gap-2">
                <h2 className="text-[15px] font-semibold tracking-tight text-ink">{t('Autopilot')}</h2>
                {autopilotOn(run, autopilot) ? <Pill tone="success" size="sm">{t('always on')}</Pill> : null}
              </div>
              {!autopilot ? (
                <p className="mt-3 text-[13px] text-ink/45">{t('Reading autopilot…')}</p>
              ) : (
                <dl className="mt-2 divide-y divide-ink/[0.05] text-[13px]">
                  <div className="flex items-center justify-between gap-3 py-2.5">
                    <dt className="text-ink/45">{t('Omnibus key')}</dt>
                    <dd className="flex items-center gap-2">
                      <span className="font-mono text-[12px] text-ink/80">{autopilot.signerAddress ? shortHash(autopilot.signerAddress, 5, 4) : '—'}</span>
                      {autopilot.signerAddress === run.omnibusAddress ? <Pill tone="success" size="sm">{t('opens this omnibus')}</Pill> : <Pill tone="warning" size="sm">{t('another omnibus')}</Pill>}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-2.5"><dt className="text-ink/45">{t('Cycle')}</dt><dd className="font-mono text-[12px] text-ink/80">{autopilot.running ? t('every {s} s').replace('{s}', String(Math.round(autopilot.intervalMs / 1000))) : t('stopped')}</dd></div>
                  <div className="flex items-center justify-between gap-3 py-2.5"><dt className="text-ink/45">{t('Caps')}</dt><dd className="font-mono text-[12px] text-ink/80">{autopilot.maxTxXrp} XRP / {t('payment')} · {autopilot.dailyCapXrp} / {t('day')}</dd></div>
                  <div className="flex items-center justify-between gap-3 py-2.5"><dt className="text-ink/45">{t('In progress')}</dt><dd className="text-[12px] text-ink/80">{(run.requests ?? []).filter((q) => q.status === 'pending' || q.status === 'submitting' || q.status === 'signed').length}</dd></div>
                </dl>
              )}
              {!run.autopilot ? (
                <div className="mt-3 space-y-2">
                  <p className="text-[12px] text-tone-warning">{t('The autopilot is paused for this exchange: client requests wait until it runs.')}</p>
                  <PrimaryButton onClick={() => void turnOn()} disabled={busy} className="w-full">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} {t('Turn the autopilot on')}</PrimaryButton>
                </div>
              ) : null}
              {autopilot?.lastError ? <p className="mt-2 text-[12px] text-tone-warning">{autopilot.lastError}</p> : null}
              {err ? <p className="mt-2 text-[12px] text-tone-warning">{err}</p> : null}
              <p className="mt-3 text-[12px] leading-relaxed text-ink/45">{t('It executes what your clients ask, within its caps. It never moves anyone’s money on its own initiative.')}</p>
            </Card>
          </RevealItem>
          )}
        </div>
      </div>

      {pote ? (
        <RevealItem>
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-[15px] font-semibold tracking-tight text-ink">{pote.name}</h2>
              <Pill mono size="sm">{shortHash(pote.pote, 6, 4)}</Pill>
              <button onClick={() => go('potes')} className="ml-auto text-[12px] text-volt hover:underline">{t('Control the pote')} →</button>
            </div>
            <PoteBar pote={pote} />
          </Card>
        </RevealItem>
      ) : null}
    </>
  );
}

const BAR_TONES = ['bg-volt', 'bg-volt-soft/50', 'bg-volt/30', 'bg-volt-soft/25'];

function PoteBar({ pote }: { pote: { totalAssets: string; freeBalance: string; bufferFloorBps: number; venues: Array<{ id: number; target: string; kind: string | number; value: string; retired?: boolean }>; asset?: { decimals: number } } }) {
  const { t } = useT();
  const total = BigInt(pote.totalAssets || '0');
  const dec = pote.asset?.decimals ?? 6;
  const pct = (v: bigint) => (total === BigInt(0) ? 0 : Number((v * BigInt(10000)) / total) / 100);
  const venues = pote.venues.filter((v) => BigInt(v.value || '0') > BigInt(0));
  const free = BigInt(pote.freeBalance || '0');
  if (total === BigInt(0)) return <p className="text-[13px] text-ink/45">{t('The pote is empty: capital arrives when a client puts XRP into it.')}</p>;
  return (
    <div>
      <div className="relative">
        <div className="flex h-3 overflow-hidden rounded-full bg-ink/[0.06]">
          {venues.map((v, i) => <div key={v.id} className={BAR_TONES[i % BAR_TONES.length]} style={{ width: `${pct(BigInt(v.value))}%` }} />)}
          <div className="bg-ink/15" style={{ width: `${pct(free)}%` }} />
        </div>
        {pote.bufferFloorBps ? <div className="absolute -bottom-1 -top-1 w-0.5 rounded bg-tone-warning" style={{ left: `${100 - pote.bufferFloorBps / 100}%` }} title={t('liquid floor')} /> : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-[12.5px]">
        {venues.map((v, i) => {
          const id = venueIdentity(v.target);
          return (
            <span key={v.id} className="inline-flex items-center gap-2">
              <span className={`h-2 w-2 rounded-sm ${BAR_TONES[i % BAR_TONES.length]}`} />
              <span className="text-ink/80">{id.known ? id.name : shortHash(v.target, 5, 3)}</span>
              <span className="font-mono text-ink/45">{fmtBase(v.value, dec)} · {pct(BigInt(v.value)).toFixed(0)} %</span>
            </span>
          );
        })}
        <span className="inline-flex items-center gap-2">
          <span className="h-2 w-2 rounded-sm bg-ink/15" />
          <span className="text-ink/80">{t('Buffer')}</span>
          <span className="font-mono text-ink/45">{fmtBase(free, dec)} · {pct(free).toFixed(0)} % ({t('floor')} {(pote.bufferFloorBps / 100).toFixed(0)} %)</span>
        </span>
      </div>
    </div>
  );
}

/* ── Omnibus: la feed ────────────────────────────────────────────────────── */
type FeedFilter = 'all' | 'in' | 'out' | 'fe' | 'attention';
interface FeedRow { hash: string; at: string; kind: string; dot: string; client: string; detail: string; amount: string; incoming: boolean; status: string; tone: 'success' | 'info' | 'warning' | 'neutral'; fe: boolean; attention: boolean; href?: string }

function useOmnibusRows(demo: DemoRunApi, run: DemoRun): FeedRow[] {
  const { t } = useT();
  return useMemo(() => {
    const txs = demo.omnibus?.ok ? demo.omnibus.data.txs : [];
    const applied = new Set(run.appliedTxHashes);
    const clientById = new Map(run.clients.map((c) => [c.id, c]));
    const clientByTag = new Map(run.clients.map((c) => [c.tag, c]));
    const byHash = new Map<string, { clientId: string; status: string; kind: string }>();
    for (const q of run.requests ?? []) if (q.txHash) byHash.set(q.txHash.toUpperCase(), { clientId: q.clientId, status: q.status, kind: q.kind });
    for (const p of run.deskPayments ?? []) if (p.txHash) byHash.set(p.txHash.toUpperCase(), { clientId: p.clientId, status: p.status, kind: p.kind });
    return txs.map((x): FeedRow => {
      const fe = Boolean(x.memoHex?.toUpperCase().startsWith('FE'));
      const linked = byHash.get(x.hash.toUpperCase());
      const client = (x.clientId && clientById.get(x.clientId)) || (linked && clientById.get(linked.clientId)) || undefined;
      const who = client ? `${client.label} · ${t('tag')} ${client.tag}` : '—';
      const base = { hash: x.hash, at: x.dateISO, client: who, amount: `${x.direction === 'in' ? '+' : '−'}${dropsToXrp(x.drops, 2)}`, incoming: x.direction === 'in', fe, href: x.explorerUrl };
      if (x.kind === 'deposit' || x.kind === 'return') {
        const credited = applied.has(`in:${x.hash.toUpperCase()}`);
        return { ...base, kind: x.kind === 'deposit' ? t('Deposit') : t('Return'), dot: 'bg-tone-success', detail: x.kind === 'deposit' ? `${t('from')} ${shortHash(x.account, 5, 4)}` : t('FAssets redemption back to the client tag'), status: credited ? t('Credited') : t('Seen'), tone: credited ? 'success' : 'info', attention: false };
      }
      if (x.kind === 'withdraw') {
        return { ...base, kind: t('Withdrawal'), dot: 'bg-ink/40', detail: `${t('to the client wallet')} ${shortHash(x.destination, 5, 4)}`, status: t('Paid'), tone: 'neutral', attention: false };
      }
      if (fe && x.direction === 'out') {
        const done = linked?.status === 'done' || linked?.status === 'settled';
        return { ...base, kind: '0xFE', dot: 'bg-volt', detail: linked ? t('Mint FXRP into the pote for the client') : t('Instruction to Flare (not linked to a client)'), status: linked ? (done ? t('In the pote') : t('On its way to the pote')) : t('Unlinked'), tone: linked ? (done ? 'success' : 'info') : 'warning', attention: !linked };
      }
      if (x.direction === 'in') {
        const tagged = typeof x.destinationTag === 'number';
        const known = tagged ? clientByTag.get(x.destinationTag as number) : undefined;
        return { ...base, client: known ? `${known.label} · ${t('tag')} ${known.tag}` : '—', kind: t('Deposit'), dot: 'bg-tone-warning', detail: tagged ? `${t('tag')} ${x.destinationTag} · ${t('from')} ${shortHash(x.account, 5, 4)}` : `${t('no tag')} · ${t('from')} ${shortHash(x.account, 5, 4)}`, status: tagged ? t('Tag without an account') : t('No tag'), tone: 'warning', attention: true };
      }
      return { ...base, kind: t('Other'), dot: 'bg-ink/25', detail: `${t('to')} ${shortHash(x.destination, 5, 4)}`, status: t('Other'), tone: 'neutral', attention: false };
    });
  }, [demo.omnibus, run.appliedTxHashes, run.clients, run.requests, run.deskPayments, t]);
}

function OmnibusFeed({ demo, run, limit, compact, filter = 'all' }: { demo: DemoRunApi; run: DemoRun; limit?: number; compact?: boolean; filter?: FeedFilter }) {
  const { t } = useT();
  const scan = demo.scanOmnibus;
  useEffect(() => {
    void scan();
    const id = window.setInterval(() => void scan(), 15_000);
    return () => window.clearInterval(id);
  }, [scan, run.runId]);
  const rows = useOmnibusRows(demo, run).filter((r) =>
    filter === 'all' ? true : filter === 'in' ? r.incoming : filter === 'out' ? !r.incoming : filter === 'fe' ? r.fe : r.attention,
  );
  const shown = limit ? rows.slice(0, limit) : rows;

  if (!demo.omnibus) return <p className="py-6 text-[13px] text-ink/45"><Loader2 className="mr-2 inline h-3.5 w-3.5 animate-spin" />{t('Reading the omnibus…')}</p>;
  if (!demo.omnibus.ok) return <p className="py-6 text-[13px] text-tone-warning">{t('The omnibus could not be read just now — this says nothing about the money in it. It retries on its own.')}</p>;
  if (shown.length === 0) return <p className="py-6 text-[13px] text-ink/45">{t('No movements on the omnibus yet.')}</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-ink/[0.06] text-left font-mono text-[10px] uppercase tracking-[0.14em] text-ink/40">
            <th className="py-2.5 pr-3 font-medium">{t('Time')}</th>
            <th className="py-2.5 pr-3 font-medium">{t('Type')}</th>
            <th className="py-2.5 pr-3 font-medium">{t('Client')}</th>
            {!compact ? <th className="py-2.5 pr-3 font-medium">{t('Detail')}</th> : null}
            <th className="py-2.5 pr-3 text-right font-medium">XRP</th>
            <th className="py-2.5 pr-3 font-medium">{t('Status')}</th>
            {!compact ? <th className="py-2.5 font-medium">Tx</th> : null}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.hash} className={`border-b border-ink/[0.04] ${r.attention ? 'bg-tone-warning/[0.03]' : ''}`}>
              <td className="py-2.5 pr-3 font-mono text-[12px] text-ink/45">{new Date(r.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
              <td className="py-2.5 pr-3"><span className="inline-flex items-center gap-2 text-ink/85"><span className={`h-1.5 w-1.5 rounded-full ${r.dot}`} />{r.kind}</span></td>
              <td className="py-2.5 pr-3 text-ink/85">{r.client}</td>
              {!compact ? <td className="py-2.5 pr-3 text-[12px] text-ink/55">{r.detail}</td> : null}
              <td className={`py-2.5 pr-3 text-right font-mono ${r.incoming ? 'text-tone-success' : 'text-ink/75'}`}>{r.amount}</td>
              <td className="py-2.5 pr-3"><Pill tone={r.tone} size="sm">{r.status}</Pill></td>
              {!compact ? <td className="py-2.5">{r.href ? <a href={r.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[12px] text-volt hover:underline">{shortHash(r.hash, 4, 4)} <ExternalLink className="h-3 w-3" /></a> : <span className="font-mono text-[12px] text-ink/40">{shortHash(r.hash, 4, 4)}</span>}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OmnibusPanel({ demo, run }: { demo: DemoRunApi; run: DemoRun }) {
  const { t } = useT();
  const [filter, setFilter] = useState<FeedFilter>('all');
  const rows = useOmnibusRows(demo, run);
  const attention = rows.filter((r) => r.attention).length;
  const today = new Date().toDateString();
  const todays = rows.filter((r) => new Date(r.at).toDateString() === today);
  const sum = (list: FeedRow[]) => list.reduce((s, r) => s + Number(r.amount.replace(/[+−]/g, '')), 0).toFixed(2);

  return (
    <>
      <RevealItem>
        <Card className="flex flex-wrap items-center gap-x-8 gap-y-3 p-5">
          <div className="min-w-0">
            <MicroLabel>{t('Omnibus account')}</MicroLabel>
            <a href={`https://xrpscan.com/account/${run.omnibusAddress}`} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1.5 break-all font-mono text-[14px] text-ink hover:text-volt">{run.omnibusAddress} <ExternalLink className="h-3.5 w-3.5 shrink-0" /></a>
          </div>
          <div>
            <p className="text-[12px] text-ink/45">{t('Today in')}</p>
            <p className="font-mono text-[16px] font-semibold text-tone-success">+{sum(todays.filter((r) => r.incoming))} XRP</p>
          </div>
          <div>
            <p className="text-[12px] text-ink/45">{t('Today out')}</p>
            <p className="font-mono text-[16px] font-semibold text-ink">−{sum(todays.filter((r) => !r.incoming))} XRP</p>
          </div>
          <div className="ml-auto flex flex-col items-end gap-1">
            <Pill tone="success"><span className="h-1.5 w-1.5 rounded-full bg-tone-success" /> {t('Live · every {s} s').replace('{s}', '15')}</Pill>
            {demo.omnibus?.ok ? <span className="font-mono text-[11px] text-ink/40">{t('read at')} {new Date(demo.omnibus.data.scannedAt).toLocaleTimeString()}</span> : null}
          </div>
        </Card>
      </RevealItem>
      <RevealItem>
        <Card className="p-5">
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <SegmentedControl<FeedFilter>
              layoutId="omnibus-filter"
              value={filter}
              onChange={setFilter}
              options={[
                { key: 'all', label: t('All') },
                { key: 'in', label: t('In') },
                { key: 'out', label: t('Out') },
                { key: 'fe', label: '0xFE' },
                { key: 'attention', label: attention ? `${t('To resolve')} · ${attention}` : t('To resolve') },
              ]}
            />
            <button onClick={() => void demo.scanOmnibus()} className="ml-auto inline-flex items-center gap-1 text-[12px] text-ink/45 hover:text-ink"><RefreshCw className="h-3 w-3" /> {t('Read now')}</button>
          </div>
          <OmnibusFeed demo={demo} run={run} filter={filter} />
          {attention ? <p className="mt-3 text-[12px] leading-relaxed text-ink/45">{AUTOPILOT_UI ? t('A payment without a tag, or with a tag no account has, is not credited to anyone. The autopilot never pays it back on its own: it only pays registered client wallets.') : t('A payment without a tag, or with a tag no account has, is not credited to anyone. Nothing pays it back on its own: every payout of the omnibus is one you sign with a QR.')}</p> : null}
        </Card>
      </RevealItem>
    </>
  );
}

/* ── Clientes y KYC ──────────────────────────────────────────────────────── */
/**
 * Aprobar el KYC de una casilla con UNA firma: la raíz emite `KYC-<tag>` sobre el
 * omnibus (CredentialCreate, en Xaman) y el autopilot la acepta con la llave de
 * la caja en su siguiente ciclo. La raíz nunca firma en caliente. La ceremonia de
 * dos firmas sigue a mano para cuando el autopilot no está en marcha.
 */
function IssueKycDoor({ run, credentialType, clientLabel, pending, onIssued, onAccepted, onBlockedChange }: {
  run: DemoRun;
  credentialType: string;
  clientLabel: string;
  /** El ledger ya la tiene emitida y sin aceptar: no se ofrece emitir otra. */
  pending: boolean;
  onIssued: (hash: string) => void;
  /** El omnibus la aceptó con su QR (sin autopilot, este es el paso 2). */
  onAccepted?: (hash: string) => void;
  onBlockedChange: (blocked: boolean) => void;
}) {
  const { t } = useT();
  const [txjson, setTxjson] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [issued, setIssued] = useState(false);
  // Paso 2: la aceptación del OMNIBUS, con su propio QR — la hacía el autopilot.
  const [acceptTx, setAcceptTx] = useState<Record<string, unknown> | null>(null);
  const [accepted, setAccepted] = useState(false);
  useEffect(() => () => onBlockedChange(false), [onBlockedChange]);

  async function prepare() {
    setErr('');
    setBusy(true);
    const r = await prepareCredentialIssue({ issuer: run.councilAddress, subject: run.omnibusAddress, credentialType, expirationDays: 365 });
    setBusy(false);
    if (!r.ok) return setErr(r.refusal.detail ?? r.refusal.error);
    setTxjson(r.data.txjson);
  }

  async function prepareAccept() {
    setErr('');
    setBusy(true);
    const r = await prepareCredentialAccept({ issuer: run.councilAddress, subject: run.omnibusAddress, credentialType });
    setBusy(false);
    if (!r.ok) return setErr(r.refusal.detail ?? r.refusal.error);
    setAcceptTx(r.data.txjson);
  }

  if ((issued || pending) && AUTOPILOT_UI) {
    return (
      <p className="mt-4 rounded-xl border border-volt/30 bg-volt/[0.05] p-3 text-[12.5px] leading-relaxed text-ink/75">
        {issued
          ? t('Issued by your root. The autopilot accepts it from the omnibus in a few seconds — this panel updates on its own.')
          : t('Issued — the autopilot accepts it from the omnibus on its next cycle. If the autopilot is not running, finish with the two-signature ceremony.')}
      </p>
    );
  }
  if (issued || pending) {
    if (accepted) {
      return (
        <p className="mt-4 rounded-xl border border-tone-success/30 bg-tone-success/[0.05] p-3 text-[12.5px] leading-relaxed text-ink/75">
          {t('Accepted by the omnibus. The KYC is in force as soon as the ledger validates it — this panel updates on its own.')}
        </p>
      );
    }
    if (acceptTx) {
      return (
        <div className="mt-4">
          <XamanSingleSign
            txjson={acceptTx}
            title={t('Accept KYC {type} · the omnibus signs').replace('{type}', credentialType)}
            onSettled={(hash) => { setAccepted(true); setAcceptTx(null); onBlockedChange(false); onAccepted?.(hash); }}
            onBlockedChange={onBlockedChange}
            onCancelled={() => { setAcceptTx(null); onBlockedChange(false); }}
          />
        </div>
      );
    }
    return (
      <>
        <p className="mt-4 rounded-xl border border-volt/30 bg-volt/[0.05] p-3 text-[12.5px] leading-relaxed text-ink/75">
          {issued ? t('Step 1 of 2 done: your root issued it.') : t('Your root already issued it; the omnibus has not accepted it yet.')}{' '}
          {t('Step 2: the omnibus accepts it — one signature of the omnibus in Xaman.')}
        </p>
        <PrimaryButton onClick={() => void prepareAccept()} disabled={busy} className="mt-3 w-full py-3">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} {t('Accept from the omnibus · QR in Xaman')}
        </PrimaryButton>
        {err ? <p className="mt-2 text-[12px] text-tone-warning">{err}</p> : null}
      </>
    );
  }
  if (txjson) {
    return (
      <div className="mt-4">
        <XamanSingleSign
          txjson={txjson}
          title={t('KYC {type} · {name}').replace('{type}', credentialType).replace('{name}', clientLabel)}
          onSettled={(hash) => { setIssued(true); setTxjson(null); onBlockedChange(false); onIssued(hash); }}
          onBlockedChange={onBlockedChange}
          onCancelled={() => { setTxjson(null); onBlockedChange(false); }}
        />
      </div>
    );
  }
  return (
    <>
      <PrimaryButton onClick={() => void prepare()} disabled={busy} className="mt-4 w-full py-3">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} {AUTOPILOT_UI ? t('Approve KYC · one root signature in Xaman') : t('Approve KYC · step 1 of 2: your root signs (QR)')}
      </PrimaryButton>
      {err ? <p className="mt-2 text-[12px] text-tone-warning">{err}</p> : null}
    </>
  );
}

function ClientsPanel({ demo, run, kyc, selected, onSelect, onBlockedChange }: { demo: DemoRunApi; run: DemoRun; kyc: RunKyc; selected: string | null; onSelect: (id: string | null) => void; onBlockedChange: (blocked: boolean) => void }) {
  const { t } = useT();
  const [filter, setFilter] = useState<'all' | 'pending' | 'ok'>('all');
  const [ceremony, setCeremony] = useState<{ issuer: string; subject: string; credentialType: string } | null>(null);
  // Mientras alguna casilla está emitida y sin aceptar, el panel relee solo: el autopilot la acepta en su ciclo.
  const anyPending = run.clients.some((c) => kyc.rows.get(c.id)?.code === 'CLIENT_CREDENTIAL_PENDING');
  const reloadKyc = kyc.reload;
  useEffect(() => {
    if (!anyPending) return;
    const id = window.setInterval(reloadKyc, 10_000);
    return () => window.clearInterval(id);
  }, [anyPending, reloadKyc]);
  const facts = useMemo(() => new Map((demo.chain?.clients ?? []).map((c) => [c.clientId, c])), [demo.chain]);
  const list = run.clients.filter((c) => {
    const ok = kyc.rows.get(c.id)?.ok;
    return filter === 'all' ? true : filter === 'pending' ? ok === false : ok === true;
  });
  const sel = run.clients.find((c) => c.id === selected) ?? null;
  const selRow = sel ? kyc.rows.get(sel.id) : undefined;

  async function recordReceipt(r: { subject: string; issuer: string; credentialType: string; txid: string | null }) {
    try {
      const tagOfType = r.subject === run.omnibusAddress ? r.credentialType.split('-').pop() : undefined;
      const client = run.clients.find((c) => c.xrplAddress === r.subject) ?? run.clients.find((c) => tagOfType !== undefined && String(c.tag) === tagOfType);
      await demo.addReceipt({ step: 'E3_CREDENTIAL', chain: 'xrpl', txHash: r.txid ?? undefined, clientId: client?.id, note: `${r.credentialType} · issuer ${r.issuer}`, expect: { subject: r.subject, issuer: r.issuer, credentialType: r.credentialType } });
    } catch {
      /* la credencial YA está en el ledger; el recibo se añade a mano en Auditoría */
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
      <RevealItem>
        <Card className="p-5">
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <SegmentedControl<'all' | 'pending' | 'ok'>
              layoutId="clients-filter"
              value={filter}
              onChange={setFilter}
              options={[
                { key: 'all', label: `${t('All')} · ${run.clients.length}` },
                { key: 'pending', label: `${t('KYC pending')} · ${run.clients.filter((c) => kyc.rows.get(c.id)?.ok === false).length}` },
                { key: 'ok', label: `${t('Verified')} · ${run.clients.filter((c) => kyc.rows.get(c.id)?.ok === true).length}` },
              ]}
            />
            <button onClick={kyc.reload} className="ml-auto inline-flex items-center gap-1 text-[12px] text-ink/45 hover:text-ink"><RefreshCw className="h-3 w-3" /> {t('Read KYC again')}</button>
          </div>
          {list.length === 0 ? (
            <p className="py-8 text-[13px] text-ink/45">{t('No clients yet — the first one appears the moment somebody signs up on your client site.')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-ink/[0.06] text-left font-mono text-[10px] uppercase tracking-[0.14em] text-ink/40">
                    <th className="py-2.5 pr-3 font-medium">{t('Client')}</th>
                    <th className="py-2.5 pr-3 font-medium">{t('Tag')}</th>
                    <th className="py-2.5 pr-3 font-medium">KYC</th>
                    <th className="py-2.5 pr-3 text-right font-medium">{t('At the exchange')}</th>
                    <th className="py-2.5 pr-3 text-right font-medium">{t('Shares')}</th>
                    <th className="py-2.5 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {list.map((c) => {
                    const row = kyc.rows.get(c.id);
                    const on = selected === c.id;
                    return (
                      <tr key={c.id} onClick={() => onSelect(c.id)} className={`cursor-pointer border-b border-ink/[0.04] transition-colors ${on ? 'bg-volt/[0.06]' : 'hover:bg-ink/[0.02]'}`}>
                        <td className="py-3 pr-3">
                          <p className="text-ink">{c.label}</p>
                          <p className="text-[11.5px] text-ink/40">{new Date(c.createdAt).toLocaleDateString()}{c.passkeyAccount ? '' : ` · ${t('no passkey yet')}`}</p>
                        </td>
                        <td className="py-3 pr-3 font-mono text-ink/80">{c.tag}</td>
                        <td className="py-3 pr-3">{!row ? <span className="text-ink/35">—</span> : row.ok ? <Pill tone="success" size="sm">{t('Verified')}</Pill> : row.code === 'CREDENTIALS_UNREADABLE' ? <Pill tone="warning" size="sm">{t('Could not read')}</Pill> : row.code === 'CLIENT_CREDENTIAL_PENDING' ? <Pill tone="info" size="sm">{t('Issued, not accepted')}</Pill> : row.code === 'CLIENT_CREDENTIAL_EXPIRED' ? <Pill tone="warning" size="sm">{t('Expired')}</Pill> : <Pill tone="warning" size="sm">{t('KYC pending')}</Pill>}</td>
                        <td className="py-3 pr-3 text-right font-mono text-ink/80">{dropsToXrp(c.xrpOnExchangeDrops, 2)}</td>
                        <td className="py-3 pr-3 text-right font-mono text-ink/60">{facts.get(c.id)?.sharesHuman ?? '—'}</td>
                        <td className="py-3 text-right text-[12px] text-volt">{row && !row.ok ? t('Approve') : t('View')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </RevealItem>

      <RevealItem>
        <div className="space-y-4">
          <Card className="p-5">
            {!sel ? (
              <p className="text-[13px] text-ink/45">{t('Pick a client to see their account and approve their KYC.')}</p>
            ) : (
              <>
                <MicroLabel>{selRow && !selRow.ok ? t('Approve KYC') : t('Client')}</MicroLabel>
                <p className="mt-2 text-[17px] font-semibold tracking-tight text-ink">{sel.label}</p>
                <p className="text-[12px] text-ink/45">{t('tag')} {sel.tag}{sel.passkeyAccount ? ` · ${t('passkey account')} ${shortHash(sel.passkeyAccount, 6, 4)}` : ''}</p>
                <dl className="mt-3 divide-y divide-ink/[0.05] text-[13px]">
                  <div className="flex items-center justify-between gap-3 py-2.5"><dt className="text-ink/45">{t('Credential')}</dt><dd className="font-mono text-[12px] text-ink/85">{selRow?.credentialType ?? `KYC-${sel.tag}`} · XLS-70</dd></div>
                  <div className="flex items-center justify-between gap-3 py-2.5"><dt className="text-ink/45">{t('Issued by')}</dt><dd className="text-[12px] text-ink/85">{t('your root')} <span className="font-mono text-ink/45">{shortHash(run.councilAddress, 4, 4)}</span></dd></div>
                  <div className="flex items-center justify-between gap-3 py-2.5"><dt className="text-ink/45">{t('Held by')}</dt><dd className="text-[12px] text-ink/85">{t('your omnibus')} <span className="font-mono text-ink/45">{shortHash(run.omnibusAddress, 4, 4)}</span></dd></div>
                  <div className="flex items-center justify-between gap-3 py-2.5"><dt className="text-ink/45">{t('Status')}</dt><dd className="text-[12px] text-ink/85">{!selRow ? '—' : selRow.ok ? `${t('in force')}${selRow.expiresAtISO ? ` · ${t('until')} ${new Date(selRow.expiresAtISO).toLocaleDateString()}` : ''}` : describeRefusal({ status: 409, error: String(selRow.code), detail: selRow.detail }, t)}</dd></div>
                  <div className="flex items-center justify-between gap-3 py-2.5"><dt className="text-ink/45">{t('At the exchange')}</dt><dd className="font-mono text-[12px] text-ink/85">{dropsToXrp(sel.xrpOnExchangeDrops)} XRP</dd></div>
                  <div className="flex items-center justify-between gap-3 py-2.5"><dt className="text-ink/45">{t('Withdrawal wallet')}</dt><dd className="font-mono text-[12px] text-ink/85">{sel.xrplAddress ? shortHash(sel.xrplAddress, 5, 4) : '—'}</dd></div>
                </dl>
                {selRow && !selRow.ok ? (
                  <>
                    <p className="mt-3 text-[13px] leading-relaxed text-ink/65">{t('You confirm that your exchange completed the KYC of this person with its own processes. It is recorded on the XRP Ledger, public and dated.')}</p>
                    <IssueKycDoor
                      key={sel.id}
                      run={run}
                      credentialType={selRow.credentialType || `KYC-${sel.tag}`}
                      clientLabel={sel.label}
                      pending={selRow.code === 'CLIENT_CREDENTIAL_PENDING'}
                      onIssued={(hash) => {
                        void recordReceipt({ subject: run.omnibusAddress, issuer: run.councilAddress, credentialType: selRow.credentialType || `KYC-${sel.tag}`, txid: hash });
                        kyc.reload();
                      }}
                      onAccepted={() => kyc.reload()}
                      onBlockedChange={onBlockedChange}
                    />
                    {AUTOPILOT_UI ? (
                      <>
                        <p className="mt-3 text-[12px] leading-relaxed text-ink/45">{t('The root issues it (one signature, yours) and the autopilot accepts it from the omnibus — the client signs nothing. It is the record of your process, not a portable credential of the client. Withdrawals never depend on it.')}</p>
                        <button type="button" onClick={() => setCeremony({ issuer: run.councilAddress, subject: run.omnibusAddress, credentialType: selRow.credentialType || `KYC-${sel.tag}` })} className="mt-2 text-[12px] text-ink/45 underline underline-offset-2 transition-colors hover:text-ink">
                          {t('Two-signature ceremony (when the autopilot is not running)')}
                        </button>
                      </>
                    ) : (
                      <p className="mt-3 text-[12px] leading-relaxed text-ink/45">{t('Two signatures, each with a QR in Xaman: your root issues it and your omnibus accepts it — the client signs nothing. It is the record of your process, not a portable credential of the client. Withdrawals never depend on it.')}</p>
                    )}
                  </>
                ) : selRow?.ok ? (
                  <p className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-tone-success"><BadgeCheck className="h-4 w-4" /> {t('KYC in force: this client can deposit and enter the pote.')}</p>
                ) : null}
              </>
            )}
          </Card>
          {run.clients.length ? (
            <Card className="p-5">
              <DeskDepositQr runId={run.runId} clients={run.clients} onSettled={() => void demo.scanOmnibus()} />
            </Card>
          ) : null}
        </div>
      </RevealItem>

      {ceremony ? (
        <CredentialCeremonyModal
          initial={ceremony}
          onClose={() => { setCeremony(null); kyc.reload(); }}
          onCompleted={(r) => { void recordReceipt(r); kyc.reload(); }}
        />
      ) : null}
    </div>
  );
}

/* ── Potes: abrir y controlar (la maquinaria de managed vaults) ──────────── */
function PotesPanel({ demo, run, connectedRoot, onBlockedChange }: { demo: DemoRunApi; run: DemoRun; connectedRoot: string | null; onBlockedChange: (b: boolean) => void }) {
  const { t } = useT();
  const [potes, setPotes] = useState<PoteState[] | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(run.poteAddress ?? null);
  const [creating, setCreating] = useState(false);
  const [consoleBlocked, setConsoleBlocked] = useState(false);
  const [creatorBlocked, setCreatorBlocked] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [assignBusy, setAssignBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { onBlockedChange(consoleBlocked || creatorBlocked); }, [consoleBlocked, creatorBlocked, onBlockedChange]);
  useEffect(() => () => onBlockedChange(false), [onBlockedChange]);

  useEffect(() => {
    let alive = true;
    setReadFailed(false);
    (async () => {
      try {
        const r = await getCageOf(run.councilAddress);
        const fromCage = r.cage && !('unreadable' in r.cage) ? (r.cage as { potes?: string[] }).potes ?? [] : [];
        const addrs = Array.from(new Set([...(run.poteAddress ? [run.poteAddress] : []), ...fromCage].map((a) => a.toLowerCase())));
        const states = await Promise.all(addrs.map((a) => getPoteState(a).catch(() => null)));
        if (!alive) return;
        const ok = states.filter((s): s is PoteState => s !== null);
        setPotes(ok);
        if (ok.length < addrs.length) setReadFailed(true);
        setSelected((cur) => cur ?? ok[0]?.pote ?? null);
      } catch {
        if (alive) { setReadFailed(true); setPotes((p) => p ?? []); }
      }
    })();
    return () => { alive = false; };
  }, [run.councilAddress, run.poteAddress, nonce]);

  async function assign(pote: string) {
    setErr('');
    setAssignBusy(true);
    const r = await demoApi.patchRun(run.runId, { poteAddress: pote });
    setAssignBusy(false);
    if (!r.ok) return setErr(describeRefusal(r.refusal, t));
    demo.setRun(r.data.run);
    void demo.refreshChain();
  }

  const lock = consoleBlocked || creatorBlocked;
  const isClientsPote = (p: string) => run.poteAddress?.toLowerCase() === p.toLowerCase();
  // LA MISMA REGLA QUE LA MESA (ManagerDesk): la sesión viva de Xaman
  // es de ESTE navegador y se pierde; la cuenta ENLAZADA a la cuenta de usuario
  // no. Leer no exige sesión, y firmar tampoco la exige: la orden lleva su
  // `Account`, así que Xaman pide ESA cuenta al firmar. Exigir que además fuera
  // la activa dejaba al fundador mirando un cartel que ya había cumplido
  // («está conectada») sin puerta ninguna.
  const activeIsRoot = connectedRoot === run.councilAddress;
  const liveRoot = useWalletStore((s) =>
    s.wallets.find((w) => w.isConnected && w.walletType === 'xaman' && w.address === run.councilAddress),
  );
  const setActiveWallet = useWalletStore((s) => s.setActiveWallet);
  const { wallets: myWallets } = useMyWallets();
  const rootLinked = useMemo(
    () => myWallets.some((w) => isXrplWallet(w) && w.address === run.councilAddress),
    [myWallets, run.councilAddress],
  );
  /** Solo se cae al túnel cuando la raíz no está ni activa, ni viva, ni enlazada. */
  const canSign = activeIsRoot || !!liveRoot || rootLinked;

  return (
    <>
      <RevealItem>
        <div className="flex flex-wrap items-center gap-2">
          {potes === null ? (
            <span className="text-[13px] text-ink/45"><Loader2 className="mr-2 inline h-3.5 w-3.5 animate-spin" />{t('Reading your potes…')}</span>
          ) : potes.length === 0 ? (
            <span className="text-[13px] text-ink/45">{t('No pote open yet.')}</span>
          ) : (
            potes.map((p) => {
              const on = selected?.toLowerCase() === p.pote.toLowerCase();
              return (
                <button key={p.pote} type="button" disabled={lock} onClick={() => { if (!lock) { setSelected(p.pote); setCreating(false); } }} aria-pressed={on} className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${on && !creating ? 'border-volt/45 bg-volt/[0.08] text-ink' : 'border-ink/10 text-ink/60 hover:border-ink/25 hover:text-ink'}`}>
                  {p.name}
                  <span className="font-mono text-[11px] text-ink/40">{fmtBase(p.totalAssets, p.asset.decimals)} {p.asset.symbol}</span>
                  {isClientsPote(p.pote) ? <Pill tone="success" size="sm">{t('clients')}</Pill> : null}
                </button>
              );
            })
          )}
          <GhostButton onClick={() => { if (!lock) setCreating(true); }} disabled={lock} className={`ml-auto py-2 ${creating ? 'border-volt/50 text-volt' : ''}`}><Plus className="h-4 w-4" /> {t('Open a pote')}</GhostButton>
        </div>
        {readFailed ? <p className="mt-2 text-[12px] text-tone-warning">{t('Some potes could not be read just now — the list may be incomplete.')}</p> : null}
      </RevealItem>

      {creating ? (
        <RevealItem>
          <Card className="p-6">
            {!canSign ? (
              <p className="mb-4 rounded-xl border border-tone-warning/30 bg-tone-warning/[0.06] p-3 text-[12.5px] text-tone-warning">
                {t('A pote is opened by the root of the exchange in Xaman. Connect {root} to sign it.').replace('{root}', shortHash(run.councilAddress, 6, 4))}
              </p>
            ) : !activeIsRoot ? (
              // Se puede firmar, y se dice CÓMO: con la raíz viva basta un
              // clic; solo enlazada, Xaman pedirá esa cuenta al firmar.
              <div className="mb-4 rounded-xl border border-ink/10 bg-ink/[0.03] p-3 text-[12.5px] text-ink/60">
                <p>
                  {liveRoot
                    ? t('The root {root} is connected, but another account is the active one — and the active account is who signs.').replace('{root}', shortHash(run.councilAddress, 6, 4))
                    : t('Linked to your account, not connected in this browser — Xaman will ask for this account when you sign.')}
                </p>
                {liveRoot ? (
                  <button type="button" onClick={() => setActiveWallet(liveRoot)} className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-volt/40 bg-volt/[0.08] px-3 py-1.5 text-[12px] font-medium text-volt transition-colors hover:bg-volt/15">
                    <Check className="h-3.5 w-3.5" /> {t('Sign with the root')}
                  </button>
                ) : null}
              </div>
            ) : null}
            <VaultCreator account={canSign ? run.councilAddress : null} embedded onOpened={() => { setCreating(false); setNonce((n) => n + 1); }} onBlockedChange={setCreatorBlocked} />
            {!creatorBlocked ? <button onClick={() => setCreating(false)} className="mt-4 text-[12px] text-ink/45 hover:text-ink">{t('Close')}</button> : null}
          </Card>
        </RevealItem>
      ) : selected ? (
        <>
          {!isClientsPote(selected) ? (
            <RevealItem>
              <Card className="flex flex-wrap items-center gap-3 p-4">
                <p className="text-[13px] text-ink/65">{t('Client entries go to another pote. This one is directed here, but clients do not enter it.')}</p>
                <GhostButton onClick={() => void assign(selected)} disabled={assignBusy || lock} className="ml-auto py-2">{assignBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {t('Use it for client entries')}</GhostButton>
                {err ? <p className="w-full text-[12px] text-tone-warning">{err}</p> : null}
              </Card>
            </RevealItem>
          ) : null}
          <RevealItem>
            <ManagerConsole key={selected} pote={selected} council={run.councilAddress} onBlockedChange={setConsoleBlocked} />
          </RevealItem>
          <RevealItem>
            <ManagerGovernance key={`g:${selected}`} pote={selected} />
          </RevealItem>
        </>
      ) : null}
    </>
  );
}

/* ── Perfil del exchange ─────────────────────────────────────────────────── */
function ProfilePanel({ run, kyc }: { run: DemoRun; kyc: RunKyc }) {
  const { t } = useT();
  const [designation, setDesignation] = useState<{ found: boolean; expiresAtISO: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    void readManagerProfile(run.omnibusAddress)
      .then((d) => {
        if (!alive) return;
        const c = d.credentials.find((x) => x.type.toUpperCase() === 'OMNIBUS' && x.issuer === run.councilAddress);
        setDesignation({ found: Boolean(c), expiresAtISO: c?.expiresAtISO ?? null });
      })
      .catch(() => { if (alive) setDesignation(null); });
    return () => { alive = false; };
  }, [run.omnibusAddress, run.councilAddress]);
  const verified = run.clients.filter((c) => kyc.rows.get(c.id)?.ok === true).length;

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <RevealItem>
        <div className="space-y-2">
          <MicroLabel tone="muted">{t('What your clients see')}</MicroLabel>
          <ManagerPublicProfile role="exchange" account={run.councilAddress} />
        </div>
      </RevealItem>
      <RevealItem>
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">{t('Structure on the ledger')}</h2>
          <dl className="mt-2 divide-y divide-ink/[0.05] text-[13px]">
            {[
              { k: t('Root · governance'), sub: t('issues credentials, opens potes, signs orders · Xaman'), v: run.councilAddress, href: `https://xrpscan.com/account/${run.councilAddress}` },
              { k: t('Omnibus · client account'), sub: AUTOPILOT_UI ? t('receives by tag · its key is used by the autopilot') : t('receives by tag · signs in your Xaman, with a QR'), v: run.omnibusAddress, href: `https://xrpscan.com/account/${run.omnibusAddress}` },
              ...(run.poteAddress ? [{ k: t('Clients pote'), sub: t('ERC-4626 on Flare'), v: run.poteAddress, href: `https://flarescan.com/address/${run.poteAddress}` }] : []),
            ].map((r) => (
              <div key={r.k} className="flex items-center justify-between gap-3 py-3">
                <dt><span className="text-ink/85">{r.k}</span><span className="block text-[12px] text-ink/40">{r.sub}</span></dt>
                <dd><a href={r.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[12px] text-ink/75 hover:text-volt">{shortHash(r.v, 5, 4)} <ArrowUpRight className="h-3 w-3" /></a></dd>
              </div>
            ))}
            <div className="flex items-center justify-between gap-3 py-3">
              <dt><span className="text-ink/85">{t('Omnibus appointment')}</span><span className="block text-[12px] text-ink/40">{t('the root names its omnibus (XLS-70 OMNIBUS)')}</span></dt>
              <dd>{designation === null ? <span className="text-[12px] text-ink/40">—</span> : designation.found ? <Pill tone="success" size="sm"><BadgeCheck className="h-3 w-3" /> {t('on the ledger')}{designation.expiresAtISO ? ` · ${t('until')} ${new Date(designation.expiresAtISO).toLocaleDateString()}` : ''}</Pill> : <Pill tone="warning" size="sm">{t('not found')}</Pill>}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-3">
              <dt><span className="text-ink/85">{t('Clients')}</span><span className="block text-[12px] text-ink/40">{t('{n} with KYC in force').replace('{n}', String(verified))}</span></dt>
              <dd className="inline-flex items-center gap-1 font-mono text-[12px] text-ink/75"><ArrowDownLeft className="h-3 w-3" /> {run.clients.length}</dd>
            </div>
          </dl>
        </Card>
      </RevealItem>
    </div>
  );
}

export default ExchangeConsole;
