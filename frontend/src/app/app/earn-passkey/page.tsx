'use client';

/**
 * /app/earn-passkey — el lado USUARIO de la demo institucional, con Face ID.
 *
 * Distinto de la consola del operador (esa vive en /app/admin): aquí el cliente
 * da de alta su passkey una vez y luego mete/saca/envía con la cara, sin ver
 * jamás una wallet ni FLR. Gated por NEXT_PUBLIC_INSTITUTIONAL_ENABLED (#10).
 */

import { useT } from '../../../i18n/LanguageProvider';
import { PasskeyGate } from '../../../components/institutional/user/PasskeyGate';
import { UserVaultPanel } from '../../../components/institutional/user/UserVaultPanel';

const ENABLED = process.env.NEXT_PUBLIC_INSTITUTIONAL_ENABLED === 'true';

export default function EarnPasskeyPage() {
  const { t } = useT();

  if (!ENABLED) {
    return (
      <div className="p-6">
        <p className="text-sm text-ink/60">{t('This surface is not enabled on this environment.')}</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold text-ink">{t('Earn with Face ID')}</h1>
        <p className="text-xs text-ink/60">
          {t('Put your balance to work and take it back whenever you want. You approve everything with your face; only you can move your money.')}
        </p>
      </header>

      <PasskeyGate>{(account) => <UserVaultPanel account={account} />}</PasskeyGate>
    </div>
  );
}
