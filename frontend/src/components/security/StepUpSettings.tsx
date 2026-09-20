'use client';

import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { apiService } from '../../services/api';
import { useStepUp } from '../../hooks/useStepUp';
import { useAuthStore } from '../../stores/authStore';
import { Card, SectionTitle, PrimaryButton, Pill } from '../ui/primitives';
import { useT } from '../../i18n/LanguageProvider';

const FEATURE_LABELS: Record<string, string> = {
  moneyflows: 'MoneyFlows',
  goals: 'Goals',
  strategies: 'Strategy',
  wallet_security: 'Wallet & security',
  kyc: 'Identity (KYC)',
  data_export: 'Data export',
  profile: 'Profile',
  rules_alerts: 'Rules & alerts',
};

interface Cell { read: boolean; write: boolean }
type Matrix = Record<string, Cell>;

interface ConfigResponse {
  config: { enabled: boolean; grantTtlSeconds: number; matrix: Matrix };
  features: string[];
}

const STEP_UP_ENABLED = process.env.NEXT_PUBLIC_STEP_UP_ENABLED === 'true';

/**
 * WHY THE SAVE WAS REFUSED, IN THIS CARD (R5 R6).
 *
 * The matrix is an AUTHORITY write, so the backend refuses one whose session
 * predates a change of ownership on the account: 401 `session_revoked`. The
 * client used to act on that 401 with the body unread — token wiped, straight to
 * /login — so a person editing their own locks was thrown out of the app by the
 * very check meant to protect them. The client now hands the refusal back, and
 * this is the sentence for it: what happened, that NOTHING was saved, and what
 * to do. The server's own `detail` is never printed (Spanish, with ids in it)
 * and neither is the raw code.
 */
export function stepUpSaveRefusal(e: unknown, t: (s: string) => string): string {
  // Plain JS on purpose: this body is also EXECUTED out of the source by the
  // test (extractFromSource), so it carries no type syntax of its own.
  const err = Object(e ?? {});
  const code = typeof err.code === 'string' ? err.code : '';
  if (err.status === 401 && code === 'session_revoked') {
    return t('Nothing was saved: this session is older than a change of ownership on this account, so it may not change what is protected. You are still signed in here — sign in again with your current key and save it once more.');
  }
  if (err.status === 401) {
    return t('Nothing was saved: your session is no longer valid. Sign in again and save it once more.');
  }
  const message = typeof err.message === 'string' ? err.message.trim() : '';
  // «HTTP 403: Forbidden» is the client's own filler, not something a person can
  // act on: it goes the same way the raw code does.
  if (message && !/^HTTP \d/.test(message)) return message;
  return t('Could not save these settings. Nothing was changed.');
}

