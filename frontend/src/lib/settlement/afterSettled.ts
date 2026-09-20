/**
 * afterSettled — lo que la app hace SOLA cuando una operación asienta.
 *
 * EL HUECO. Firmar y asentar cambiaba el capital de verdad, pero nadie se lo
 * decía al Portfolio: el snapshot del backend vive 5 min en caché por wallet
 * y el agregado del cliente 60 s más. Home (FleetBand) y el anillo «Assets
 * earning» leen ESE snapshot — así que la posición nueva no existía para
 * ellos hasta cinco minutos y una recarga después. El Portfolio tenía un
 * botón manual de refresco; el Home ni eso.
 */

import { listMyWallets } from '../../services/walletLinkService';
import { portfolioV1 } from '../../services/v1Api';
import { invalidatePortfolioCache } from '../portfolioMerge';

const refreshed = new Set<string>();

export async function refreshPortfolioAfterSettlement(ref: string): Promise<void> {
  if (refreshed.has(ref)) return;
  refreshed.add(ref);
  try {
    const wallets = await listMyWallets();
    // Todas las direcciones, en paralelo, cada una a su ritmo: una lenta no
    // retiene a las demás y un fallo no impide el resto (el forceSnapshot ya
    // enruta por ecosistema; la XRPL también cambió — salió el XRP).
    await Promise.allSettled(wallets.map((w) => portfolioV1.forceSnapshot(w.address, w.chainId ?? 14)));
  } catch {
    /* sin lista de wallets no hay a quién refrescar: la invalidación de abajo
       al menos obliga a releer lo que haya */
  }
  invalidatePortfolioCache();
}
