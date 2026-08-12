'use client';

/**
 * CouncilOrderCard — "the council orders, the cage obeys" (roadmap Pieza 1).
 *
 * The full enforcement rail, in one card:
 *   compose (prepare-only) → quorum signs N QRs (the existing coordinator) →
 *   browser broadcasts on XRPL → the courtesy relayer carries the FDC proof →
 *   the XrplCouncilBridge executes EXACTLY the committed bytes on the vault.
 *
 * The tracker (F8 pattern) shows the three stages honestly: signed on XRPL ✓ →
 * FDC round (~2-5 min) → executed in the cage ✓. Settlement truth is read from
 * the bridge on-chain (consumedTxId), never from local state alone.
 *
 * Astryum composes and relays with ZERO discretion: the bridge only accepts
 * the bytes whose keccak256 the quorum signed. No order can extract principal —
 * the vault has no such function.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, ExternalLink, Landmark, Loader2, Send } from 'lucide-react';
import { Card, GhostButton, MicroLabel, Pill, PrimaryButton, SectionTitle } from '../ui/primitives';
import { useT } from '../../i18n/LanguageProvider';
import { getUserRegion } from '../../lib/region';
import { xrplLegacy, type CouncilOrderHandoff } from '../../services/v1Api';
import { startPending } from '../../lib/settlement/settlement';
import { useSettlement } from '../../lib/settlement/useSettlement';
import CouncilMultisigFlow from './CouncilMultisigFlow';
import ProposeToCouncil from './ProposeToCouncil';
import { DisclosureBlock } from './LegacyPanel';
import { InlineNotice } from './InlineNotice';

const XRPSCAN_TX = 'https://xrpscan.com/tx/';
const FLARE_EXPLORER: Record<string, string> = {
  coston2: 'https://coston2-explorer.flare.network/tx/',
  flare: 'https://flare-explorer.flare.network/tx/',
};

// The FDC round latency the tracker promises up front, so the wait reads as
// normal and not as a failure with the family watching. PLACEHOLDER — confirm
// the real number with `rehearse-attestation.ts` and update.
const FDC_ROUND_ESTIMATE = '2–5 min';

/** What the quorum is really paying, read from the COMPOSED transaction.
 *  With the order fee on, the Payment is 1 drop + the fee (0.200001 XRP), not
 *  the "1 drop" the copy used to promise. Drops are always 6 decimals. */
function orderPaymentXrp(handoff: CouncilOrderHandoff): string {
  const raw = (handoff.xrplTx as { Amount?: unknown })?.Amount;
  const drops = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : NaN;
  if (!Number.isFinite(drops) || drops <= 0) return '—';
  if (drops === 1) return '1 drop';
  return `${(drops / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 6 })} XRP`;
}

/** The v1 action forms — field lists per action, rendered generically.
 *  'payees' is the one repeatable field: address + % rows (wire wants bps). */
type FieldKind = 'venueId' | 'amount' | 'bps' | 'address' | 'date' | 'ref' | 'payees';
interface ActionForm {
  action: string;
  label: string;
  fields: Array<{ id: string; label: string; kind: FieldKind }>;
}
const ACTION_FORMS: ActionForm[] = [
  {
    action: 'direct-to',
    label: 'Direct principal to a venue',
    fields: [
      { id: 'venueId', label: 'Venue #', kind: 'venueId' },
      { id: 'amount', label: 'Amount (base units)', kind: 'amount' },
    ],
  },
  {
    action: 'recall',
    label: 'Recall principal from a venue',
    fields: [
      { id: 'venueId', label: 'Venue #', kind: 'venueId' },
      { id: 'amount', label: 'Amount (base units)', kind: 'amount' },
    ],
  },
  {
    action: 'evacuate',
    label: 'Evacuate a venue (emergency)',
    fields: [{ id: 'venueId', label: 'Venue #', kind: 'venueId' }],
  },
  {
    action: 'set-linaje-fee-bps',
    label: 'Set the linaje cut (bps)',
    fields: [{ id: 'bps', label: 'Bps (1000–4000)', kind: 'bps' }],
  },
  {
    // The yield panel's "no payees set" notice pointed here for weeks while the
    // form did not exist (F5) — the backend rail (setPayees) was always live.
    action: 'set-payees',
    label: 'Set the payees (who receives the yield)',
    fields: [{ id: 'payees', label: 'Payees', kind: 'payees' }],
  },
  {
    action: 'cede',
    label: 'Grant direction (the cession)',
    fields: [
      { id: 'director', label: 'Director (Flare 0x…)', kind: 'address' },
      { id: 'untilISO', label: 'Until', kind: 'date' },
    ],
  },
  { action: 'end-cession', label: 'End the cession', fields: [] },
  {
    action: 'set-constitution-ref',
    label: 'Point at a new constitution version',
    fields: [{ id: 'newRefHex', label: 'New SHA-256 (0x + 64 hex)', kind: 'ref' }],
  },
];

