import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { getConfig, getRepositoryRoot } from '@exit/config';

/**
 * LAN reachability probe (owner directive, 2026-09-02).
 *
 * Exists so a tester's script can prove that a request reached THIS
 * application instance - not a proxy, not a different project on the same
 * port, not a cached page. It answers before sign-in because reachability is
 * what it measures, and it says only what is needed for that: the app's
 * name, which environment it is, the time it answered, and the commit it
 * was built from. No configuration values, no database facts, no secrets.
 *
 * Development and test only. Production has a monitored health check of its
 * own and does not advertise build identifiers to unauthenticated callers.
 */
export const dynamic = 'force-dynamic';

/** The checked-out commit, read from the repository when one is present. */
function currentCommit(): string | null {
  // The web process loads .env through next.config, not through
  // loadRootEnvFile, so the recorded root is usually absent here; the
  // checkout is two directories above apps/web.
  const root = getRepositoryRoot() ?? path.resolve(process.cwd(), '..', '..');
  try {
    const head = readFileSync(path.join(root, '.git', 'HEAD'), 'utf8').trim();
    const ref = /^ref: (.+)$/.exec(head)?.[1];
    const sha = ref ? readFileSync(path.join(root, '.git', ref), 'utf8').trim() : head;
    return /^[0-9a-f]{40}$/.test(sha) ? sha.slice(0, 12) : null;
  } catch {
    return null;
  }
}

export function GET(): NextResponse {
  const config = getConfig();
  if (config.isProduction) return new NextResponse(null, { status: 404 });
  return NextResponse.json(
    {
      status: 'ok',
      app: 'exit-platform',
      environment: config.appEnvironment,
      serverTime: new Date().toISOString(),
      commit: currentCommit(),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
