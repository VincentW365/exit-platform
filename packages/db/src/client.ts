import { getConfig } from '@exit/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client.ts';

// Singleton Prisma client (Prisma 7 driver-adapter model). Next.js dev-mode
// module reloading would otherwise exhaust connections, so the instance is
// cached on globalThis.
const globalForPrisma = globalThis as unknown as { __exitPrisma?: PrismaClient };

export function getPrisma(): PrismaClient {
  if (!globalForPrisma.__exitPrisma) {
    // Validates the environment (and its fail-closed guards) before any
    // database connection is possible.
    const config = getConfig();
    const adapter = new PrismaPg({ connectionString: config.DATABASE_URL });
    globalForPrisma.__exitPrisma = new PrismaClient({ adapter });
  }
  return globalForPrisma.__exitPrisma;
}

export type { PrismaClient };
export * from './generated/client.ts';
