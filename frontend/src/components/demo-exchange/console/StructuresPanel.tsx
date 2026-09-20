'use client';

/**
 * StructuresPanel — sumar las wallets XRPL de una persona bajo su cuenta
 * personal: las CUENTAS COMANDADAS.
 *
 * La cuenta personal del titular se sienta en la lista de firmantes de las
 * demás — sola (quórum 1) o como una de varias — y eso es lo que las hace
 * «subwallets». El árbol de autoridad es del USUARIO, no del exchange: el
 * exchange solo pone la caja que patrocina la reserva.
 *
 * La cuenta nace en la wallet de su titular, se constituye con su lista de
 * firmantes, se ensaya en cadena y se cierra con `asfDisableMaster`. Después de
 * eso NADIE tiene llave de esa cuenta — ni el titular, ni el exchange, ni
 * Astryum: solo manda quien está sentado.
 *
 * Diseño y cuadro de asientos:
 * `docs/context/Astryum_Exchange_2_Estructuras_Bajo_El_Omnibus_2026-09-18.md`.
 *
 * FLUJO MECÁNICO, NO INSTRUCCIONES (doctrina del 21-ago). La ceremonia son
 * cinco pasos y esta pantalla los RECORRE: compone el paso, lo manda a firmar
 * por la puerta que le toca a ese firmante, y cuando el ledger lo valida lo
 * apunta con su hash. El siguiente paso no se ofrece hasta que el anterior está
 * en el ledger — y el servidor vuelve a comprobarlo, porque el candado de la
 * puerta no puede vivir en un componente de React.
 *
 * LO QUE ESTA PANTALLA NO DECIDE: quién puede mover el dinero. Lo dice la
 * aritmética de los asientos en el servidor; aquí solo se enseña la negativa con
 * su razón. Declarar «manda mi personal sola» con un quórum que no alcanza, o
 * dejar que un tercero lo alcance, no se puede por mucho que se rellene el
 * formulario.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Info, KeyRound, Loader2, Plus, RefreshCw, ShieldCheck, Trash2, Users } from 'lucide-react';
import { Card, EmptyState, GhostButton, MicroLabel, Pill, PrimaryButton } from '../../ui/primitives';
import { RevealItem } from '../../ui/motion';
import { useT } from '../../../i18n/LanguageProvider';
import {
  demoApi,
  describeRefusal,
  shortHash,
  type BirthStepId,
  type DemoRun,
  type PreparedStructureStep,
  type StructureDeclaration,
  type StructureGovernance,
  type StructureKind,
  type StructurePlan,
  type StructureRow,
  type StructureSeat,
} from '../../../lib/demo-exchange/api';
import { XamanSingleSign } from '../../xrpl/XamanSingleSign';
import { CouncilSigningDoors } from '../../legacy/CouncilMultisigFlow';

const XRPL_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

/** The four things a client of an exchange can be. Only three are accounts. */
const KINDS: StructureKind[] = ['family', 'enterprise', 'agent', 'box'];
const GOVERNANCE: StructureGovernance[] = ['sole', 'shared'];

function kindLabel(kind: StructureKind, t: (s: string) => string): string {
  if (kind === 'family') return t('Family / Legacy');
  if (kind === 'enterprise') return t('Company');
  if (kind === 'agent') return t('Agent');
  return t('Deposit box');
}

function governanceLabel(g: StructureGovernance, t: (s: string) => string): string {
  return g === 'sole' ? t('My personal account commands it alone') : t('A quorum commands it, and my personal account is one of them');
}

function stepLabel(step: BirthStepId, t: (s: string) => string): string {
  if (step === 'fund') return t('Sponsor the reserve');
  if (step === 'constitute') return t('Seat the signers');
  if (step === 'rehearse') return t('Rehearse on-chain');
  if (step === 'designate') return t('Name it on the ledger');
  return t('Close the door');
}

function signerLabel(signer: PreparedStructureStep['signer'], t: (s: string) => string): string {
  if (signer === 'funder') return t('the funding account signs');
  if (signer === 'structure-master') return t('the birth key signs');
  if (signer === 'structure-quorum') return t('the seats of this account sign');
  return t('the personal account signs');
}

