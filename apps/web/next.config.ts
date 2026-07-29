import path from 'node:path';
import type { NextConfig } from 'next';

// Load the repository-root .env for local development (monorepo root, not the
// app folder). Real environments inject configuration directly (REQ-SEC-013).
try {
  process.loadEnvFile(path.resolve(process.cwd(), '../../.env'));
} catch {
  /* no .env - environment must already be configured */
}

const securityHeaders = [
  // Stage 1 CSP: no external origins at all; the inline allowances exist for
  // Next's own runtime and are revisited at Stage 7 hardening (REQ-SEC-015).
  {
    key: 'Content-Security-Policy',
    value:
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; " +
      "form-action 'self'; base-uri 'self'; object-src 'none'",
  },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  transpilePackages: ['@exit/config', '@exit/domain', '@exit/db'],
  serverExternalPackages: ['@prisma/client'],
  poweredByHeader: false,
  headers() {
    return Promise.resolve([{ source: '/(.*)', headers: securityHeaders }]);
  },
};

export default nextConfig;
