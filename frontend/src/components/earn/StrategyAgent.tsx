'use client';

/**
 * StrategyAgent — the "Create with AI Agent" surface + the user's saved
 * strategies (drafts), shown in Estrategias · Guardadas (the registry) since
 * the 2026-07-12 UI reorg.
 *
 * The agent is a DETERMINISTIC compiler with a conversational skin: it parses
 * the user's words into strategy parameters, asks for the factors that are
 * missing (amount, protection…), and summarises what it understood. It has
 * ZERO discretion (invariant #8): it never invents parameters, never promises
 * yield, and never executes. When asked to execute a custom strategy it says
 * plainly that the beta can't run custom strategies yet and offers the two
 * audited ready-made packs as prompt cards — which open the SAME prepare→
 * review→sign modal the manual flow uses. Astryum never signs.
 *
 * Drafts persist device-locally per identity (lib/strategyDrafts) and surface
 * in Estrategias · Guardadas with edit (params + agent on the side), execute
 * and delete.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Pencil,
  Play,
  Save,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { useAuthStore } from '../../stores/authStore';
import { profileIdentity } from '../../lib/profileStore';
import {
  deleteDraft,
  listDrafts,
  saveDraft,
  type DraftKind,
  type StrategyDraft,
} from '../../lib/strategyDrafts';
import { ModalOverlay } from '@/components/ui/ModalPortal';

export function inferDraftKind(asset?: string): DraftKind {
  const a = (asset ?? '').toUpperCase();
  if (a === 'XRP' || a === 'FXRP') return 'e1';
  if (a === 'FLR' || a === 'WFLR') return 'e2';
  return 'custom';
}

/* ------------------------------------------------------------------ */
/* Shared launch contract — opens the REAL prepare modal upstream.      */
/* ------------------------------------------------------------------ */

export type LaunchStrategy = (
  kind: 'e1' | 'e2' | 'e3' | 'v-firelight' | 'v-earnxrp' | 'v-monarq',
  initial?: { amount?: string; ratio?: string; targetHF?: string },
) => void;

/** The two ready-made packs rendered as prompt cards inside the chat. */
function ReadyPrompts({
  draft,
  onLaunch,
  es,
}: {
  draft: Partial<StrategyDraft>;
  onLaunch: LaunchStrategy;
  es: boolean;
}) {
  const amount = draft.amount && Number(draft.amount) > 0 ? draft.amount : undefined;
  const isXrp = inferDraftKind(draft.asset) === 'e1';
  const e1Amount = isXrp && amount ? amount : '5';
  const e2Amount = !isXrp && amount ? amount : '100';
  const ratio = draft.ratio ?? '0.30';
  const hf = draft.targetHF ?? '1.10';
  const e1Prompt = es
    ? `Pon ${e1Amount} XRP a trabajar en el vault de FXRP con ratio ${ratio} y protección en HF ${hf}`
    : `Put ${e1Amount} XRP to work in the FXRP vault at ratio ${ratio} with protection at HF ${hf}`;
  const e2Prompt = es
    ? `Envuelve ${e2Amount} FLR y delega su poder de voto a un proveedor FTSO`
    : `Wrap ${e2Amount} FLR and delegate its vote power to an FTSO provider`;
  return (
    <div className="mt-2 space-y-2">
      <button
        onClick={() => onLaunch('e1', { amount: e1Amount, ratio, targetHF: hf })}
        className="w-full text-left px-3.5 py-2.5 rounded-xl border border-sky-400/25 bg-sky-400/[0.07] hover:bg-sky-400/[0.14] transition-colors"
      >
        <div className="text-[10px] text-sky-300/80 mb-0.5 font-medium">FXRP → Kinetic · Xaman</div>
        <div className="text-xs text-ink/80 leading-relaxed">“{e1Prompt}”</div>
      </button>
      <button
        onClick={() => onLaunch('e2', { amount: e2Amount })}
        className="w-full text-left px-3.5 py-2.5 rounded-xl border border-orange-400/25 bg-orange-400/[0.07] hover:bg-orange-400/[0.14] transition-colors"
      >
        <div className="text-[10px] text-orange-300/80 mb-0.5 font-medium">FLR → FTSO · EVM</div>
        <div className="text-xs text-ink/80 leading-relaxed">“{e2Prompt}”</div>
      </button>
    </div>
  );
}

