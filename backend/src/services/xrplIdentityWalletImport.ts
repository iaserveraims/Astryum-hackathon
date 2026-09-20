/**
 * Import the XRPL wallet the user connected in their XRP Identity profile.
 *
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
