'use client';

/**
 * ManagerGovernance — la constitución de una bóveda, en lectura.
 *
 * TODO LO QUE SALE AQUÍ ES DEL CONSEJO, NO DEL GESTOR. Bajo `onlyCouncil` viven
 * los diez actos que cambian lo que la bóveda ES: proponer un sitio, retirarlo,
 * mover el tope, fijar el reparto, ceder la dirección, terminarla, poner la
 * puerta de entrada, cambiar la constitución, traspasar el consejo y evacuar.
 * El gestor no tiene ninguno — él solo mueve capital entre sitios que ya
 * existen. Esta pantalla es donde ve qué le ata, y qué tiene que pedirle al
 * quórum si quiere que cambie.
 *
 * ── LA MECHA DE 30 DÍAS ES AVISO, NO IMPOSIBILIDAD ─────────────────
 * `VENUE_DELAY = 30 days`, y el contrato lleva escrito el porqué en su propio
 * comentario: «adding a venue IS the power to extract».
 *
 * CORREGIDO EL 26-AGO, y la corrección importa. Este texto decía que la espera
 * «es toda la seguridad», dando a entender que impide el robo. NO LO IMPIDE: en
 * el pote v1 —el que está vivo hoy— quien gobierna puede proponer un vault
 * FALSO, esperar 31 días y mandarle capital. Está reproducido en
 * `AstryumCage.t.sol::test_v1_the_robbery_that_WAS_possible`, y el propio test
 * lo llama por su nombre: «el único freno de la v1: la espera». La jaula v2 sí
 * lo cierra — un registro on-chain al que el pote pregunta él mismo — pero v2
 * no está en mainnet todavía.
 *
 * Y en Bóvedas con gestor esto no es teórico: el gestor ES el consejo (su cuenta
 * XRPL gobierna su propio pote), así que ese poder es SUYO.
 *
 * Por eso la pantalla vende los 30 días como lo que son: el mes que tienes para
 * salir. Sigue pintándose como CUENTA ATRÁS, y ahora avisa cuando ese mes no da
 * de sí — la ventana de salida (`COOLDOWN`, tope 30 d) puede igualar al propio
 * aviso y dejar margen CERO.
 *
 * ── DOS COSAS QUE NO CAMBIAN NUNCA ──────────────────────────────────────────
 * `COOLDOWN` y `BUFFER_FLOOR_BPS` son `immutable`: se fijan al nacer y no los
 * mueve ni el consejo. Se enseñan aparte y dichos así, porque son la única
 * promesa de esta pantalla que no depende de que nadie se porte bien.
 *
 * ── EL REPARTO ES DE RENDIMIENTO, NUNCA DE PRINCIPAL ────────────────────────
 * Los payees cobran un corte del rendimiento REALIZADO por encima de la marca
 * de cada venue, con techo duro fijado AL NACER el pote (`MAX_PAYEE_BPS` en la
 * generación v2; 20% para un pote abierto a terceros). No se dice «20% para
 * siempre» a secas porque un pote privado nace con otro techo — lo que sí es
 * universal es que el techo es inmutable y que el corte es de yield. Decir
 * solo «se lleva un X%» dejaría creer que el corte sale del dinero que metiste.
 * No hay ninguna función que pague principal a una dirección arbitraria.
 */

import { useCallback, useEffect, useState } from 'react';
import { Clock, Coins, Landmark, Loader2, Lock, ShieldCheck } from 'lucide-react';

import { Card, GhostButton, MicroLabel, Pill } from '../ui/primitives';
import { useT } from '../../i18n/LanguageProvider';
import { shortAddr } from '../../lib/institutional/format';
import { getPoteState, type PoteState } from '../../lib/institutional/api';

const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

function days(ms: number): number {
  return Math.ceil(ms / 86400000);
}

