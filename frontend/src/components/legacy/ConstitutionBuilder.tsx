'use client';

/**
 * ConstitutionBuilder — gallery → field form → preview → insert.
 *
 * Replaces the "here is a wall of text, go hunt the [BRACKETS]" flow: the user
 * picks a template that matches their situation, fills labelled FIELDS (with
 * help lines and sensible defaults), sees the assembled document live, and
 * inserts it into the constitution editor — where it stays fully editable.
 *
 * PRIVACY (the invariant this page exists to keep): everything here is
 * CLIENT-SIDE. The names, addresses and rules typed into these fields become a
 * local document; only its SHA-256 fingerprint is ever anchored. Nothing in
 * this component talks to any backend.
 */

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, FileText, Lock, ScrollText } from 'lucide-react';
import { GhostButton, MicroLabel, Pill, PrimaryButton } from '../ui/primitives';
import { useT } from '../../i18n/LanguageProvider';
import {
  CONSTITUTION_TEMPLATES,
  assembleConstitution,
  resolveDefault,
  type ConstitutionTemplate,
} from './constitutionTemplates';
import { getConstitutionDraft, saveConstitutionDraft } from './legacyLocal';

const inputCls =
  'mt-1 w-full rounded-lg border border-ink/10 bg-ink/5 px-3 py-2 text-sm outline-none focus:border-ink/25';

