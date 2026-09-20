'use client';

/**
 * SkinPreview / SkinChoice — el panel en miniatura, vestido con SU tema.
 *
 * UNA SOLA PIEZA, DOS SITIOS: el cuestionario de alta (OnboardingModal) y
 * Preferencias (settings/AppearanceSettings) enseñan exactamente lo mismo. Es
 * la regla que ya siguen las probetas de Movimiento: «no imitan nada, usan
 * las MISMAS piezas», porque una maqueta que se parece es una maqueta que
 * miente en cuanto alguien toca el tema y se olvida de la maqueta.
 *
 * EL TRUCO QUE LA HACE HONESTA está en el `data-skin`/`data-theme` de la
 * caja: globals.css define los tokens por selector de atributo, así que
 * declararlos aquí hace que toda la miniatura —fondo, filetes, tipografía,
 * acento, geometría— se pinte con el material de ESE tema aunque la página
 * lleve puesto el otro. No hay colores escritos a mano en este fichero: todo
 * sale de los mismos tokens que visten la aplicación.
 *
 * `data-authority='single'` la fija en la cara Personal para que la
 * comparación no dependa de si el usuario estaba dentro de un Legacy.
 */

import type { Skin } from '../../../lib/theme/appearance';
import { GuillocheField, GuillocheRosette } from './marks';

/** La miniatura desnuda — sin marco ni nombre: solo el panel. */
export function SkinPreview({
  skin,
  theme,
  t,
}: {
  skin: Skin;
  /** La luz YA RESUELTA: los bloques de tokens cruzan los dos ejes, así que
   *  sin estampar también la luz, la probeta se quedaría con la cara oscura
   *  del tema mientras el panel está en claro. */
  theme: 'dark' | 'light';
  t: (s: string) => string;
}) {
  const engraved = skin === 'institutional';
  return (
    <div
      data-skin={skin}
      data-theme={theme}
      data-authority="single"
      className="relative h-[164px] overflow-hidden px-3.5 pt-3"
      style={{ background: 'var(--shell-bg)' }}
    >
      {/* EL FONDO de cada mundo: el campo de estrellas o el rayado de
          seguridad. Es lo primero que los distingue de un vistazo. */}
      {engraved ? (
        <GuillocheField />
      ) : (
        <>
          <div
            className="absolute inset-0"
            style={{
              background: 'radial-gradient(120% 90% at 50% -20%, hsl(var(--volt) / 0.16), transparent 70%)',
            }}
          />
          <div className="starfield absolute inset-0" />
        </>
      )}

      <div className="relative">
        {/* la cabecera de página: epígrafe, título y, en la lámina, su regla */}
        <div
          className={engraved ? 'plate-register text-[7px] text-volt-soft/70' : 'text-[7px] font-medium text-ink/40'}
        >
          {t('Earn')}
        </div>
        <div
          className="mt-1 text-[15px] leading-none text-ink"
          style={
            engraved
              ? { fontFamily: 'var(--font-serif), Georgia, serif', fontWeight: 500 }
              : { fontWeight: 600, letterSpacing: '-0.02em' }
          }
        >
          {t('Make it earn, simply')}
        </div>
        <div className="mt-2 h-px" style={{ background: engraved ? 'var(--plate-rule)' : 'hsl(var(--ink) / 0.07)' }} />

        {/* la puerta: tarjeta con su dibujo a la derecha */}
        <div
          className={`relative mt-2.5 flex items-center gap-2 border p-2.5 ${engraved ? 'plate' : 'rounded-xl'}`}
          style={{
            background: 'hsl(var(--surface-1))',
            borderColor: engraved ? 'var(--plate-rule)' : 'hsl(var(--ink) / 0.06)',
            boxShadow: engraved ? 'none' : '0 8px 20px -14px rgba(0,0,0,0.8)',
          }}
        >
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[13px] leading-none text-ink tabular-nums">12 480,00</div>
            <div className="mt-1.5 h-1 w-14 rounded-full" style={{ background: 'hsl(var(--ink) / 0.12)' }} />
          </div>
          <span className="shrink-0 opacity-80">{engraved ? <GuillocheRosette size={46} /> : <MiniOrbit />}</span>
        </div>

        {/* el botón principal, con el acabado de su tema */}
        <div className="mt-2.5 flex items-center gap-2">
          <span
            className={`inline-flex items-center px-2.5 py-1 text-[9px] font-semibold ${engraved ? '' : 'rounded-lg'}`}
            style={{
              background: 'hsl(var(--volt))',
              color: 'hsl(var(--volt-ink))',
              borderRadius: engraved ? 2 : undefined,
              boxShadow: engraved ? 'inset 0 0 0 1px hsl(var(--volt-hi) / 0.26)' : undefined,
            }}
          >
            {t('Open')}
          </span>
          {/* Aquí había una balanza a 26px. Se retiró (2026-09-13) porque a ese
              tamaño no se leía: el dibujo tiene fuste, brazo, tirantes, dos
              platillos y una base, y ningún grosor de trazo salva esa densidad
              en 26 píxeles — engordarlo solo lo convierte en una mancha. La
              probeta ya lleva el carácter del grabado en la roseta de 46px,
              que sí se lee. Un dibujo que no se puede leer a su tamaño de
              montaje no se monta ahí. */}
        </div>
      </div>
    </div>
  );
}

/** La probeta como OPCIÓN: la miniatura, su nombre y el radio. */
export function SkinChoice({
  skin,
  theme,
  selected,
  label,
  onSelect,
  t,
}: {
  skin: Skin;
  theme: 'dark' | 'light';
  selected: boolean;
  label: string;
  onSelect: () => void;
  t: (s: string) => string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`group overflow-hidden rounded-xl border text-left transition-colors ${
        selected ? 'border-volt/60' : 'border-ink/10 hover:border-ink/25'
      }`}
    >
      <SkinPreview skin={skin} theme={theme} t={t} />
      {/* el nombre, ya fuera de la probeta y en el tema ACTIVO de la página */}
      <div className="flex items-center justify-between gap-2 border-t border-ink/[0.06] px-3 py-2">
        <span className="text-[13px] font-medium text-ink">{label}</span>
        <span
          aria-hidden
          className={`grid h-3.5 w-3.5 place-items-center rounded-full border ${
            selected ? 'border-volt' : 'border-ink/25'
          }`}
        >
          {selected && <span className="h-1.5 w-1.5 rounded-full bg-volt" />}
        </span>
      </div>
    </button>
  );
}

/** El guiño de Astryum en la probeta: un sistema en órbita, a escala de
 *  miniatura. No se importa una escena de verdad porque las de la casa se
 *  dibujan a 170px y aquí hay 46. */
function MiniOrbit() {
  return (
    <svg width="46" height="46" viewBox="0 0 46 46" fill="none" aria-hidden className="text-volt">
      <circle cx="23" cy="23" r="18" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1" />
      <circle cx="23" cy="23" r="11" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1" />
      <circle cx="23" cy="23" r="4.5" fill="currentColor" fillOpacity="0.85" />
      <circle cx="41" cy="23" r="2" fill="currentColor" fillOpacity="0.6" />
      <circle cx="12" cy="23" r="1.6" fill="currentColor" fillOpacity="0.45" />
    </svg>
  );
}
