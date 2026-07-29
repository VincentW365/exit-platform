// Prisma CLI configuration (Prisma 7). The CLI no longer auto-loads .env and
// the schema file no longer carries a datasource URL: Migrate reads it from
// here, the runtime client uses a driver adapter (see src/client.ts).
import path from 'node:path';
import { defineConfig } from 'prisma/config';

try {
  process.loadEnvFile(path.resolve(import.meta.dirname, '../../.env'));
} catch {
  // No .env present - environment variables must already be set.
}

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  datasource: {
    // Migrations run as the schema-owner role, never as the runtime role
    // (Directive 1.1 section C role separation).
    url: process.env['DATABASE_URL_MIGRATE'] ?? process.env['DATABASE_URL'] ?? '',
  },
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx src/seed.ts',
  },
});
