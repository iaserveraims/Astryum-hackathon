'use client';

/**
 * ManagerDeclaration — «soy gestor de bóvedas», la puerta de la mesa para
 * quien aún no se declaró. Una pieza, dos montajes: la página /app/manager y
 * la ventana anclable que se abre desde Managed vaults. El flag
 * viaja a la CUENTA (POST /auth/manager-mode); si falla, revierte y se dice.
 */

import { useState } from 'react';
import { Landmark } from 'lucide-react';
import { Card, MicroLabel, PrimaryButton } from '../ui/primitives';
import { useT } from '../../i18n/LanguageProvider';
import { useManagerStore } from '../../stores/managerStore';

export function ManagerDeclaration() {
  const { t } = useT();
  const setManager = useManagerStore((s) => s.setManager);
  const [saveFailed, setSaveFailed] = useState(false);
  return (
    <Card className="p-6">
      <MicroLabel>{t('Before anything')}</MicroLabel>
      <h3 className="mt-3 text-base font-semibold tracking-tight text-ink">{t('This desk is for vault managers')}</h3>
      <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-ink/55">
        {t('If you manage third-party capital as a certified financial manager, declare it and your desk opens from here — Earn → Managed vaults. You can switch it off any time from Settings.')}
      </p>
      <PrimaryButton
        className="mt-4"
        onClick={() => {
          setSaveFailed(false);
          void setManager(true).then((ok) => setSaveFailed(!ok));
        }}
      >
        <Landmark className="mr-1.5 inline h-4 w-4" /> {t('I am a vault manager')}
      </PrimaryButton>
      {saveFailed && (
        <p className="mt-2 text-[11px] leading-relaxed text-tone-warning">
          {t('The change did not reach your account — it was undone. Try again in a moment; without it, other browsers would not see it.')}
        </p>
      )}
    </Card>
  );
}

export default ManagerDeclaration;
