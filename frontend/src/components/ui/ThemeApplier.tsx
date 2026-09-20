'use client';

/**
 * ThemeApplier — estampa en <html> los TRES atributos que visten el panel
 * mientras el panel está montado:
 *
 *   · data-skin      el TEMA (material): astryum · institutional
 *   · data-theme     la LUZ: dark · light ('system' se resuelve en vivo)
 *   · data-authority la autoridad activa: single · governed
 *
 * En <html> (no en el div del shell) para que todo lo que vive FUERA del
 * árbol del shell —los portales de body (ProductTour, modales de la puerta,
 * el QR de Xaman) y los hermanos del layout (ProductAssistant,
 * LegacyComingSoonModal)— herede los tres. El copiloto salía dorado dentro de
 * Legacy precisamente porque el sello de autoridad vivía solo en el div del
 * shell y el copiloto es un hermano (fundador 2026-08-04).
 *
 * Los tres leen el mismo par de stores, así que no pueden discrepar. Al
 * desmontar se retiran los tres: la landing y el login llevan su propio
 * aspecto fijo (la landing gestiona data-authority por su cuenta). La misma
 * frontera que respeta el script pre-pintado — ver lib/theme/appearance.ts
 * §pathWearsAppearance.
 *
 * EL PRIMER FRAME NO ES SUYO. Estos efectos corren DESPUÉS del primer
 * pintado; con un tema que cambia fondo, radio, tipografía y sombras, ese
 * frame no es un detalle. Lo cubre el script pre-pintado
 * (lib/theme/prepaint.ts, inyectado en app/layout.tsx), que ya dejó data-skin
 * y data-theme puestos antes de que existiera React; aquí solo se mantienen
 * al día cuando el usuario cambia de opinión.
 */

import { useEffect, useRef, useState } from 'react';
import { useResolvedTheme, useThemeStore } from '../../stores/themeStore';
import { useAuthorityStore } from '../../stores/authorityStore';
import { useMotionLevel } from '../../stores/motionStore';
import { SKIN_ATTRIBUTE, THEME_ATTRIBUTE } from '../../lib/theme/appearance';
import { bumpSkinEpoch } from '../../lib/theme/sweep';

/** EL RE-TINTE LENTO (fundador 2026-08-25: «el color de la página cambiando
 *  lentamente, simple pero potente»). Las variables CSS no transicionan, pero
 *  los elementos que las consumen sí: durante ~1s tras cada cruce, la clase
 *  authority-retint (globals.css) pide a todo el árbol transicionar
 *  background/border/color — y se retira sola, así que el coste vive solo en
 *  el cruce. Reduced motion lo anula la propia CSS.
 *
 *  Lo comparten los tres ejes porque los tres son el mismo gesto: la página
 *  mudando de piel. Cambiar de tema entero de golpe sería un salto brusco;
 *  con el re-tinte, el panel se CONVIERTE en el otro durante un segundo
 *  largo. El primer estampado nunca transiciona — entrar ya vestido no es un
 *  cruce. */
function useSlowRetint(value: string): void {
  const prev = useRef<string | null>(null);
  useEffect(() => {
    const root = document.documentElement;
    const isFlip = prev.current !== null && prev.current !== value;
    prev.current = value;
    if (!isFlip) return;
    root.classList.add('authority-retint');
    const timer = setTimeout(() => root.classList.remove('authority-retint'), 1150);
    return () => {
      clearTimeout(timer);
      root.classList.remove('authority-retint');
    };
  }, [value]);
}

