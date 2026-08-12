'use client';

import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { Card, SectionTitle, PrimaryButton, Pill } from '../ui/primitives';
import { useT } from '../../i18n/LanguageProvider';

const PASSKEY_ENABLED = process.env.NEXT_PUBLIC_PASSKEY_ENABLED === 'true';

/**
 * PasskeySettings — register a passkey on the current device so the user can
 * sign in with biometrics next time. A passkey is a login credential only.
 */
export default function PasskeySettings() {
  const { t } = useT();
  const registerPasskey = useAuthStore((s) => s.registerPasskey);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!PASSKEY_ENABLED) return null;

  const onAdd = async () => {
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await registerPasskey(label.trim() || undefined);
      setDone(true);
      setLabel('');
    } catch (e: any) {
      setError(e?.message ?? 'Could not add passkey.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <SectionTitle>
        <span className="inline-flex items-center gap-2">
          <KeyRound className="w-4 h-4" strokeWidth={1.5} /> {t('Passkeys')}
        </span>
      </SectionTitle>
      <p className="text-xs text-ink/50 leading-relaxed mb-3">
        {t('Add this device as a passkey to sign in with your fingerprint, face, or device PIN — no password needed.')}
      </p>
      <input
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder={t('Device name (optional)')}
        className="w-full mb-3 bg-ink/5 border border-ink/10 rounded-lg px-3 py-2.5 text-sm text-ink/90 placeholder-ink/20 focus:outline-none focus:border-ink/30"
      />
      {error && (
        <div className="mb-3 px-3 py-2 rounded bg-red-900/40 border border-red-500/40 text-sm text-red-300">
          {error}
        </div>
      )}
      <div className="flex items-center gap-3">
        <PrimaryButton onClick={onAdd} disabled={busy}>
          {busy ? t('Waiting for device…') : t('Add a passkey')}
        </PrimaryButton>
        {done && <Pill tone="success">{t('Passkey added')}</Pill>}
      </div>
    </Card>
  );
}
