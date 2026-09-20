'use client';

/**
 * PartnerDesk — la mesa del PARTNER de KYC: su registro (`ExchangeKycRegistry`)
 * y sus clientes. El partner es el ADMIN de su propio contrato; Astryum ni
 * firma ni decide quién entra — compone el call y lo enseña.
 *
 * El circuito: el partner tiene (o despliega, en el ensayo) su registro → da de
 * alta clientes (`setApprovedWithTag`) → el gestor apunta su pote a ese registro
 * (`set-user-gate`, en su consola) → desde entonces el pote solo acepta
 * depósitos cuyo RECEIVER esté aprobado — lo aplica el contrato del pote, no
 * esta pantalla.
 *
 * En vivo firma el admin con su wallet EVM; en el ensayo, el actor activo de la
 * banda ejecuta la misma calldata en el fork.
 */

import { useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { Card, GhostButton, MicroLabel, PrimaryButton } from '../ui/primitives';
import { useT } from '../../i18n/LanguageProvider';
import { useWalletPartner } from '../../lib/wallet/useWalletPartner';
import { prepareKycRegister } from '../../lib/institutional/api';
import {
  DRY_RUN,
  activeDryRunActor,
  dryRunDeployKycRegistry,
  dryRunExecuteCalls,
  dryRunKycStatus,
} from '../../lib/dryRun';

const EVM_RE = /^0x[a-fA-F0-9]{40}$/;
const REGISTRY_KEY = 'astryum-partner-registry';

function savedRegistry(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(REGISTRY_KEY) ?? '';
  } catch {
    return '';
  }
}

