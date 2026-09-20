'use client';

/**
 * ManagerTitleLine — el título de gestor en UNA línea, para la sala Operar.
 *
 * Antes Operar montaba la puerta entera (ManagerCredentialGate) arriba y la
 * bandeja (CredentialTray) abajo — las mismas dos piezas que ya viven en la
 * estación «Título» del alta. Tres montajes de lo mismo, dos de ellos en la
 * pantalla que el gestor abre cada día. Aquí solo se dice el HECHO —vigente o pendiente— y, si está
 * pendiente, una puerta a la estación donde está toda la maquinaria.
 *
 * Con la puerta del ledger apagada, o sin lectura, no se pinta nada: no hay
 * hecho que decir. «No pude leer» jamás se pinta como «no lo tienes».
 */

import { useEffect, useState } from 'react';
import { BadgeCheck, ShieldAlert } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { readManagerCredentialStatus, type ManagerCredentialStatus } from '../../lib/xrpl/credentialsApi';
import { managerTitleLegs } from '../../lib/managed/managerTitle';

export function ManagerTitleLine({ account, onGoToTitle }: { account: string; onGoToTitle: () => void }) {
  const { t } = useT();
  const [status, setStatus] = useState<ManagerCredentialStatus | null>(null);

  useEffect(() => {
    let alive = true;
    readManagerCredentialStatus(account)
      .then((s) => { if (alive) setStatus(s); })
      .catch(() => { if (alive) setStatus(null); });
    return () => { alive = false; };
  }, [account]);

  if (!status || status.gate === 'disabled') return null;

  if (status.ok) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-[12px] text-ink/60">
        <BadgeCheck size={14} className="text-tone-success" />
        <span className="font-medium text-ink/75">{t('Manager title in force')}</span>
        {/* Las patas del GESTOR, no los grupos OR de la puerta («AIFM|CASP»
            es la puerta hablando de dos sectores; aquí solo está el suyo). */}
        <span className="font-mono text-[11px] text-ink/45">{managerTitleLegs(status.credentialTypes).join(' + ')}</span>
        <button type="button" onClick={onGoToTitle} className="text-[11px] text-ink/40 underline-offset-2 hover:text-ink/70 hover:underline">
          {t('Renew')}
        </button>
      </p>
    );
  }

  return (
    <p className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-[12px] text-ink/70">
      <ShieldAlert size={14} className="text-tone-warning" />
      <span className="font-medium">{t('Manager title pending')}</span>
      <span className="text-ink/50">{t('The ledger will refuse this account’s orders until it holds one.')}</span>
      <button type="button" onClick={onGoToTitle} className="ml-auto rounded-lg border border-volt/40 bg-volt/[0.08] px-2.5 py-1 text-[11px] font-medium text-volt">
        {t('Go to the Title station')} →
      </button>
    </p>
  );
}

export default ManagerTitleLine;