type Stage = 'form' | 'review' | 'signing' | 'settling' | 'done' | 'error';

export default function CouncilOrderCard({ account }: { account: string }) {
  const { t } = useT();
  const [form, setForm] = useState<ActionForm>(ACTION_FORMS[0]);
  const [values, setValues] = useState<Record<string, string>>({});
  // set-payees rows — the person types a Flare address and a % share; the wire
  // gets bps. Empty rows are dropped before validation.
  const [payeeRows, setPayeeRows] = useState<Array<{ account: string; pct: string }>>([
    { account: '', pct: '' },
  ]);
  const [stage, setStage] = useState<Stage>('form');
  const [handoff, setHandoff] = useState<CouncilOrderHandoff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [xrplHash, setXrplHash] = useState<string | null>(null);
  const [flareHash, setFlareHash] = useState<string | null>(null);
  const [stuckReason, setStuckReason] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // The settlement machine owns the DONE verdict (and the F5 persistence).
  const settlement = useSettlement();
  useEffect(() => () => {
    if (pollTimer.current) clearInterval(pollTimer.current);
  }, []);

  const prepare = useCallback(async () => {
    setError(null);
    setStage('review');
    setHandoff(null);
    try {
      // Params go up as-typed; the backend validates + encodes deterministically.
      const params: Record<string, unknown> = {};
      for (const f of form.fields) {
        if (f.kind === 'payees') {
          const rows = payeeRows
            .map((r) => ({ account: r.account.trim(), pct: Number(String(r.pct).replace(',', '.')) }))
            .filter((r) => r.account.length > 0 || Number.isFinite(r.pct));
          if (rows.length === 0) throw new Error(t('Add at least one payee.'));
          if (rows.some((r) => !/^0x[a-fA-F0-9]{40}$/.test(r.account))) {
            throw new Error(t('Every payee must be a Flare address (0x…).'));
          }
          if (rows.some((r) => !(r.pct > 0))) throw new Error(t('Every payee needs a share greater than 0%.'));
          const total = rows.reduce((a, r) => a + r.pct, 0);
          if (total > 100) throw new Error(`${t('The shares add up to more than 100%')} (${total}%).`);
          params.payees = rows.map((r) => ({ account: r.account, bps: Math.round(r.pct * 100) }));
          continue;
        }
        const v = values[f.id]?.trim();
        if (!v) throw new Error(t('Fill every field of the order first.'));
        params[f.id] = f.kind === 'venueId' || f.kind === 'bps' ? Number(v) : f.kind === 'date' ? new Date(`${v}T00:00:00Z`).toISOString() : v;
      }
      const h = await xrplLegacy.councilOrderPrepare({
        account,
        action: form.action,
        params,
        region: getUserRegion() ?? undefined,
      });
      setHandoff(h);
    } catch (e) {
      setError((e as Error).message);
      setStage('form');
    }
  }, [account, form, values, payeeRows, t]);

  /** Fire (or re-fire) the courtesy relay for a signed XRPL tx. Idempotent on the
   *  backend (executed → 'already-executed'); persistence-backed so a redeploy
   *  won't re-pay. A failure surfaces as the VISIBLE stuck state, never a spinner. */
  const triggerRelay = useCallback(
    (hash: string) => {
      setStuckReason(null);
      void xrplLegacy
        .councilOrderRelay({ xrplTxHash: hash, orderData: handoff?.order.orderData })
        .catch((e) => setStuckReason((e as Error).message));
    },
    [handoff],
  );

  /** After the quorum signed + the browser broadcast: start the FDC leg.
   *  NOTE the broadcast's tesSUCCESS is PRELIMINARY — it only moves the card to
   *  'settling'. The DONE state comes exclusively from the settlement machine
   *  (rail 'council-order' → LegacyBridge.consumedTxId on Flare), which also
   *  persists the op: an F5 mid-FDC-round resumes in the floating settlements
   *  surface instead of losing the ceremony (escaneo #6). */
  const onSettled = useCallback(
    (hash: string) => {
      setXrplHash(hash);
      setStage('settling');
      triggerRelay(hash);
      settlement.track(startPending('council-order', hash), {
        onSettled: () => {
          setStuckReason(null);
          setStage('done');
          if (pollTimer.current) clearInterval(pollTimer.current);
        },
      });
      // Council-specific ENRICHMENT poll (relay stuck-state + the Flare tx
      // hash): read-only detail; the success verdict never comes from here.
      pollTimer.current = setInterval(async () => {
        try {
          const st = await xrplLegacy.councilOrderStatus(hash, account);
          if (st.relay?.state === 'error') setStuckReason(st.relay.detail ?? t('the relay could not deliver the proof'));
          else if (st.relay?.state === 'relaying') setStuckReason(null);
          if (st.relay?.flareTxHash) setFlareHash(st.relay.flareTxHash);
        } catch {
          /* transient — keep polling */
        }
      }, 10_000);
    },
    [triggerRelay, settlement, t],
  );

  /** The diagnostic instrument of the ceremony: re-deliver the proof after a
   *  stuck relay, without re-signing (same XRPL tx, same committed bytes). */
  const retryRelay = useCallback(() => {
    if (xrplHash) triggerRelay(xrplHash);
  }, [xrplHash, triggerRelay]);

  const reset = useCallback(() => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    settlement.reset();
    setStage('form');
    setHandoff(null);
    setXrplHash(null);
    setFlareHash(null);
    setStuckReason(null);
    setError(null);
    setValues({});
  }, [settlement]);

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║ MODO DEMO TEMPORAL — BORRAR TRAS LA CEREMONIA (runbook §7)           ║
  // ║ Deja VER el estado "atascada" + Reintentar sin quórum, para no       ║
  // ║ estrenarlo con la familia delante. NUNCA en producción: el bundle de ║
  // ║ prod tiene NODE_ENV==='production' y este bloque queda muerto, así   ║
  // ║ que no puede activarse con una wallet real ni pasando ?demoStuck=1.  ║
  // ║ Para quitarlo: borra ESTE bloque y su uso en el JSX (busca DEMO_STUCK).║
  // ╚══════════════════════════════════════════════════════════════════════╝
  const demoStuckAvailable =
    process.env.NODE_ENV !== 'production' &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('demoStuck') === '1';
  const forceDemoStuck = useCallback(() => {
    setXrplHash('DEMO'.padEnd(64, '0'));
    setStage('settling');
    setStuckReason(
      'DATOS FALSOS (modo demo) — bridge.execute would revert: NonceMismatch(expected 0, actual 3)',
    );
  }, []);
  // ╚═══════════════════ fin del MODO DEMO TEMPORAL ══════════════════════╝

  const inputCls =
    'mt-1 w-full rounded-lg border border-ink/10 bg-ink/5 px-3 py-2 text-sm outline-none focus:border-ink/25';

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Landmark size={16} className="text-ink/50" />
        <SectionTitle>{t('Council order (the cage on Flare)')}</SectionTitle>
      </div>
      <p className="text-[12px] text-ink/55">
        {t(
          'Govern the productive capital from XRPL, literally: the quorum signs ONE transaction committing the exact order; the Flare Data Connector proves it; the bridge executes only those bytes against the vault. No order can extract the principal — that function does not exist.',
        )}
      </p>

      {(stage === 'form' || (stage === 'review' && !handoff)) && (
        <div className="space-y-3">
          <label className="block">
            <MicroLabel>{t('Order')}</MicroLabel>
            <select
              value={form.action}
              onChange={(e) => {
                const next = ACTION_FORMS.find((a) => a.action === e.target.value)!;
                setForm(next);
                setValues({});
                setPayeeRows([{ account: '', pct: '' }]);
              }}
              className={inputCls}
            >
              {ACTION_FORMS.map((a) => (
                <option key={a.action} value={a.action} className="bg-surface-2">
                  {t(a.label)}
                </option>
              ))}
            </select>
          </label>
          {form.fields.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {form.fields.map((f) =>
                f.kind === 'payees' ? (
                  <div key={f.id} className="sm:col-span-2 space-y-2">
                    {payeeRows.map((r, i) => (
                      <div key={i} className="flex flex-wrap items-end gap-2">
                        <label className="grow">
                          <MicroLabel>{t('Payee (Flare 0x…)')}</MicroLabel>
                          <input
                            value={r.account}
                            onChange={(e) =>
                              setPayeeRows((prev) => prev.map((x, j) => (j === i ? { ...x, account: e.target.value } : x)))
                            }
                            spellCheck={false}
                            className={inputCls}
                          />
                        </label>
                        <label className="w-24">
                          <MicroLabel>{t('Share (%)')}</MicroLabel>
                          <input
                            value={r.pct}
                            onChange={(e) =>
                              setPayeeRows((prev) => prev.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))
                            }
                            inputMode="decimal"
                            className={inputCls}
                          />
                        </label>
                        {payeeRows.length > 1 && (
                          <GhostButton onClick={() => setPayeeRows((prev) => prev.filter((_, j) => j !== i))}>
                            ×
                          </GhostButton>
                        )}
                      </div>
                    ))}
                    <GhostButton onClick={() => setPayeeRows((prev) => [...prev, { account: '', pct: '' }])}>
                      + {t('Add payee')}
                    </GhostButton>
                    <p className="text-[11px] text-ink/45">
                      {t('The yield is shared out in these proportions. What is not assigned keeps capitalizing into the principal.')}
                    </p>
                  </div>
                ) : (
                  <label key={f.id} className="block">
                    <MicroLabel>{t(f.label)}</MicroLabel>
                    <input
                      type={f.kind === 'date' ? 'date' : 'text'}
                      inputMode={f.kind === 'venueId' || f.kind === 'bps' || f.kind === 'amount' ? 'numeric' : undefined}
                      value={values[f.id] ?? ''}
                      onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                      spellCheck={false}
                      className={inputCls}
                    />
                  </label>
                ),
              )}
            </div>
          )}
          <PrimaryButton onClick={() => void prepare()} disabled={stage === 'review'}>
            {stage === 'review' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {t('Compose the order')}
          </PrimaryButton>
          {/* DEMO_STUCK — bloque temporal, borrar tras la ceremonia (runbook §7) */}
          {demoStuckAvailable && (
            <GhostButton onClick={forceDemoStuck}>
              <AlertTriangle size={13} /> MODO DEMO: forzar estado atascado (datos falsos)
            </GhostButton>
          )}
        </div>
      )}

      {stage === 'review' && handoff && (
        <div className="space-y-3">
          <DisclosureBlock handoff={handoff} />
          <p className="text-[12px] text-ink/55">
            {/* The amount is READ from the composed tx, never described from
                memory: this line used to promise a single drop while the order
                fee made it 200,001 drops — a screen that contradicts what the
                quorum is about to sign (F4 family, 2026-08-03). */}
            {t('Your council signs this Payment of')} {orderPaymentXrp(handoff)}{' '}
            {t(
              'here, each member from their own device. The signature authorizes ONLY the order above — same bytes, once, in order.',
            )}
          </p>
          <CouncilMultisigFlow xrplTx={handoff.xrplTx} account={account} onSettled={onSettled} />
          {/* The async tempo (§2.4): file it in the inbox and let each member
              sign from their own device over days. */}
          {/* The proposal's TITLE is the order's own summary ("Put 0.1 FXRP of
              the principal to work in Kinetic"), not the generic "Council
              order": the capital movement lives in the order bytes, so without
              this the inbox — and the sidebar tray — could only say "Payment"
              about a decision the family has to weigh (2026-08-03). */}
          <ProposeToCouncil
            xrplTx={handoff.xrplTx}
            account={account}
            defaultTitle={handoff.order.summary || t('Council order')}
          />
          <GhostButton onClick={reset}>{t('Back')}</GhostButton>
        </div>
      )}

      {(stage === 'settling' || stage === 'done') && (
        <div className="space-y-2">
          {/* The F8 tracker: three honest stages — plus an honest STUCK state,
              never a perpetual spinner (the day's diagnostic instrument). */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill tone="success">
              <Check size={12} /> {t('signed on XRPL')}
            </Pill>
            <span className="text-ink/25">→</span>
            {stage === 'done' ? (
              <Pill tone="success">
                <Check size={12} /> {t('FDC round')}
              </Pill>
            ) : stuckReason ? (
              <Pill tone="warning">
                <AlertTriangle size={12} /> {t('stuck')}
              </Pill>
            ) : (
              <Pill tone="warning">
                <Loader2 size={12} className="animate-spin" /> {t('FDC round')}
              </Pill>
            )}
            <span className="text-ink/25">→</span>
            {stage === 'done' ? (
              <Pill tone="success">
                <Check size={12} /> {t('executed in the cage')}
              </Pill>
            ) : (
              <Pill tone="neutral">{t('executed in the cage')}</Pill>
            )}
          </div>

          {/* The expected wait, promised up front so the silence reads as normal
              and not as a failure with the family watching. */}
          {stage === 'settling' && !stuckReason && (
            <p className="text-[12px] text-ink/55">
              {t('The FDC round takes about')} {FDC_ROUND_ESTIMATE}. {t('The quorum can step away — the wait is normal, not a failure.')}
            </p>
          )}

          {stage === 'done' && (
            <InlineNotice tone="success">
              {t('The order the quorum signed on XRPL was executed on Flare. Nobody held a key in between.')}
            </InlineNotice>
          )}
          <div className="flex flex-wrap gap-3 text-[12px]">
            {xrplHash && (
              <a href={`${XRPSCAN_TX}${xrplHash}`} target="_blank" rel="noreferrer" className="text-ink/55 underline hover:text-ink/80">
                <ExternalLink size={12} className="mr-1 inline" /> XRPL tx
              </a>
            )}
            {flareHash && handoff && (
              <a
                href={`${FLARE_EXPLORER[handoff.order.chain] ?? FLARE_EXPLORER.coston2}${flareHash}`}
                target="_blank"
                rel="noreferrer"
                className="text-ink/55 underline hover:text-ink/80"
              >
                <ExternalLink size={12} className="mr-1 inline" /> Flare tx
              </a>
            )}
          </div>

          {/* Stuck: say WHY, and offer to re-deliver the proof — no re-signing,
              same committed bytes. Idempotent + persistence-backed on the backend. */}
          {stuckReason && stage !== 'done' && (
            <InlineNotice tone="warning">
              <div className="space-y-2">
                <div>
                  <span className="font-medium">{t('The relay is stuck:')}</span> {stuckReason}
                </div>
                <div className="text-ink/60">
                  {t('The order stays valid — the same signed transaction can be re-delivered by anyone (permissionless), no new signature needed.')}
                </div>
                <GhostButton onClick={retryRelay}>
                  <Send size={13} /> {t('Retry the relay')}
                </GhostButton>
              </div>
            </InlineNotice>
          )}

          {stage === 'done' && <GhostButton onClick={reset}>{t('New order')}</GhostButton>}
        </div>
      )}

      {error && <InlineNotice tone="warning">{error}</InlineNotice>}
    </Card>
  );
}