export function PartnerDesk() {
  const { t } = useT();
  const evm = useWalletPartner();

  const [registry, setRegistry] = useState<string>(savedRegistry);
  const [user, setUser] = useState('');
  const [tag, setTag] = useState('0');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState<{ user: string; approved: boolean } | null>(null);

  function keepRegistry(addr: string) {
    setRegistry(addr);
    try {
      window.localStorage.setItem(REGISTRY_KEY, addr);
    } catch {
      /* sin memoria: se vuelve a pegar */
    }
  }

  async function deployDry() {
    const admin = activeDryRunActor();
    if (!admin) return setError(t('Pick an actor in the DRY RUN band (or connect a wallet).'));
    setBusy(true);
    setError('');
    const res = await dryRunDeployKycRegistry(admin);
    setBusy(false);
    if (!res.ok) return setError(`${res.error}${res.detail ? ` — ${res.detail}` : ''}`);
    keepRegistry(res.data.registry);
    setNotice(`${t('Registry deployed on the fork; you are its admin.')} ${res.data.registry}`);
  }

  async function register(approved: boolean) {
    setError('');
    setNotice('');
    setStatus(null);
    if (!EVM_RE.test(registry)) return setError(t('The registry must be an EVM address (0x…).'));
    if (!EVM_RE.test(user)) return setError(t('The client must be an EVM address (0x…) — the account that RECEIVES the shares.'));
    const n = Number(tag);
    if (!Number.isInteger(n) || n < 0 || n > 4294967295) return setError(t('The tag must be a 32-bit integer (0 … 4294967295).'));

    setBusy(true);
    try {
      const res = await prepareKycRegister({ registry, user, tag: n, approved });
      if (!res.ok) return setError(`${res.refusal.error}${res.refusal.detail ? ` — ${res.refusal.detail}` : ''}`);
      const call = res.data.call;
      const dryFrom = DRY_RUN && !evm.isConnected ? activeDryRunActor() : null;
      if (dryFrom) {
        const dr = await dryRunExecuteCalls(dryFrom, [call]);
        if (!dr.ok) return setError(`${dr.error}${dr.detail ? ` — ${dr.detail}` : ''}`);
        setNotice(approved ? t('Client approved on the fork.') : t('Client revoked on the fork.'));
      } else {
        if (!evm.isConnected) return setError(t('Connect the admin EVM wallet of this registry to sign.'));
        const { handle } = await evm.sendIntentCalls([{ to: call.to, data: call.data, value: call.value, chainId: call.chainId }]);
        void handle;
        setNotice(t('Sent to your wallet — the registry admin signs; Astryum never does.'));
      }
    } catch (e) {
      // La wallet dijo que no (o el cambio de red falló): se dice, no se traga.
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function check() {
    setError('');
    setStatus(null);
    if (!EVM_RE.test(registry) || !EVM_RE.test(user)) return setError(t('Registry and client must be EVM addresses (0x…).'));
    if (!DRY_RUN) return setError(t('The live check reads on-chain from the vault card; this button is for the dry run.'));
    setBusy(true);
    const res = await dryRunKycStatus(registry, user);
    setBusy(false);
    if (!res.ok) return setError(`${res.error}${res.detail ? ` — ${res.detail}` : ''}`);
    setStatus({ user, approved: res.data.approved });
  }

  return (
    <Card className="p-6">
      <MicroLabel>{t('KYC partner desk')}</MicroLabel>
      <div className="mt-3 flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-ink/35" strokeWidth={1.6} />
        <div className="min-w-0">
          <h3 className="text-base font-semibold tracking-tight text-ink">{t('Your registry, your clients')}</h3>
          <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-ink/55">
            {t('The partner is the admin of its own on-chain registry. A manager points a vault at it (entry gate) and from then on the vault itself refuses any deposit whose receiver you have not approved. Astryum composes the call and never signs it.')}
          </p>
        </div>
      </div>

      {notice ? <p className="mt-3 rounded-lg border border-ink/10 bg-ink/[0.02] p-2.5 text-[11px] leading-relaxed text-ink/60">{notice}</p> : null}
      {error ? <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2.5 text-[11px] leading-relaxed text-tone-warning">{error}</p> : null}

      <div className="mt-4 space-y-3">
        <label className="block text-[11px] text-ink/50">
          {t('Registry address (ExchangeKycRegistry)')}
          <input value={registry} onChange={(e) => keepRegistry(e.target.value.trim())} placeholder="0x…" className="mt-1 w-full rounded-md border border-ink/10 bg-ink/[0.03] text-ink placeholder:text-ink/30 focus:border-volt/40 focus:outline-none px-2 py-1.5 font-mono text-[12px]" />
        </label>
        {DRY_RUN && !registry ? (
          <GhostButton onClick={() => void deployDry()} disabled={busy}>
            {busy ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : null}
            {t('Deploy a rehearsal registry (dry run, you become admin)')}
          </GhostButton>
        ) : null}

        <div className="grid grid-cols-[1fr_auto] gap-1.5">
          <input value={user} onChange={(e) => setUser(e.target.value.trim())} placeholder={t('Client EVM account (receives the shares)')} className="rounded-md border border-ink/10 bg-ink/[0.03] text-ink placeholder:text-ink/30 focus:border-volt/40 focus:outline-none px-2 py-1.5 font-mono text-[12px]" />
          <input value={tag} onChange={(e) => setTag(e.target.value)} className="w-24 rounded-md border border-ink/10 bg-ink/[0.03] text-ink placeholder:text-ink/30 focus:border-volt/40 focus:outline-none px-2 py-1.5 font-mono text-[12px]" aria-label={t('XRPL destination tag')} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <PrimaryButton onClick={() => void register(true)} disabled={busy}>{t('Approve client')}</PrimaryButton>
          <GhostButton onClick={() => void register(false)} disabled={busy}>{t('Revoke')}</GhostButton>
          <GhostButton onClick={() => void check()} disabled={busy}>{t('Check status')}</GhostButton>
        </div>
        {status ? (
          <p className="text-[12px] text-ink/70">
            {status.user.slice(0, 8)}… {status.approved ? t('is approved in this registry.') : t('is NOT approved in this registry.')}
          </p>
        ) : null}
        <p className="text-[10px] leading-relaxed text-ink/40">
          {t('The XRPL credential («Verified by X») is a separate, XRPL-native label the manager accepts in their own account — it never gates deposits by itself and Astryum never issues it.')}
        </p>
      </div>
    </Card>
  );
}

export default PartnerDesk;