export default function ThemeApplier() {
  const skin = useThemeStore((s) => s.skin);
  const theme = useThemeStore((s) => s.theme);
  const productMode = useAuthorityStore((s) => s.productMode);

  // ── EL TEMA ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute(SKIN_ATTRIBUTE, skin);
    return () => {
      root.removeAttribute(SKIN_ATTRIBUTE);
    };
  }, [skin]);
  useSlowRetint(skin);

  // ── EL BARRIDO DEL CAMBIO DE TEMA (fundador 2026-09-14: «alguna especie de
  // barrido para cuando se cambia el tema») ─────────────────────────────────
  // Cambiar de material es cambiar de mundo, y un mundo no se sustituye de
  // golpe: con el re-tinte de arriba los colores cruzan despacio; con la ÉPOCA
  // (lib/theme/sweep.ts) cada RevealGroup vuelve a jugar su entrada en el
  // lenguaje del tema nuevo —la página se imprime al pasar a la lámina, se
  // posa al volver a Astryum—; y con la luz de abajo (.theme-sweep,
  // globals.css) una banda del acento nuevo recorre la pantalla entera, que
  // es lo que llega al menú y a las cabeceras, que no viven en ningún grupo.
  // El primer estampado no es un cambio: entrar ya vestido no barre nada.
  const [sweep, setSweep] = useState(0);
  const prevSkinForSweep = useRef<string | null>(null);
  useEffect(() => {
    const isFlip = prevSkinForSweep.current !== null && prevSkinForSweep.current !== skin;
    prevSkinForSweep.current = skin;
    if (!isFlip) return;
    bumpSkinEpoch();
    setSweep((n) => n + 1);
  }, [skin]);
  // LA LUZ TAMBIÉN BARRE, pero no reimprime: cambiar de claro a oscuro no
  // cambia de material —no hay entrada nueva que jugar—, pero en Ajustes las
  // dos filas viven bajo «Apariencia» y el fundador pidió un barrido «cuando
  // se cambia el tema». La banda pasa (con el acento de la cara nueva y su
  // mezcla: multiply sobre papel) y la época se queda quieta. Se mira la luz
  // RESUELTA: pasar de «sistema» a lo que el sistema ya era no barre nada.
  const resolved = useResolvedTheme();
  const prevLightForSweep = useRef<string | null>(null);
  useEffect(() => {
    const isFlip = prevLightForSweep.current !== null && prevLightForSweep.current !== resolved;
    prevLightForSweep.current = resolved;
    if (!isFlip) return;
    setSweep((n) => n + 1);
  }, [resolved]);
  // En Mínimo la banda NO SE MONTA (astryum-73, 14-sep): con `display: none`
  // una animación CSS no termina y `animationend` no llega, así que el nodo
  // se quedaba montado el resto de la sesión. Lo que no se va a ver, no se
  // pinta.
  const level = useMotionLevel();

  // ── LA LUZ ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const root = document.documentElement;
    // 'system' (fundador 2026-08-17) sigue al SO en vivo: se resuelve contra
    // prefers-color-scheme y se re-estampa cuando el SO cambia — la app
    // cambia con el atardecer sin recargar.
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: light)');
      const apply = () => root.setAttribute(THEME_ATTRIBUTE, mq.matches ? 'light' : 'dark');
      apply();
      mq.addEventListener('change', apply);
      return () => {
        mq.removeEventListener('change', apply);
        root.removeAttribute(THEME_ATTRIBUTE);
      };
    }
    root.setAttribute(THEME_ATTRIBUTE, theme);
    return () => {
      root.removeAttribute(THEME_ATTRIBUTE);
    };
  }, [theme]);
  useSlowRetint(theme);

  // ── LA AUTORIDAD ─────────────────────────────────────────────────────────
  const authority = productMode === 'legacy' ? 'governed' : 'single';
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-authority', authority);
    return () => {
      root.removeAttribute('data-authority');
    };
  }, [authority]);
  useSlowRetint(authority);

  // La banda de luz: se monta con clave nueva en cada cambio (así la animación
  // CSS arranca de cero) y se retira sola al terminar. Sin eventos de ratón,
  // por encima del contenido y por debajo de los modales.
  return sweep > 0 && level !== 'minimal' ? (
    <div key={sweep} className="theme-sweep" aria-hidden onAnimationEnd={() => setSweep(0)} />
  ) : null;
}
