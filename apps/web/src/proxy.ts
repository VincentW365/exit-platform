import { NextResponse, type NextRequest } from 'next/server';

/**
 * Per-request security headers (Directive 1.1 section D.7/D.8).
 *
 * Production Content-Security-Policy uses a per-request nonce with
 * strict-dynamic: no unsafe-eval, no unsafe-inline, no wildcard script
 * sources. Next.js reads the nonce from the request CSP header and applies it
 * to its own bootstrap scripts.
 *
 * Development keeps a relaxed script policy because the Turbopack dev runtime
 * requires eval; that branch is compiled around NODE_ENV and cannot apply to
 * a production build.
 *
 * style-src retains 'unsafe-inline': the UI uses style attributes, which CSP
 * can only allow via unsafe-inline (nonces do not apply to attributes). This
 * is the documented, deliberate exception; scripts are fully nonce-protected.
 */
export function proxy(request: NextRequest): NextResponse {
  const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = btoa(String.fromCharCode(...nonceBytes));
  const isProduction = process.env.NODE_ENV === 'production';

  const scriptSrc = isProduction
    ? `'self' 'nonce-${nonce}' 'strict-dynamic'`
    : `'self' 'unsafe-eval' 'unsafe-inline'`;

  const csp = [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  // Authenticated HR content must never be cached by shared intermediaries or
  // indexed (D.8). Static assets are excluded by the matcher below.
  response.headers.set('Cache-Control', 'no-store, private');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [{ type: 'header', key: 'next-router-prefetch' }],
    },
  ],
};
