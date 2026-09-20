/**
 * Import the XRPL wallet the user connected in their XRP Identity profile.
 *
 * Founder decision 2026-08-19: if the address is there, bring it in — so a new
 * user's Capital Map is populated before they type anything.
 *
 * WHAT IT IS WORTH, because everything below follows from it. The operator
 * (Thomas Hussenet, 2026-08-19) states their backend stores whatever the wallet
 * connector returned and does NOT independently verify or persist cryptographic
 * proof of ownership. So this address is a **user-associated hint** — not proof
 * of control, not a binding, not something that may ever authorize a movement.
 * It lands as `purpose: 'watch'`: the Capital Map, and nothing else.
 *
 * The three rules that keep an existing account safe, in force order:
 *
 *  1. **Never touch a row that already exists.** Not to upgrade it, not to
 *     "refresh" it. A wallet the user connected by SIGNING outranks this one,
 *     and silently rewriting its type or purpose would degrade a strong claim
 *     with a weak one.
 *  2. **Never resurrect a deleted wallet.** Deleting leaves a soft-removed row
 *     (`permissions.unlinkedAt`), and rule 1 already covers it: a user who
 *     removed this address must not find it back after every login.
 *  3. **Never become primary.** The primary wallet is the default signer and
 *     bridge recipient for its ecosystem. A hint does not get to be that.
 *
 * And it never writes a WalletBinding: that model requires a `signatureProof`,
 * which is exactly the thing we do not have. The schema enforces the invariant
 * on its own — this file just declines to argue with it.
 */
import { prisma } from '../database/prismaClient';

/** What happened, for the caller's log and the admin card. */
export type XrplIdentityImportOutcome =
  | 'imported'      // a new watch-only wallet now exists
  | 'already_known' // the user already had this address (any purpose, even removed)
  | 'skipped'       // nothing to import
  | 'failed';       // the write did not go through; login is unaffected

const XRPL_NETWORK = 'xrpl';
const XRPL_CAIP2 = 'xrpl:0';

/** Marks the provenance on the row itself, so its origin survives this file. */
export const XRPL_IDENTITY_WALLET_TYPE = 'xrp_identity';

export async function importXrplIdentityWallet(
  userId: string,
  address: string | null,
): Promise<XrplIdentityImportOutcome> {
  if (!address) return 'skipped';

  try {
    const existing = await prisma.wallet.findUnique({
      where: { userId_address_network: { userId, address, network: XRPL_NETWORK } },
      select: { id: true },
    });
    // Rules 1 and 2: whatever it says, it was not put there by us and it stays.
    if (existing) return 'already_known';

    await prisma.wallet.create({
      data: {
        userId,
        walletType: XRPL_IDENTITY_WALLET_TYPE,
        address,
        network: XRPL_NETWORK,
        caip2: XRPL_CAIP2,
        chainId: null,
        ecosystem: 'xrpl',
        nickname: null,
        isConnected: true,
        // Rule 3. Also sidesteps the one-primary-per-ecosystem unique index.
        isPrimary: false,
        purpose: 'watch',
        // Provenance in the row, not only in this comment: anyone reading the
        // database can tell this address arrived on somebody else's word.
        permissions: {
          importedFrom: 'xrp_identity',
          importedAt: new Date().toISOString(),
          ownershipProof: 'none',
        },
      },
    });
    return 'imported';
  } catch {
    // A wallet we failed to add is a missing row on a map. A login that fails
    // is a person locked out. Never trade the second for the first.
    return 'failed';
  }
}
