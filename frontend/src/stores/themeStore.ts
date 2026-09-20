'use client';

/**
 * themeStore — LA APARIENCIA DE LA CUENTA: el TEMA (material) y la LUZ.
 *
 * Las reglas del modelo, los tipos y los nombres de los dos ejes viven en
 * lib/theme/appearance.ts (parte pura, importable desde el servidor); aquí
 * está solo el store y su persistencia. Lee esa cabecera primero.
 */

import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  DEFAULT_SKIN,
  DEFAULT_THEME,
  isAppTheme,
  isSkin,
  type AppTheme,
  type AppearanceRecord,
  type Skin,
} from '../lib/theme/appearance';
import { getApiBase } from '../lib/env';

export type { AppTheme, Skin } from '../lib/theme/appearance';
export { SKINS, APP_THEMES } from '../lib/theme/appearance';

interface ThemeState extends AppearanceRecord {
  /** La cuenta cuya vista son `skin`/`theme`; null antes del primer login. */
  accountKey: string | null;
  byAccount: Record<string, AppearanceRecord>;

  setSkin: (s: Skin) => Promise<boolean>;
  setTheme: (t: AppTheme) => Promise<boolean>;
  /** Las dos a la vez — el cuestionario de alta elige un ASPECTO, no dos
   *  ajustes sueltos, y una sola escritura evita la carrera de dos POST. */
  setAppearance: (a: Partial<AppearanceRecord>) => Promise<boolean>;

  activateAccount: (key: string) => void;
  /** Lo que dice GET /auth/me para la cuenta activa. El servidor gana. */
  adoptServerAppearance: (a: AppearanceRecord, accountKey: string | null) => void;
}

/** Escribe la apariencia EN LA CUENTA. Sin sesión no hay cuenta a la que
 *  seguir: lo local es todo lo que existe, y eso ES el resultado correcto. */
async function persistToAccount(a: AppearanceRecord): Promise<boolean> {
  if (typeof window === 'undefined') return true;
  let token: string | null = null;
  try {
    token = window.localStorage.getItem('auth_token');
  } catch {
    /* modo privado */
  }
  if (!token || token === 'dev-bypass-no-jwt') return true;
  try {
    const res = await fetch(`${getApiBase()}/auth/appearance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(a),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => {
      /** Aplica el parche a la vista Y al registro de la cuenta activa. */
      const write = (patch: Partial<AppearanceRecord>): AppearanceRecord => {
        const s = get();
        const next: AppearanceRecord = {
          skin: patch.skin ?? s.skin,
          theme: patch.theme ?? s.theme,
        };
        set({
          ...next,
          byAccount: s.accountKey ? { ...s.byAccount, [s.accountKey]: next } : s.byAccount,
        });
        return next;
      };
      return {
        ...DEFAULT_APPEARANCE,
        accountKey: null,
        byAccount: {},

        setAppearance: (a) => persistToAccount(write(a)),
        setSkin: (skin) => persistToAccount(write({ skin })),
        setTheme: (theme) => persistToAccount(write({ theme })),

        activateAccount: (key) => {
          const s = get();
          if (s.accountKey === key) return;
          const known = s.byAccount[key];
          // Primera activación en este navegador: el registro sin cuenta —
          // el que existía antes de que las cuentas se distinguieran —
          // pertenece a quien ha entrado ahora. Las siguientes empiezan en el
          // tema de la casa.
          const legacy = s.accountKey === null && Object.keys(s.byAccount).length === 0;
          const rec: AppearanceRecord =
            known ?? (legacy ? { skin: s.skin, theme: s.theme } : { ...DEFAULT_APPEARANCE });
          set({ accountKey: key, ...rec, byAccount: { ...s.byAccount, [key]: rec } });
        },

        adoptServerAppearance: (a, accountKey) => {
          const s = get();
          const key = accountKey ?? s.accountKey;
          set({
            ...a,
            accountKey: key ?? s.accountKey,
            byAccount: key ? { ...s.byAccount, [key]: a } : s.byAccount,
          });
        },
      };
    },
    {
      name: APPEARANCE_STORAGE_KEY,
      partialize: (s) => ({
        // `skin`/`theme` en la RAÍZ del estado persistido a propósito: es lo
        // que lee el script pre-pintado (lib/theme/prepaint.ts) sin conocer
        // la cuenta activa, un frame antes de que exista React.
        skin: s.skin,
        theme: s.theme,
        accountKey: s.accountKey,
        byAccount: s.byAccount,
      }),
      // Un valor corrupto en localStorage no puede colar un tema inventado —
      // sin bloque de tokens, sería la casa a medio vestir.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ThemeState>;
        return {
          ...current,
          ...p,
          skin: isSkin(p.skin) ? p.skin : DEFAULT_SKIN,
          theme: isAppTheme(p.theme) ? p.theme : DEFAULT_THEME,
          byAccount: p.byAccount && typeof p.byAccount === 'object' ? p.byAccount : {},
        };
      },
    },
  ),
);

/** El tema elegido — para quien cambia de ARTEFACTO, no solo de color. */
export function useSkin(): Skin {
  return useThemeStore((s) => s.skin);
}

/**
 * Atajo de lectura para el caso más repetido: «¿toca el grabado?».
 *
 * Se llama por el ARTEFACTO y no por la marca a propósito (nombre propuesto
 * por la sesión paralela astryum-27, y es el bueno): `useSkin() ===
 * 'institutional'` escrito treinta veces son treinta sitios donde comparar
 * mal un literal, y cuando entre el tercer tema, quien pregunte por el
 * grabado seguirá preguntando por él y no por el nombre de un tema.
 */
export function useEngraved(): boolean {
  return useThemeStore((s) => s.skin) === 'institutional';
}

/**
 * La luz REAL, con 'system' ya resuelto contra el dispositivo y siguiéndolo en
 * vivo. La necesita quien tiene que ESTAMPAR la luz en una caja concreta —las
 * probetas del selector de tema (ui/skin/SkinPreview.tsx)— porque los bloques
 * de tokens cruzan los dos ejes: sin la luz al lado del tema, la probeta se
 * quedaría con la cara oscura mientras el panel está en claro.
 *
 * En el servidor y en el primer render devuelve 'dark' para 'system' (el
 * mismo valor que asume el servidor), y corrige un frame después: así no hay
 * desajuste de hidratación.
 */
export function useResolvedTheme(): 'dark' | 'light' {
  const theme = useThemeStore((s) => s.theme);
  const [osLight, setOsLight] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const read = () => setOsLight(mq.matches);
    read();
    mq.addEventListener('change', read);
    return () => mq.removeEventListener('change', read);
  }, []);
  if (theme === 'system') return osLight ? 'light' : 'dark';
  return theme;
}
