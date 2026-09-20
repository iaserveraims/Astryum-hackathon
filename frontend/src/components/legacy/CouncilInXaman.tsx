'use client';

/**
 * CouncilInXaman — step 2 of the constitution: creating the council.
 *
 * WHY THIS REPLACES THE IN-APP BUILDER. The panel used to offer
 * "Prepare the council" and hand the composed `SignerListSet` to Xaman. Xaman
 * answers **401 / code 1217, "No permission to create this type of sign
 * request"**: it gates account-security transaction types PER APP, and the
 * permission is granted case by case by its support. There is nothing to fix in
 * our code — the button led a family to a dead end at the single most
 * irreversible moment of the ceremony.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { StepShot } from '../ui/StepShot';
import {
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  Smartphone,
  Users,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { ModalOverlay } from '../ui/ModalPortal';
import { isValidClassicAddress } from 'xrpl';
import { Card, GhostButton, MicroLabel, Pill, PrimaryButton, SectionTitle } from '../ui/primitives';
import { CouncilScene } from '../ui/scenes';
import { InlineNotice } from './InlineNotice';
import { useT } from '../../i18n/LanguageProvider';
import {
  compareCouncilPlan,
  formatPlanProblem,
  normalizeCouncilPlan,
  validateCouncilPlan,
  type CouncilOnLedger,
  type PlannedSigner,
} from '../../lib/legacy/councilPlan';
import { clearCouncilPlan, getCouncilPlan, saveCouncilPlan } from './legacyLocal';
import type { CeremonyReservePlan } from '../../lib/legacy/ceremonyReserve';

/** The Multisign xApp deep link — opens only on a phone that has Xaman. */
export const XAMAN_MULTISIGN_XAPP = 'https://xumm.app/detect/xapp:xumm.multisign';
const XRPL_SERVICES_TOOLS = 'https://xrpl.services/tools';

const inputCls =
  'mt-1 w-full rounded-lg border border-ink/10 bg-ink/5 px-3 py-2 text-sm text-ink caret-ink placeholder:text-ink/30 outline-none focus:border-ink/25';

/** Copy-to-clipboard button that says so for two seconds. */
function CopyButton({ value, label }: { value: string; label?: string }) {
  const { t } = useT();
  const [done, setDone] = useState(false);
  return (
    <GhostButton
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 2_000);
        });
      }}
    >
      {done ? <Check size={12} /> : <Copy size={12} />}
      {done ? t('Copied') : (label ?? t('Copy'))}
    </GhostButton>
  );
}

/**
 * The signer rows + quorum editor. Shared by this guide and by the amendment
 * form in LegacyPanel so both speak with one voice (and one set of labels).
 */
