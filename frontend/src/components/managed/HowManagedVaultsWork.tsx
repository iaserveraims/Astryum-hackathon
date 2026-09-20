'use client';

/**
 * HowManagedVaultsWork — la explicación del trato, en un solo sitio.
 *
 * VIVÍA SIEMPRE ABIERTA encima del catálogo, y eso la convertía en un peaje: la
 * leías una vez y luego la saltabas cada visita. Ahora sale (a) sola la PRIMERA
 * vez que alguien entra, y (b) cuando la pide desde el botón de arriba a la
 * derecha. La misma pieza en los dos sitios — dos explicaciones que se
 * mantienen aparte acaban divergiendo, y aquí divergir sería contar dos
 * versiones distintas de qué puede hacer alguien con tu dinero.
 */

import { AlertTriangle, Landmark, Lock, LogOut, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Card, MicroLabel } from '../ui/primitives';
import { useT } from '../../i18n/LanguageProvider';

/**
 * Un hecho: icono, afirmación y el mecanismo debajo.
 *
 * Recibe texto YA TRADUCIDO. Traducir dentro sería una llamada dinámica, y
 * `scripts/check-i18n.js` solo ve argumentos literales: el castellano se
 * publicaría ausente con el CI en verde.
 */
function Fact({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <li className="flex items-start gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink/35" strokeWidth={1.7} />
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-ink/80">{title}</p>
        <p className="mt-0.5 max-w-[62ch] text-[13px] leading-relaxed text-ink/50">{body}</p>
      </div>
    </li>
  );
}

/** El cuerpo, sin marco: lo reutilizan la card y el modal de primera visita. */
export function HowManagedVaultsWorkBody() {
  const { t } = useT();
  return (
    <>
      <ul className="space-y-4">
        <Fact
          icon={ShieldCheck}
          title={t('Not a loan, no collateral')}
          body={t('You deposit the asset and receive shares of the vault in your own wallet. Nothing is borrowed and nothing of yours is pledged: the vault pools the capital and the manager moves it — only inside the rules — to destinations that produce something, which stays in the vault pro-rata to your shares.')}
        />
        <Fact
          icon={Landmark}
          title={t('A manager puts your assets to work')}
          body={t('Someone who does this professionally moves the capital inside the vault, seeking a return. They are a third party — never Astryum.')}
        />
        <Fact
          icon={SlidersHorizontal}
          title={t('You choose the vault, and with it the risk')}
          body={t('Each vault says which venues it allows before you enter. Picking one is picking what can happen to your capital — that choice stays yours and is never made for you.')}
        />
        <Fact
          icon={Lock}
          title={t('Code holds them, not trust')}
          body={t('The manager can only move capital inside the parameters you signed. Those parameters are locked in the contract: step outside them and the transaction reverts. Nothing here depends on the manager behaving.')}
        />
        <Fact
          icon={ShieldCheck}
          title={t('A new destination gives you 30 days to leave')}
          body={t('The person running the vault can add a destination, and that is the one power that could reach your capital. It cannot be used for 30 days — so the notice is the protection, and leaving in time is yours to do.')}
        />
        <Fact
          icon={LogOut}
          title={t('You leave on your own')}
          body={t('Exiting does not need the manager’s permission. Each vault publishes how long its exit takes before you enter, and that clock is in the contract too.')}
        />
      </ul>

      {/* El límite de la protección, en su propio marco para que no se lea como
          nota al pie de las buenas noticias. */}
      <div className="mt-5 flex items-start gap-3 rounded-xl border border-tone-warning/25 bg-tone-warning/[0.06] p-4">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-tone-warning" strokeWidth={1.7} />
        <p className="max-w-[62ch] text-[13px] leading-relaxed text-ink/60">
          {t('What the code does NOT do is stop you losing money. It keeps the manager inside the vault’s rules; it cannot keep a venue the vault allows from falling. That risk is exactly why you pick the vault and not them.')}
        </p>
      </div>
    </>
  );
}

export function HowManagedVaultsWork() {
  const { t } = useT();
  return (
    <Card className="p-6">
      <MicroLabel>{t('How a managed vault works')}</MicroLabel>
      <div className="mt-4">
        <HowManagedVaultsWorkBody />
      </div>
    </Card>
  );
}

export default HowManagedVaultsWork;
