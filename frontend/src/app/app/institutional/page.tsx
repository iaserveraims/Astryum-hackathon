'use client';

/**
 * /app/institutional — the demo surface of the institutional rail (Fase 0).
 *
 * Three lenses on the SAME primitive, matching the five scenes:
 *  - Client: choose a policy (exit speed at decision time), deposit, exit.
 *  - My exits: the tickets with their day-scale clock (F3).
 *  - Operator: the director's console — and the DENIED panel (scene 4).
 *
 * Gated by NEXT_PUBLIC_INSTITUTIONAL_ENABLED (#10 — ships OFF). We play the
 * operator in the demo and the page says so: no exchange uses this yet.
 */

import { useState } from 'react';
import { useT } from '../../../i18n/LanguageProvider';
import { PreviewOnly } from '../../../components/ui/PreviewOnly';
import { PoliciesCatalog } from '../../../components/institutional/PoliciesCatalog';
import { TicketsBoard } from '../../../components/institutional/TicketsBoard';
import { OperatorConsole } from '../../../components/institutional/OperatorConsole';
import { useCatalogPolicies } from '../../../lib/institutional/useCatalogPolicies';
import { PoteExitCard } from '../../../components/institutional/user/PoteExitCard';
import { CageConsole } from '../../../components/institutional/CageConsole';
import { CredentialTray } from '../../../components/institutional/CredentialTray';
import { useXrplWalletPartner } from '../../../lib/wallet/useXrplWalletPartner';
import { XamanSignBlockedNote, XamanSignBlockScope } from '../../../components/xrpl/XamanSingleSign';

const ENABLED = process.env.NEXT_PUBLIC_INSTITUTIONAL_ENABLED === 'true';

type Lens = 'client' | 'exits' | 'operator';

export default function InstitutionalPage() {
  const { t } = useT();

  if (!ENABLED) {
    return (
      <div className="p-6">
        <p className="text-sm text-ink/60">{t('The institutional module is not enabled on this environment.')}</p>
      </div>
    );
  }

  // Gate de admin (28-ago, cerrado 8-sep): esta página monta la consola de la
  // JAULA v2 (gobierno completo) y con la flag sola entraba cualquier usuario
  // logueado que tecleara la URL — con capital real detrás en mainnet. Durante
  // la ventana de demo va tras PreviewOnly (fail-closed, veredicto de servidor);
  // publicar = borrar el envoltorio, como manda la doctrina.
  return (
    <PreviewOnly label="Potes institucionales" pending="rodaje 13-sep">
      <InstitutionalLenses />
    </PreviewOnly>
  );
}

function InstitutionalLenses() {
  const { t } = useT();
  const [lens, setLens] = useState<Lens>('client');
  // El catálogo, de la cadena (v1 + jaulas v2); por env solo mientras se lee o si falla.
  const { policies } = useCatalogPolicies();
  // La cuenta XRPL conectada: quien firma la salida del modo no-custodial.
  const { address: xrplAddress } = useXrplWalletPartner();
  // A Xaman signature of the operator lens (CageConsole / CredentialTray) can no
  // longer be dropped: switching lens would unmount it (productizer-it7). The
  // scope below hears every XamanSingleSign inside the lens.
  const [lensBlocked, setLensBlocked] = useState(false);

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold text-ink">{t('Institutional potes')}</h1>
        <p className="text-xs text-ink/60">
          {t('The manager can work the capital; it can never decide whether you may leave.')}{' '}
          {t('Demo: Astryum plays the operator — no exchange uses this yet.')}
        </p>
      </header>

      <nav className="flex gap-2">
        {(
          [
            ['client', t('Client')],
            ['exits', t('My exits')],
            ['operator', t('Operator')],
          ] as Array<[Lens, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            disabled={lensBlocked && lens !== key}
            onClick={() => { if (!lensBlocked) setLens(key); }}
            className={`rounded-full px-3 py-1 text-xs font-semibold border disabled:cursor-not-allowed disabled:opacity-40 ${
              lens === key ? 'border-volt text-volt' : 'border-ink/10 text-ink/60'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>
      {lensBlocked ? (
        <div className="-mt-3 space-y-0.5">
          <p className="text-[11px] leading-relaxed text-tone-warning">
            {t('The other lenses stay closed until this signature is resolved.')}
          </p>
          <XamanSignBlockedNote />
        </div>
      ) : null}

      {lens === 'client' ? <PoliciesCatalog /> : null}

      {lens === 'exits' ? (
        <div className="space-y-6">
          {/* La salida directa a XRP: quien entró con su cuenta XRPL sale por
              ahí mismo, en una firma. Solo aparece cuando hay una cuenta Xaman
              conectada — sin ella no hay nada que preparar, y una tarjeta que
              pide firmar sin saber quién firma es una promesa vacía. */}
          {xrplAddress ? (
            policies.map((p) =>
              p.poteAddress ? (
                <PoteExitCard key={`exit-${p.key}`} pote={p.poteAddress} account={xrplAddress} />
              ) : null,
            )
          ) : (
            <p className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-[11px] leading-relaxed text-ink/50">
              {t('Connect your XRPL account (Xaman) to take capital back out to XRP in one signature.')}
            </p>
          )}

          {policies.map((p) => (
            <TicketsBoard key={p.key} policy={p} />
          ))}
          <p className="text-[11px] text-ink/40">
            {t('An exit that shows no clock here may simply not be readable right now — “could not read” is never “you have nothing”.')}
          </p>
        </div>
      ) : null}

      {lens === 'operator' ? (
        <XamanSignBlockScope onBlockedChange={setLensBlocked}>
        <div className="space-y-8">
          {/* La jaula v2: nace, abre potes y dirige — todo desde la cuenta XRPL
              conectada. Sin ella no hay nada que preparar. */}
          {xrplAddress ? (
            <>
              {/* El título del gestor vive en SU cuenta XRPL: la bandeja donde
                  acepta lo que un emisor le concedió. Astryum no emite. */}
              <CredentialTray account={xrplAddress} />
              <CageConsole account={xrplAddress} />
            </>
          ) : (
            <p className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-[11px] leading-relaxed text-ink/50">
              {t('Connect your XRPL account (Xaman) to birth your cage, open potes and direct capital.')}
            </p>
          )}

          {/* La consola vieja (órdenes de consejo a un pote suelto) solo para la
              v1: las órdenes de un pote de jaula se componen en la CageConsole
              de arriba, y el backend rechaza el otro camino (COUNCIL_GOVERNS_A_CAGE). */}
          {policies
            .filter((p) => p.generation !== 'v2')
            .map((p) => (
              <section key={p.key} className="space-y-3">
                <h2 className="text-sm font-semibold text-ink">{t(p.title)}</h2>
                <OperatorConsole policy={p} />
              </section>
            ))}
        </div>
        </XamanSignBlockScope>
      ) : null}
    </div>
  );
}
