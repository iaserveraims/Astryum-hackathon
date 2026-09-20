'use client';

/**
 * /app/exchange/operator — LA MESA DEL OPERADOR del exchange.
 *
 * LA CONSOLA PRODUCTIZADA (ExchangeConsole): Resumen · Clientes ·
 * Omnibus · Potes · Perfil · Auditoría, con la sección de exchanges arriba
 * (elegir uno, crear otro con el alta completa). La mesa por estaciones
 * (ExchangeStage: Set up / Operate / v1, tour incluido) NO se borra — queda a
 * un clic, y el clic se recuerda.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Compass } from 'lucide-react';
import { ExchangeConsole } from '../../../../components/demo-exchange/console/ExchangeConsole';
import { ExchangeStage } from '../../../../components/demo-exchange/stage/ExchangeStage';
import { Card, GhostButton, MicroLabel, PrimaryButton } from '../../../../components/ui/primitives';
import { useT } from '../../../../i18n/LanguageProvider';
import { PreviewOnly } from '../../../../components/ui/PreviewOnly';
import { useAuthStore } from '../../../../stores/authStore';

const ENABLED = process.env.NEXT_PUBLIC_INSTITUTIONAL_ENABLED === 'true';
const VIEW_KEY = 'astryum:exchange:operatorView';

function OperatorRoom() {
  const { t } = useT();
  const [stations, setStations] = useState(false);
  // El aviso del ensayo: solo el viaje que viene del alta lo enciende.
  const [guided, setGuided] = useState(false);

  useEffect(() => {
    // `window.location.search` y no useSearchParams: así esta página no arrastra
    // una frontera de Suspense por leer un parámetro una vez (la costumbre de la
    // casa — ver portfolio/page.tsx y EarlyAccessPage).
    let forced = false;
    try {
      const params = new URLSearchParams(window.location.search);
      forced = params.get('guided') === '1';
      if (forced) {
        params.delete('guided');
        const q = params.toString();
        window.history.replaceState(null, '', window.location.pathname + (q ? `?${q}` : ''));
      }
    } catch { /* sin URL legible */ }
    if (forced) {
      setGuided(true);
      setStations(true);
      try { window.localStorage.setItem(VIEW_KEY, 'stations'); } catch { /* sin memoria */ }
      return;
    }
    try { setStations(window.localStorage.getItem(VIEW_KEY) === 'stations'); } catch { /* sin memoria */ }
  }, []);

  const choose = (next: boolean) => {
    setStations(next);
    setGuided(false);
    try { window.localStorage.setItem(VIEW_KEY, next ? 'stations' : 'console'); } catch { /* sin memoria */ }
  };

  if (!ENABLED) {
    return (
      <div className="p-6">
        <p className="text-sm text-ink/60">{t('The institutional module is not enabled on this environment.')}</p>
      </div>
    );
  }
  return (
    <div className={stations ? 'max-w-6xl' : ''}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Link href="/app/exchange" className="inline-flex items-center gap-1.5 text-[12px] text-ink/40 underline underline-offset-2 transition-colors hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" /> {t('Exchange home')}
        </Link>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link href="/app/exchange" className="text-[12px] text-ink/40 underline underline-offset-2 transition-colors hover:text-ink">{t('Client site')} →</Link>
          {/* VOLVER AL ENSAYO es un BOTÓN, no una nota al pie.
          { */}
          <GhostButton onClick={() => choose(!stations)} className={stations ? '' : 'border-volt/40 text-volt'}>
            <Compass className="h-3.5 w-3.5" />
            {stations ? t('Back to the console') : t('Station desk (setup, tour, v1)')}
          </GhostButton>
        </div>
      </div>

      {guided && stations ? (
        <Card className="mb-5 border-volt/30 p-6">
          <MicroLabel>{t('Your exchange is born')}</MicroLabel>
          <h2 className="mt-1.5 text-[19px] font-semibold tracking-tight text-ink">{t('Rehearse it before you operate it')}</h2>
          <p className="mt-2.5 max-w-[68ch] text-[13.5px] leading-relaxed text-ink/60">
            {t('Walk the whole circuit here first — the setup stations, a deposit, the vault and an exit — with the guided tour beside you. It is the same desk you will operate with, so what works here works there.')}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <PrimaryButton onClick={() => setGuided(false)}>{t('Start the rehearsal')}</PrimaryButton>
            <GhostButton onClick={() => choose(false)}>{t('Skip for now')}</GhostButton>
          </div>
          <p className="mt-3 text-[11px] text-ink/40">{t('Skipping is not losing it: the button above brings the station desk back any time.')}</p>
        </Card>
      ) : null}

      {stations ? <ExchangeStage /> : <ExchangeConsole />}
    </div>
  );
}

/**
 * La puerta de la página. `PreviewOnly` es el veredicto del SERVIDOR (`isAdmin`
 * de /auth/me) y falla cerrado: mientras carga, o si no se pudo leer, no pinta
 * nada. La nota de abajo solo aparece con un «no» explícito, para que quien llega
 * por los enlaces del sitio del cliente no aterrice en una página en blanco.
 */
export default function ExchangeOperatorPage() {
  const { t } = useT();
  const isAdmin = useAuthStore((s) => s.isAdmin);
  // `isAdmin` arranca en false mientras /auth/me viaja: sin esta marca la nota
  // parpadearía para un fundador en cada carga.
  const meAnswered = useAuthStore((s) => s.legacyAccessKnown);
  return (
    <>
      <PreviewOnly
        label="Mesa del operador del exchange"
        pending="crear un exchange es de fundadores hasta que exija la credencial de la raíz y cada exchange tenga dueño"
      >
        <OperatorRoom />
      </PreviewOnly>
      {meAnswered && !isAdmin ? (
        <div className="p-6">
          <p className="text-sm text-ink/60">{t('This desk is open to the founders only for now.')}</p>
        </div>
      ) : null}
    </>
  );
}