export default function StepUpSettings() {
  const { t } = useT();
  const { withStepUp, pending, error: signError } = useStepUp();
  const hasWallet = useAuthStore((s) => s.linkedWallets.length > 0);

  const [features, setFeatures] = useState<string[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [ttl, setTtl] = useState(300);
  const [matrix, setMatrix] = useState<Matrix>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!STEP_UP_ENABLED) { setLoading(false); return; }
    (async () => {
      try {
        const res = await apiService.get<ConfigResponse>('/security/step-up/config');
        setFeatures(res.features);
        setEnabled(res.config.enabled);
        setTtl(res.config.grantTtlSeconds);
        const m: Matrix = {};
        for (const f of res.features) {
          m[f] = { read: res.config.matrix[f]?.read ?? false, write: res.config.matrix[f]?.write ?? false };
        }
        setMatrix(m);
      } catch {
        /* leave defaults */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (!STEP_UP_ENABLED) return null;

  const toggleCell = (feature: string, action: 'read' | 'write') => {
    setSaved(false);
    setMatrix((prev) => ({
      ...prev,
      [feature]: { ...prev[feature], [action]: !prev[feature]?.[action] },
    }));
  };

  const onSave = async () => {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      // Tightening locks is itself protected once wallet_security:write is on.
      // withStepUp transparently runs the signature handshake on a 403.
      await withStepUp('wallet_security', 'write', (grant) =>
        apiService.put('/security/step-up/config', { enabled, grantTtlSeconds: ttl, matrix }, grant)
      );
      setSaved(true);
    } catch (e: unknown) {
      setSaveError(stepUpSaveRefusal(e, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="md:col-span-2">
      <SectionTitle>
        <span className="inline-flex items-center gap-2">
          <ShieldCheck className="w-4 h-4" strokeWidth={1.5} /> {t('Step-up signature locks')}
        </span>
      </SectionTitle>

      <p className="text-xs text-ink/50 leading-relaxed mb-4">
        {t("Require a fresh wallet signature before reading or changing sensitive parts of the app — so even if someone gets into your account, they can't touch what matters without your device. Pick exactly what to protect.")}
      </p>

      {!hasWallet && (
        <div className="mb-4 px-3 py-2 rounded bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
          {t('Link a wallet first — step-up locks are confirmed with a wallet signature.')}
        </div>
      )}

      {/* Master toggle */}
      <label className="flex items-center justify-between gap-4 py-2 cursor-pointer">
        <div>
          <div className="text-sm text-ink/90">{t('Enable step-up locks')}</div>
          <div className="text-xs text-ink/40 mt-0.5">{t('Master switch. When off, nothing is gated.')}</div>
        </div>
        <button
          type="button"
          onClick={() => { setSaved(false); setEnabled((v) => !v); }}
          className={`relative w-11 h-6 rounded-full transition-colors ${enabled ? 'bg-volt' : 'bg-ink/10'}`}
        >
          {/* left-0.5 is load-bearing: buttons center content by default, so a
              left-less absolute knob starts mid-track and slides out. */}
          <span className={`absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
        </button>
      </label>

      {/* TTL */}
      <div className="flex items-center justify-between gap-4 py-3 border-b border-ink/5">
        <div>
          <div className="text-sm text-ink/90">{t('Re-ask after')}</div>
          <div className="text-xs text-ink/40 mt-0.5">{t('Seconds a signature stays valid (60–1800).')}</div>
        </div>
        <input
          type="number"
          min={60}
          max={1800}
          value={ttl}
          onChange={(e) => { setSaved(false); setTtl(Math.min(1800, Math.max(60, Number(e.target.value) || 300))); }}
          className="w-24 bg-ink/5 border border-ink/10 rounded px-2 py-1.5 text-sm text-right text-ink/90 focus:outline-none focus:border-ink/30"
        />
      </div>

      {/* Matrix */}
      <div className="mt-3">
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-6 items-center text-xs text-ink/30 pb-2 border-b border-ink/5">
          <span>{t('Feature')}</span>
          <span className="w-12 text-center">{t('Read')}</span>
          <span className="w-12 text-center">{t('Write')}</span>
        </div>
        {(loading ? [] : features).map((f) => (
          <div key={f} className="grid grid-cols-[1fr_auto_auto] gap-x-6 items-center py-2.5 border-b border-ink/5 last:border-0">
            <span className="text-sm text-ink/85">{t(FEATURE_LABELS[f] ?? f)}</span>
            <div className="w-12 flex justify-center">
              <input
                type="checkbox"
                checked={matrix[f]?.read ?? false}
                onChange={() => toggleCell(f, 'read')}
                disabled={!enabled}
                className="w-4 h-4 accent-volt disabled:opacity-30"
              />
            </div>
            <div className="w-12 flex justify-center">
              <input
                type="checkbox"
                checked={matrix[f]?.write ?? false}
                onChange={() => toggleCell(f, 'write')}
                disabled={!enabled}
                className="w-4 h-4 accent-volt disabled:opacity-30"
              />
            </div>
          </div>
        ))}
        {loading && <div className="py-4 text-xs text-ink/30">{t('Loading…')}</div>}
      </div>

      {(saveError || signError) && (
        <div className="mt-4 px-3 py-2 rounded bg-red-900/40 border border-red-500/40 text-sm text-red-300">
          {saveError || signError}
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <PrimaryButton onClick={onSave} disabled={saving || pending}>
          {saving || pending ? t('Saving…') : t('Save protection settings')}
        </PrimaryButton>
        {saved && <Pill tone="success">{t('Saved')}</Pill>}
      </div>
    </Card>
  );
}
