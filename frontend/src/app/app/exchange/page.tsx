'use client';

/**
 * /app/exchange — LA PORTADA DEL EXCHANGE, y detrás el sitio del cliente.
 *
 * Lo primero que se ve es una WELCOME con dos recuadros
 * grandes — Entrar y Crear — y dentro de cada uno sus dos patas: el exchange
 * (la mesa del operador) y el cliente (esta cuenta). La portada SALE SIEMPRE:
 * no se recuerda la última puerta.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ExchangeClientApp } from '../../../components/demo-exchange/client/ExchangeClientApp';
import { ExchangeClientSite } from '../../../components/demo-exchange/client/ExchangeClientSite';
import { ExchangeWelcome, type ClientIntent } from '../../../components/demo-exchange/ExchangeWelcome';
import { useT } from '../../../i18n/LanguageProvider';

const ENABLED = process.env.NEXT_PUBLIC_INSTITUTIONAL_ENABLED === 'true';
const VIEW_KEY = 'astryum:exchange:clientView';

export default function ExchangePage() {
  const { t } = useT();
  const [classic, setClassic] = useState(false);
  // La puerta elegida en la portada. Empieza SIEMPRE en null: la portada se
  // enseña en cada visita, y el clic decide.
  const [intent, setIntent] = useState<ClientIntent | null>(null);
  useEffect(() => {
    try { setClassic(window.localStorage.getItem(VIEW_KEY) === 'classic'); } catch { /* sin memoria */ }
  }, []);
  const choose = (next: boolean) => {
    setClassic(next);
    try { window.localStorage.setItem(VIEW_KEY, next ? 'classic' : 'app'); } catch { /* sin memoria */ }
  };

  if (!ENABLED) {
    return (
      <div className="p-6">
        <p className="text-sm text-ink/60">{t('The institutional module is not enabled on this environment.')}</p>
      </div>
    );
  }

  if (intent === null) {
    return (
      <div className="max-w-5xl">
        <ExchangeWelcome onClient={setIntent} />
      </div>
    );
  }

  return (
    <div className={classic ? 'max-w-4xl' : 'max-w-6xl'}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[12px] text-ink/40">
        <button
          type="button"
          onClick={() => setIntent(null)}
          className="inline-flex items-center gap-1.5 underline underline-offset-2 transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> {t('Exchange home')}
        </button>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <button type="button" onClick={() => choose(!classic)} className="underline underline-offset-2 transition-colors hover:text-ink">
            {classic ? t('Back to the new account view') : t('Previous version of this page')}
          </button>
          <Link href="/app/exchange/operator" className="underline underline-offset-2 transition-colors hover:text-ink">{t('Operator console')} →</Link>
        </span>
      </div>
      {classic ? <ExchangeClientSite /> : <ExchangeClientApp intent={intent} />}
    </div>
  );
}
