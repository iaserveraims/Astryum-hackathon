/**
 * El script PRE-PINTADO del nivel de movimiento (stores/motionStore.ts).
 *
 * Se inyecta inline en el <head> (app/layout.tsx) y corre ANTES del primer
 * pintado: lee el nivel guardado y estampa `data-motion` en <html>. Sin él,
 * un usuario en «sereno» vería las escenas del Earn arrancar a girar y frenar
 * un frame después, en cada carga — que es justo el destello que el ajuste
 * existe para evitar. La CSS de globals.css solo mira este atributo, así que
 * el atributo tiene que estar antes que la CSS pinte.
 *
 * Sin nada guardado aplica la regla del primer arranque (defaultMotionLevel):
 * lo de siempre, salvo que el dispositivo pida movimiento reducido. La misma
 * regla que MotionApplier graba como primera elección.
 *
 * Vive como cadena exportada (no como fichero .js suelto) para que el test
 * lo ejecute tal cual se inyecta, y para que la clave de storage y la lista
 * de niveles no se dupliquen a mano en dos sitios.
 *
 * Sin dependencias del bundle a propósito: es JS de navegador puro, ES5, en
 * un IIFE, con try/catch porque localStorage lanza en modo privado en
 * algunos navegadores y eso no puede romper la carga.
 */

import { MOTION_ATTRIBUTE, MOTION_LEVELS, MOTION_STORAGE_KEY } from './level';

export function motionPrepaintScript(): string {
  const key = JSON.stringify(MOTION_STORAGE_KEY);
  const levels = JSON.stringify(MOTION_LEVELS);
  return (
    '(function(){try{' +
    'var level=null;' +
    `var raw=window.localStorage.getItem(${key});` +
    // Un JSON roto en storage no puede dejar el atributo sin poner: cae a la
    // regla del primer arranque.
    'if(raw){try{var s=JSON.parse(raw);var v=s&&s.state&&s.state.level;' +
    `if(${levels}.indexOf(v)>=0)level=v;}catch(e){}}` +
    'if(!level){var os=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;' +
    'level=os?"minimal":"full";}' +
    `document.documentElement.setAttribute(${JSON.stringify(MOTION_ATTRIBUTE)},level);` +
    '}catch(e){}})();'
  );
}
