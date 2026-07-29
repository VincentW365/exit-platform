import { execSync } from 'node:child_process';
import path from 'node:path';

// Apply migrations to the isolated test database before the suite runs.
export default function setup(): void {
  const testUrl = process.env['DATABASE_URL_TEST'];
  if (!testUrl) throw new Error('DATABASE_URL_TEST missing.');
  execSync('pnpm exec prisma migrate deploy', {
    cwd: path.resolve(import.meta.dirname, 'packages/db'),
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'inherit',
  });
}
