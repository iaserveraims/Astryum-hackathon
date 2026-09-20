'use client';

/**
 * CredentialCeremonyModal — la escena 2 de la demo: el circuito de
 * consentimiento/KYC de XRPL, en dos firmas.
 *
 *   Paso 1 · el EMISOR firma CredentialCreate (tras su proceso de KYC).
 *   Paso 2 · el SUJETO firma CredentialAccept — esa firma ES el consentimiento.
 *
 * Astryum JAMÁS emite ni acepta: compone el txjson (rutas del backend) y lo
 * entrega a Xaman con el patrón create-payload + poll (el mismo de
 * CloseDoorSign). Cada firma la hace la cuenta que debe, en su propio Xaman.
 * La credencial lleva `Expiration` SIEMPRE (I5): el backend la impone; aquí
 * solo se elige el plazo.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ExternalLink, Loader2, X, Check } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { GhostButton, PrimaryButton } from '../ui/primitives';
import { ModalOverlay } from '@/components/ui/ModalPortal';
import { translateError } from '../../lib/errors/translateError';
import {
  prepareCredentialAccept,
  prepareCredentialIssue,
  type PreparedCredentialTx,
  type Refusal,
} from '../../lib/institutional/api';
import { readManagerIssuers, requestNotaryAifmDemo } from '../../lib/xrpl/credentialsApi';
import { awaitValidation, XRPSCAN_TX } from '../../lib/xrpl/councilSigning';
import {
  decideAfterSigned,
  decideAfterValidation,
  type SingleSignVerdict,
} from '../../lib/xrpl/singleSignVerdict';

const XRPL_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
/** How long to wait for the ledger before saying «we could not confirm». */
const VALIDATION_TIMEOUT_MS = 60_000;
// Las licencias que el atajo de demo puede firmar en el servidor — cada raíz la
// de SU sector (AIFM el gestor, CASP el exchange). La KYC nunca: esa exige la
// atestación real (robot Coinbase) o la ceremonia de dos firmas.
const DEMO_LICENSE_TYPES = ['AIFM', 'CASP', 'KYB'];
type Step = 'form' | 'issuing' | 'accepting' | 'done';
type SignPhase = 'idle' | 'creating' | 'waiting' | 'confirming' | 'signed' | 'unconfirmed' | 'error';
/**
 * How one signature of the ceremony ended («firmado» NO es «hecho»):
 *  · settled → the ledger validated it with tesSUCCESS: the chain continues;
 *  · retry   → provably nothing entered a ledger (cancelled, expired, tem/tef/tel,
 *              payload never created): back to the form is safe;
 *  · stop    → unconfirmed, or validated with a failure: the ceremony halts
 *              right here, with no way back to «Start».
 */
type SignEnding = 'settled' | 'retry' | 'stop';

async function pollStatus(
  uuid: string,
): Promise<{ signed?: boolean; cancelled?: boolean; expired?: boolean; txid?: string; dispatched?: string }> {
  try {
    const res = await fetch(`/api/xaman/status/${uuid}`);
    if (!res.ok) return {};
    const data = await res.json();
    return {
      signed: data?.meta?.signed,
      cancelled: data?.meta?.cancelled,
      expired: data?.meta?.expired,
      // El hash de la tx firmada: es lo que el recibo E3_CREDENTIAL necesita
      // para que el verificador pueda probar la ceremonia en el ledger.
      txid: typeof data?.response?.txid === 'string' ? data.response.txid : undefined,
      // Lo que contestó el nodo al envío de Xaman (preliminar): un tem/tef/tel
      // prueba que no entró en ningún ledger.
      dispatched: typeof data?.response?.dispatched_result === 'string' ? data.response.dispatched_result : undefined,
    };
  } catch {
    return {};
  }
}

