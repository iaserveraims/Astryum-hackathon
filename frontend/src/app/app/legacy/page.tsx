'use client';

/**
 * /app/legacy — la PÁGINA de gobernanza (fundador 2026-08-22, segunda pasada:
 * el diálogo «está mal gestionado, pásalo a página independiente»). Vuelve a
 * montar LegacyPanel entero, con dos diferencias respecto a su era anterior:
 *
 *  · La lista «My Legacies» NO existe como pantalla — esta ruta es solo el
 *    taller (constituir / gobernar / reforzar / bandeja), entrado con params
 *    desde la tarjeta de cada cuenta en /app/wallets. Sin destino, el panel
 *    redirige a Wallets (BackToWallets).
 *  · «Volver» regresa a /app/wallets, no a una lista.
 *
 * Todos los deep-links históricos siguen entrando por aquí en su forma nativa
 * (?govern= / ?reinforce= / ?constitute=1 / ?tab=proposals — las push del
 * consejo del backend congelado — / ?walkthrough=1), y el shell viste el
 * índigo por pathname como siempre (AppShell + LegacyAccessGuard intactos).
 * El experimento del diálogo queda preservado sin montar en
 * components/legacy/GovernanceModal.tsx (y el modo `embed` de LegacyPanel).
 */

import LegacyPanel from '../../../components/legacy/LegacyPanel';

export default function LegacyPage() {
  return <LegacyPanel />;
}
