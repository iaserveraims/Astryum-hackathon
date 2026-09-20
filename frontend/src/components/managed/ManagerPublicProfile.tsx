'use client';

/**
 * ManagerPublicProfile — la ficha PÚBLICA del gestor: lo que
 * un cliente revisa ANTES de poner capital en un vault suyo.
 *
 * Dos mitades, y la etiqueta lo deja claro:
 *  · AUTO-DECLARADO — nombre, entidad, bio, foto, enlaces. Lo escribió el
 *    dueño PROBADO de la r-address (wallet vinculada por firma); aun así es su
 *    palabra, y se dice.
 *  · HECHOS DEL LEDGER — las credenciales vigentes con su «Verified», hasta
 *    cuándo, y el enlace a la PRUEBA (el URI de la XLS-70 — p. ej. la
 *    atestación de Coinbase en Base). Esto no lo escribe nadie: se lee.
 */

import { useEffect, useState } from 'react';
import { BadgeCheck, ExternalLink, Globe, Loader2 } from 'lucide-react';
import { Card, MicroLabel } from '../ui/primitives';
import { useT } from '../../i18n/LanguageProvider';
import { readManagerProfile, type ManagerPublicProfileData } from '../../lib/institutional/api';
import { readManagerCredentialStatus } from '../../lib/xrpl/credentialsApi';
import { shortAddr as short } from '../../lib/institutional/format';

// Una LICENCIA (AIFM del gestor, CASP del exchange) lleva como URI el enlace de
// su entrada en el registro —el que pegó el dueño o el que trae su credencial
// aceptada en Xaman—; el que mira lo abre y COMPRUEBA en el registro. Una KYC
// lleva el URI de la atestación. El texto del enlace lo dice según el tipo.
const isLicenceType = (type: string): boolean => {
  const up = type.toUpperCase();
  return up === 'AIFM' || up === 'CASP';
};

