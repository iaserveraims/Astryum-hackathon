'use client';

/**
 * AnchorGateCard — la puerta del ancla v2 (DepositAuth + preauth por
 * credencial) en /app/admin → Sistema.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldCheck, ShieldOff } from 'lucide-react';
import { Card, GhostButton, MicroLabel, Pill } from '../ui/primitives';
import { adminAnchorGateApi, type AdminAnchorGateReport, type AdminAnchorGateStatus, type AdminGateSet } from '../../services/v1Api';

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

function typeLabel(hex: string): string {
  try {
    const bytes = hex.match(/.{1,2}/g) ?? [];
    const text = String.fromCharCode(...bytes.map((b) => parseInt(b, 16)));
    return /^[\x20-\x7E]+$/.test(text) ? text : hex;
  } catch {
    return hex;
  }
}

function setLabel(set: AdminGateSet): string {
  return set.map((c) => `${typeLabel(c.credentialTypeHex)} · ${short(c.issuer)}`).join('  +  ');
}

function Row({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <MicroLabel tone="muted">{label}</MicroLabel>
      <span className={`text-sm text-ink/80 text-right ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
    </div>
  );
}

export function AnchorGateCard({ session }: { session: string }) {
  const [status, setStatus] = useState<AdminAnchorGateStatus | null>(null);
  const [failed, setFailed] = useState<string>('');
  const [busy, setBusy] = useState<'arm-dry' | 'objects' | 'arm' | 'disarm' | null>(null);
  const [report, setReport] = useState<AdminAnchorGateReport | null>(null);
  const [error, setError] = useState('');
  const [confirmArm, setConfirmArm] = useState(false);

  const load = useCallback(() => {
    setFailed('');
    adminAnchorGateApi
      .status(session)
      .then(setStatus)
      .catch((e: Error & { status?: number }) => {
        setStatus(null);
        setFailed(e.status === 503 ? 'ASTRYUM_ORDER_ANCHOR sin definir en este entorno' : 'No se pudo leer la puerta del ancla');
      });
  }, [session]);
  useEffect(() => {
    load();
  }, [load]);

  async function run(kind: 'arm-dry' | 'objects' | 'arm' | 'disarm') {
    setBusy(kind);
    setError('');
    setReport(null);
    try {
      const r =
        kind === 'disarm'
          ? await adminAnchorGateApi.disarm(session, { dryRun: false })
          : await adminAnchorGateApi.arm(session, { dryRun: kind === 'arm-dry', objectsOnly: kind === 'objects' });
      setReport(r);
      setConfirmArm(false);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const state = status?.state;
  const armed = !!state?.depositAuth && (status?.drift.missing.length ?? 1) === 0;

  return (
    <Card>
      {failed ? (
        <p className="text-sm text-tone-warning">{failed}</p>
      ) : !status || !state ? (
        <p className="text-sm text-ink/50">Leyendo…</p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              {armed ? <ShieldCheck className="w-4 h-4 text-tone-success" /> : <ShieldOff className="w-4 h-4 text-ink/40" />}
              <Pill tone={state.depositAuth ? (armed ? 'success' : 'warning') : 'neutral'} size="sm">
                {state.depositAuth ? (armed ? 'PUERTA ENCENDIDA' : 'ENCENDIDA — faltan conjuntos') : 'APAGADA (BUILT, no LIVE)'}
              </Pill>
            </div>
            <div className="flex items-center gap-2">
              <GhostButton onClick={() => run('arm-dry')} disabled={busy != null} className="px-3 py-1.5 text-xs">
                {busy === 'arm-dry' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Plan (en seco)'}
              </GhostButton>
              <GhostButton
                onClick={() => run('objects')}
                disabled={busy != null || status.drift.missing.length === 0 || status.plan.shortfallXrp > 0 || !status.seed.configured || status.seed.matchesExpected === false}
                className="px-3 py-1.5 text-xs"
                aria-label="Fase 1: publicar los conjuntos sin encender el flag"
              >
                {busy === 'objects' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Fase 1: publicar conjuntos (sin flag)'}
              </GhostButton>
              {!confirmArm ? (
                <GhostButton
                  onClick={() => setConfirmArm(true)}
                  disabled={busy != null || status.plan.alreadyArmed || status.plan.shortfallXrp > 0 || !status.seed.configured || status.seed.matchesExpected === false}
                  className="px-3 py-1.5 text-xs"
                >
                  Fase 2: encender el flag…
                </GhostButton>
              ) : (
                <GhostButton onClick={() => run('arm')} disabled={busy != null} className="px-3 py-1.5 text-xs border-amber-500/40 text-tone-warning">
                  {busy === 'arm' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Confirmar: firmar y mandar'}
                </GhostButton>
              )}
              <GhostButton onClick={() => run('disarm')} disabled={busy != null || !state.depositAuth} className="px-3 py-1.5 text-xs">
                {busy === 'disarm' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Apagar el flag'}
              </GhostButton>
            </div>
          </div>

          <Row label="Ancla v2" value={state.anchor} mono />
          <Row label="lsfDepositAuth (account_info)" value={state.depositAuth ? 'SÍ — 0x01000000' : 'no'} />
          <Row label="Saldo / reserva del ledger" value={`${state.balanceXrp} XRP / ${state.ledgerReserveXrp} XRP (${state.ownerCount} objetos)`} />
          <Row label="Conjuntos que exige la config" value={`${status.configSets.length}`} />
          <Row label="Conjuntos publicados en el ancla" value={`${state.credentialSets.length}`} />
          {state.accounts.length > 0 && <Row label="Cuentas preautorizadas" value={state.accounts.map(short).join(', ')} mono />}
          <Row
            label="Deriva config ↔ ledger"
            value={
              status.drift.missing.length === 0 && status.drift.extra.length === 0
                ? 'ninguna'
                : `${status.drift.missing.length} faltan · ${status.drift.extra.length} sobran`
            }
          />
          <Row
            label="Plan"
            value={
              status.plan.alreadyArmed
                ? 'nada que hacer'
                : `${status.plan.toAuthorize.length} DepositPreauth${status.plan.setFlag ? ' + AccountSet{asfDepositAuth}' : ''} → reserva ${status.plan.reserveAfterXrp} XRP` +
                  (status.plan.shortfallXrp > 0 ? ` — FALTAN ${status.plan.shortfallXrp} XRP` : '')
            }
          />
          <Row
            label="Clave del ancla"
            value={
              !status.seed.configured
                ? 'NO CONFIGURADA (ASTRYUM_ANCHOR_SEED) — no se puede armar'
                : status.seed.error
                  ? `ILEGIBLE — ${status.seed.error}`
                  : status.seed.matchesExpected === false
                    ? `ABRE OTRA CUENTA (${status.seed.address})`
                    : 'OK — abre el ancla'
            }
          />
          {status.configError && !/SEED/.test(status.configError) && <p className="text-xs text-tone-warning">{status.configError}</p>}

          <div className="pt-1">
            <MicroLabel tone="muted">Conjuntos (cada uno = un objeto; el gestor lo sostiene entero o el consenso rechaza)</MicroLabel>
            <ul className="mt-1 space-y-0.5">
              {status.configSets.map((set) => {
                const key = set.map((c) => `${c.issuer}:${c.credentialTypeHex}`).sort().join(',');
                const published = state.credentialSets.some((s) => s.map((c) => `${c.issuer}:${c.credentialTypeHex}`).sort().join(',') === key);
                return (
                  <li key={key} className="flex items-center gap-2 text-xs font-mono text-ink/70">
                    <Pill tone={published ? 'success' : 'neutral'} size="sm">
                      {published ? 'en el ledger' : 'falta'}
                    </Pill>
                    {setLabel(set)}
                  </li>
                );
              })}
              {status.drift.extra.map((set) => (
                <li key={`extra-${setLabel(set)}`} className="flex items-center gap-2 text-xs font-mono text-ink/70">
                  <Pill tone="warning" size="sm">
                    sobra
                  </Pill>
                  {setLabel(set)}
                </li>
              ))}
            </ul>
          </div>

          {report && (
            <div className="rounded-lg border border-ink/10 p-2 text-xs space-y-1">
              <p className="font-semibold">
                {report.dryRun ? 'Plan (en seco, nada firmado)' : 'Mandado'}
                {report.stoppedBecause ? ` — parado: ${report.stoppedBecause}` : ''}
              </p>
              {report.dryRun && report.plan.toAuthorize.map((s) => <p key={setLabel(s)} className="font-mono">DepositPreauth {setLabel(s)}</p>)}
              {report.dryRun && report.plan.setFlag && <p className="font-mono">AccountSet SetFlag 9 (asfDepositAuth)</p>}
              {report.dryRun && report.plan.alreadyArmed && <p>Ya está como la config dice.</p>}
              {report.submitted.map((s) => (
                <p key={`${s.kind}-${s.label}`} className="font-mono">
                  {s.kind} {s.label} → {s.result} {s.hash ? `· ${s.hash}` : ''}
                </p>
              ))}
              {report.after && <p>Después: DepositAuth {report.after.depositAuth ? 'SÍ' : 'no'} · {report.after.credentialSets.length} conjuntos.</p>}
            </div>
          )}
          {error && <p className="text-xs text-tone-danger">{error}</p>}

          <p className="text-[11px] text-ink/45">
            Comprobación externa: {status.verify.accountInfo} · {status.verify.accountObjects}. Solo el ancla v2; la del Legacy no se arma (consejos sin
            título).
          </p>
        </div>
      )}
    </Card>
  );
}
