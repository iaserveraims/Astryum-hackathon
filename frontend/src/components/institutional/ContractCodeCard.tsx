'use client';

/**
 * ContractCodeCard — muestra el código de un contrato (real) con qué permite y
 * qué NO, al exchange y al user. Es la pieza «que el code esté visible con
 * explicación»: el espectador lee el Solidity y ve por qué la garantía es
 * verdad, no una promesa.
 */

import { useState } from 'react';
import { ChevronDown, Code2, FileCode } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { contractDoc } from '../../lib/institutional/contractDocs';

export function ContractCodeCard({ contractKey, defaultOpen = false }: { contractKey: string; defaultOpen?: boolean }) {
  const { t } = useT();
  const doc = contractDoc(contractKey);
  const [open, setOpen] = useState(defaultOpen);
  const [ruleOpen, setRuleOpen] = useState(0);
  if (!doc) return null;

  return (
    <div className="rounded-2xl border border-ink/10 bg-surface-1 overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-4 py-3 text-left">
        <span className="flex items-center gap-2">
          <FileCode className="w-4 h-4 text-volt" />
          <span className="text-sm font-semibold text-ink">{doc.name}</span>
          <code className="text-[10px] text-ink/40">{doc.file}</code>
        </span>
        <ChevronDown className={`w-4 h-4 text-ink/40 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-ink/10 pt-3">
          <p className="text-xs text-ink/60">{t(doc.summary)}</p>

          {doc.rules.map((rule, i) => (
            <div key={rule.title} className="rounded-lg border border-ink/10 bg-surface-2 overflow-hidden">
              <button
                onClick={() => setRuleOpen(ruleOpen === i ? -1 : i)}
                className="w-full flex items-center justify-between px-3 py-2 text-left"
              >
                <span className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                  <Code2 className="w-3 h-3 text-ink/40" /> {t(rule.title)}
                </span>
                <ChevronDown className={`w-3.5 h-3.5 text-ink/40 transition-transform ${ruleOpen === i ? 'rotate-180' : ''}`} />
              </button>
              {ruleOpen === i && (
                <div className="px-3 pb-3 space-y-2">
                  <pre className="overflow-x-auto rounded-md bg-ink/[0.06] p-3 text-[11px] leading-relaxed text-ink font-mono whitespace-pre">
                    {rule.code}
                  </pre>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded-md border p-2" style={{ borderColor: 'var(--authority, #A76A15)55' }}>
                      <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--authority, #A76A15)' }}>
                        {t('Exchange')}
                      </div>
                      <p className="text-[11px] text-ink/70 mt-0.5">{t(rule.plainExchange)}</p>
                    </div>
                    <div className="rounded-md border p-2" style={{ borderColor: 'var(--muscle, #1F6F70)55' }}>
                      <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muscle, #1F6F70)' }}>
                        {t('User')}
                      </div>
                      <p className="text-[11px] text-ink/70 mt-0.5">{t(rule.plainUser)}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
