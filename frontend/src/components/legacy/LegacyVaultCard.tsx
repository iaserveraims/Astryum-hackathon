'use client';

/**
 * LegacyVaultCard — la jaula, contada como lo que es: patrimonio del consejo.
 *
 * El agujero que cierra (fundador, 2026-07-29): el capital del consejo vive en
 * un CONTRATO, no en una wallet, así que no aparecía en ningún inventario. La
 * familia había fondeado 4,69 FXRP y la app no los enseñaba en ninguna parte —
 * existían solo en la cadena. Dinero real, invisible.
 *
 * Así que el vault se lista junto a las wallets del Legacy, con el mismo
 * lenguaje visual, pero SIN fingir que es una wallet: una wallet es algo de
 * donde puedes sacar. De aquí no. La tarjeta enseña el saldo desglosado
 * (ocioso / trabajando / yield debido) y dice en su cara que el principal no
 * sale — porque un inventario que sugiere liquidez que no existe es peor que
 * no tener inventario.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Copy, ExternalLink, Landmark, Loader2, Lock, RefreshCw } from 'lucide-react';
import { Card, GhostButton, MicroLabel, Pill } from '../ui/primitives';
import { TokenLogo } from '../ui/TokenLogo';
import CageBirthCard from './CageBirthCard';
import { InlineNotice } from './InlineNotice';
import { useT } from '../../i18n/LanguageProvider';
import { displayBaseUnits, formatBaseUnits } from '../../lib/legacy/baseUnits';
import { xrplLegacy, type LegacyVaultState } from '../../services/v1Api';

const FLARE_EXPLORER = 'https://flare-explorer.flare.network/address/';

/**
 * `account` is THIS Legacy. The card used to read "the" vault from the backend
 * env, so every Legacy in the install was shown the same cage — the first one
 * deployed — as if it were its own patrimony (founder, 2026-08-05). A cage
 * belongs to exactly one council: the bridge writes its address in at birth and
 * it can never change. So a Legacy either has one, or is told plainly that it
 * does not.
 */
