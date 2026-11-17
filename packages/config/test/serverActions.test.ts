/**
 * Server actions behind a proxy: the public hostnames a deployment is reached
 * through, read at build time, so a rewritten Host header does not turn every
 * form submit into "Invalid Server Actions request".
 */
import { describe, expect, it } from 'vitest';
import { serverActionAllowedOrigins } from '../src/index.ts';

describe('server action allowed origins', () => {
  it('reads a comma-separated list, trimmed, lower-cased, without duplicates', () => {
    expect(serverActionAllowedOrigins(undefined)).toEqual([]);
    expect(serverActionAllowedOrigins('')).toEqual([]);
    expect(serverActionAllowedOrigins(' , ')).toEqual([]);
    expect(
      serverActionAllowedOrigins('Exit.Example.test, exit.example.test ,uat.example.test:8443'),
    ).toEqual(['exit.example.test', 'uat.example.test:8443']);
  });
});
