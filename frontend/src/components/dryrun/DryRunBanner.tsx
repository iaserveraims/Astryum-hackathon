'use client';

/**
 * DryRunBanner — la banda del ensayo: dice EN GRANDE que nada de esto es real,
 * enseña el reparto de papeles del fork y deja elegir «quién firma» (el actor
 * activo que usan los botones «Ejecutar en seco»). Solo se monta con
 * NEXT_PUBLIC_DRY_RUN=true; si el backend no tiene el módulo, lo dice tal cual.
 */

import { useCallback, useEffect, useState } from 'react';
import { FlaskConical, Loader2, RefreshCw } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import {
  DRY_RUN,
  activeDryRunActor,
  dryRunActors,
  dryRunFund,
  setActiveDryRunActor,
  type DryRunActor,
} from '../../lib/dryRun';

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const fxrpHuman = (base: string | null) => (base === null ? '—' : (Number(base) / 1e6).toLocaleString());

export function DryRunBanner() {
  const { t } = useT();
  const [actors, setActors] = useState<DryRunActor[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    const res = await dryRunActors();
    if (res.ok) {
      setActors(res.data.actors);
      setError(null);
    } else {
      setActors(null);
      setError(`${res.error}${res.detail ? ` — ${res.detail}` : ''}`);
    }
  }, []);

  useEffect(() => {
    if (!DRY_RUN) return;
    setActive(activeDryRunActor());
    void load();
  }, [load]);

  if (!DRY_RUN) return null;

  async function fund(address: string) {
    setBusy(address);
    await dryRunFund(address, '100000000'); // 100 FXRP del whale del fork
    setBusy('');
    void load();
  }

  return (
    <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-4">
      <p className="flex items-center gap-2 text-[13px] font-semibold text-tone-warning">
        <FlaskConical size={15} />
        {t('DRY RUN — a local fork. Nothing here is real: no capital, no signatures, no chain.')}
        <button onClick={() => void load()} className="ml-auto text-ink/40 hover:text-ink" aria-label={t('Refresh')}>
          <RefreshCw size={13} />
        </button>
      </p>

      {error ? (
        <p className="text-[11px] leading-relaxed text-ink/55">
          {t('The rehearsal backend is not answering')} ({error}). {t('Start it with')}{' '}
          <code className="font-mono">bash scripts/dry-run/start.sh</code> {t('and the env it prints.')}
        </p>
      ) : actors === null ? (
        <p className="flex items-center gap-2 text-[11px] text-ink/45"><Loader2 size={12} className="animate-spin" /> {t('Reading the cast…')}</p>
      ) : (
        <>
          <p className="text-[11px] text-ink/50">{t('Acting as (the "Run dry" buttons sign as this actor):')}</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {actors.map((a) => (
              <label key={a.address} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-[11px] ${active === a.address ? 'border-volt/50 bg-volt/[0.06]' : 'border-white/10'}`}>
                <input
                  type="radio"
                  checked={active === a.address}
                  onChange={() => { setActiveDryRunActor(a.address); setActive(a.address); }}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="font-medium text-ink/80">{a.role}</span>{' '}
                  <span className="font-mono text-ink/45">{short(a.address)}</span>
                  <span className="block text-ink/45">{a.note}</span>
                  <span className="block font-mono text-ink/55">{fxrpHuman(a.fxrp)} FXRP</span>
                </span>
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); void fund(a.address); }}
                  disabled={busy === a.address}
                  className="ml-auto shrink-0 rounded-md border border-white/10 px-2 py-1 text-[10px] text-ink/60 hover:text-ink disabled:opacity-40"
                >
                  {busy === a.address ? '…' : t('+100 FXRP')}
                </button>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