function betaNoticeText(es: boolean): string {
  return es
    ? 'Entendido — tu estrategia está guardada en Estrategias · Guardadas. Ahora mismo no puedo ejecutar estrategias personalizadas: esta beta aún está construyendo esos raíles. Lo que SÍ puedo preparar hoy son estas dos estrategias listas — elige una y la dejo precargada para que la revises y la firmes tú:'
    : "Understood — your strategy is saved in Estrategias · Saved. I can't execute custom strategies yet: this beta is still wiring those rails. What I CAN prepare today are these two ready-made strategies — pick one and I'll pre-fill it for you to review and sign:";
}

/* ------------------------------------------------------------------ */
/* MY STRATEGY — saved drafts: edit · execute · delete                  */
/* ------------------------------------------------------------------ */

export function MyStrategyDrafts({
  onLaunch,
  onCreate,
}: {
  onLaunch: LaunchStrategy;
  /** Opens the agent. Omit it on surfaces that shouldn't offer creation —
   *  creating with the agent lives in Earn only, other pages just list. */
  onCreate?: () => void;
}) {
  const { t, lang } = useT();
  const es = lang === 'es';
  const user = useAuthStore((s) => s.user);
  const identity = profileIdentity(user) ?? 'anon';

  const [drafts, setDrafts] = useState<StrategyDraft[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [betaFor, setBetaFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<StrategyDraft | null>(null);

  const refresh = useCallback(() => setDrafts(listDrafts(identity)), [identity]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const execute = (d: StrategyDraft) => {
    if (d.kind === 'e1' || d.kind === 'e2') {
      onLaunch(d.kind, { amount: d.amount, ratio: d.ratio, targetHF: d.targetHF });
    } else {
      setBetaFor(betaFor === d.id ? null : d.id);
    }
  };

  if (drafts.length === 0) {
    return (
      <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-dashed border-ink/10 px-4 py-3">
        <p className="text-xs text-ink/40">
          {t('Strategies you create with the agent are saved here — editable and ready to run.')}
        </p>
        {onCreate && (
          <button
            onClick={onCreate}
            className="shrink-0 inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg border border-sky-400/30 bg-sky-400/10 text-sky-200 hover:bg-sky-400/20 transition-colors"
          >
            <Sparkles className="w-3 h-3" /> {t('Create with AI Agent')}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mb-5">
      <div className="text-[11px] text-ink/40 mb-2">{t('Created by you')}</div>
      <ul className="space-y-2">
        {drafts.map((d) => (
          <li key={d.id} className="rounded-xl border border-ink/[0.06] bg-ink/[0.02] px-4 py-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-ink/85 font-medium truncate">{d.name}</span>
                  <span
                    className={`text-[9px] px-1.5 py-0.5 rounded-full border shrink-0 ${
                      d.kind === 'custom'
                        ? 'border-ink/15 text-ink/45'
                        : 'border-emerald-500/25 text-emerald-300/80'
                    }`}
                  >
                    {d.kind === 'custom' ? t('Custom · beta') : t('Ready-made match')}
                  </span>
                </div>
                <div className="text-[10px] text-ink/35 mt-0.5 truncate">
                  {d.prompt || `${d.amount ?? ''} ${d.asset ?? ''}`}
                  {d.targetHF ? ` · HF ${d.targetHF}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => setEditing(d)}
                  className="p-1.5 rounded-lg text-ink/40 hover:text-ink hover:bg-ink/5 transition-colors"
                  title={t('Edit')}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => execute(d)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-volt text-volt-ink text-[11px] font-medium hover:brightness-95 transition-all"
                >
                  <Play className="w-3 h-3" /> {t('Run')}
                </button>
                {confirmDelete === d.id ? (
                  <span className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        deleteDraft(identity, d.id);
                        setConfirmDelete(null);
                        refresh();
                      }}
                      className="text-[10px] px-2 py-1 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 hover:bg-red-500/25 transition-colors"
                    >
                      {t('Delete?')}
                    </button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="p-1 text-ink/40 hover:text-ink"
                      aria-label={t('Cancel')}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(d.id)}
                    className="p-1.5 rounded-lg text-ink/40 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                    title={t('Delete')}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
            {betaFor === d.id && (
              <div className="mt-3 rounded-lg border border-ink/[0.07] bg-ink/[0.03] p-3">
                <p className="text-[11px] text-ink/55 leading-relaxed mb-1.5">{betaNoticeText(es)}</p>
                <ReadyPrompts draft={d} onLaunch={onLaunch} es={es} />
              </div>
            )}
          </li>
        ))}
      </ul>

      {editing && (
        <DraftEditorModal
          draft={editing}
          identity={identity}
          onLaunch={onLaunch}
          onClose={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Draft editor — parameters on the left, the agent on the right.       */
/* ------------------------------------------------------------------ */

function DraftEditorModal({
  draft,
  identity,
  onLaunch,
  onClose,
}: {
  draft: StrategyDraft;
  identity: string;
  onLaunch: LaunchStrategy;
  onClose: () => void;
}) {
  const { t } = useT();
  const [name, setName] = useState(draft.name);
  const [asset, setAsset] = useState(draft.asset ?? '');
  const [amount, setAmount] = useState(draft.amount ?? '');
  const [ratio, setRatio] = useState(draft.ratio ?? '');
  const [targetHF, setTargetHF] = useState(draft.targetHF ?? '');
  const [savedTick, setSavedTick] = useState(false);

  const save = () => {
    saveDraft(identity, {
      id: draft.id,
      name: name.trim() || draft.name,
      kind: inferDraftKind(asset),
      asset: asset.trim().toUpperCase() || undefined,
      amount: amount.trim() || undefined,
      ratio: ratio.trim() || undefined,
      targetHF: targetHF.trim() || undefined,
      prompt: draft.prompt,
    });
    setSavedTick(true);
    setTimeout(() => setSavedTick(false), 1500);
  };

  const field = 'w-full px-3.5 py-2.5 bg-ink/5 border border-ink/10 rounded-xl text-ink text-xs placeholder-ink/30 focus:outline-none focus:border-volt/50';

  return (
    <ModalOverlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-md my-auto" onClick={(e) => e.stopPropagation()}>
        <div className="rounded-2xl border border-ink/10 bg-surface-1 shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-ink/5">
            <h2 className="text-base font-semibold text-ink">{t('Edit strategy')}</h2>
            <button onClick={onClose} className="text-ink/40 hover:text-ink transition-colors" aria-label={t('Close')}>
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6">
            <div className="space-y-3.5">
              <div>
                <label className="text-[11px] text-ink/40 block mb-1.5">{t('Name')}</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className={field} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-ink/40 block mb-1.5">{t('Asset')}</label>
                  <input value={asset} onChange={(e) => setAsset(e.target.value)} placeholder="XRP / FLR…" className={field} />
                </div>
                <div>
                  <label className="text-[11px] text-ink/40 block mb-1.5">{t('Amount')}</label>
                  <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="25" className={field} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-ink/40 block mb-1.5">{t('Borrow ratio')}</label>
                  <input value={ratio} onChange={(e) => setRatio(e.target.value)} placeholder="0.30" className={field} />
                </div>
                <div>
                  <label className="text-[11px] text-ink/40 block mb-1.5">{t('Stop-loss HF')}</label>
                  <input value={targetHF} onChange={(e) => setTargetHF(e.target.value)} placeholder="1.10" className={field} />
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1.5">
                <button
                  onClick={save}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-volt text-volt-ink text-xs font-medium hover:brightness-95 transition-all"
                >
                  {savedTick ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                  {savedTick ? t('Saved') : t('Save changes')}
                </button>
                {(inferDraftKind(asset) === 'e1' || inferDraftKind(asset) === 'e2') && (
                  <button
                    onClick={() => {
                      save();
                      onLaunch(inferDraftKind(asset) as 'e1' | 'e2', {
                        amount: amount || undefined,
                        ratio: ratio || undefined,
                        targetHF: targetHF || undefined,
                      });
                      onClose();
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-ink/15 bg-ink/[0.05] text-ink/80 text-xs font-medium hover:bg-ink/10 transition-colors"
                  >
                    <Play className="w-3.5 h-3.5" /> {t('Run')}
                  </button>
                )}
              </div>
              <p className="text-[10px] text-ink/30 leading-relaxed">
                {t('Running opens the same review — nothing moves until you sign in your own wallet.')}
              </p>
            </div>
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}
