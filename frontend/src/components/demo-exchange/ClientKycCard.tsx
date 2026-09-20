'use client';

/**
 * ClientKycCard — el KYC de la casilla del cliente, en su propia pantalla.
 *
 * Diseño B (fundador 14-sep): el exchange verifica a su cliente y registra ese
 * KYC en el ledger como una credencial XLS-70 `KYC-<tag>` emitida por su raíz
 * sobre el propio omnibus. El cliente NO firma nada: ni tiene que tener wallet
 * XRPL, ni hay aceptación suya. Por eso aquí no hay botón de aceptar ni de
 * emitir — la tarjeta solo dice, leído del ledger, si su casilla está verificada.
 *
 * Lo que la tarjeta NO dice, porque sería falso: que el ledger lo haga cumplir.
 * XRPL no condiciona nada a un tag; lo hace cumplir el exchange (su backend
 * relee la credencial en cada entrada de capital).
 *
 * Y lo que repite siempre: **sacar el dinero no pasa por esta puerta**.
 */

import { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, Clock, ExternalLink, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { demoApi, describeRefusal, type DemoClient, type RunCredentialRow } from '../../lib/demo-exchange/api';

export function ClientKycCard({ runId, client }: { runId: string; client: DemoClient }) {
  const { t } = useT();
  const [required, setRequired] = useState(true);
  const [row, setRow] = useState<RunCredentialRow | null>(null);
  const [unreadable, setUnreadable] = useState(false);
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    setBusy(true);
    try {
      const r = await demoApi.runCredentials(runId);
      if (!r.ok) {
        // «No pude leer» no es «no la tiene»: se dice, y no se pinta un veredicto.
        setUnreadable(true);
        return;
      }
      setUnreadable(false);
      setRequired(r.data.required);
      setRow(r.data.clients.find((c) => c.clientId === client.id) ?? null);
    } catch {
      setUnreadable(true);
    } finally {
      setBusy(false);
    }
  }, [runId, client.id]);

  useEffect(() => {
    void check();
  }, [check]);

  // Con el gate apagado en este entorno la tarjeta sobra: no se inventa un trámite.
  if (!required) return null;

  const verified = row?.ok === true;

  return (
    <section className="rounded-2xl border border-ink/10 bg-surface-1 p-4 space-y-2">
      <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
        {verified ? <BadgeCheck className="w-4 h-4 text-tone-success" /> : <ShieldAlert className="w-4 h-4 text-tone-warning" />}
        {t('My KYC at the exchange')}
      </h3>

      {unreadable ? (
        <p className="text-xs text-tone-warning">
          {t('Your credential could not be checked against the XRP Ledger right now — this does not mean you have none. Nothing moved; try again.')}
        </p>
      ) : verified ? (
        <p className="text-xs text-tone-success">
          {t('Verified: the exchange registered the KYC of your account on the XRP Ledger.')}
          {row?.expiresAtISO ? ` · ${t('expires')} ${new Date(row.expiresAtISO).toLocaleDateString()}` : ''}
        </p>
      ) : row ? (
        <p className="text-xs text-ink/70">{describeRefusal({ status: 409, error: String(row.code), detail: row.detail }, t)}</p>
      ) : (
        <p className="text-xs text-ink/50 inline-flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" /> {t('Reading your credential from the ledger…')}
        </p>
      )}

      {row ? (
        <p className="text-[11px] text-ink/45 font-mono">
          {row.credentialType} · {t('issued by the exchange root')}
          {' · '}
          <a href={`https://xrpscan.com/account/${row.subject}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-volt hover:underline">
            {t('see it on the ledger')} <ExternalLink className="w-3 h-3" />
          </a>
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          onClick={() => void check()}
          disabled={busy}
          className="rounded-full border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} {t('Check my KYC')}
        </button>
      </div>

      <p className="text-[11px] text-ink/45 inline-flex items-center gap-1.5">
        <Clock className="w-3 h-3" /> {t('Taking your money out never needs this credential — if it expires, it is renewed and meanwhile your way out stays open.')}
      </p>
    </section>
  );
}
