'use client';

/**
 * VenueRegistryCard — el gobierno del SCANNER de Astryum (AstryumRegistry).
 *
 * X1 de la revisión: el registro es la whitelist on-chain que todo pote
 * v2 consulta en `_addVenue` — con el registro vacío, todo pote nace con CERO
 * destinos. Esta card lo lee entero y COMPONE las escrituras del governor:
 * proponer (entra tras el timelock), activar (cualquiera, cuando madura) y
 * retirar (inmediata; solo bloquea capital nuevo). Astryum no firma nada — la
 * llamada compuesta la firma el GOVERNOR con su wallet EVM (o el actor del
 * fork en el dry run, como en PartnerDesk).
 *
 * Filtro técnico uniforme, jamás recomendación (invariante #9): aquí se lista
 * qué pasó el scanner, no qué «conviene».
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, PlusCircle, ShieldCheck, Trash2, Zap } from 'lucide-react';
import { Card, GhostButton, MicroLabel } from '../ui/primitives';
import { TokenLogo } from '../ui/TokenLogo';
import { venueIdentity } from '../../lib/institutional/venueIdentity';
import { useT } from '../../i18n/LanguageProvider';
import { useWalletPartner } from '../../lib/wallet/useWalletPartner';
import { DRY_RUN, activeDryRunActor, dryRunExecuteCalls } from '../../lib/dryRun';
import {
  prepareVenueActivate,
  prepareVenuePropose,
  prepareVenueRemove,
  readVenueRegistry,
  type PreparedEvmCall,
  type VenueRegistryState,
} from '../../lib/institutional/api';

const EVM_RE = /^0x[a-fA-F0-9]{40}$/;
const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

export function VenueRegistryCard() {
  const { t } = useT();
  const evm = useWalletPartner();

  const [state, setState] = useState<VenueRegistryState | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [target, setTarget] = useState('');
  const [kind, setKind] = useState('compoundv2');

  const load = useCallback(() => {
    readVenueRegistry()
      .then((s) => { setState(s); setFailed(false); })
      .catch(() => { setState(null); setFailed(true); });
  }, []);
  useEffect(() => { load(); }, [load]);

  /** Compone → firma (governor en su wallet, o el actor del fork) → relee. */
  async function run(prep: Promise<{ ok: true; data: PreparedEvmCall } | { ok: false; refusal: { error: string; detail?: string } }>, doneMsg: string) {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const res = await prep;
      if (!res.ok) return setError(`${res.refusal.error}${res.refusal.detail ? ` — ${res.refusal.detail}` : ''}`);
      const call = res.data.call;
      const dryFrom = DRY_RUN && !evm.isConnected ? activeDryRunActor() : null;
      if (dryFrom) {
        const dr = await dryRunExecuteCalls(dryFrom, [call]);
        if (!dr.ok) return setError(`${dr.error}${dr.detail ? ` — ${dr.detail}` : ''}`);
        setNotice(`${doneMsg} ${t('(on the fork)')}`);
      } else {
        if (!evm.isConnected) return setError(t('Connect the GOVERNOR wallet of the registry to sign.'));
        await evm.sendIntentCalls([{ to: call.to, data: call.data, value: call.value, chainId: call.chainId }]);
        setNotice(doneMsg);
      }
      setTimeout(load, 2500);
    } finally {
      setBusy(false);
    }
  }

  const now = Math.floor(Date.now() / 1000);

  return (
    <Card className="p-6">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-ink/35" strokeWidth={1.6} />
        <div className="min-w-0 flex-1">
          <MicroLabel>{t('Astryum venue registry (the scanner)')}</MicroLabel>
          <p className="mt-2 max-w-[66ch] text-[13px] leading-relaxed text-ink/55">
            {t('The on-chain whitelist every v2 pote consults. Empty registry = every pote is born with zero destinations. Proposals wait out the timelock; removal is immediate and only blocks NEW capital. The governor signs — Astryum never does.')}
          </p>

          {failed ? (
            <p className="mt-3 text-[12px] text-tone-warning/80">
              {t('The registry could not be read right now — that is not the same as it being empty.')}
            </p>
          ) : !state ? (
            <p className="mt-3 flex items-center gap-2 text-[12px] text-ink/45">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('Reading the registry from the chain…')}
            </p>
          ) : (
            <>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-ink/50">
                <span>{t('Registry')}: <span className="font-mono text-ink/70">{short(state.registry)}</span></span>
                <span>{t('Governor')}: <span className="font-mono text-ink/70">{short(state.governor)}</span></span>
                <span>{t('Timelock')}: <span className="font-mono text-ink/70">{Math.round(state.timelockSeconds / 3600)} h</span></span>
              </div>

              {state.venues.length === 0 ? (
                <p className="mt-3 text-[12px] font-medium text-tone-warning">
                  {t('The registry is EMPTY: no pote can add a single venue until an entry is proposed, matured and activated.')}
                </p>
              ) : (
                <ul className="mt-3 space-y-1.5">
                  {state.venues.map((v) => (
                    <li key={`${v.chainId}:${v.target}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 px-2.5 py-1.5">
                      {(() => { const id = venueIdentity(v.target); return id.asset ? <TokenLogo symbol={id.asset} size="xs" /> : null; })()}
                      {(() => {
                        const id = venueIdentity(v.target);
                        return id.known ? (
                          <span className="text-[12px] font-medium text-ink/80">{id.name}<span className="text-ink/45"> · {id.product}</span></span>
                        ) : null;
                      })()}
                      <span className="font-mono text-[11px] text-ink/55">{short(v.target)}</span>
                      <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-ink/50">{v.kind}</span>
                      <span className="text-[10px] text-ink/40">chain {v.chainId}</span>
                      <span className={`text-[10px] font-medium ${v.status === 'active' ? 'text-emerald-500/80' : v.status === 'pending' ? 'text-tone-warning' : 'text-ink/40'}`}>
                        {v.status === 'active' ? t('active') : v.status === 'pending' ? `${t('pending')} · ${v.activeAt > now ? new Date(v.activeAt * 1000).toLocaleString() : t('ripe — can be activated')}` : t('removed')}
                      </span>
                      <span className="ml-auto flex gap-1.5">
                        {v.status === 'pending' && v.activeAt <= now ? (
                          <GhostButton onClick={() => void run(prepareVenueActivate({ target: v.target, chainId: v.chainId }), t('Activation sent.'))} disabled={busy}>
                            <Zap className="mr-1 inline h-3 w-3" /> {t('Activate')}
                          </GhostButton>
                        ) : null}
                        {v.status !== 'removed' ? (
                          <GhostButton onClick={() => void run(prepareVenueRemove({ target: v.target, chainId: v.chainId }), t('Removal sent — immediate.'))} disabled={busy}>
                            <Trash2 className="mr-1 inline h-3 w-3" /> {t('Remove')}
                          </GhostButton>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {/* Proponer: entra en vigor tras el timelock + activación. */}
              <div className="mt-4 rounded-lg border border-white/10 p-3">
                <p className="text-[11px] font-medium text-ink/70">{t('Propose a venue (governor signs; enters after the timelock)')}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <input
                    value={target}
                    onChange={(e) => setTarget(e.target.value.trim())}
                    placeholder="0x… (Kinetic kFXRP, Firelight…)"
                    className="w-72 rounded-md bg-white/5 px-2 py-1.5 font-mono text-[12px]"
                  />
                  <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-md bg-white/5 px-2 py-1.5 text-[12px]">
                    <option value="erc4626">ERC-4626</option>
                    <option value="compoundv2">CompoundV2 (Kinetic ISO)</option>
                    <option value="erc4626queued">ERC-4626 {t('with exit queue')} (Firelight)</option>
                  </select>
                  <GhostButton
                    onClick={() => {
                      if (!EVM_RE.test(target)) return setError(t('The venue target must be an EVM address (0x…).'));
                      void run(prepareVenuePropose({ target, kind }), t('Proposal sent — it matures with the timelock.'));
                    }}
                    disabled={busy}
                  >
                    <PlusCircle className="mr-1 inline h-3.5 w-3.5" /> {t('Propose')}
                  </GhostButton>
                </div>
              </div>
            </>
          )}

          {notice ? <p className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-2.5 text-[11px] text-ink/60">{notice}</p> : null}
          {error ? <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2.5 text-[11px] text-tone-warning">{error}</p> : null}
        </div>
      </div>
    </Card>
  );
}

export default VenueRegistryCard;
