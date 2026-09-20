'use client';

/**
 * /app/wallets — la pantalla de las cuentas (quinta pasada del fundador
 * 2026-08-22 + rediseño «identidad delante, gestión detrás» del mismo día).
 *
 * Aquí viven TODAS las cuentas, en dos estantes: Personal (tus llaves, tus
 * colores) y Legacy (gobernadas por consejo, siempre índigo). La gobernanza
 * entera —consejo, constitución, propuestas, movimientos, reforzar— se abre
 * en un DIÁLOGO grande desde la tarjeta de cada cuenta (GovernanceModal);
 * /app/legacy quedó como reenviador para los deep-links históricos.
 *
 * La puerta de constituir vive DENTRO de WalletManager (constituteDoor):
 * puerta y diálogo comparten dueño, así el clic no necesita navegar.
 * Los enlaces profundos de siempre siguen entrando aquí: `?add=1` (la guía
 * de la primera wallet), `?govern=`/`?reinforce=`/`?legacy=` (gobernanza).
 */

import WalletManager from '../../../components/wallet/WalletManager';

export default function WalletsPage() {
  return <WalletManager scope="personal" variant="page" constituteDoor />;
}