export function StructuresPanel({ run, onBlockedChange }: { run: DemoRun; onBlockedChange?: (blocked: boolean) => void }) {
  const { t } = useT();
  const [rows, setRows] = useState<StructureRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [declaring, setDeclaring] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    const res = await demoApi.listStructures(run.runId);
    setLoading(false);
    if (!res.ok) {
      setError(describeRefusal(res.refusal, t));
      return;
    }
    setError(null);
    setRows(res.data.structures);
  }, [run.runId, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <RevealItem>
      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-medium text-tone-strong">{t('Structures')}</h3>
            <p className="max-w-2xl text-[12.5px] text-tone-muted">
              {t('One person, several XRPL accounts: the personal one sits in the signer list of the others and commands them — alone, or as one of a quorum. Once an account closes its door, nobody holds a key to it at all: only whoever is seated can move it.')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <GhostButton onClick={() => void reload()} disabled={loading}>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {t('Refresh')}
            </GhostButton>
            <PrimaryButton onClick={() => setDeclaring((v) => !v)}>
              <Plus className="h-3.5 w-3.5" />
              {t('New structure')}
            </PrimaryButton>
          </div>
        </div>

        {error ? (
          <p className="rounded-xl border border-tone-warning/30 bg-tone-warning/[0.06] p-3 text-[12.5px] text-tone-warning">{error}</p>
        ) : null}

        {declaring ? (
          <DeclareForm
            run={run}
            onDone={() => {
              setDeclaring(false);
              void reload();
            }}
            onCancel={() => setDeclaring(false)}
          />
        ) : null}

        {rows === null ? (
          <p className="text-[12.5px] text-tone-muted">{t('Reading the ledger…')}</p>
        ) : rows.length === 0 ? (
          <EmptyState
            title={t('No commanded accounts yet')}
            hint={t('A deposit box is a destination tag and needs none of this. A commanded account is for what is a vehicle: the family, the company.')}
          />
        ) : (
          <div className="space-y-3">
            {rows.map((row) => (
              <StructureCard key={row.structure.id} run={run} row={row} onChanged={() => void reload()} onBlockedChange={onBlockedChange} />
            ))}
          </div>
        )}
      </Card>
    </RevealItem>
  );
}

/* ── declare ─────────────────────────────────────────────────────────────── */

interface DraftSeat {
  account: string;
  weight: string;
  holder: StructureSeat['holder'];
}

