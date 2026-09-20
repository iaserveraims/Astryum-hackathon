/**
 * El script PRE-PINTADO de la apariencia (lib/theme/appearance.ts).
 *
 * Se inyecta inline en el <head> (app/layout.tsx) y corre ANTES del primer
 * pintado: lee el tema y la luz guardados y los estampa en <html>. Sin él,
 * quien eligió el tema Institucional vería el panel arrancar dorado con
 * esquinas redondas y cuadrarse un frame después, en cada carga — que es
 * justo el destello que el ajuste existe para evitar. Con un tema que cambia
 * el fondo, el radio, la tipografía y las sombras, ese frame no es un
 * detalle. Es la misma pieza, y por la misma razón, que lib/motion/prepaint.ts.
 *
 * De paso tapa un agujero viejo: `data-theme` nunca se estampó antes del
 * primer frame, así que quien tenía la luz CLARA veía un fogonazo de espacio
 * oscuro en cada carga del panel. Ahora los dos ejes llegan a tiempo.
 *
 * SOLO EN EL PANEL. La landing, el login y las páginas legales llevan su
 * aspecto fijo (pathWearsAppearance): estampar ahí la preferencia de la
 * cuenta haría que la web pública cambiara de cara según quién hubiera usado
 * el navegador. ThemeApplier defiende esta misma frontera montándose solo
 * dentro de /app y retirando los sellos al desmontar.
 *
 * Sin dependencias del bundle a propósito: es JS de navegador puro, ES5, en
 * un IIFE, con try/catch porque localStorage lanza en modo privado en
 * algunos navegadores y eso no puede romper la carga. Vive como cadena
 * exportada (no como fichero .js suelto) para que el test lo ejecute tal cual
 * se inyecta, y para que la clave de storage no se duplique a mano.
 */

import {
  APPEARANCE_STORAGE_KEY,
  APP_THEMES,
  DASHBOARD_PREFIX,
  DEFAULT_SKIN,
  DEFAULT_THEME,
  SKINS,
  SKIN_ATTRIBUTE,
  THEME_ATTRIBUTE,
} from './appearance';

export function appearancePrepaintScript(): string {
  const key = JSON.stringify(APPEARANCE_STORAGE_KEY);
  const skins = JSON.stringify(SKINS);
  const themes = JSON.stringify(APP_THEMES);
  return (
    '(function(){try{' +
    // Fuera del panel no se estampa nada: la portada y el login conservan su
    // cara fija, exactamente como cuando ThemeApplier se desmonta.
    'var p=window.location&&window.location.pathname||"";' +
    `if(p!==${JSON.stringify(DASHBOARD_PREFIX)}&&p.indexOf(${JSON.stringify(DASHBOARD_PREFIX + '/')})!==0)return;` +
    `var skin=${JSON.stringify(DEFAULT_SKIN)},theme=${JSON.stringify(DEFAULT_THEME)};` +
    // Un JSON roto en storage no puede dejar los atributos sin poner: caen a
    // los valores por defecto, que son el tema de siempre.
    `try{var raw=window.localStorage.getItem(${key});` +
    'if(raw){var s=JSON.parse(raw);s=s&&s.state;' +
    `if(s){if(${skins}.indexOf(s.skin)>=0)skin=s.skin;` +
    `if(${themes}.indexOf(s.theme)>=0)theme=s.theme;}}}catch(e){}` +
    'if(theme==="system"){var m=window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)");' +
    'theme=m&&m.matches?"light":"dark";}' +
    'var r=document.documentElement;' +
    `r.setAttribute(${JSON.stringify(SKIN_ATTRIBUTE)},skin);` +
    `r.setAttribute(${JSON.stringify(THEME_ATTRIBUTE)},theme);` +
    '}catch(e){}})();'
  );
}
