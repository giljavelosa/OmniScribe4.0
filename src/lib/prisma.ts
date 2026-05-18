import { PrismaClient } from '@prisma/client';

// HMR-safe Prisma client singleton. Without this, `npm run dev`'s hot reloads
// create a new client on every file change and Postgres rejects with
// "too many connections" after ~20 reloads.

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
