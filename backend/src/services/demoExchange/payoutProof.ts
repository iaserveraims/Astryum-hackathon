/**
 * payoutProof — may the exchange autopilot pay this client out to the wallet on
 * file? Pure.
 *
 * "The address on file" proves nothing by itself: whoever wrote it would collect
 * the balance. Two kinds of proof count, and nothing else does:
 *
 *  1. LEDGER proof — `run.provenDepositSenders`, written ONLY by the watcher
 *     (syncOmnibus) when it credits a deposit: the ledger showed THAT account
 *     paying a credited deposit in for THIS client.
 *     Iteration 2 checked a `U1_DEPOSIT` receipt plus its movement key instead;
 *     that was forgeable (receipts come through an open route, and a movement
 *     key is bound to neither client nor sender — iteration 3).
 *
 *  2. SIGNATURE proof — `client.xrplAddressProof` is 'session' or 'binding': the
 *     row's OWNER wrote the wallet and the route checked it was their SIWE login
 *     wallet or an active signed WalletBinding of theirs (routes/demoExchange).
 *     This is what un-sticks a client who deposited before registering a wallet
 *     (or from another wallet): their old deposits were credited as 'return' and
 *     never recorded a sender.
 *
 * Why (1) alone was not enough — the CIRCULAR proof of iteration 4: the open
 * PATCH let anyone write a wallet on a zero-activity row; the victim's deposit
 * was credited as 'return'; the attacker sent 1 drop from their wallet, which
 * the watcher credited as 'deposit' → "proven"; a withdraw paid the victim's
 * balance to the attacker. Rows now have owners and the wallet must be proven to
 * the owner when written, so that write never happens. 'admin' is recorded but
 * is not proof: a founder typing an address is not the ledger or a signature.
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