function Row({ k, v, hint }: { k: string; v: string; hint?: string }) {
  return (
    <div className="border-b border-ink/5 py-2.5 last:border-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[12px] text-ink/45">{k}</span>
        <span className="truncate font-mono text-[12px] text-ink/80">{v}</span>
      </div>
      {hint && <p className="mt-1 max-w-[62ch] text-[11px] leading-relaxed text-ink/35">{hint}</p>}
    </div>
  );
}

export function ManagerGovernance({ pote }: { pote: string }) {
  const { t } = useT();
  const [state, setState] = useState<PoteState | null>(null);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(async () => {
    try {
      setState(await getPoteState(pote));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [pote]);

  useEffect(() => { void reload(); }, [reload]);

  if (failed) {
    return (
      <Card className="p-6">
        <p className="max-w-[62ch] text-sm leading-relaxed text-tone-warning/80">
          {t('The constitution could not be read right now. That is not the same as this vault having none.')}
        </p>
        <GhostButton onClick={() => void reload()} className="mt-3">{t('Retry')}</GhostButton>
      </Card>
    );
  }

  if (!state) {
    return (
      <Card className="p-6">
        <p className="flex items-center gap-2 text-sm text-ink/45">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('Reading the constitution…')}
        </p>
      </Card>
    );
  }

  const g = state.governance;
  const hasDirector = g.director && g.director !== ZERO_ADDR;
  const untilMs = g.directorUntil * 1000;
  const mandateOver = hasDirector && untilMs <= Date.now();
  const totalPayeeBps = g.payees.reduce((acc, p) => acc + p.bps, 0);
  /** Dias de sobra entre poder salir y que el destino nuevo se abra. */
  const VENUE_DELAY_DAYS = 30;
  const escapeMargin = VENUE_DELAY_DAYS - state.cooldownSeconds / 86400;

  return (
    <div className="space-y-5">
      {/* Lo inmutable primero: es lo único de esta pantalla que no depende de
          que nadie se porte bien. */}
      <Card className="p-6">
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-ink/35" strokeWidth={1.8} />
          <MicroLabel>{t('Fixed at birth, forever')}</MicroLabel>
        </div>
        <div className="mt-3">
          <Row
            k={t('Exit window')}
            v={state.cooldownSeconds === 0 ? t('immediate') : `${Math.round(state.cooldownSeconds / 3600)} h`}
            hint={t('How long a client waits after asking to leave. Neither the manager nor the council can change it.')}
          />
          <Row
            k={t('Untouchable floor')}
            v={`${state.bufferFloorBps / 100}%`}
            hint={t('The share that always stays liquid. The manager cannot cross it; a client leaving may.')}
          />
        </div>
      </Card>

      {/* Los sitios, con la mecha. */}
      <Card className="p-6">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-ink/35" strokeWidth={1.8} />
          <MicroLabel>{t('Allowed venues')}</MicroLabel>
        </div>
        <p className="mt-2 max-w-[70ch] text-[12px] leading-relaxed text-ink/45">
          {t('A new venue waits 30 days before any capital may enter it. Read that delay as NOTICE, not as impossibility: whoever governs this vault can add a destination, and that is the one power that could reach your capital. The 30 days are the month you have to leave first.')}
        </p>
        {escapeMargin <= 0 && (
          // La ventana de escape es `cooldown`; el aviso es 30 dias. Si el
          // primero iguala al segundo, quien se entere un dia tarde ya no
          // llega. Con MAX_COOLDOWN = 30 d y VENUE_DELAY = 30 d el margen
          // puede ser CERO, y eso hay que decirlo aqui y no descubrirlo.
          <p className="mt-2 max-w-[70ch] text-[12px] leading-relaxed text-tone-warning/80">
            {t('Careful: this vault’s exit window is as long as that notice, so the month to leave is exactly the month you would need. Noticing a day late means not getting out before the new destination opens.')}
          </p>
        )}

        {state.venues.length === 0 ? (
          <p className="mt-4 text-sm text-ink/45">{t('No venues allowed yet.')}</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {state.venues.map((v) => {
              const waitMs = v.readyAt * 1000 - Date.now();
              return (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink/10 px-3 py-2">
                  <span className="truncate font-mono text-[12px] text-ink/70">{shortAddr(v.target)}</span>
                  {v.retired ? (
                    <Pill tone="neutral">{t('retired')}</Pill>
                  ) : waitMs > 0 ? (
                    // La cuenta atrás, en su sitio y con su tono: es una espera
                    // que protege, no un error.
                    <Pill tone="warning">{`${t('opens in')} ${days(waitMs)} d`}</Pill>
                  ) : (
                    <Pill tone="success">{t('open')}</Pill>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-4">
          <Row
            k={t('Max per venue')}
            v={`${state.maxVenueBps / 100}%`}
            hint={t('The most that may sit in any single venue. The council can move this; the manager cannot.')}
          />
        </div>
      </Card>

      {/* Quién manda, y hasta cuándo. */}
      <Card className="p-6">
        <div className="flex items-center gap-2">
          <Landmark className="h-4 w-4 text-ink/35" strokeWidth={1.8} />
          <MicroLabel>{t('Who holds authority')}</MicroLabel>
        </div>
        <div className="mt-3">
          <Row
            k={t('Council')}
            v={shortAddr(g.council)}
            hint={t('The only address that can change what this vault is. Everything on this screen is its doing.')}
          />
          <Row
            k={t('Director')}
            v={hasDirector ? shortAddr(g.director) : t('nobody — the council runs it itself')}
            hint={
              !hasDirector
                ? t('No direction has been granted, so only the council can move capital.')
                : mandateOver
                  ? t('This mandate has already run out: the address is still on record, but its moves now revert.')
                  : `${t('Runs out in')} ${days(untilMs - Date.now())} d — ${t('authority expires on its own and never renews itself.')}`
            }
          />
          <Row k={t('Constitution')} v={`${g.constitutionRef.slice(0, 18)}…`} />
        </div>
      </Card>

      {/* El reparto, dicho entero. */}
      <Card className="p-6">
        <div className="flex items-center gap-2">
          <Coins className="h-4 w-4 text-ink/35" strokeWidth={1.8} />
          <MicroLabel>{t('The cut')}</MicroLabel>
        </div>
        {g.payees.length === 0 ? (
          <p className="mt-3 text-sm text-ink/45">{t('Nobody takes a cut: all yield stays in the vault.')}</p>
        ) : (
          <>
            <ul className="mt-3 space-y-1.5">
              {g.payees.map((p) => (
                <li key={p.account} className="flex items-center justify-between gap-3 text-[12px]">
                  <span className="truncate font-mono text-ink/70">{shortAddr(p.account)}</span>
                  <span className="shrink-0 font-mono text-ink/80">{p.bps / 100}%</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 font-mono text-[12px] text-ink/60">
              {t('Total')}: {totalPayeeBps / 100}%
            </p>
          </>
        )}
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-ink/10 bg-ink/[0.02] p-4">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-ink/35" strokeWidth={1.7} />
          <p className="max-w-[62ch] text-[12px] leading-relaxed text-ink/50">
            {t('The cut is taken from realised yield above each venue’s high-water mark — never from the capital you put in. Its ceiling was fixed when this pote was born and cannot be raised afterwards: it is in the contract, not in a policy.')}
          </p>
        </div>
      </Card>

      {/* Lo que el gestor NO puede, dicho una vez y entero. */}
      <Card className="p-6">
        <MicroLabel>{t('What only the council may do')}</MicroLabel>
        <p className="mt-2 max-w-[70ch] text-[12px] leading-relaxed text-ink/45">
          {t('Propose or retire a venue, move the per-venue cap, set the cut, grant or end direction, set the entry gate, amend the constitution, hand over the council, and evacuate a venue. The manager holds none of these — moving capital between venues that already exist is the whole of the job.')}
        </p>
      </Card>
    </div>
  );
}

export default ManagerGovernance;
