import { networkInterfaces } from 'node:os';
import path from 'node:path';
import type { NextConfig } from 'next';

// Load the repository-root .env for local development (monorepo root, not the
// app folder). Real environments inject configuration directly (REQ-SEC-013).
try {
  process.loadEnvFile(path.resolve(process.cwd(), '../../.env'));
} catch {
  /* no .env - environment must already be configured */
}

// The Content-Security-Policy is set per-request in src/proxy.ts so the
// production policy can carry a nonce (no unsafe-eval / unsafe-inline for
// scripts). Static headers below apply to every response.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ...(process.env.NODE_ENV === 'production'
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
    : []),
];

/**
 * LAN access for internal UAT (owner directive, 2026-09-02).
 *
 * The Next.js DEVELOPMENT server refuses requests for its own resources
 * (/_next/*, the HMR socket) from any browser origin it has not been told
 * about - so a page opened from another workstation renders but never
 * hydrates. The only host it allows automatically is the one it was told to
 * listen on, and that is 0.0.0.0 here, which matches nothing.
 *
 * The allow-list is therefore built from configuration, never typed in:
 * every non-loopback IPv4 address this machine currently holds (read at
 * start, so a changed DHCP lease needs no edit), plus DEV_ALLOWED_ORIGINS
 * from .env for a hostname a tester might use instead. Development only -
 * `next start` has no such guard, and production must never carry a
 * development allow-list.
 */
function allowedDevOrigins(): string[] {
  if (process.env.NODE_ENV === 'production') return [];
  const fromEnv = (process.env.DEV_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const local: string[] = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) {
        local.push(a.address);
      }
    }
  }
  // 127.0.0.1 is not covered by Next's built-in "localhost" allowance, so a
  // page opened at http://127.0.0.1:<port> rendered but never hydrated - the
  // create-case accordion simply stayed collapsed. Loopback is this machine.
  return [...new Set(['127.0.0.1', ...local, ...fromEnv])];
}

const nextConfig: NextConfig = {
  allowedDevOrigins: allowedDevOrigins(),
  transpilePackages: ['@exit/config', '@exit/domain', '@exit/db'],
  // pdfkit must stay external: bundling breaks its runtime font-data paths.
  serverExternalPackages: ['@prisma/client', 'pdfkit'],
  // Stage 4 (Directive 4 U): minimal self-contained server output for the
  // production container image.
  output: 'standalone',
  poweredByHeader: false,
  headers() {
    return Promise.resolve([{ source: '/(.*)', headers: securityHeaders }]);
  },
};

export default nextConfig;
