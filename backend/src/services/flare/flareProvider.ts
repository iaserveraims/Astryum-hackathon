/**
 * flareProvider — UN JsonRpcProvider por URL, con red fija.
 *
 * Cada ruta de lectura creaba `new ethers.JsonRpcProvider(url)` por petición;
 * sin `staticNetwork`, ethers pregunta `eth_chainId` antes de la primera
 * lectura y, si el nodo tarda, reintenta cada segundo con aviso en consola.
 * Un viaje entero al RPC pagado en CADA petición, por nada: la red es Flare
 * (14) y no cambia. `MarketRatesService` ya lo hacía así; aquí se comparte.
 *
 * Solo LECTURAS. Las rutas que componen o relayan siguen con su provider
 * propio: no se toca lo que firma.
 */
import { ethers } from 'ethers';

const FLARE = { name: 'flare', chainId: 14 };
const providers = new Map<string, ethers.JsonRpcProvider>();

export function flareReadProvider(rpcUrl: string): ethers.JsonRpcProvider {
  let p = providers.get(rpcUrl);
  if (!p) {
    p = new ethers.JsonRpcProvider(rpcUrl, FLARE, { staticNetwork: true });
    providers.set(rpcUrl, p);
  }
  return p;
}
