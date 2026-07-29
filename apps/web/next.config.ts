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

const nextConfig: NextConfig = {
  transpilePackages: ['@exit/config', '@exit/domain', '@exit/db'],
  // pdfkit must stay external: bundling breaks its runtime font-data paths.
  serverExternalPackages: ['@prisma/client', 'pdfkit'],
  poweredByHeader: false,
  headers() {
    return Promise.resolve([{ source: '/(.*)', headers: securityHeaders }]);
  },
};

export default nextConfig;
