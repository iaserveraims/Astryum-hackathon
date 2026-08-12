'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/i18n/LanguageProvider';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const isDev = process.env.NODE_ENV !== 'production';

  useEffect(() => {
    console.error('[AppError boundary]', error);
  }, [error]);

  const errorText = [
    error.message,
    error.digest ? `digest: ${error.digest}` : null,
    isDev && error.stack ? `\n${error.stack}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const handleCopy = () => {
    navigator.clipboard.writeText(errorText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 py-12">
      <div className="w-full max-w-lg bg-surface-2 border border-red-500/30 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">⚠️</span>
          <h2 className="text-lg font-semibold text-ink">{t('Something went wrong on this page')}</h2>
        </div>

        <div className="bg-red-950/40 border border-red-500/20 rounded-lg px-4 py-3">
          <p className="text-red-300 text-sm font-mono break-all">{error.message || t('Unknown error')}</p>
          {error.digest && (
            <p className="text-red-400/60 text-xs mt-1">digest: {error.digest}</p>
          )}
        </div>

        {isDev && error.stack && (
          <details className="text-xs">
            <summary className="text-ink/40 cursor-pointer hover:text-ink/70 select-none">
              {t('Stack trace (dev only)')}
            </summary>
            <pre className="mt-2 text-ink/50 overflow-x-auto whitespace-pre-wrap break-all text-[10px] leading-relaxed max-h-48 overflow-y-auto">
              {error.stack}
            </pre>
          </details>
        )}

        <div className="flex gap-3 pt-1">
          <button
            onClick={reset}
            className="flex-1 px-4 py-2 bg-volt hover:bg-volt text-volt-ink text-sm rounded-lg transition-colors"
          >
            {t('Try again')}
          </button>
          <button
            onClick={handleCopy}
            className="px-4 py-2 bg-surface-3 hover:bg-zinc-700 text-ink/70 text-sm rounded-lg transition-colors"
          >
            {copied ? t('✓ Copied') : t('Copy error')}
          </button>
        </div>
      </div>
    </div>
  );
}
