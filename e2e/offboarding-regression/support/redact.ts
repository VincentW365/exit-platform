/**
 * Secrets never reach a report (directive section 43). The evidence pack
 * proves a link existed and worked; it does not have to reproduce it.
 */

const TOKEN_LINK = /(\/(?:checklist|ack|survey)\/)[A-Za-z0-9_-]{43}/g;
const BARE_TOKEN = /\b[A-Za-z0-9_-]{43}\b/g;

/** Replace every token-bearing link and bare token with a fixed marker. */
export function redactTokens(text: string): string {
  return text.replace(TOKEN_LINK, '$1<redacted-token>').replace(BARE_TOKEN, '<redacted-token>');
}

/** Redact a URL for display while keeping its route recognisable. */
export function redactUrl(url: string): string {
  return redactTokens(url);
}

/** Session cookies and similar never leave the browser context; belt and braces. */
export function stripCookieHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (/cookie|authorization|x-api-key/i.test(k)) continue;
    out[k] = v;
  }
  return out;
}
