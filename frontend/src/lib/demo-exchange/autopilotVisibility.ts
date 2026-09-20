/**
 * ¿Se ve el autopilot del exchange? NO.
 *
 * El autopilot firmaba con UNA llave que tiene el backend, y esa llave solo abre
 * UN omnibus: el de un exchange nuevo, que vive en la Xaman de su dueño, no podía
 * servirse nunca («the exchange key opens rMB8x…; this run's omnibus is r4yp47…»).
 * Sin él, cada movimiento lo firma el OMNIBUS con un QR de Xaman: el KYC que
 * acepta, meter en el vault y pagar a un cliente — siempre lo que el CLIENTE pidió,
 * por el importe que pidió (la mesa no elige cliente ni importe: regla,
 * DESK_PUT_TO_WORK_UI).
 */
export const AUTOPILOT_UI: boolean = false;