export function SignerListRows({
  signers,
  setSigners,
  quorum,
  setQuorum,
}: {
  signers: PlannedSigner[];
  setSigners: (fn: (prev: PlannedSigner[]) => PlannedSigner[]) => void;
  quorum: string;
  setQuorum: (v: string) => void;
}) {
  const { t } = useT();
  const plan = normalizeCouncilPlan(signers, quorum);
  return (
    <div className="space-y-2">
      {signers.map((s, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2">
          <label className="grow">
            <MicroLabel>
              {t('Signer address')} {i + 1}
            </MicroLabel>
            <input
              value={s.account}
              onChange={(e) => setSigners((prev) => prev.map((x, j) => (j === i ? { ...x, account: e.target.value } : x)))}
              placeholder="r…"
              spellCheck={false}
              className={inputCls}
            />
          </label>
          <label className="w-20">
            <MicroLabel>{t('Weight')}</MicroLabel>
            <input
              value={s.weight}
              onChange={(e) => setSigners((prev) => prev.map((x, j) => (j === i ? { ...x, weight: e.target.value } : x)))}
              inputMode="numeric"
              className={inputCls}
            />
          </label>
          {signers.length > 1 && (
            <GhostButton onClick={() => setSigners((prev) => prev.filter((_, j) => j !== i))}>×</GhostButton>
          )}
        </div>
      ))}
      <div className="flex flex-wrap items-end gap-2">
        <GhostButton
          onClick={() => setSigners((prev) => [...prev, { account: '', weight: '1' }])}
          disabled={signers.length >= 32}
        >
          + {t('Add signer')}
        </GhostButton>
        <label className="block">
          <MicroLabel>{t('Quorum')}</MicroLabel>
          <input value={quorum} onChange={(e) => setQuorum(e.target.value)} inputMode="numeric" className={`${inputCls} w-20`} />
        </label>
      </div>
      <p className={`text-[11px] ${plan.margin < 0 ? 'text-tone-danger' : 'text-ink/45'}`}>
        {t('Decisions need')} {plan.quorum || '—'} / {plan.totalWeight || '—'}{' '}
        {plan.margin < 0
          ? t('votes — MORE than the total: no decision could ever pass. Lower the quorum or add signers.')
          : `${t('votes. Keys you can lose without locking the account:')} ${plan.margin}. ${t('Leave the weight at 1 if every member counts the same.')}`}
      </p>
    </div>
  );
}

/** One numbered step of the wallet walk-through. */
function Step({ n, title, children }: { n: number; title: string; children?: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-volt/40 bg-volt/[0.1] font-mono text-[11px] text-volt/90">
        {n}
      </span>
      <div className="min-w-0 space-y-1.5">
        <p className="text-[13px] font-medium leading-snug text-ink/85">{title}</p>
        {children}
      </div>
    </li>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] leading-relaxed text-ink/50">{children}</p>;
}

/**
 * A real screenshot of the Xaman screen this step lands on. If the
 * file is not there yet, the frame stays visible as a labelled placeholder —
 * the slot is part of the tutorial, with or without the image.
 */

