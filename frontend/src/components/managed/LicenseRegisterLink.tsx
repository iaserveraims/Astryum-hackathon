'use client';

/**
 * ⚠ DESMONTADO desde el 2026-09-20 — se queda en el repo, inerte.
 *
 * Fundador: «quitemos los botones de issue credential demo para que la gente
 * no pueda probarlo así como así». Este componente PARECE el camino de verdad
 * («pega tu enlace del registro») pero llama al notario de RODAJE
 * (`issue-aifm-demo`), que no comprueba ni dominio ni registro. Estaba montado
 * en la mesa del exchange (CASP, KYB) y en la del gestor (AIFM), a la vista de
 * cualquier cuenta con sesión. La emisión de demo vive ahora en /app/admin
 * (la ceremonia, con su campo de enlace), y el backend exige `requireAdmin`:
 * montarlo de nuevo fuera del panel solo enseñaría un botón que contesta 403.
 */
/**
 * LicenseRegisterLink — el textbox COMPARTIDO por las dos raíces del raíl:
 *   · AIFM (gestor de vehículos agrupados)  · CASP (exchange, MiCA).
 *
 * El user pega el link de su entrada en el registro (ESMA / su regulador) y se
 * emite la licencia DEMO con ESE link como `URI` de la XLS-70. El LINK ES la
 * credencial: Astryum lo trae on-chain como evidencia, **no lo verifica ni lo
 * certifica** — cualquiera lo abre y comprueba el registro. La responsabilidad
 * de verificar es del que va a operar/depositar (fundador 13-sep).
 *
 * Mismo textbox e interacción en los dos circuitos: la única diferencia es el
 * `type` (AIFM|CASP) y el nombre del registro. La aceptación de la credencial
 * sigue siendo del sujeto en su Xaman (bandeja).
 */

import { useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { requestNotaryAifmDemo } from '../../lib/xrpl/credentialsApi';

const HTTPS_RE = /^https:\/\/\S+$/;

export function LicenseRegisterLink({
  subject,
  type,
  onIssued,
}: {
  /** La r-address de la raíz (gestor/exchange) a la que se emite la licencia. */
  subject: string;
  /** KYB (13-sep): la identidad del VEHÍCULO — el asiento de la sociedad en el
   *  registro mercantil, mismo modelo paste-link→URI que las licencias. */
  type: 'AIFM' | 'CASP' | 'KYB';
  /** Se llama tras emitir OK (para refrescar el estado de la credencial). */
  onIssued?: () => void;
}) {
  const { t } = useT();
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const registerName =
    type === 'CASP'
      ? t('CASP register (ESMA / your national authority)')
      : type === 'KYB'
        ? t('company register (your commercial registry)')
        : t('AIFM register (ESMA / your regulator)');
  const valid = HTTPS_RE.test(link.trim());

  async function issue() {
    setError('');
    setDone(false);
    setBusy(true);
    const r = await requestNotaryAifmDemo({ subject, type, uri: link.trim() || undefined });
    setBusy(false);
    if (!r.ok) {
      setError(`${r.refusal.error}${r.refusal.detail ? ` — ${r.refusal.detail}` : ''}`);
      return;
    }
    setDone(true);
    onIssued?.();
  }

  return (
    <div className="space-y-2">
      <label className="block text-[11px] text-ink/55">
        {t('Paste the link to your entry in the')} <span className="text-ink/75">{registerName}</span>
        <input
          value={link}
          onChange={(e) => setLink(e.target.value.trim())}
          placeholder="https://…"
          className="mt-1 w-full rounded-lg border border-ink/10 bg-surface-2 px-3 py-2 font-mono text-[12px] text-ink placeholder:text-ink/30 focus:border-volt/40 focus:outline-none"
        />
      </label>
      <p className="text-[10px] leading-relaxed text-ink/40">
        {t(
          'Astryum brings this link on-chain as the credential’s evidence — it does NOT verify or certify the licence. Anyone can open it and check the register themselves; verifying is their responsibility.',
        )}
      </p>
      <button
        type="button"
        onClick={() => void issue()}
        disabled={busy || !valid}
        className="inline-flex items-center gap-1.5 rounded-lg bg-volt px-4 py-2 text-[12px] font-semibold text-volt-ink disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
        {t('Issue')} {type} {t('with this link')}
      </button>
      {done ? (
        <p className="text-[11px] text-emerald-500/90">{t('Issued — accept it in your Xaman tray below.')}</p>
      ) : null}
      {error ? <p className="text-[11px] leading-relaxed text-tone-warning">{error}</p> : null}
    </div>
  );
}

export default LicenseRegisterLink;