export default function LegacyVaultCard({ account }: { account: string }) {
  const { t } = useT();
  const [state, setState] = useState<LegacyVaultState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noCage, setNoCage] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNoCage(false);
    try {
      setState(await xrplLegacy.vaultState(account));
    } catch (err) {
      const body = (err as { body?: { error?: string; detail?: string } })?.body;
      if (body?.error === 'NO_CAGE_FOR_LEGACY') {
        setState(null);
        setNoCage(true);
      } else {
        setError(body?.detail ?? (err as Error)?.message ?? t('Could not read the vault.'));
      }
    } finally {
      setLoading(false);
    }
  }, [account, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !state) {
    return (
      <Card className="p-4">
        <p className="flex items-center gap-2 text-sm text-ink/50">
          <Loader2 size={14} className="animate-spin" /> {t('Reading the vault on Flare…')}
        </p>
      </Card>
    );
  }
  if (error && !state) {
    return (
      <Card className="p-4 space-y-2">
        <InlineNotice tone="warning">{error}</InlineNotice>
        <GhostButton onClick={() => void load()}>
          <RefreshCw size={14} /> {t('Try again')}
        </GhostButton>
      </Card>
    );
  }
  // Sin jaula NO es un error ni un hueco: es el estado normal de un Legacy que
  // aún no tiene una — y desde aquí el quórum crea LA SUYA con una firma
  // (factory vía 0xFE; nadie más puede crearla). El consejo ya gobierna sin
  // ella; lo que no puede es heredar la de otro.
  if (noCage) {
    return (
      <Card className="p-4">
        <CageBirthCard account={account} onBorn={() => void load()} />
      </Card>
    );
  }
  if (!state) return null;

  const dec = state.asset.decimals;
  const sym = state.asset.symbol;
  const working = state.venues.reduce((s, v) => s + BigInt(v.value), BigInt(0));
  const total = BigInt(state.idlePrincipal) + working;

  return (
    <Card className="p-4 space-y-3">
      {/* Identidad — igual que una wallet card, pero con su naturaleza dicha. */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[15px] font-semibold text-ink">
            <Landmark size={15} className="text-[var(--authority-solid)]" />
            {t('The cage')}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] text-ink/45">
            {state.vault.slice(0, 10)}…{state.vault.slice(-8)}
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(state.vault).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
              className="text-ink/30 hover:text-ink/70"
              aria-label={t('Copy address')}
            >
              <Copy size={11} />
            </button>
            {copied && <span className="text-tone-success">{t('copied')}</span>}
            <a
              href={`${FLARE_EXPLORER}${state.vault}`}
              target="_blank"
              rel="noreferrer"
              className="text-ink/30 hover:text-ink/70"
            >
              <ExternalLink size={11} />
            </a>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Pill tone="neutral">{t('contract')}</Pill>
          <GhostButton onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          </GhostButton>
        </div>
      </div>

      {/* El número que faltaba en toda la app. */}
      <div>
        <MicroLabel>{t('Capital held here')}</MicroLabel>
        <p className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-ink">
          {/* The cage holds FXRP; `symbol` is read live, so fall back the same
              way GovernedMoneyFlows does rather than paint an empty coin. */}
          <TokenLogo symbol={sym || 'FXRP'} size="md" />
          {displayBaseUnits(total.toString(), dec)} <span className="text-base text-ink/50">{sym}</span>
        </p>
      </div>

      {/* Dónde está exactamente, que no es lo mismo que cuánto hay. */}
      <div className="space-y-1.5 rounded-xl border border-ink/10 bg-ink/[0.03] p-3">
        <div className="flex items-center justify-between gap-3 text-[13px]">
          <span className="text-ink/55">{t('Idle in the vault')}</span>
          <span className="text-ink/85">
            {formatBaseUnits(state.idlePrincipal, dec)} {sym}
          </span>
        </div>
        {state.venues.map((v) => (
          <div key={v.id} className="space-y-0.5">
            <div className="flex items-center justify-between gap-3 text-[13px]">
              <span className="text-ink/55">
                {t('Working in')} {v.targetSymbol ?? `${t('venue')} #${v.id}`}
                {v.retired && <span className="ml-1 text-tone-warning">({t('retired')})</span>}
              </span>
              <span className="text-ink/85">
                {formatBaseUnits(v.value, dec)} {sym}
              </span>
            </div>
            {/* La dirección del contrato donde está el dinero, comprobable por
                cualquiera, y lo que ese protocolo dice que tenemos — que es
                distinto de lo que dice nuestro propio vault. */}
            <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-ink/35">
              <a
                href={`${FLARE_EXPLORER}${v.target}`}
                target="_blank"
                rel="noreferrer"
                className="hover:text-ink/60"
              >
                {v.target.slice(0, 10)}…{v.target.slice(-6)} <ExternalLink size={9} className="inline" />
              </a>
              <span className="text-ink/20">·</span>
              <span>
                {v.shares === null
                  ? t('shares unreadable')
                  : BigInt(v.shares) > BigInt(0)
                    ? `${t('the protocol confirms our position')} ✓`
                    : t('no position at the protocol yet')}
              </span>
            </div>
          </div>
        ))}
        {BigInt(state.totalClaimable) > BigInt(0) && (
          <div className="flex items-center justify-between gap-3 border-t border-ink/5 pt-1.5 text-[13px]">
            <span className="text-tone-success/80">{t('Yield owed to the payees')}</span>
            <span className="text-tone-success">
              {formatBaseUnits(state.totalClaimable, dec)} {sym}
            </span>
          </div>
        )}
      </div>

      {/* Dinero que entró mal: ni es principal ni lo puede reclamar nadie. */}
      {BigInt(state.strayAssets) > BigInt(0) && (
        <InlineNotice tone="warning">
          {t('There are')} {formatBaseUnits(state.strayAssets, dec)} {sym}{' '}
          {t(
            'sitting in the contract that were transferred directly instead of deposited. They never became principal, so they fund nothing and nobody can claim them.',
          )}
        </InlineNotice>
      )}

      {state.migrated && (
        <InlineNotice tone="warning">
          {t('This vault has migrated to a successor — it accepts no new principal.')}
        </InlineNotice>
      )}

      {/* La razón por la que esto NO es una wallet. */}
      <p className="flex items-start gap-2 text-[11px] leading-relaxed text-ink/45">
        <Lock size={12} className="mt-0.5 shrink-0" />
        {t(
          'This is the council\'s capital, but it is not a wallet: there is no function that pays this principal out to any address. It can work in the whitelisted venues, come back idle to the vault, or migrate to a verified successor. Only the yield it earns can ever be paid to a person.',
        )}
      </p>
      {error && (
        <p className="flex items-start gap-2 text-[11px] text-tone-warning">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}
    </Card>
  );
}