export function CredentialCeremonyModal({
  onClose,
  onCompleted,
  initial,
  allowDemoServerIssue = false,
  startInDemo = false,
  adminSession = null,
}: {
  /**
   * EL MODO DEMO SOLO EXISTE EN LA CONSOLA ADMIN. Con
   * `false` —el valor por defecto, el de todas las mesas del producto— la
   * casilla «el servidor firma» no se pinta y la ceremonia solo puede tomar el
   * camino del emisor de verdad. El backend lo hace cumplir igualmente
   * (`requireAdmin` en issue-aifm-demo): esto es para no enseñar una puerta
   * que ya no abre.
   */
  allowDemoServerIssue?: boolean;
  /** Abrir ya en modo demo (el botón de rodaje del panel). Sin efecto si no se permite. */
  startInDemo?: boolean;
  /** La sesión del panel: viaja como `x-admin-session` a la emisión de demo. */
  adminSession?: string | null;
  onClose: () => void;
  /** Al terminar (accept firmado): quién, de quién, qué tipo y el hash del accept — para que el caller deje su recibo. */
  onCompleted?: (result: { subject: string; issuer: string; credentialType: string; txid: string | null }) => void;
  /** Prerrelleno del caller (p. ej. la DESIGNACIÓN: emisor=la raíz, sujeto=el omnibus, tipo=OMNIBUS). Editable siempre. */
  initial?: { issuer?: string; subject?: string; credentialType?: string };
}) {
  const { t } = useT();
  const [step, setStep] = useState<Step>('form');
  const [issuer, setIssuer] = useState(initial?.issuer ?? '');
  // Los emisores acreditados (MANAGER_CREDENTIAL_ISSUERS): un desplegable en vez
  // de teclear la r-address a mano. `issuerManual` cae al input libre cuando no
  // hay lista (o el emisor es de otro contexto, p. ej. el exchange en su mesa).
  const [issuerOptions, setIssuerOptions] = useState<string[]>([]);
  // Con emisor traído por el caller (designación: la raíz), el input manual
  // manda — el desplegable de emisores acreditados es para el otro caso.
  const [issuerManual, setIssuerManual] = useState(Boolean(initial?.issuer));
  // SOLO RODAJE: para el AIFM, el servidor firma el create con la seed del
  // notario (sin Xaman del emisor), saltándose los checks de Domain. El paso 2
  // (accept del sujeto) es idéntico. Requiere el flag del backend y la puerta
  // de los fundadores (`requireAdmin`), y aquí el permiso explícito del caller.
  const [demoChecked, setDemoServerIssue] = useState(Boolean(allowDemoServerIssue && startInDemo));
  const demoServerIssue = allowDemoServerIssue && demoChecked;
  const [subject, setSubject] = useState(initial?.subject ?? '');
  const [days, setDays] = useState('180');
  // El TIPO de credencial: 'KYC' para el depositante, 'AIFM' para el título de
  // gestor. Un emisor (de demo o regulado) emite las dos con el mismo raíl.
  const [credType, setCredType] = useState(initial?.credentialType ?? 'KYC');
  // El ENLACE de la licencia (V1 del link, fundador): viaja como URI de
  // la XLS-70 — el link ES la credencial. Astryum NO lo verifica: por eso se
  // enseña siempre y quien deposita lo comprueba («tu responsabilidad»).
  const [uri, setUri] = useState('');
  // Lo emitido, para la pantalla final: el link se enseña con su disclaimer.
  const [doneUri, setDoneUri] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  // Xaman signing sub-state (shared by both steps).
  const [signPhase, setSignPhase] = useState<SignPhase>('idle');
  const [qrPng, setQrPng] = useState<string | undefined>();
  const [deeplink, setDeeplink] = useState<string | undefined>();
  // The hash of the signature being followed: the amber panel and the failed
  // result link it, so «check it before trying again» is actionable.
  const [signTxid, setSignTxid] = useState<string | null>(null);
  const uuidRef = useRef<string | undefined>(undefined);
  // El hash de la ÚLTIMA firma (la ceremonia acaba en el accept del sujeto):
  // es lo que onCompleted entrega para el recibo E3_CREDENTIAL.
  const lastTxidRef = useRef<string | null>(null);

  const partiesValid = XRPL_RE.test(issuer.trim()) && XRPL_RE.test(subject.trim()) && issuer.trim() !== subject.trim();

  // Al abrir: lee los emisores acreditados. Uno solo → preseleccionado; ninguno
  // (o fallo de lectura) → input manual, para no bloquear al que sabe la r-address.
  useEffect(() => {
    let alive = true;
    readManagerIssuers()
      .then((r) => {
        if (!alive) return;
        const list = r.issuers ?? [];
        setIssuerOptions(list);
        // Preselección SOLO si el caller no trajo emisor (la designación trae la raíz).
        if (list.length === 1) setIssuer((cur) => cur || list[0]);
        if (list.length === 0) setIssuerManual(true);
      })
      .catch(() => {
        if (alive) setIssuerManual(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const signTx = useCallback(
    async (prepared: PreparedCredentialTx): Promise<SignEnding> => {
      setSignPhase('creating');
      setSignTxid(null);
      setQrPng(undefined);
      setDeeplink(undefined);
      uuidRef.current = undefined;
      try {
        const res = await fetch('/api/xaman/create-payload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            txjson: prepared.txjson,
            // Xaman's `expire` is in MINUTES: 5 = five minutes (300 was five hours).
            options: { submit: true, expire: 5 },
            custom_meta: { identifier: `cred-${prepared.signer}-${Date.now().toString(36)}` },
          }),
        });
        if (!res.ok) throw new Error(`Xaman payload failed (${res.status})`);
        const data = await res.json();
        uuidRef.current = data.uuid;
        setQrPng(data.refs?.qr_png);
        setDeeplink(data.next?.always);
        setSignPhase('waiting');
      } catch (e) {
        setError(translateError(e, t).message);
        setSignPhase('error');
        // The request never reached Xaman: nothing could have been signed.
        return 'retry';
      }
      // Poll until signed / cancelled / expired — and, once signed, until the
      // LEDGER says how it ended. Xaman's «signed» is the wallet's word: the
      // issuance used to chain the subject's accept, mark the ceremony done and
      // leave a receipt on a transaction nobody had validated.
      return new Promise<SignEnding>((resolve) => {
        // A slow status poll can overlap the next tick: the first answer wins.
        let decided = false;
        const id = setInterval(async () => {
          const uuid = uuidRef.current;
          if (!uuid || decided) return;
          const st = await pollStatus(uuid);
          if (decided) return;
          if (st.signed) {
            decided = true;
            clearInterval(id);
            let verdict: SingleSignVerdict = decideAfterSigned({ txid: st.txid, dispatched: st.dispatched });
            if (verdict.kind === 'await-validation') {
              setSignTxid(verdict.txid);
              setSignPhase('confirming');
              const v = await awaitValidation(verdict.txid, { timeoutMs: VALIDATION_TIMEOUT_MS });
              verdict = decideAfterValidation({
                txid: verdict.txid,
                validated: v.validated,
                finalResult: v.finalResult,
                timedOut: v.timedOut,
              });
            }
            switch (verdict.kind) {
              case 'settled':
                // Only a validated tesSUCCESS continues the ceremony.
                setSignPhase('signed');
                lastTxidRef.current = verdict.txid;
                resolve('settled');
                return;
              case 'refused':
                setSignPhase('error');
                setError(`${t('The network refused this transaction before it entered a ledger. Nothing moved.')} (${verdict.code})`);
                resolve('retry');
                return;
              case 'failed-onchain':
                setSignTxid(verdict.txid);
                setSignPhase('error');
                setError(`${t('The ledger validated this transaction with a failure result, so it did not take effect and its network fee was charged. Check the account before starting the ceremony again.')} (${verdict.code})`);
                resolve('stop');
                return;
              default:
                // Signed, outcome unknown (no hash, or not validated in time).
                setSignTxid(verdict.txid ?? null);
                setError('');
                setSignPhase('unconfirmed');
                resolve('stop');
                return;
            }
          } else if (st.cancelled || st.expired) {
            decided = true;
            clearInterval(id);
            setSignPhase('error');
            setError(st.cancelled ? t('The signature was cancelled.') : t('The request expired before it was signed.'));
            resolve('retry');
          }
        }, 2500);
      });
    },
    [t]
  );

  async function runIssue() {
    setError('');
    setRefusal(null);
    setDoneUri(null);
    setStep('issuing');

    // El emisor real de cara al accept del sujeto: en demo lo fija el servidor
    // (la seed del notario); si no, la cuenta elegida en el formulario.
    let acceptIssuer = issuer.trim();

    if (demoServerIssue) {
      // Paso 1 EN EL SERVIDOR: el robot firma el create con su seed (sin Xaman
      // del emisor), saltándose los checks de Domain. Solo rodaje, solo licencias.
      // El link del user viaja como URI: el link ES la credencial (V1).
      const created = await requestNotaryAifmDemo({ subject: subject.trim(), type: credType.trim().toUpperCase() as 'AIFM' | 'CASP' | 'KYB', uri: uri.trim() || undefined }, { adminSession });
      if (!created.ok) {
        setRefusal(created.refusal);
        setStep('form');
        return;
      }
      acceptIssuer = created.data.issuer;
      setDoneUri(uri.trim() || null);
    } else {
      const issued = await prepareCredentialIssue({
        issuer: issuer.trim(),
        subject: subject.trim(),
        credentialType: credType.trim() || 'KYC',
        expirationDays: Number(days) || undefined,
        uri: uri.trim() || undefined,
      });
      if (!issued.ok) {
        setRefusal(issued.refusal);
        setStep('form');
        return;
      }
      const issuedEnding = await signTx(issued.data);
      if (issuedEnding !== 'settled') {
        // retry: nothing entered a ledger — the form again. stop: the issuance
        // is unconfirmed or failed on the ledger — the ceremony halts here, and
        // the subject is NOT asked to accept a credential nobody saw validate.
        if (issuedEnding === 'retry') setStep('form');
        return;
      }
      setDoneUri(uri.trim() || null);
    }

    // Create done → subject accepts, same Xaman flow, chained directly.
    setStep('accepting');
    setSignPhase('idle');
    const accepted = await prepareCredentialAccept({ issuer: acceptIssuer, subject: subject.trim(), credentialType: credType.trim() || 'KYC' });
    if (!accepted.ok) {
      setRefusal(accepted.refusal);
      setStep('form');
      return;
    }
    const acceptEnding = await signTx(accepted.data);
    if (acceptEnding === 'settled') {
      setStep('done');
      onCompleted?.({
        subject: subject.trim(),
        issuer: acceptIssuer,
        credentialType: (credType.trim() || 'KYC').toUpperCase(),
        txid: lastTxidRef.current,
      });
    } else if (acceptEnding === 'retry') {
      setStep('form');
    }
    // stop: stays on this step — no done, no receipt, no «Start» again.
  }

  return (
    <ModalOverlay
      onEscape={onClose}
      lockScroll
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
    >
      {/* El traje de la casa: cabecera con borde y subtítulo, cuerpo scrollable,
          primitivas para los botones. La mecánica no cambia ni una línea. */}
      <div className="my-auto flex max-h-[min(90dvh,44rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-ink/10 bg-surface-1 shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-ink/5 px-6 py-5">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-ink">{t('Credential ceremony (KYC → consent)')}</h2>
            <p className="mt-0.5 text-[11px] text-ink/45">{t('The issuer signs, the subject accepts — that signature IS the consent.')}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-ink/40 transition-colors hover:bg-surface-2 hover:text-ink" aria-label={t('Close')}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5 scrollbar-thin">

        <ol className="flex gap-2 text-xs">
          <li className={step === 'form' || step === 'issuing' ? 'text-volt font-semibold' : 'text-ink/40'}>
            1 · {t('Issuer signs')}
          </li>
          <li className={step === 'accepting' ? 'text-volt font-semibold' : 'text-ink/40'}>2 · {t('Subject accepts')}</li>
          <li className={step === 'done' ? 'text-volt font-semibold' : 'text-ink/40'}>✓ {t('Done')}</li>
        </ol>

        {step === 'form' && (
          <div className="space-y-4">
            <p className="text-xs text-ink/60">
              {t('Astryum composes the transactions; it never issues or accepts. The issuer signs the create (after its KYC), the subject signs the accept — that signature IS the consent. The credential always carries an expiry (I5).')}
            </p>
            <label className="block text-xs text-ink/60">
              {t('Accredited issuer')}
              {issuerManual || issuerOptions.length === 0 ? (
                <input value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="r…" className="mt-1 w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink font-mono" />
              ) : (
                <select
                  value={issuer}
                  onChange={(e) => {
                    if (e.target.value === '__manual__') {
                      setIssuerManual(true);
                      setIssuer('');
                    } else {
                      setIssuer(e.target.value);
                    }
                  }}
                  className="mt-1 w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink font-mono"
                >
                  <option value="" disabled>
                    {t('Select the accredited issuer…')}
                  </option>
                  {issuerOptions.map((iss) => (
                    <option key={iss} value={iss}>
                      {iss}
                    </option>
                  ))}
                  <option value="__manual__">{t('Other account (enter manually)…')}</option>
                </select>
              )}
              <span className="mt-1 block text-[10px] text-ink/40">
                {t('Astryum only chooses which issuers it accepts — no ranking. Typing is the fallback.')}
              </span>
            </label>
            <label className="block text-xs text-ink/60">
              {t('Subject XRPL account (the client root)')}
              <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="r…" className="mt-1 w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink font-mono" />
            </label>
            <label className="block text-xs text-ink/60">
              {t('Credential type')}
              <select
                value={credType}
                onChange={(e) => {
                  setCredType(e.target.value);
                  if (!DEMO_LICENSE_TYPES.includes(e.target.value.toUpperCase())) setDemoServerIssue(false);
                }}
                className="mt-1 w-40 rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink"
              >
                <option value="KYC">KYC ({t('depositant')})</option>
                <option value="AIFM">AIFM ({t('manager title')})</option>
                <option value="CASP">CASP ({t('exchange licence')})</option>
                {/* KYB: la raíz de un exchange es una SOCIEDAD — su
                    identidad es el asiento del registro mercantil, paste-link
                    como AIFM/CASP. El KYC personal sigue siendo del robot. */}
                <option value="KYB">KYB ({t('company registration')})</option>
                {/* Designación raíz→subordinada: el consejo nombra a SU
                    omnibus en el ledger. Emisor = la raíz, jamás el robot demo. */}
                <option value="OMNIBUS">OMNIBUS ({t('treasury appointment')})</option>
              </select>
            </label>
            {allowDemoServerIssue && DEMO_LICENSE_TYPES.includes(credType.trim().toUpperCase()) ? (
              <label className="flex items-start gap-2 rounded-lg border border-ink/10 bg-surface-2/50 p-2.5 text-xs text-ink/70">
                <input type="checkbox" checked={demoChecked} onChange={(e) => setDemoServerIssue(e.target.checked)} className="mt-0.5" />
                <span>
                  {t('Demo: the server signs the create (no issuer Xaman)')}
                  <span className="mt-0.5 block text-[10px] text-ink/40">
                    {t('Skips the domain/register checks — shoot only, never a real regulatory attestation. The subject still accepts in their own Xaman.')}
                  </span>
                </span>
              </label>
            ) : null}
            <label className="block text-xs text-ink/60">
              {t('Expiry (days)')}
              <input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" className="mt-1 w-24 rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink" />
            </label>
            <label className="block text-xs text-ink/60">
              {t('Licence link (travels as the credential URI)')}
              <input value={uri} onChange={(e) => setUri(e.target.value)} placeholder="https://…" className="mt-1 w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink font-mono" />
              <span className="mt-1 block text-[10px] text-ink/40">
                {t('The link IS the credential: it is shown to anyone who relies on it, and they check it themselves. Astryum does not verify it. A pointer only — no document goes on-chain.')}
              </span>
            </label>
            {refusal && (
              <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs text-ink">
                <div className="font-semibold">{refusal.error}</div>
                {refusal.detail && <div className="mt-1 text-ink/70">{refusal.detail}</div>}
              </div>
            )}
            {error && <p className="text-xs text-danger">{error}</p>}
            <PrimaryButton
              onClick={runIssue}
              disabled={!(demoServerIssue ? XRPL_RE.test(subject.trim()) : partiesValid)}
              className="w-full"
            >
              {demoServerIssue ? t('Start — server issues (demo)') : t('Start — issuer signs')}
            </PrimaryButton>
          </div>
        )}

        {(step === 'issuing' || step === 'accepting') && (
          <div className="space-y-3 text-center">
            <p className="text-sm text-ink">
              {step === 'issuing'
                ? demoServerIssue
                  ? t('Issuing on the server…')
                  : t('The ISSUER signs the credential in Xaman')
                : t('The SUBJECT signs the acceptance in Xaman')}
            </p>
            {step === 'issuing' && demoServerIssue && <Loader2 className="w-5 h-5 animate-spin mx-auto text-ink/50" />}
            {signPhase === 'creating' && <Loader2 className="w-5 h-5 animate-spin mx-auto text-ink/50" />}
            {signPhase === 'waiting' && qrPng && (
              <div className="space-y-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrPng} alt={t('Scan with Xaman')} className="w-44 h-44 mx-auto rounded-lg" />
                {deeplink && (
                  <a href={deeplink} target="_blank" rel="noreferrer" className="text-xs text-volt underline">
                    {t('Open in Xaman')}
                  </a>
                )}
              </div>
            )}
            {signPhase === 'confirming' && (
              <p className="flex items-center justify-center gap-2 text-[11px] text-ink/55">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('Waiting for the ledger to validate…')}
              </p>
            )}
            {/* Signed, outcome unknown: amber, the hash to check, and NO way
                back to «Start» — the ceremony stops here. */}
            {signPhase === 'unconfirmed' && (
              <div className="space-y-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-left text-[11px] leading-relaxed text-amber-200">
                <p className="flex items-start gap-2 text-[12px] font-medium text-amber-100">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {t('We could not confirm your signature')}
                </p>
                <p>
                  {signTxid
                    ? t('Xaman reports it signed and sent, but the ledger had not validated the transaction when we stopped waiting. Do NOT sign it again: check this hash on the explorer and your account history first.')
                    : t('Xaman reports it signed, but it returned no transaction hash. Check the account history before doing anything again — do NOT sign it again.')}
                </p>
                {signTxid && (
                  <a
                    href={`${XRPSCAN_TX}${signTxid}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block break-all font-mono text-sky-300 underline underline-offset-2 hover:text-sky-200"
                  >
                    {signTxid}
                  </a>
                )}
              </div>
            )}
            {error && <p className="text-xs text-danger">{error}</p>}
            {signPhase === 'error' && signTxid && (
              <a
                href={`${XRPSCAN_TX}${signTxid}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block break-all font-mono text-[10px] text-ink/45 underline underline-offset-2"
              >
                {signTxid}
              </a>
            )}
          </div>
        )}

        {step === 'done' && (
          <div className="space-y-3 text-center">
            <Check className="w-8 h-8 mx-auto text-volt" />
            <p className="text-sm text-ink">
              {t('The credential is on the ledger and accepted by the client. The gated pote now admits their deposit.')}
            </p>
            {doneUri ? (
              // El link ES la credencial (V1): se enseña SIEMPRE, con su
              // disclaimer — si no se viera, Astryum parecería que certifica.
              <div className="rounded-xl border border-ink/10 bg-surface-2/60 p-3 text-left">
                <div className="text-[10px] uppercase tracking-wider text-ink/50">{t('The credential points at')}</div>
                <a href={doneUri} target="_blank" rel="noreferrer" className="mt-1 inline-flex max-w-full items-center gap-1 break-all font-mono text-xs text-volt underline">
                  {doneUri} <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
                <p className="mt-1.5 text-[10px] text-ink/45">
                  {t('Astryum does not verify this link. Whoever relies on this credential checks it themselves — their responsibility, like any reference.')}
                </p>
              </div>
            ) : null}
            <GhostButton onClick={onClose} className="w-full">
              {t('Close')}
            </GhostButton>
          </div>
        )}
        </div>
      </div>
    </ModalOverlay>
  );
}