export default function CouncilInXaman({
  account,
  signers,
  setSigners,
  quorum,
  setQuorum,
  reservePlan,
  balanceXrp,
  loading,
  onRefresh,
  onPrepareUnsigned,
  unsignedBusy,
  unsignedError,
  unsignedSlot,
}: {
  account: string | null;
  signers: PlannedSigner[];
  setSigners: (fn: (prev: PlannedSigner[]) => PlannedSigner[]) => void;
  quorum: string;
  setQuorum: (v: string) => void;
  reservePlan: CeremonyReservePlan | null;
  balanceXrp: number | null;
  loading: boolean;
  /** Re-read the ledger — the ONLY confirmation that the council exists. */
  onRefresh: () => void;
  /** Escape hatch for signers outside Xaman: compose the unsigned SignerListSet. */
  onPrepareUnsigned: () => void;
  unsignedBusy: boolean;
  unsignedError: string | null;
  /** Rendered under the escape hatch once a hand-off exists (disclosure + copy). */
  unsignedSlot?: React.ReactNode;
}) {
  const { t } = useT();
  // El tutorial paginado (Know how).
  const [knowHowOpen, setKnowHowOpen] = useState(false);
  const [knowHowPage, setKnowHowPage] = useState(0);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // The plan form is OPTIONAL and folded: the council is
  // created in Xaman, so the tutorial is the protagonist. The fold opens
  // itself when a saved plan exists — half-written work is never hidden.
  const [planOpen, setPlanOpen] = useState(false);

  const problem = useMemo(
    () => validateCouncilPlan(account, signers, quorum, isPlausibleAddress),
    [account, signers, quorum],
  );
  const plan = useMemo(() => normalizeCouncilPlan(signers, quorum), [signers, quorum]);
  const planReady = problem === null;

  // The plan survives the trip to the phone (and a reload): the person types it
  // here, walks to Xaman, and comes back — losing it in between would mean
  // retyping five addresses from memory, which is how a typo gets in.
  useEffect(() => {
    if (!account) return;
    const saved = getCouncilPlan(account);
    if (saved?.signers?.length) {
      setSigners(() => saved.signers);
      if (saved.quorum) setQuorum(saved.quorum);
      setPlanOpen(true);
    }
    // Only on account change — later edits are saved by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  // Saved on EVERY edit, complete or not: the deck unmounts this slide whenever
  // the person clicks another station, and half-typed work that vanishes on a
  // click is work retyped from memory. The `complete` flag is what keeps an
  // unfinished draft from being compared against the ledger later.
  useEffect(() => {
    if (!account) return;
    saveCouncilPlan(account, { signers, quorum, complete: planReady });
  }, [account, signers, quorum, planReady]);

  const planText = useMemo(
    () =>
      plan.signers.map((s, i) => `${i + 1}. ${s.account}  (${t('weight')} ${s.weight})`).join('\n') +
      `\n${t('Quorum')}: ${plan.quorum} / ${plan.totalWeight}`,
    [plan, t],
  );

  return (
    <div className="space-y-5">
      {/* ── The frame (restructure, founder): one job per card.
          The old single column stacked intro + plan + tutorial + check inside
          one giant rectangle, leaving the council scene floating mid-height in
          reserved emptiness. This card is COMPACT, so the scene sits where it
          belongs — beside the words, not beside a form. ── */}
      <Card spotlight padded={false} className="group isolate relative overflow-hidden p-5 md:p-6 lg:pr-56 space-y-3">
        <div
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 hidden lg:block opacity-[0.32] group-hover:opacity-60 transition-opacity duration-700"
          style={{ zIndex: -1 }}
          aria-hidden
        >
          <CouncilScene width={200} height={160} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Users size={16} className="text-ink/50" />
          <SectionTitle>{t('The council')}</SectionTitle>
          <Pill tone="neutral">
            <Smartphone size={11} className="mr-1 inline" />
            {t('created in Xaman, not here')}
          </Pill>
        </div>
        <p className="text-[13px] leading-relaxed text-ink/65">
          {t(
            'No council governs this account yet. It is created in the Xaman Multisign xApp — from the phone that holds this account’s key — following the illustrated steps below; then you come back and Astryum reads it from the ledger. Astryum never holds a key.',
          )}
        </p>
        <p className="text-[12px] leading-relaxed text-ink/50">
          {t(
            'Why there? The signer list is the one transaction that hands over control of an account, and Xaman only lets its own tools compose it — it refuses the request from any app, Astryum included. Everything after this step — the rehearsal, closing the door, the constitution — happens back here.',
          )}
        </p>
      </Card>

      {/* ── A. Before you start ── */}
      <Card className="p-5 space-y-2">
        <MicroLabel>{t('Before you start — four things, in this order')}</MicroLabel>
        <ul className="space-y-2 text-[12px] leading-relaxed text-ink/60">
          <li className="flex gap-2">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink/30" />
            <span>
              <strong className="font-medium text-ink/80">{t('Each member has their own Xaman, on their own phone.')}</strong>{' '}
              {t(
                'You do not create their accounts — each person creates their own and sends you their address (r…). That is the difference between a council and a bank account: nobody holds anybody else’s key.',
              )}
            </span>
          </li>
          <li className="flex gap-2">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink/30" />
            <span>
              <strong className="font-medium text-ink/80">{t('You have THIS account in your own Xaman.')}</strong>{' '}
              {t('The signer list is signed by the account’s own master key — the account being governed, not yours.')}{' '}
              {account && <span className="font-mono text-ink/70">{account}</span>}
            </span>
          </li>
          <li className="flex gap-2">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink/30" />
            <span>
              <strong className="font-medium text-ink/80">{t('The account holds enough XRP.')}</strong>{' '}
              {reservePlan && balanceXrp !== null ? (
                <>
                  {t('The whole ceremony needs about')} {reservePlan.requiredBalanceXrp} XRP{' '}
                  {t('held in the account; it currently holds')} {balanceXrp.toFixed(2)} XRP.{' '}
                </>
              ) : reservePlan ? (
                <>
                  {t('The whole ceremony needs about')} {reservePlan.requiredBalanceXrp} XRP{' '}
                  {t('held in the account.')}{' '}
                </>
              ) : (
                <>{t('About 15 XRP covers the reserves and the fees of the whole ceremony.')} </>
              )}
              {t(
                'The xApp may create Tickets of its own before the signer list, and each one locks reserve too — a signature that fails for insufficient reserve still burns its fee.',
              )}
            </span>
          </li>
          <li className="flex gap-2">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink/30" />
            <span>
              <strong className="font-medium text-ink/80">{t('You have decided who is in and how many signatures decide.')}</strong>{' '}
              {t(
                'Five signers with a quorum of three is the recommended family setup. Never 2-of-2 nor 2-of-3: one lost key and you are left with no margin at all.',
              )}
            </span>
          </li>
        </ul>
      </Card>

      {/* ── B. The tutorial — the protagonist. ──
      { */}
      <Card className="p-5 space-y-3">
        <MicroLabel>{t('The steps in Xaman, illustrated')}</MicroLabel>
        <p className="text-[12px] leading-relaxed text-ink/50">
          {t(
            'The Multisign xApp is made by XRPL Labs (the makers of Xaman) and its wording may change between versions — what you are looking for is the SIGNER LIST section, not the one for signing a transaction that already exists.',
          )}
        </p>

        {/* KNOW HOW — los ocho pasos
            dejan de ser una pared inline: uno por página, con su captura
            grande, al ritmo del que aprende. El aviso rojo de abajo se queda
            AQUÍ, a la vista siempre: la seguridad no se pagina. */}
        <button
          onClick={() => {
            setKnowHowPage(0);
            setKnowHowOpen(true);
          }}
          className="w-full flex items-center justify-center gap-2.5 rounded-xl border px-4 py-3.5 text-sm font-semibold transition-colors"
          style={{
            borderColor: 'hsl(var(--product-legacy) / 0.4)',
            background: 'hsl(var(--product-legacy) / 0.1)',
            color: 'hsl(var(--product-legacy))',
          }}
        >
          <BookOpen className="h-4.5 w-4.5" size={18} />
          {t('Know how — the 8 steps, illustrated')}
          <ArrowRight size={15} />
        </button>


        <div className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/[0.06] p-2.5 text-[12px] leading-relaxed text-tone-danger">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            {t(
              'While you are in the wallet, do NOT disable the master key — not from the xApp, not from Xaman’s account settings. That is step 4, it is done from Astryum, and only after the rehearsal proves every member can sign. Disabling it now, with a council nobody has tested, locks the account forever.',
            )}
          </span>
        </div>
      </Card>

      {/* ── C. Come back ── */}
      <Card className="p-5 space-y-2">
        <MicroLabel>{t('Come back here and check it against the ledger')}</MicroLabel>
        <p className="text-[12px] leading-relaxed text-ink/55">
          {t(
            'The wallet saying “signed” is not the proof — the ledger is. Astryum reads the signer list straight from the ledger and compares it with the plan you wrote above, member by member.',
          )}
        </p>
        <PrimaryButton onClick={onRefresh} disabled={loading || !account}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {t('I have done it — read the council from the ledger')}
        </PrimaryButton>
        <p className="text-[12px] leading-relaxed text-ink/45">
          {t(
            'If it does not appear yet, wait a few seconds and press again. If it appears but does not match your plan, you can still repeat the screen in the xApp with the corrected list — the master key is still active, and the new list replaces the old one entirely.',
          )}
        </p>
        <div className="flex items-start gap-2 pt-1 text-[12px] leading-relaxed text-ink/60">
          <ArrowRight size={14} className="mt-0.5 shrink-0 text-ink/40" />
          <span>
            {t(
              'From here on, everything is back in Astryum: the signing rehearsal (step 3), closing the door (step 4) and the constitution (step 5). You will not need the xApp again — except the day you have to replace a signer.',
            )}
          </span>
        </div>
      </Card>

      {/* ── D. ──
      { */}
      <section className="space-y-2">
        <button
          type="button"
          onClick={() => setPlanOpen((v) => !v)}
          aria-expanded={planOpen}
          className="flex items-center gap-1.5 text-[12px] text-ink/40 transition-colors hover:text-ink/70"
        >
          <ChevronDown size={13} className={planOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
          {t('Optional: write the plan here first — a checked list to copy into the phone, compared against the ledger afterwards')}
        </button>
        {planOpen && (
          <div className="space-y-2 rounded-xl border border-ink/10 bg-ink/[0.02] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Users size={14} className="text-ink/50" />
              <MicroLabel>{t('Write the list here first')}</MicroLabel>
              {planReady ? (
                <Pill tone="success">{t('ready to type into Xaman')}</Pill>
              ) : (
                <Pill tone="neutral">{t('list not ready yet')}</Pill>
              )}
            </div>
            <p className="text-[12px] leading-relaxed text-ink/55">
              {t(
                'Nothing here is sent anywhere and nothing is signed — this is the checked list you will copy into the wallet. Astryum verifies each address (a single wrong character is a member who can never sign) and refuses a quorum higher than the total, which would lock the account forever.',
              )}
            </p>

            <SignerListRows signers={signers} setSigners={setSigners} quorum={quorum} setQuorum={setQuorum} />

            {problem && <InlineNotice tone="warning">{formatPlanProblem(problem, t)}</InlineNotice>}

            {planReady && (
              <div className="space-y-2 rounded-lg border border-ink/10 bg-black/20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <MicroLabel>{t('Type exactly this into the xApp')}</MicroLabel>
                  <CopyButton value={planText} label={t('Copy the whole list')} />
                </div>
                <ul className="space-y-1.5">
                  {plan.signers.map((s, i) => (
                    <li key={s.account} className="flex flex-wrap items-center gap-2 text-[12px]">
                      <span className="font-mono text-ink/40">{i + 1}.</span>
                      <span className="break-all font-mono text-ink/80">{s.account}</span>
                      <Pill tone="neutral">
                        {t('weight')} {s.weight}
                      </Pill>
                      <span className="ml-auto">
                        <CopyButton value={s.account} label={t('Copy address')} />
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-[12px] text-ink/60">
                  <strong className="font-medium text-ink/80">
                    {t('Quorum')}: {plan.quorum} / {plan.totalWeight}
                  </strong>{' '}
                  <span className="text-ink/45">
                    ({t('margin')} {plan.margin})
                  </span>
                </p>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── E. Escape hatch: signers who do not use Xaman. The in-app composer
             is NOT deleted — it is the only path for a Ledger/Crossmark holder,
             and the day Xaman grants the permission it becomes usable again. ── */}
      <section className="space-y-2">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="flex items-center gap-1.5 text-[12px] text-ink/40 hover:text-ink/70"
        >
          <ChevronDown size={13} className={advancedOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
          {t('Not using Xaman? (Ledger, Crossmark, xrpl.services)')}
        </button>
        {advancedOpen && (
          <div className="space-y-2 rounded-xl border border-ink/10 bg-ink/[0.02] p-3">
            <p className="text-[12px] leading-relaxed text-ink/55">
              {t(
                'Astryum can still compose the unsigned transaction for the list above. Copy it into the tool that holds this account’s key and sign it there. Do not try to sign it with Xaman: it rejects this type of request from any app (error 1217) — that is the whole reason the guide above exists.',
              )}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <PrimaryButton onClick={onPrepareUnsigned} disabled={unsignedBusy || !account || !planReady}>
                {unsignedBusy ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />}
                {t('Compose the unsigned transaction')}
              </PrimaryButton>
              <a href={XRPL_SERVICES_TOOLS} target="_blank" rel="noreferrer" className="text-[12px] text-ink/40 hover:text-ink/70">
                xrpl.services
              </a>
            </div>
            {unsignedError && <InlineNotice tone="warning">{unsignedError}</InlineNotice>}
            {unsignedSlot}
          </div>
        )}
      </section>

      {/* ── KNOW HOW — el tutorial, una página por paso ─────────────────── */}
      {knowHowOpen && (() => {
        const pages = [
(
<ol className="space-y-3.5">          <Step n={1} title={t('Open Xaman on the phone that holds this account’s key.')}>
            <Hint>
              {t(
                'Check the account shown at the top: it must be exactly the account you are constituting. If you hold several, switch to it now — a signer list created on the wrong account governs the wrong account, and you would only find out later.',
              )}
            </Hint>
            {account && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="break-all font-mono text-[12px] text-ink/75">{account}</span>
                <CopyButton value={account} label={t('Copy address')} />
              </div>
            )}
          </Step></ol>
),
(
<ol className="space-y-3.5">          <Step n={2} title={t('Open the Multisign xApp.')}>
            <Hint>
              {t(
                'In Xaman: the xApps tab → search for “Multisign” → open it. Or open this link on the phone (it only works on a device that has Xaman installed):',
              )}
            </Hint>
            <div className="flex flex-wrap items-center gap-2">
              <a href={XAMAN_MULTISIGN_XAPP} target="_blank" rel="noreferrer">
                <GhostButton>
                  <ExternalLink size={13} /> {t('Open the Multisign xApp')}
                </GhostButton>
              </a>
              <CopyButton value={XAMAN_MULTISIGN_XAPP} label={t('Copy the link for the phone')} />
            </div>
            <StepShot src="/legacy/xaman/multisign-step-1.png" caption={t('Xaman → xApps → search “Multisign”')} />
          </Step></ol>
),
(
<ol className="space-y-3.5">          <Step n={3} title={t('Choose to create the signer list of this account.')}>
            <Hint>
              {t(
                'The xApp does two different jobs: define WHO signs for an account (this, the signer list) and collect signatures for a transaction that already exists (that one you will not need — Astryum gathers the council’s signatures itself, later). Pick the first.',
              )}
            </Hint>
            <StepShot src="/legacy/xaman/multisign-step-2.png" caption={t('The Setup screen, empty — Add Signer starts the list')} />
          </Step></ol>
),
(
<ol className="space-y-3.5">          <Step n={4} title={t('Add the members, one by one.')}>
            <Hint>
              {t(
                'Paste each address as its owner sent it to you — never retype it by hand — and set its weight to 1 unless you deliberately want someone to weigh more. Add all of them before continuing: the list you send REPLACES anything that was there; it is not added to it.',
              )}
            </Hint>
          </Step></ol>
),
(
<ol className="space-y-3.5">          <Step n={5} title={t('Set the quorum.')}>
            <Hint>
              {planReady
                ? `${t('That is how many votes any decision needs, out of the total on the list. What is left over is the margin: the votes you can lose before the council can no longer decide anything.')} (${plan.quorum}/${plan.totalWeight} · ${t('margin')} ${plan.margin})`
                : t('That is how many votes any decision needs, out of the total on the list. Five signers with a quorum of three is the recommended family setup — never 2-of-2 nor 2-of-3.')}
            </Hint>
            <StepShot src="/legacy/xaman/multisign-step-3.png" caption={t('All members added, weight 1 each, quorum set — then Submit')} />
          </Step></ol>
),
(
<ol className="space-y-3.5">          <Step n={6} title={t('Compare the review screen, line by line.')}>
            <Hint>
              {t(
                'This is the last cheap moment. One wrong character in one address is a member who can never sign — and once the master key is disabled, a council short of quorum cannot be repaired by anyone, ever. If anything differs, cancel and start the screen again.',
              )}
            </Hint>
            <StepShot src="/legacy/xaman/multisign-step-4.png" caption={t('The review — type Set Signer List: every member, every weight, the quorum')} />
          </Step></ol>
),
(
<ol className="space-y-3.5">          <Step n={7} title={t('Accept Xaman’s warning and slide to sign.')}>
            <Hint>
              {t(
                'Xaman shows a red warning before this signature. It is expected, and it is literally true — this is the transaction that hands the account to the council. Its exact words:',
              )}
            </Hint>
            <p className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 font-mono text-[11px] leading-relaxed text-tone-warning">
              “YOU HAVE BEEN WARNED BY XAMAN… YOU ARE GIVING AWAY CONTROL OF YOUR ACCOUNT”
            </p>
            <Hint>
              {t(
                'You are signing with the account’s master key — the council does not exist yet, so it cannot sign its own creation. The master key stays ACTIVE after this: it is your safety net until the rehearsal proves every member can sign.',
              )}
            </Hint>
          </Step></ol>
),
(
<ol className="space-y-3.5">          <Step n={8} title={t('Wait until the ledger validates it.')}>
            <Hint>
              {t(
                'A few seconds. If it fails with tecINSUFFICIENT_RESERVE, the account is short of XRP: top it up and repeat the screen — the failed attempt only cost its fee.',
              )}
            </Hint>
          </Step>
</ol>
)
        ];
        const last = pages.length - 1;
        const page = Math.min(knowHowPage, last);
        return (
          <ModalOverlay
            className="fixed inset-0 z-[60] overflow-y-auto bg-black/70 backdrop-blur-sm"
            onEscape={() => setKnowHowOpen(false)}
          >
            <div className="flex min-h-full justify-center p-4" onClick={() => setKnowHowOpen(false)}>
              <div
                className="relative my-auto w-full max-w-xl rounded-2xl border bg-surface-1 p-5 shadow-2xl"
                style={{ borderColor: 'hsl(var(--product-legacy) / 0.25)' }}
                role="dialog"
                aria-modal="true"
                aria-label={t('Know how — the 8 steps, illustrated')}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="grid h-8 w-8 place-items-center rounded-lg border"
                      style={{
                        borderColor: 'hsl(var(--product-legacy) / 0.4)',
                        background: 'hsl(var(--product-legacy) / 0.1)',
                        color: 'hsl(var(--product-legacy))',
                      }}
                    >
                      <BookOpen size={15} />
                    </span>
                    <span className="text-sm font-semibold text-ink">{t('The steps in Xaman, illustrated')}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-ink/40">{page + 1} / {pages.length}</span>
                    <button
                      onClick={() => setKnowHowOpen(false)}
                      className="rounded-lg p-1.5 text-ink/45 transition-colors hover:bg-ink/5 hover:text-ink"
                      aria-label={t('Close')}
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>

                <div className="min-h-[16rem]">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={page}
                      initial={{ opacity: 0, x: 18 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -14 }}
                      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                    >
                      {pages[page]}
                    </motion.div>
                  </AnimatePresence>
                </div>

                <div className="mt-5 flex items-center justify-between gap-3 border-t border-ink/5 pt-4">
                  <GhostButton onClick={() => setKnowHowPage(Math.max(0, page - 1))} disabled={page === 0}>
                    <ArrowLeft size={14} /> {t('Previous')}
                  </GhostButton>
                  <div className="flex items-center gap-1.5" aria-hidden>
                    {pages.map((_, d) => (
                      <button
                        key={d}
                        onClick={() => setKnowHowPage(d)}
                        className="h-1.5 rounded-full transition-all"
                        style={{
                          width: d === page ? 18 : 6,
                          background:
                            d === page
                              ? 'hsl(var(--product-legacy))'
                              : 'hsl(var(--product-legacy) / 0.25)',
                        }}
                      />
                    ))}
                  </div>
                  {page < last ? (
                    <PrimaryButton onClick={() => setKnowHowPage(page + 1)}>
                      {t('Next')} <ArrowRight size={14} />
                    </PrimaryButton>
                  ) : (
                    <PrimaryButton onClick={() => setKnowHowOpen(false)}>
                      {t('Done')} <Check size={14} />
                    </PrimaryButton>
                  )}
                </div>
              </div>
            </div>
          </ModalOverlay>
        );
      })()}
    </div>
  );
}

/**
 * CouncilPlanCheck — the other half of the loop, rendered next to the council
 * once it EXISTS on the ledger: does it match what the family planned?
 *
 * A council that is off by one signer or one quorum unit still looks perfectly
 * healthy on screen. The mismatch is discovered years later, by whoever needed
 * it to work. So while a saved plan exists, it is compared — and it is the
 * person who clears it, by confirming the council is right.
 */
export function CouncilPlanCheck({ account, council }: { account: string; council: CouncilOnLedger }) {
  const { t } = useT();
  const [dismissed, setDismissed] = useState(false);
  const saved = useMemo(() => getCouncilPlan(account), [account]);

  const cmp = useMemo(
    () =>
      saved?.complete && saved.signers.length
        ? compareCouncilPlan(saved.signers, saved.quorum ?? '', council)
        : null,
    [saved, council],
  );

  const confirm = useCallback(() => {
    clearCouncilPlan(account);
    setDismissed(true);
  }, [account]);

  if (!cmp || dismissed) return null;

  if (cmp.matches) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.07] p-2.5 text-[12px] text-tone-success">
        <Check size={14} className="shrink-0" />
        <span>{t('The council on the ledger matches the plan you prepared, member by member.')}</span>
        <span className="ml-auto">
          <GhostButton onClick={confirm}>{t('Got it')}</GhostButton>
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2.5 text-[12px] text-tone-warning">
      <p className="flex items-start gap-2">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <span>
          {t(
            'The council on the ledger does NOT match the plan you prepared. Check it before going any further — while the master key is still active, you can send a corrected signer list from the Xaman Multisign xApp.',
          )}
        </span>
      </p>
      <ul className="space-y-1 pl-6">
        {!cmp.quorumMatches && (
          <li>
            • {t('Quorum — planned vs on the ledger')}:{' '}
            <span className="font-mono">
              {saved?.quorum} → {council.quorum}
            </span>
          </li>
        )}
        {cmp.missing.map((a) => (
          <li key={`m-${a}`}>
            • {t('Planned but NOT on the ledger')}: <span className="break-all font-mono">{a}</span>
          </li>
        ))}
        {cmp.unexpected.map((a) => (
          <li key={`u-${a}`}>
            • {t('On the ledger but not in your plan')}: <span className="break-all font-mono">{a}</span>
          </li>
        ))}
        {cmp.weightMismatch.map((w) => (
          <li key={`w-${w.account}`}>
            • <span className="break-all font-mono">{w.account}</span> —{' '}
            {t('weight — planned vs on the ledger')}:{' '}
            <span className="font-mono">
              {w.planned} → {w.onLedger}
            </span>
          </li>
        ))}
      </ul>
      <div className="pl-6">
        <GhostButton onClick={confirm}>{t('The council is correct — stop comparing')}</GhostButton>
      </div>
    </div>

  );
}

/**
 * Shape AND checksum. The regex alone lets a plausible one-character typo
 * through — and copying a relative's address by hand is exactly where that typo
 * happens. A signer whose address is off by one character is a member who can
 * never sign, discovered when it is too late to fix.
 */
function isPlausibleAddress(a: string): boolean {
  try {
    return isValidClassicAddress(a);
  } catch {
    return false;
  }
}
