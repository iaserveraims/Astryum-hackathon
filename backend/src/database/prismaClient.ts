import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __defibroPrisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  global.__defibroPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  global.__defibroPrisma = prisma;
}

export async function connectPrisma(): Promise<void> {
  await prisma.$connect();
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
