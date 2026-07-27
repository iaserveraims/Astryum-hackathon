'use client';

import { useEffect, useState } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const isDev = process.env.NODE_ENV !== 'production';

  useEffect(() => {
    console.error('[RootError boundary]', error);
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
    <div className="flex min-h-screen items-center justify-center bg-black px-4">
      <div className="w-full max-w-lg bg-zinc-900 border border-red-500/30 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">⚠️</span>
          <h2 className="text-lg font-semibold text-white">Algo salió mal</h2>
        </div>

        <div className="bg-red-950/40 border border-red-500/20 rounded-lg px-4 py-3">
          <p className="text-red-300 text-sm font-mono break-all">{error.message || 'Error desconocido'}</p>
          {error.digest && (
            <p className="text-red-400/60 text-xs mt-1">digest: {error.digest}</p>
          )}
        </div>

        {isDev && error.stack && (
          <details className="text-xs">
            <summary className="text-white/40 cursor-pointer hover:text-white/70 select-none">
              Stack trace (dev only)
            </summary>
            <pre className="mt-2 text-white/50 overflow-x-auto whitespace-pre-wrap break-all text-[10px] leading-relaxed max-h-48 overflow-y-auto">
              {error.stack}
            </pre>
          </details>
        )}

        <div className="flex gap-3 pt-1">
          <button
            onClick={reset}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
          >
            Intentar de nuevo
          </button>
          <button
            onClick={handleCopy}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white/70 text-sm rounded-lg transition-colors"
          >
            {copied ? '✓ Copiado' : 'Copiar error'}
          </button>
        </div>
      </div>
    </div>
  );
}

