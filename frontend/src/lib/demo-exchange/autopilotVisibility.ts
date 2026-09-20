/**
 * ¿Se ve el autopilot del exchange? NO (fundador 18-sep: «el autopilot hay que
 * sacarlo no visible y que se haga a través de QR»).
 *
 * El autopilot firmaba con UNA llave que tiene el backend, y esa llave solo abre
 * UN omnibus: el de un exchange nuevo, que vive en la Xaman de su dueño, no podía
 * servirse nunca («the exchange key opens rMB8x…; this run's omnibus is r4yp47…»).
 * Sin él, cada movimiento lo firma el OMNIBUS con un QR de Xaman: el KYC que
 * acepta, meter en el vault y pagar a un cliente — siempre lo que el CLIENTE pidió,
 * por el importe que pidió (la mesa no elige cliente ni importe: regla del 14-sep,
 * DESK_PUT_TO_WORK_UI).
 *
 * Construido e inerte, no borrado: con `true` vuelve todo lo del autopilot (la
 * consola, la estación AUTO de la mesa y su paso del tour). Constante de código,
 * jamás variable de entorno: lo que decide qué se ve vive en código (CLAUDE.md 14-sep).
 */
export const AUTOPILOT_UI: boolean = false;
