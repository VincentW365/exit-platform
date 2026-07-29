import { execSync } from 'node:child_process';
import path from 'node:path';

// Prepare the isolated test database before the suite runs: apply migrations
// as the schema-owner role, then apply the runtime least-privilege grants so
// privilege-denial tests exercise the real permission model.
export default function setup(): void {
  const testUrl = process.env['DATABASE_URL_TEST'];
  if (!testUrl) throw new Error('DATABASE_URL_TEST missing.');
  const dbDir = path.resolve(import.meta.dirname, 'packages/db');
  execSync('pnpm exec prisma migrate deploy', {
    cwd: dbDir,
    env: { ...process.env, DATABASE_URL: testUrl, DATABASE_URL_MIGRATE: testUrl },
    stdio: 'inherit',
  });
  const grants = path.resolve(import.meta.dirname, 'scripts/db/grants.sql');
  execSync(
    `node -e "const{readFileSync}=require('fs');const{Client}=require('pg');(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL_TEST});await c.connect();await c.query(readFileSync(process.argv[1],'utf8'));await c.end();})().catch(e=>{console.error(e.message);process.exit(1)})" "${grants}"`,
    { cwd: dbDir, env: { ...process.env }, stdio: 'inherit' },
  );
}
