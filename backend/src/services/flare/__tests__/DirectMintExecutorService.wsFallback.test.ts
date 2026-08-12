/**
 * Fallback WebSocket del transporte XRPL (incidente 2026-07-31, parte 2): con
 * s1/s2 congelados y el HTTP de xrplcluster cerrado por el gate 402 a IPs de
 * datacenter, el barrido se quedaba sin transporte en Railway. El WS de
 * xrplcluster SÍ pasa el gate (AnchorFeedingService/XrplEscrowKeeper lo usan
 * en prod) — xrplWsRequest es ese último recurso, con el MISMO contrato de
 * frescura que el camino HTTP.
 *
 * Qué se prueba y por qué:
 *  1. Nodo WS fresco → devuelve el result del método pedido y desconecta.
 *  2. Nodo WS congelado → lanza xrpl_ws_endpoint_stale (jamás barrer una
 *     ventana muerta) y desconecta igualmente.
 *  3. Fallo de conexión → sube el error y no deja el cliente colgado.
 */
jest.mock('xrpl', () => ({ Client: jest.fn() }));

import { Client } from 'xrpl';
import { xrplWsRequest } from '../DirectMintExecutorService';

const RIPPLE_EPOCH_S = 946_684_800;
const closeTimeAgo = (ageS: number) => Math.floor(Date.now() / 1000) - RIPPLE_EPOCH_S - ageS;

type MockClient = {
  connect: jest.Mock;
  disconnect: jest.Mock;
  request: jest.Mock;
};

function installClient(opts: { ledgerAgeS?: number; result?: unknown; connectError?: Error }): MockClient {
  const client: MockClient = {
    connect: opts.connectError
      ? jest.fn().mockRejectedValue(opts.connectError)
      : jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    request: jest.fn().mockImplementation(async (req: { command: string }) => {
      if (req.command === 'ledger') {
        return { result: { ledger: { close_time: closeTimeAgo(opts.ledgerAgeS ?? 0) } } };
      }
      return { result: opts.result };
    }),
  };
  (Client as unknown as jest.Mock).mockImplementation(() => client);
  return client;
}

beforeEach(() => {
  (Client as unknown as jest.Mock).mockReset();
});

describe('xrplWsRequest — el último recurso WS con contrato de frescura', () => {
  it('nodo fresco → devuelve el result y desconecta', async () => {
    const rows = { transactions: [{ hash: 'AA' }] };
    const client = installClient({ ledgerAgeS: 10, result: rows });
    await expect(xrplWsRequest('account_tx', { account: 'rVault' })).resolves.toEqual(rows);
    expect(client.request).toHaveBeenCalledWith(expect.objectContaining({ command: 'ledger' }));
    expect(client.request).toHaveBeenCalledWith(expect.objectContaining({ command: 'account_tx', account: 'rVault' }));
    expect(client.disconnect).toHaveBeenCalled();
  });

  it('nodo congelado → lanza stale y desconecta igualmente', async () => {
    const client = installClient({ ledgerAgeS: 4 * 3600, result: { transactions: [] } });
    await expect(xrplWsRequest('account_tx', { account: 'rVault' })).rejects.toThrow('xrpl_ws_endpoint_stale');
    // jamás llegó a pedir account_tx — la frescura va ANTES que el barrido
    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.disconnect).toHaveBeenCalled();
  });

  it('conexión caída → sube el error sin dejar el cliente colgado', async () => {
    const client = installClient({ connectError: new Error('ws_unreachable') });
    await expect(xrplWsRequest('account_tx', { account: 'rVault' })).rejects.toThrow('ws_unreachable');
    expect(client.disconnect).toHaveBeenCalled();
  });
});
