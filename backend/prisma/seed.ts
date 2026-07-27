import { PrismaClient, ProtocolCategory } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const flare = await prisma.chain.upsert({
    where: { chainId: 14 },
    update: {},
    create: {
      chainId: 14,
      name: 'Flare',
      rpcHttp: 'https://flare-api.flare.network/ext/C/rpc',
      rpcWs: 'wss://flare-api.flare.network/ext/bc/C/ws',
      explorer: 'https://flarescan.com',
      blockTime: 1800,
      nativeSymbol: 'FLR',
      isActive: true,
    },
  });

  // Activation is driven by env vars — protocols flip to isActive=true automatically
  // once the corresponding env addresses are set.
  const protocols: Array<{
    slug: string;
    name: string;
    category: ProtocolCategory;
    riskTier: number;
    isActive: boolean;
  }> = [
    {
      slug: 'kinetic',
      name: 'Kinetic Market',
      category: 'LENDING',
      riskTier: 3,
      isActive: !!process.env.KINETIC_COMPTROLLER,
    },
    {
      slug: 'sparkdex',
      name: 'SparkDEX',
      category: 'DEX',
      riskTier: 3,
      isActive: !!process.env.SPARKDEX_NFPM,
    },
    {
      slug: 'firelight',
      name: 'Firelight',
      category: 'STAKING',
      riskTier: 2,
      isActive: !!(process.env.FIRELIGHT_STAKING && process.env.FIRELIGHT_STXRP),
    },
    {
      slug: 'enosys',
      name: 'Enosys',
      category: 'DEX',
      riskTier: 3,
      isActive: !!(process.env.ENOSYS_ROUTER || process.env.ENOSYS_FARMING),
    },
  ];

  for (const p of protocols) {
    await prisma.protocol.upsert({
      where: { slug: p.slug },
      update: { isActive: p.isActive },
      create: {
        slug: p.slug,
        name: p.name,
        category: p.category,
        chainId: flare.chainId,
        riskTier: p.riskTier,
        isActive: p.isActive,
      },
    });
  }

  // eslint-disable-next-line no-console
  console.log(
    `Seed OK — chain ${flare.name} (chainId ${flare.chainId}), ${protocols.length} protocols (inactive until env addresses set)`
  );
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
