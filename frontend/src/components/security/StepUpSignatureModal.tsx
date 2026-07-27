'use client';

/**
 * StepUpSignatureModal — explains why a fresh wallet signature is being asked
 * for, then triggers it. Presentational: the parent owns the useStepUp() engine
 * and passes the handlers. The wallet's own popup is the real confirmation.
 */
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

export default function StepUpSignatureModal({
  open,
  feature,
  action,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  feature: string;
  action: 'read' | 'write';
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  const label = FEATURE_LABELS[feature] ?? feature;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 p-6 rounded-lg border border-ink/10 bg-surface-1 text-ink">
        <div className="text-xs text-volt">Security verification</div>
        <h2 className="text-lg font-semibold mt-2">
          Confirm with your wallet
        </h2>
        <p className="text-sm text-ink/60 mt-2 leading-relaxed">
          You protected <span className="text-ink/90 font-medium">{label}</span> ({action}).
          Sign a quick verification message with a linked wallet to continue. No funds move and no
          transaction is sent — this only proves it's really you.
        </p>

        {error && (
          <div className="mt-4 px-3 py-2 rounded bg-red-900/40 border border-red-500/40 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="mt-6 flex gap-3">
          <button
            onClick={onCancel}
            disabled={pending}
            className="flex-1 py-2.5 rounded border border-ink/20 text-sm hover:bg-ink/5 disabled:opacity-50 transition"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={pending}
            className="flex-1 py-2.5 rounded bg-ink text-surface-1 text-sm font-medium hover:bg-ink/90 disabled:opacity-50 transition"
          >
            {pending ? 'Waiting for signature…' : 'Sign to continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