export function ManagerPublicProfile({
  account,
  role = 'manager',
}: {
  account: string;
  /** La MISMA zona de credencial sirve a las dos raíces: 'manager'
   *  (AIFM) o 'exchange' (CASP). Solo cambia el copy del vacío — los hechos
   *  del ledger, el link de la licencia y el disclaimer son neutrales. */
  role?: 'manager' | 'exchange';
}) {
  const { t } = useT();
  const [data, setData] = useState<ManagerPublicProfileData | null>(null);
  const [failed, setFailed] = useState(false);
  // Los emisores que la puerta ACEPTA: una credencial que la cuenta se emitió a sí misma es un
  // objeto válido del ledger, pero NO una verificación — y decir «Verified»
  // igual para las dos era mentir por omisión.
  const [accepted, setAccepted] = useState<Set<string> | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setFailed(false);
    readManagerProfile(account)
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setFailed(true); });
    readManagerCredentialStatus(account)
      .then((st) => { if (alive) setAccepted(new Set(st.acceptedIssuers ?? [])); })
      .catch(() => undefined); // sin lista no se juzga al emisor: se enseña quién es y punto
    return () => { alive = false; };
  }, [account]);

  if (failed) {
    return (
      <p className="text-[11px] leading-relaxed text-ink/45">
        {t('The profile could not be read right now — that says nothing about the manager.')}
      </p>
    );
  }
  if (!data) {
    return (
      <p className="flex items-center gap-2 text-[11px] text-ink/40">
        <Loader2 className="h-3 w-3 animate-spin" /> {t('Reading the profile…')}
      </p>
    );
  }

  return (
    <Card className="p-5">
      {/* ── Auto-declarado ── */}
      {data.profile ? (
        <div className="flex items-start gap-3">
          {data.profile.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.profile.avatarUrl} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold tracking-tight text-ink">{data.profile.displayName}</p>
            {data.profile.entity ? <p className="text-[12px] text-ink/55">{data.profile.entity}</p> : null}
            <p className="mt-0.5 font-mono text-[10px] text-ink/40">{short(data.account)}</p>
            {data.profile.bio ? <p className="mt-2 max-w-[60ch] text-[12px] leading-relaxed text-ink/60">{data.profile.bio}</p> : null}
            <div className="mt-2 flex flex-wrap gap-3">
              {data.profile.website ? (
                <a href={data.profile.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-volt">
                  <Globe className="h-3 w-3" /> {t('Website')} <ExternalLink className="h-2.5 w-2.5" />
                </a>
              ) : null}
              {data.profile.twitter ? (
                <a href={`https://x.com/${data.profile.twitter.replace(/^@/, '')}`} target="_blank" rel="noopener noreferrer" className="text-[11px] text-volt">
                  @{data.profile.twitter.replace(/^@/, '')}
                </a>
              ) : null}
            </div>
            <p className="mt-2 text-[10px] text-ink/35">
              {t('Self-declared by the account’s proven owner — their word, clearly labelled. The facts below are read from the ledger.')}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-[12px] text-ink/50">
          {role === 'exchange'
            ? t('This exchange has not published a profile yet. The ledger facts below stand on their own.')
            : t('This manager has not published a profile yet. The ledger facts below stand on their own.')}
        </p>
      )}

      {/* ── Hechos del ledger: verified, hasta cuándo, y la prueba ── */}
      <div className="mt-4 border-t border-ink/10 pt-3">
        <MicroLabel>{t('Verified on the ledger')}</MicroLabel>
        {data.credentials.length === 0 ? (
          <p className="mt-1.5 text-[11px] text-ink/45">{t('No credential in force right now.')}</p>
        ) : (
          <ul className="mt-1.5 space-y-1.5">
            {data.credentials.map((c) => {
              const selfIssued = c.issuer === data.account;
              const gateAccepts = accepted ? accepted.has(c.issuer) : null;
              // Tres verdades: auto-emitida (no verifica nada), emisor aceptado
              // por la puerta (verificada), o emisor desconocido para la puerta.
              const tone = selfIssued ? 'self' : gateAccepts === false ? 'other' : 'ok';
              return (
              <li key={`${c.issuer}:${c.type}`} className="flex flex-wrap items-center gap-2">
                {tone === 'ok' ? (
                  <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-tone-success" strokeWidth={1.8} />
                ) : (
                  <span className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border border-tone-warning/50 text-[9px] text-tone-warning" aria-hidden>!</span>
                )}
                <span className="text-[12px] font-medium text-ink/80">{c.type}</span>
                {tone === 'ok' ? (
                  <span className="text-[11px] text-emerald-500/90">{t('Verified')}</span>
                ) : tone === 'self' ? (
                  <span className="text-[11px] text-tone-warning">{t('Self-issued — not a verification')}</span>
                ) : (
                  <span className="text-[11px] text-ink/50">{t('Issuer not on the gate’s list')}</span>
                )}
                {c.expiresAtISO ? (
                  <span className="text-[11px] text-ink/50">{t('until')} {new Date(c.expiresAtISO).toLocaleDateString()}</span>
                ) : null}
                <span className="font-mono text-[10px] text-ink/35">· {short(c.issuer)}</span>
                {c.uri && /^https:\/\//.test(c.uri) ? (
                  <a href={c.uri} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-volt">
                    {isLicenceType(c.type) ? t('Open the register entry') : t('View proof')} <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                ) : null}
              </li>
              );
            })}
          </ul>
        )}
        {/* El encuadre para EL QUE MIRA: los enlaces de arriba
            —el que el gestor pegó de su registro, o el que trae su credencial
            aceptada en Xaman— son la EVIDENCIA que este otro user abre y juzga.
            Astryum los trae on-chain, no los certifica: la decisión de confiar
            es de quien va a operar, y se le dice con todas las letras. */}
        {data.credentials.some((c) => c.uri && /^https:\/\//.test(c.uri)) ? (
          <p className="mt-2.5 text-[10px] leading-relaxed text-ink/40">
            {t(
              'Astryum brings on-chain the link each credential declares — it does NOT verify or certify the licence. Open it, check the register yourself, and decide whether to trust: it’s your call and your responsibility.',
            )}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

export default ManagerPublicProfile;