export default function ConstitutionBuilder({
  account,
  onUse,
  onClose,
}: {
  /** The Legacy account under inspection — prefills the {{cuenta}} field. */
  account: string | null;
  /** Receives the assembled document text (goes into the editable textarea). */
  onUse: (text: string) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  // Restore the draft on mount: typed work survives a refresh/deploy. The
  // helpers no-op under SSR/private mode, so the lazy initializers are safe.
  const [picked, setPicked] = useState<ConstitutionTemplate | null>(() => {
    const d = account ? getConstitutionDraft(account) : undefined;
    return d?.templateId
      ? CONSTITUTION_TEMPLATES.find((tpl) => tpl.id === d.templateId && tpl.available) ?? null
      : null;
  });
  const [values, setValues] = useState<Record<string, string>>(() => {
    const d = account ? getConstitutionDraft(account) : undefined;
    return d?.values ?? {};
  });

  useEffect(() => {
    if (!account || !picked) return;
    saveConstitutionDraft(account, { templateId: picked.id, values });
  }, [account, picked, values]);

  const pick = (tpl: ConstitutionTemplate) => {
    setPicked(tpl);
    const initial: Record<string, string> = {};
    for (const f of tpl.fields) initial[f.id] = resolveDefault(f, account);
    // Re-picking the template a draft was saved under resumes it (draft wins
    // over defaults); picking a different template starts clean.
    const draft = account ? getConstitutionDraft(account) : undefined;
    setValues(draft?.templateId === tpl.id && draft.values ? { ...initial, ...draft.values } : initial);
  };

  const assembled = useMemo(
    () => (picked ? assembleConstitution(picked, values) : ''),
    [picked, values],
  );
  const pendingCount = useMemo(
    () => (assembled.match(/\[PENDIENTE:/g) ?? []).length,
    [assembled],
  );

  // ── the gallery ──
  if (!picked) {
    return (
      <div className="space-y-2 rounded-xl border border-ink/10 bg-ink/[0.03] p-3">
        <div className="flex items-center justify-between">
          <MicroLabel>{t('Pick a starting point (never an imposition — you edit everything)')}</MicroLabel>
          <GhostButton onClick={onClose}>{t('Close')}</GhostButton>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {CONSTITUTION_TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => pick(tpl)}
              className={`rounded-xl border p-3 text-left transition ${
                tpl.available
                  ? 'border-ink/10 bg-ink/[0.02] hover:border-ink/25 hover:bg-ink/[0.05]'
                  : 'border-ink/5 bg-ink/[0.01] opacity-70 hover:opacity-100'
              }`}
            >
              <div className="flex items-center gap-2">
                {tpl.available ? (
                  <FileText size={14} className="shrink-0 text-ink/50" />
                ) : (
                  <Lock size={13} className="shrink-0 text-ink/35" />
                )}
                <span className="text-sm font-medium text-ink/90">{t(tpl.name)}</span>
                {!tpl.available && <Pill tone="neutral">{t('coming soon — preview')}</Pill>}
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-ink/55">{t(tpl.description)}</p>
              <p className="mt-1.5 text-[11px] text-ink/35">{t(tpl.recommendedCouncil)}</p>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── locked template: read-only preview, never a form (founder decision:
  //    only PERSONAL is usable at launch; the rest open one by one) ──
  if (!picked.available) {
    return (
      <div className="space-y-3 rounded-xl border border-ink/10 bg-ink/[0.03] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <GhostButton onClick={() => setPicked(null)}>
            <ArrowLeft size={14} /> {t('Templates')}
          </GhostButton>
          <span className="text-sm font-medium text-ink/90">{t(picked.name)}</span>
          <Pill tone="neutral">
            <Lock size={11} /> {t('coming soon — preview')}
          </Pill>
        </div>
        <p className="text-[12px] text-ink/55">{t(picked.description)}</p>
        <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-ink/10 bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-ink/50">
          {assembled}
        </pre>
        <p className="text-[11px] text-ink/40">
          {t('This template is a preview — it cannot be used yet. Constitute with the available template in the gallery.')}
        </p>
      </div>
    );
  }

  // ── the form + live preview ──
  return (
    <div className="space-y-3 rounded-xl border border-ink/10 bg-ink/[0.03] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <GhostButton onClick={() => setPicked(null)}>
          <ArrowLeft size={14} /> {t('Templates')}
        </GhostButton>
        <span className="text-sm font-medium text-ink/90">{t(picked.name)}</span>
        <Pill tone={pendingCount === 0 ? 'success' : 'warning'}>
          {pendingCount === 0 ? t('complete') : `${pendingCount} ${t('fields pending')}`}
        </Pill>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {picked.fields.map((f) => (
          <label key={f.id} className={f.type === 'multiline' ? 'sm:col-span-2' : ''}>
            <MicroLabel>{t(f.label)}</MicroLabel>
            {f.type === 'multiline' ? (
              <textarea
                value={values[f.id] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                rows={3}
                spellCheck={false}
                placeholder={f.placeholder}
                className={`${inputCls} font-mono text-[12px]`}
              />
            ) : (
              <input
                type={f.type === 'date' ? 'date' : 'text'}
                inputMode={f.type === 'number' || f.type === 'percent' ? 'numeric' : undefined}
                value={values[f.id] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                spellCheck={false}
                placeholder={f.placeholder}
                className={inputCls}
              />
            )}
            {f.help && <span className="mt-1 block text-[11px] text-ink/40">{t(f.help)}</span>}
          </label>
        ))}
      </div>

      {/* Live preview — the exact text that will be hashed (after your edits). */}
      <div>
        <MicroLabel>{t('Preview — the document as it will read')}</MicroLabel>
        <pre className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-ink/10 bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-ink/70">
          {assembled}
        </pre>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <PrimaryButton onClick={() => onUse(assembled)}>
          <ScrollText size={14} /> {t('Insert into the document editor')}
        </PrimaryButton>
        {pendingCount > 0 && (
          <span className="text-[11px] text-tone-warning">
            {t('Pending fields are marked [PENDIENTE] in the text — fill them here or edit them there.')}
          </span>
        )}
        {pendingCount === 0 && (
          <span className="flex items-center gap-1 text-[11px] text-tone-success">
            <Check size={12} /> {t('Everything filled — review the preview, then insert.')}
          </span>
        )}
      </div>

      <p className="text-[10px] leading-relaxed text-ink/35">
        {t(
          'Everything on this form stays in your browser: the document is assembled and fingerprinted locally, and only its SHA-256 fingerprint is anchored on the ledger.',
        )}{' '}
        {t('Your draft auto-saves in this browser — a refresh will not lose it.')}
      </p>
    </div>
  );
}