function DeclareForm({ run, onDone, onCancel }: { run: DemoRun; onDone: () => void; onCancel: () => void }) {
  const { t } = useT();
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<StructureKind>('family');
  const [governance, setGovernance] = useState<StructureGovernance>('sole');
  const [rootAddress, setRootAddress] = useState('');
  const [address, setAddress] = useState('');
  const [quorum, setQuorum] = useState('1');
  const [designation, setDesignation] = useState(true);
  const [paysThroughGate, setPaysThroughGate] = useState(false);
  // Por defecto: la personal sentada, y un asiento de RESPALDO — con un solo
  // asiento el margen es 0 y la puerta no se puede cerrar nunca (perder esa
  // llave dejaria la cuenta muerta con su dinero dentro).
  const [seats, setSeats] = useState<DraftSeat[]>([
    { account: '', weight: '1', holder: 'root' },
    { account: '', weight: '1', holder: 'member' },
  ]);
  const [plan, setPlan] = useState<StructurePlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const declaration: StructureDeclaration = useMemo(
    () => ({
      label: label.trim(),
      kind,
      governance,
      rootAddress: rootAddress.trim(),
      address: address.trim(),
      quorum: Number(quorum),
      designation,
      paysThroughCredentialGate: paysThroughGate,
      seats: seats
        .filter((s) => s.account.trim().length > 0)
        .map((s) => ({ account: s.account.trim(), weight: Number(s.weight), holder: s.holder })),
    }),
    [label, kind, governance, rootAddress, address, quorum, designation, paysThroughGate, seats],
  );

  const shapeReady =
    declaration.label.length > 0 &&
    XRPL_RE.test(declaration.address) &&
    XRPL_RE.test(declaration.rootAddress) &&
    declaration.seats.length > 0;

  /** Sentar la personal se hace desde su propio campo: escribirla dos veces es un sitio donde equivocarse. */
  const syncRootSeat = useCallback((next: string) => {
    setRootAddress(next);
    setSeats((prev) => prev.map((p) => (p.holder === 'root' ? { ...p, account: next } : p)));
    setPlan(null);
  }, []);

  const check = useCallback(async () => {
    setBusy(true);
    setError(null);
    const res = await demoApi.planStructure(run.runId, declaration);
    setBusy(false);
    if (!res.ok) {
      setPlan(null);
      setError(describeRefusal(res.refusal, t));
      return;
    }
    setPlan(res.data.plan);
  }, [run.runId, declaration, t]);

  const declare = useCallback(async () => {
    setBusy(true);
    setError(null);
    const res = await demoApi.addStructure(run.runId, declaration);
    setBusy(false);
    if (!res.ok) {
      setError(describeRefusal(res.refusal, t));
      return;
    }
    onDone();
  }, [run.runId, declaration, onDone, t]);

  return (
    <div className="space-y-4 rounded-2xl border border-tone-line/60 bg-tone-surface/40 p-4">
      <p className="text-[12.5px] text-tone-muted">
        {t('The account is created by its holder, in their own wallet app — Astryum never generates a key. Paste its address here; the reserve is sponsored and charged afterwards.')}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('Name')}>
          <input className={inputCls} value={label} onChange={(e) => { setLabel(e.target.value); setPlan(null); }} placeholder={t('What the holder calls it — never personal data')} />
        </Field>
        <Field label={t('XRPL address of the new account')}>
          <input className={inputCls} value={address} onChange={(e) => { setAddress(e.target.value.trim()); setPlan(null); }} placeholder="r…" spellCheck={false} />
        </Field>
        <Field label={t('The personal account that commands it')}>
          <input className={inputCls} value={rootAddress} onChange={(e) => syncRootSeat(e.target.value.trim())} placeholder="r…" spellCheck={false} />
        </Field>
        <Field label={t('Kind')}>
          <select className={inputCls} value={kind} onChange={(e) => { setKind(e.target.value as StructureKind); setPlan(null); }}>
            {KINDS.map((k) => (
              <option key={k} value={k}>{kindLabel(k, t)}</option>
            ))}
          </select>
        </Field>
        <Field label={t('How it is commanded')}>
          <select className={inputCls} value={governance} onChange={(e) => { setGovernance(e.target.value as StructureGovernance); setPlan(null); }}>
            {GOVERNANCE.map((g) => (
              <option key={g} value={g}>{governanceLabel(g, t)}</option>
            ))}
          </select>
        </Field>
        <Field label={t('Quorum (weight that must sign)')}>
          <input className={inputCls} value={quorum} inputMode="numeric" onChange={(e) => { setQuorum(e.target.value.replace(/[^0-9]/g, '')); setPlan(null); }} />
        </Field>
        <Field label={t('Designation by the personal account')}>
          <label className="flex h-[38px] items-center gap-2 text-[12.5px] text-tone-muted">
            <input type="checkbox" checked={designation} onChange={(e) => { setDesignation(e.target.checked); setPlan(null); }} />
            {t('My personal account names it as mine, for 90 days')}
          </label>
        </Field>
        <Field label={t('Will it pay by itself through a credential gate?')}>
          <label className="flex h-[38px] items-center gap-2 text-[12.5px] text-tone-muted">
            <input type="checkbox" checked={paysThroughGate} onChange={(e) => { setPaysThroughGate(e.target.checked); setPlan(null); }} />
            {t('It sends its own payments to a gated destination')}
          </label>
        </Field>
      </div>

      <div className="space-y-2">
        <MicroLabel>{t('Seats')}</MicroLabel>
        <p className="text-[12px] text-tone-muted">
          {t('Whose seat each one is decides who can move this money. A third party that reaches the quorum on its own can move it without you. And with a single seat the door can never be closed: losing that one key would leave the account dead with its money inside.')}
        </p>
        {seats.map((s, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input
              className={`${inputCls} min-w-[240px] flex-1`}
              value={s.account}
              spellCheck={false}
              placeholder="r…"
              onChange={(e) => { const v = e.target.value.trim(); setSeats((prev) => prev.map((p, j) => (i === j ? { ...p, account: v } : p))); setPlan(null); }}
            />
            <input
              className={`${inputCls} w-20`}
              value={s.weight}
              inputMode="numeric"
              onChange={(e) => { const v = e.target.value.replace(/[^0-9]/g, ''); setSeats((prev) => prev.map((p, j) => (i === j ? { ...p, weight: v } : p))); setPlan(null); }}
            />
            <select
              className={`${inputCls} w-36`}
              value={s.holder}
              onChange={(e) => { const v = e.target.value as StructureSeat['holder']; setSeats((prev) => prev.map((p, j) => (i === j ? { ...p, holder: v } : p))); setPlan(null); }}
            >
              <option value="root">{t('my personal account')}</option>
              <option value="member">{t('someone in my circle')}</option>
              <option value="operator">{t('a third party')}</option>
            </select>
            <GhostButton onClick={() => { setSeats((prev) => prev.filter((_, j) => j !== i)); setPlan(null); }}>
              <Trash2 className="h-3.5 w-3.5" />
            </GhostButton>
          </div>
        ))}
        <GhostButton onClick={() => setSeats((prev) => [...prev, { account: '', weight: '1', holder: 'member' }])}>
          <Plus className="h-3.5 w-3.5" />
          {t('Add a seat')}
        </GhostButton>
      </div>

      {error ? <p className="rounded-xl border border-tone-warning/30 bg-tone-warning/[0.06] p-3 text-[12.5px] text-tone-warning">{error}</p> : null}

      {plan ? <PlanView plan={plan} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <GhostButton onClick={onCancel}>{t('Cancel')}</GhostButton>
        <GhostButton onClick={() => void check()} disabled={!shapeReady || busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {t('Check it')}
        </GhostButton>
        <PrimaryButton onClick={() => void declare()} disabled={!plan?.ok || busy}>
          {t('Declare this account')}
        </PrimaryButton>
      </div>
    </div>
  );
}

function PlanView({ plan }: { plan: StructurePlan }) {
  const { t } = useT();
  // Una negativa PARA y un aviso ACOMPAÑA. Pintarlos igual hace que se ignoren
  // los dos, así que los avisos se ven también cuando el plan se puede firmar.
  const notes = plan.notes?.length ? (
    <div className="space-y-1.5 rounded-xl border border-tone-line/60 bg-tone-surface/40 p-3">
      <p className="flex items-center gap-2 text-[12px] font-medium text-tone-muted">
        <Info className="h-3.5 w-3.5" />
        {t('Before you sign, what is true here')}
      </p>
      {plan.notes.map((n) => (
        <p key={n.code} className="text-[12px] text-tone-muted">{n.text}</p>
      ))}
    </div>
  ) : null;

  if (!plan.ok) {
    return (
      <div className="space-y-2">
        <div className="space-y-2 rounded-xl border border-tone-warning/30 bg-tone-warning/[0.06] p-3">
          <p className="flex items-center gap-2 text-[12.5px] font-medium text-tone-warning">
            <AlertTriangle className="h-3.5 w-3.5" />
            {t('This cannot be declared as it stands')}
          </p>
          {plan.refusals.map((r) => (
            <p key={r.code} className="text-[12.5px] text-tone-warning">{r.reason}</p>
          ))}
        </div>
        {notes}
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-xl border border-tone-line/60 bg-tone-surface/60 p-3">
      <p className="text-[12.5px] text-tone-strong">
        {t('The omnibus sponsors {amount} XRP; {back} XRP come back if the structure is ever wound up.')
          .replace('{amount}', String(plan.reserve?.fundingXrp ?? 0))
          .replace('{back}', String(plan.reserve?.recoverableXrp ?? 0))}
      </p>
      <p className="text-[12px] text-tone-muted">
        {t('Quorum margin: {margin} — seats that can be lost before this structure freezes for good.').replace('{margin}', String(plan.authority.quorumMargin))}
      </p>
      <ol className="space-y-1 text-[12px] text-tone-muted">
        {plan.steps.map((s, i) => (
          <li key={s.id}>
            {i + 1}. <span className="text-tone-strong">{stepLabel(s.id, t)}</span> — {s.note}
          </li>
        ))}
      </ol>
      {notes}
    </div>
  );
}

/* ── one structure, and its ceremony ─────────────────────────────────────── */

function StructureCard({
  run,
  row,
  onChanged,
  onBlockedChange,
}: {
  run: DemoRun;
  row: StructureRow;
  onChanged: () => void;
  onBlockedChange?: (blocked: boolean) => void;
}) {
  const { t } = useT();
  const s = row.structure;
  const [prepared, setPrepared] = useState<PreparedStructureStep | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = row.progress?.next ?? null;
  const doorClosed = row.ledger?.masterKeyDisabled === true;

  const prepare = useCallback(async (step: BirthStepId) => {
    setBusy(true);
    setError(null);
    const res = await demoApi.prepareStructureStep(run.runId, s.id, step);
    setBusy(false);
    if (!res.ok) {
      setError(describeRefusal(res.refusal, t));
      return;
    }
    setPrepared(res.data);
  }, [run.runId, s.id, t]);

  const record = useCallback(async (step: BirthStepId, txHash: string) => {
    setBusy(true);
    const res = await demoApi.recordStructureStep(run.runId, s.id, step, txHash);
    setBusy(false);
    setPrepared(null);
    if (!res.ok) {
      setError(describeRefusal(res.refusal, t));
      return;
    }
    onChanged();
  }, [run.runId, s.id, onChanged, t]);

  return (
    <div className="space-y-3 rounded-2xl border border-tone-line/60 bg-tone-surface/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <p className="flex items-center gap-2 text-[13.5px] font-medium text-tone-strong">
            <Users className="h-3.5 w-3.5" />
            {s.label}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill>{kindLabel(s.kind, t)}</Pill>
            <Pill>{governanceLabel(s.governance, t)}</Pill>
            <Pill>{t('quorum {q} of {w}').replace('{q}', String(s.quorum)).replace('{w}', String(s.seats.reduce((a, x) => a + x.weight, 0)))}</Pill>
            {doorClosed ? (
              <Pill tone="success">
                <KeyRound className="mr-1 inline h-3 w-3" />
                {t('no key — only its quorum')}
              </Pill>
            ) : null}
          </div>
          <p className="font-mono text-[11.5px] text-tone-muted">{s.address}</p>
          <p className="text-[11.5px] text-tone-muted">
            {t('Commanded by {root}').replace('{root}', shortHash(s.rootAddress, 8, 6))}
          </p>
        </div>
        <div className="text-right text-[12px] text-tone-muted">
          {row.ledgerUnreadable ? (
            <span className="text-tone-warning">{t('the ledger could not be read')}</span>
          ) : (
            <>
              <p>{row.ledger?.hasSignerList ? t('signer list on the ledger ✓') : t('no signer list yet')}</p>
              <p>{t('{done} of {total} steps').replace('{done}', String(row.progress?.done.length ?? 0)).replace('{total}', String(row.progress?.total ?? 5))}</p>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(['fund', 'constitute', 'rehearse', 'designate', 'close-door'] as BirthStepId[])
          .filter((step) => step !== 'designate' || s.designation)
          .map((step) => {
            const done = s.steps.find((r) => r.step === step);
            return (
              <span
                key={step}
                className={`rounded-lg border px-2 py-1 text-[11.5px] ${done ? 'border-tone-success/30 bg-tone-success/[0.08] text-tone-success' : step === next ? 'border-tone-accent/40 text-tone-strong' : 'border-tone-line/50 text-tone-muted'}`}
                title={done?.txHash ? shortHash(done.txHash, 8, 6) : undefined}
              >
                {done ? <Check className="mr-1 inline h-3 w-3" /> : null}
                {stepLabel(step, t)}
              </span>
            );
          })}
      </div>

      {error ? <p className="rounded-xl border border-tone-warning/30 bg-tone-warning/[0.06] p-3 text-[12.5px] text-tone-warning">{error}</p> : null}

      {row.door && !row.door.allowed && next === 'close-door' ? (
        <p className="rounded-xl border border-tone-warning/30 bg-tone-warning/[0.06] p-3 text-[12.5px] text-tone-warning">{row.door.reason}</p>
      ) : null}

      {prepared ? (
        <SignStep
          prepared={prepared}
          structureAddress={s.address}
          rootAddress={s.rootAddress}
          omnibusAddress={run.omnibusAddress}
          onSettled={(hash) => void record(prepared.step, hash)}
          onCancel={() => setPrepared(null)}
          onBlockedChange={onBlockedChange}
        />
      ) : next ? (
        <div className="flex flex-wrap items-center gap-2">
          <PrimaryButton onClick={() => void prepare(next)} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {t('Prepare: {step}').replace('{step}', stepLabel(next, t))}
          </PrimaryButton>
          {next === 'close-door' ? (
            <span className="text-[12px] text-tone-warning">{t('This one cannot be undone.')}</span>
          ) : null}
        </div>
      ) : (
        <p className="flex items-center gap-2 text-[12.5px] text-tone-success">
          <ShieldCheck className="h-3.5 w-3.5" />
          {t('The ceremony is complete. This account has no key: only its quorum can act, and anyone can check it on the ledger.')}
        </p>
      )}
    </div>
  );
}

function SignStep({
  prepared,
  structureAddress,
  rootAddress,
  omnibusAddress,
  onSettled,
  onCancel,
  onBlockedChange,
}: {
  prepared: PreparedStructureStep;
  structureAddress: string;
  /** La cuenta personal que comanda: firma la designacion. */
  rootAddress: string;
  /** La caja que patrocina la reserva. */
  omnibusAddress: string;
  onSettled: (hash: string) => void;
  onCancel: () => void;
  onBlockedChange?: (blocked: boolean) => void;
}) {
  const { t } = useT();
  const title = `${stepLabel(prepared.step, t)} — ${signerLabel(prepared.signer, t)}`;
  // A quorum step goes through the council doors; a single-signature step goes
  // to its own wallet. Sending a quorum order down the single-sig door is how
  // «not a council account» happened on 5-sep; each tool to its account.
  const byQuorum = prepared.signer === 'structure-quorum';
  const account = prepared.signer === 'funder' ? omnibusAddress : prepared.signer === 'root' ? rootAddress : structureAddress;

  return (
    <div className="space-y-3 rounded-xl border border-tone-line/60 bg-tone-surface/60 p-3">
      <p className="text-[12.5px] text-tone-strong">{prepared.disclosure.note}</p>
      <p className="text-[12px] text-tone-muted">
        {t('Signs: {account}').replace('{account}', shortHash(account, 8, 6))}
      </p>
      {byQuorum ? (
        <CouncilSigningDoors
          xrplTx={prepared.xrplTx}
          account={account}
          defaultTitle={title}
          onSettled={(hash) => onSettled(hash)}
          onBlockedChange={onBlockedChange}
        />
      ) : (
        <XamanSingleSign
          txjson={prepared.xrplTx}
          title={title}
          onSettled={(hash) => onSettled(hash)}
          onBlockedChange={onBlockedChange}
        />
      )}
      <GhostButton onClick={onCancel}>{t('Cancel')}</GhostButton>
    </div>
  );
}

/* ── small bits ──────────────────────────────────────────────────────────── */

const inputCls =
  'h-[38px] w-full rounded-lg border border-tone-line/60 bg-tone-surface px-3 text-[12.5px] text-tone-strong outline-none focus:border-tone-accent/50';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <MicroLabel>{label}</MicroLabel>
      {children}
    </div>
  );
}
