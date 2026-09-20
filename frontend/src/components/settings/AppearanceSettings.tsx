'use client';

/**
 * AppearanceSettings — las dos filas de «Apariencia» en Preferencias.
 *
 *   · TEMA — de qué material está hecho el panel. Dos PROBETAS GRANDES, una
 *     por tema, que se pintan con el material de verdad: tokens, tipografía,
 *     geometría, fondo y dibujo. No son capturas ni maquetas de colores: cada
 *     probeta se envuelve en un `data-skin`/`data-theme` propio y hereda del
 *     mismo bloque de globals.css que viste la aplicación entera, así que lo
 *     que se ve aquí es exactamente lo que se verá al pulsar.
 *   · CLARO U OSCURO — la luz. Es un eje APARTE: elegir «institucional» no te
 *     quita el modo claro, y elegir «claro» no te devuelve al oro. Por eso son
 *     dos filas y no una lista revuelta de cuatro combinaciones.
 */

import { useState } from 'react';
import { useT } from '../../i18n/LanguageProvider';
import { useResolvedTheme, useThemeStore, type AppTheme, type Skin } from '../../stores/themeStore';
import { SKINS } from '../../lib/theme/appearance';
import { SkinChoice } from '../ui/skin/SkinPreview';

const SKIN_LABEL: Record<Skin, string> = {
  astryum: 'Astryum',
  institutional: 'Institutional',
};

/** Qué ES cada tema, en una frase factual. Sin adjetivos de venta y sin
 *  prometer nada: describe el material, como la fila de Movimiento. */
const SKIN_DESCRIPTION: Record<Skin, string> = {
  astryum:
    'Deep space and warm gold. Living scenes on the doors, generous corners, orbits and a breathing star field. The house look — nothing moves from where you know it.',
  institutional:
    'Ink on register paper. Bronze instead of gold, square corners, serif headings, rules instead of shadows, and engraved marks — the guilloche rosette, the balance, the portico — instead of scenes.',
};

export default function AppearanceSettings() {
  const { t } = useT();
  const skin = useThemeStore((s) => s.skin);
  const theme = useThemeStore((s) => s.theme);
  const setSkin = useThemeStore((s) => s.setSkin);
  const setTheme = useThemeStore((s) => s.setTheme);
  const resolved = useResolvedTheme();
  const [saveFailed, setSaveFailed] = useState(false);

  const save = (p: Promise<boolean>) => {
    setSaveFailed(false);
    void p.then((ok) => setSaveFailed(!ok));
  };

  return (
    <>
      {/* ── EL TEMA ─────────────────────────────────────────────────────── */}
      <div className="py-2 border-b border-ink/5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm text-ink/90">{t('Theme')}</div>
            <div className="text-xs text-ink/40 mt-0.5">
              {t('The material the panel is made of — colours, drawings and layout, not just a tint. It follows your account, not this browser.')}
            </div>
          </div>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={t('Theme')}>
          {SKINS.map((s) => (
            <SkinChoice
              key={s}
              skin={s}
              theme={resolved}
              selected={skin === s}
              label={t(SKIN_LABEL[s])}
              onSelect={() => save(setSkin(s))}
              t={t}
            />
          ))}
        </div>

        <p className="mt-2 text-xs leading-relaxed text-ink/50">{t(SKIN_DESCRIPTION[skin])}</p>
        {saveFailed && (
          <p className="mt-1.5 text-[11px] leading-relaxed text-tone-warning">
            {t('The change did not reach your account — it stays on this device, so other browsers will not see it. Try again in a moment.')}
          </p>
        )}
      </div>

      {/* ── LA LUZ ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 py-2 border-b border-ink/5">
        <div>
          <div className="text-sm text-ink/90">{t('Light or dark')}</div>
          <div className="text-xs text-ink/40 mt-0.5">
            {t('Every theme has both faces. You can also let your device decide.')}
          </div>
        </div>
        <div
          className="flex items-center rounded-lg border border-ink/10 bg-ink/[0.03] p-0.5 text-[11px] font-medium shrink-0"
          role="radiogroup"
          aria-label={t('Light or dark')}
        >
          {(
            [
              { key: 'dark', label: t('Dark') },
              { key: 'light', label: t('Light') },
              { key: 'system', label: t('System') },
            ] as { key: AppTheme; label: string }[]
          ).map((o) => (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={theme === o.key}
              onClick={() => save(setTheme(o.key))}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                theme === o.key ? 'bg-volt text-volt-ink' : 'text-ink/50 hover:text-ink'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
