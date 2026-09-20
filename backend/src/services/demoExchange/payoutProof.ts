/**
 * payoutProof — may the exchange autopilot pay this client out to the wallet on
 * file? Pure.
 */

import type { DemoClient, DemoRun } from './DemoExchangeStore';

export function payoutWalletProven(
  run: DemoRun,
  clientId: string,
  wallet: string | undefined,
  client?: Pick<DemoClient, 'xrplAddress' | 'xrplAddressProof'>,
): boolean {
  if (!wallet) return false;
  const senders = run.provenDepositSenders?.[clientId];
  if (Array.isArray(senders) && senders.includes(wallet)) return true;
  const row = client ?? run.clients?.find((c) => c.id === clientId);
  if (!row || row.xrplAddress !== wallet) return false;
  return row.xrplAddressProof === 'session' || row.xrplAddressProof === 'binding';
}
