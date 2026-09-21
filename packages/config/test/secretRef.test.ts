/**
 * Credential reference resolution (DEC-062).
 *
 * `*_REF` fields hold a reference to where a secret lives, never the secret.
 * These tests pin the fail-closed behaviour and - most importantly - that no
 * error message ever carries a credential value.
 */
import { describe, expect, it } from 'vitest';
import { ConfigError, resolveSecretRef, secretRefFormatError } from '../src/index.ts';

const SECRET = 'SUPER-SECRET-ACCESS-KEY-VALUE-9f3a';

describe('resolveSecretRef', () => {
  it('resolves a well-formed env: reference', () => {
    const env = { UAT_S3_ACCESS_KEY: SECRET };
    expect(resolveSecretRef('env:UAT_S3_ACCESS_KEY', 'S3_ACCESS_KEY_REF', env)).toBe(SECRET);
  });

  it('tolerates surrounding whitespace in the reference and the name', () => {
    const env = { UAT_S3_ACCESS_KEY: SECRET };
    expect(resolveSecretRef('  env: UAT_S3_ACCESS_KEY  ', 'S3_ACCESS_KEY_REF', env)).toBe(SECRET);
  });

  it('fails closed when the referenced variable is missing', () => {
    expect(() => resolveSecretRef('env:NOT_SET_ANYWHERE', 'S3_ACCESS_KEY_REF', {})).toThrow(
      ConfigError,
    );
    // The variable NAME is safe to state, and is what an operator needs.
    expect(() => resolveSecretRef('env:NOT_SET_ANYWHERE', 'S3_ACCESS_KEY_REF', {})).toThrow(
      /NOT_SET_ANYWHERE/,
    );
  });

  it('fails closed when the referenced variable is empty or whitespace', () => {
    expect(() => resolveSecretRef('env:EMPTY', 'S3_SECRET_KEY_REF', { EMPTY: '' })).toThrow(
      /not set or is empty/,
    );
    expect(() => resolveSecretRef('env:BLANK', 'S3_SECRET_KEY_REF', { BLANK: '   ' })).toThrow(
      /not set or is empty/,
    );
  });

  it('fails closed on an unsupported scheme', () => {
    for (const ref of ['vault://secret/s3', 'aws-sm:some-secret', 'file:/etc/key']) {
      expect(() => resolveSecretRef(ref, 'S3_ACCESS_KEY_REF', {})).toThrow(ConfigError);
    }
    expect(() => resolveSecretRef('vault://secret/s3', 'S3_ACCESS_KEY_REF', {})).toThrow(
      /unsupported reference scheme/,
    );
  });

  it('fails closed on a missing reference', () => {
    expect(() => resolveSecretRef(undefined, 'S3_ACCESS_KEY_REF', {})).toThrow(/not configured/);
    expect(() => resolveSecretRef('   ', 'S3_ACCESS_KEY_REF', {})).toThrow(/not configured/);
  });

  it('fails closed on a reference that names no variable', () => {
    expect(() => resolveSecretRef('env:', 'S3_ACCESS_KEY_REF', {})).toThrow(
      /must name an environment variable/,
    );
  });

  it('REFUSES a raw credential pasted into a reference field', () => {
    // No scheme at all - the common and dangerous mistake.
    expect(() => resolveSecretRef(SECRET, 'S3_ACCESS_KEY_REF', {})).toThrow(ConfigError);
    expect(() => resolveSecretRef(SECRET, 'S3_ACCESS_KEY_REF', {})).toThrow(
      /raw credential value is not accepted/,
    );
  });

  it('NEVER leaks the secret, or the reference itself, through an error', () => {
    const env = { UAT_S3_ACCESS_KEY: SECRET };
    const attempts: Array<[string | undefined, Record<string, string>]> = [
      [SECRET, env], // raw secret in the field
      [`vault://${SECRET}`, env], // secret inside an unsupported scheme
      ['env:MISSING', env], // missing target
      ['env:', env], // no variable named
      [undefined, env],
      ['   ', env],
    ];
    for (const [reference, e] of attempts) {
      let message = '';
      try {
        resolveSecretRef(reference, 'S3_ACCESS_KEY_REF', e);
      } catch (err) {
        message = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
      }
      expect(message).not.toBe('');
      expect(message).not.toContain(SECRET);
      // A credential mistakenly placed in the field must not be echoed even
      // in part: check the distinctive tail as well as the whole value.
      expect(message).not.toContain('9f3a');
    }
  });

  it('resolves without ever returning the value through a thrown path', () => {
    // Sanity: the ONLY way to obtain the value is a successful resolution.
    const env = { K: SECRET };
    expect(resolveSecretRef('env:K', 'S3_ACCESS_KEY_REF', env)).toBe(SECRET);
  });
});

describe('secretRefFormatError (non-resolving report for validateConfig)', () => {
  it('accepts a well-formed reference without touching the environment', () => {
    expect(secretRefFormatError('env:ANY_NAME', 'S3_ACCESS_KEY_REF')).toBeNull();
  });

  it('reports the same problems the resolver refuses', () => {
    expect(secretRefFormatError(undefined, 'S3_ACCESS_KEY_REF')).toMatch(/not configured/);
    expect(secretRefFormatError('vault://x', 'S3_ACCESS_KEY_REF')).toMatch(/unsupported/);
    expect(secretRefFormatError('env:', 'S3_ACCESS_KEY_REF')).toMatch(/must name/);
    expect(secretRefFormatError(SECRET, 'S3_ACCESS_KEY_REF')).toMatch(/must be a reference/);
  });

  it('never echoes a credential placed in the field', () => {
    const message = secretRefFormatError(SECRET, 'S3_ACCESS_KEY_REF') ?? '';
    expect(message).not.toContain(SECRET);
    expect(message).not.toContain('9f3a');
  });
});
