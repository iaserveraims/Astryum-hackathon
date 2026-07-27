import { LRUCache } from 'lru-cache';
import { prisma } from '../database/prismaClient';

export interface PersistedWallet {
  address: string;
  label?: string | null;
  registeredAt: Date;
  isActive: boolean;
  lastSyncedAt?: Date | null;
  lastBlockSynced?: number | null;
}

const BETA_OWNER_XRPL_PLACEHOLDER = 'beta-owner-private';

const cache = new LRUCache<string, PersistedWallet>({ max: 1000, ttl: 60_000 });

async function getOrCreateBetaOwnerId(): Promise<string> {
  const existing = await prisma.user.findUnique({
    where: { xrplAddress: BETA_OWNER_XRPL_PLACEHOLDER },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.user.create({
    data: {
      xrplAddress: BETA_OWNER_XRPL_PLACEHOLDER,
      isActive: true,
    },
    select: { id: true },
  });
  return created.id;
}

function rowToWallet(row: {
  address: string;
  nickname: string | null;
  isConnected: boolean;
  createdAt: Date;
  lastActivity: Date;
  permissions: unknown;
}): PersistedWallet {
  const perms = (row.permissions ?? {}) as Record<string, unknown>;
  const lastBlock = perms.lastBlockSynced;
  const lastSynced = perms.lastSyncedAt;
  return {
    address: row.address.toLowerCase(),
    label: row.nickname,
    registeredAt: row.createdAt,
    isActive: row.isConnected,
    lastSyncedAt: typeof lastSynced === 'string' ? new Date(lastSynced) : null,
    lastBlockSynced: typeof lastBlock === 'number' ? lastBlock : null,
  };
}

export const WalletRepository = {
  async loadAll(): Promise<PersistedWallet[]> {
    const ownerId = await getOrCreateBetaOwnerId();
    const rows = await prisma.wallet.findMany({
      where: { userId: ownerId, network: 'flare' },
    });
    const wallets = rows.map(rowToWallet);
    for (const w of wallets) cache.set(w.address, w);
    return wallets;
  },

  async findByAddress(address: string): Promise<PersistedWallet | null> {
    const key = address.toLowerCase();
    const cached = cache.get(key);
    if (cached) return cached;
    const ownerId = await getOrCreateBetaOwnerId();
    const row = await prisma.wallet.findFirst({
      where: { userId: ownerId, address: key, network: 'flare' },
    });
    if (!row) return null;
    const wallet = rowToWallet(row);
    cache.set(key, wallet);
    return wallet;
  },

  async save(wallet: PersistedWallet): Promise<void> {
    const ownerId = await getOrCreateBetaOwnerId();
    const key = wallet.address.toLowerCase();
    const permissions = {
      lastSyncedAt: wallet.lastSyncedAt?.toISOString() ?? null,
      lastBlockSynced: wallet.lastBlockSynced ?? null,
    };
    await prisma.wallet.upsert({
      where: {
        userId_address_network: { userId: ownerId, address: key, network: 'flare' },
      },
      update: {
        nickname: wallet.label ?? null,
        isConnected: wallet.isActive,
        permissions,
        lastActivity: new Date(),
      },
      create: {
        userId: ownerId,
        address: key,
        network: 'flare',
        chainId: 14,
        walletType: 'evm',
        nickname: wallet.label ?? null,
        isConnected: wallet.isActive,
        permissions,
      },
    });
    cache.set(key, { ...wallet, address: key });
  },

  async delete(address: string): Promise<void> {
    const ownerId = await getOrCreateBetaOwnerId();
    const key = address.toLowerCase();
    await prisma.wallet.deleteMany({
      where: { userId: ownerId, address: key, network: 'flare' },
    });
    cache.delete(key);
  },

  invalidateCache(address?: string): void {
    if (address) cache.delete(address.toLowerCase());
    else cache.clear();
  },
};
