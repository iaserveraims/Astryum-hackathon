'use client';

/**
 * ManagerCertificationCard — la certificación del gestor es un REFERRAL, no un
 * formulario (fundador 2026-08-30: «no podemos tener la creación ni custodia
 * de estos documentos... poner un botón que dirija a dicha empresa»).
 *
 * LA REGLA REGULATORIA QUE ESTA TARJETA ENCARNA: Astryum ni crea ni custodia
 * documentos de certificación. El gestor trata DIRECTAMENTE con la empresa
 * certificadora — sus datos y su documento identificativo viajan a ella, por
 * sus canales, sin tocar jamás un servidor ni un navegador de Astryum. Aquí
 * solo hay la explicación del circuito y la puerta de salida.
 *
 * Esto reemplaza al formulario ManagerKycCard (borrador local + PreviewOnly):
 * murió entero, incluida su rebanada del managerStore — guardar un borrador
 * de PII en localStorage ya era custodiar lo que no podemos custodiar (el
 * store purga los borradores viejos en su migración v1).
 *
 * LA EMPRESA AÚN NO EXISTE: el botón se declara por env
 * (NEXT_PUBLIC_CERT_PARTNER_URL + NEXT_PUBLIC_CERT_PARTNER_NAME). Sin URL, el
 * botón está deshabilitado y dice la verdad — elegida la certificadora, darle
 * vida es poner dos variables en Vercel, sin tocar código.
 *
 * Lo que SÍ seguirá siendo nuestro: LEER el veredicto. Certificado el gestor,
 * la credencial se emite a SU cuenta XRPL (XLS-70), él la acepta en su bandeja
 * y el propio ledger la exige en sus bóvedas; el catálogo enseña «Verified by
 * X» leyéndola del ledger — mostrar un hecho público, no custodiar un
 * documento. (Corrección 3-sep: la versión anterior decía que «el FDC lo lleva
 * a XRPL» — imposible por construcción: el FDC es unidireccional hacia Flare y
 * XRPL no puede leerlo. El raíl real es la credencial XLS-70, decidido 29-ago.)
 *
 * Una pieza, dos montajes (Settings → Perfil profesional y la mesa del
 * gestor), como su antecesora.
 */

import { useEffect, useState } from 'react';
import { ArrowUpRight, FileCheck2, Landmark, ShieldCheck } from 'lucide-react';

import { Card, MicroLabel, PrimaryButton } from '../ui/primitives';
import { useT } from '../../i18n/LanguageProvider';
import { readVerificationPartners, type ConfiguredVerificationPartner } from '../../lib/xrpl/credentialsApi';

const PARTNER_URL = process.env.NEXT_PUBLIC_CERT_PARTNER_URL ?? '';
const PARTNER_NAME = process.env.NEXT_PUBLIC_CERT_PARTNER_NAME ?? '';

export function ManagerCertificationCard() {
  const { t } = useT();
  // La certificadora viene del BACKEND en runtime (MANAGER_VERIFICATION_PARTNERS
  // — la misma fuente que la puerta del título): elegirla o cambiarla es una
  // variable de Railway, sin rebuild. Las NEXT_PUBLIC_* quedan como fallback.
  const [partners, setPartners] = useState<ConfiguredVerificationPartner[]>([]);
  useEffect(() => {
    let alive = true;
    readVerificationPartners()
      .then((list) => { if (alive) setPartners(list); })
      .catch(() => undefined); // sin lectura, queda el fallback — jamás se inventa una puerta
    return () => { alive = false; };
  }, []);

  const doors: ConfiguredVerificationPartner[] =
    partners.length > 0
      ? partners
      : PARTNER_URL
        ? [{ name: PARTNER_NAME, url: PARTNER_URL }]
        : [];

  return (
    <Card className="p-6">
      <MicroLabel>{t('Manager certification (KYC)')}</MicroLabel>
      <div className="mt-3 flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-ink/35" strokeWidth={1.6} />
        <div className="min-w-0">
          <h3 className="text-base font-semibold tracking-tight text-ink">
            {t('You get certified at the certifier — never at Astryum')}
          </h3>
          <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-ink/55">
            {t('Astryum neither creates nor custodies certification documents. Your details and your identity document go directly to the independent certifying company, through their channels — they never touch Astryum. Once they certify you, the credential is issued to your XRPL account (XLS-70); you accept it in your tray, and the ledger itself enforces it on every vault you run.')}
          </p>
        </div>
      </div>

      {/* El circuito, en tres pasos ESTÁTICOS: aquí no hay estado que seguir,
          porque nada de esto pasa por Astryum. */}
      <ol className="mt-5 space-y-2">
        {[
          { icon: ArrowUpRight, label: t('Get certified at the certifying company') },
          { icon: FileCheck2, label: t('Credential issued to your XRPL account (XLS-70)') },
          { icon: Landmark, label: t('You accept it in your tray — the ledger enforces it') },
        ].map((s, i) => (
          <li key={s.label} className="flex items-center gap-2.5 text-[13px] text-ink/60">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-ink/15 font-mono text-[10px] text-ink/45">
              {i + 1}
            </span>
            <s.icon className="h-3.5 w-3.5 shrink-0 text-ink/35" strokeWidth={1.8} />
            {s.label}
          </li>
        ))}
      </ol>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {doors.length > 0 ? (
          doors.map((p) => (
            <a
              key={p.url}
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl bg-volt px-5 py-2.5 text-sm font-semibold text-volt-ink transition-transform hover:-translate-y-0.5"
            >
              {p.name ? `${t('Get certified at')} ${p.name}` : t('Go to the certifying company')}
              <ArrowUpRight className="h-4 w-4" />
            </a>
          ))
        ) : (
          // Sin empresa todavía: el botón existe, apagado, con la verdad al
          // lado. Nada de un enlace a ninguna parte.
          <PrimaryButton disabled disabledReason={t('The certifying company is not announced yet')}>
            {t('Go to the certifying company')} <ArrowUpRight className="ml-1 inline h-4 w-4" />
          </PrimaryButton>
        )}
        <p className="basis-full text-[10px] leading-relaxed text-ink/40 sm:basis-auto sm:max-w-[36ch]">
          {doors.length > 0
            ? t('You leave Astryum: what you submit there is between you and the certifier.')
            : t('The certifying company is being selected — this door opens the moment it exists.')}
        </p>
      </div>
    </Card>
  );
}

export default ManagerCertificationCard;
