/**
 * Directive 5.1 A.8/K.1/K.2: configuration status reporting never includes the
 * credential; production refuses raw keys entirely. Fake values only.
 */
import { describe, expect, it } from 'vitest';
import { bambooApiKey, bambooDirectoryStatus, ConfigError, loadConfig } from '../src/index.ts';

const base = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://exitplatform:x@localhost:5432/exitplatform_dev',
  SESSION_SECRET: 'a-test-only-secret-that-is-long-enough-0123456789',
};

const FAKE_KEY = 'faketestkey-0123456789abcdefghijklmnopqrs';

describe('BambooHR directory configuration status (A.8)', () => {
  it('reports not configured when both values are absent', () => {
    expect(bambooDirectoryStatus(loadConfig(base))).toBe('not configured');
  });

  it('reports invalid configuration for partial or malformed values', () => {
    expect(bambooDirectoryStatus(loadConfig({ ...base, BAMBOOHR_API_KEY: FAKE_KEY }))).toBe(
      'invalid configuration',
    );
    expect(bambooDirectoryStatus(loadConfig({ ...base, BAMBOOHR_SUBDOMAIN: 'bertsauto' }))).toBe(
      'invalid configuration',
    );
    expect(
      bambooDirectoryStatus(
        loadConfig({ ...base, BAMBOOHR_API_KEY: 'short', BAMBOOHR_SUBDOMAIN: 'bertsauto' }),
      ),
    ).toBe('invalid configuration');
    expect(
      bambooDirectoryStatus(
        loadConfig({ ...base, BAMBOOHR_API_KEY: FAKE_KEY, BAMBOOHR_SUBDOMAIN: 'bad domain!' }),
      ),
    ).toBe('invalid configuration');
  });

  it('reports configured for a complete local configuration', () => {
    expect(
      bambooDirectoryStatus(
        loadConfig({ ...base, BAMBOOHR_API_KEY: FAKE_KEY, BAMBOOHR_SUBDOMAIN: 'bertsauto' }),
      ),
    ).toBe('configured');
  });

  it('never returns the credential value in any status string (K.1/K.2)', () => {
    for (const env of [
      { ...base, BAMBOOHR_API_KEY: FAKE_KEY },
      { ...base, BAMBOOHR_API_KEY: FAKE_KEY, BAMBOOHR_SUBDOMAIN: 'bertsauto' },
    ]) {
      const status: string = bambooDirectoryStatus(loadConfig(env));
      expect(status).not.toContain(FAKE_KEY);
      expect(status).not.toContain(FAKE_KEY.slice(0, 12));
    }
  });

  it('production refuses a raw BAMBOOHR_API_KEY outright (A.9 fail-closed)', () => {
    // Otherwise-complete production configuration: the ONLY problem is the
    // raw BambooHR key, so the bamboo-specific guard must be what fires.
    const prodOk = {
      ...base,
      NODE_ENV: 'production',
      SCAN_MODE: 'external',
      SCANNER_URL: 'https://scanner.internal.invalid',
      EMAIL_MODE: 'disabled',
      STORAGE_MODE: 's3',
      S3_ENDPOINT: 'https://s3.internal.invalid',
      S3_BUCKET: 'exit-platform',
      S3_REGION: 'us-east-1',
      S3_ACCESS_KEY_REF: 'vault://s3-access',
      S3_SECRET_KEY_REF: 'vault://s3-secret',
      IDENTITY_MODE: 'oidc',
      OIDC_ISSUER: 'https://login.company.invalid',
      OIDC_CLIENT_ID: 'app-client',
      OIDC_CLIENT_SECRET_REF: 'vault://oidc-secret',
      ALLOW_DEV_LOGIN: 'false',
    } as const;
    expect(() => loadConfig({ ...prodOk })).not.toThrow();
    expect(() =>
      loadConfig({ ...prodOk, BAMBOOHR_API_KEY: FAKE_KEY, BAMBOOHR_SUBDOMAIN: 'bertsauto' }),
    ).toThrow(/BAMBOOHR_API_KEY/);
    try {
      loadConfig({ ...prodOk, BAMBOOHR_API_KEY: FAKE_KEY, BAMBOOHR_SUBDOMAIN: 'bertsauto' });
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      // The refusal message itself must not echo the secret.
      expect((e as Error).message).not.toContain(FAKE_KEY);
    }
  });

  it('production connects through BAMBOOHR_API_KEY_REF (DEC-071)', () => {
    const prod = {
      ...base,
      NODE_ENV: 'production',
      SCAN_MODE: 'external',
      SCANNER_URL: 'https://scanner.internal.invalid',
      EMAIL_MODE: 'disabled',
      STORAGE_MODE: 's3',
      S3_ENDPOINT: 'https://s3.internal.invalid',
      S3_BUCKET: 'exit-platform',
      S3_REGION: 'us-east-1',
      S3_ACCESS_KEY_REF: 'vault://s3-access',
      S3_SECRET_KEY_REF: 'vault://s3-secret',
      IDENTITY_MODE: 'oidc',
      OIDC_ISSUER: 'https://login.company.invalid',
      OIDC_CLIENT_ID: 'app-client',
      OIDC_CLIENT_SECRET_REF: 'vault://oidc-secret',
      ALLOW_DEV_LOGIN: 'false',
      BAMBOOHR_API_KEY_REF: 'env:BAMBOO_SECRET',
      BAMBOOHR_SUBDOMAIN: 'bertsauto',
    } as const;
    const config = loadConfig(prod);
    expect(bambooDirectoryStatus(config, { BAMBOO_SECRET: FAKE_KEY })).toBe('configured');
    expect(bambooApiKey(config, { BAMBOO_SECRET: FAKE_KEY })).toBe(FAKE_KEY);
    // The secret variable missing on the host reads as a configuration fault.
    expect(bambooDirectoryStatus(config, {})).toBe('invalid configuration');
    // A raw key pasted into the reference field is refused at startup, unechoed.
    expect(() => loadConfig({ ...prod, BAMBOOHR_API_KEY_REF: FAKE_KEY })).toThrow(
      /BAMBOOHR_API_KEY_REF/,
    );
    try {
      loadConfig({ ...prod, BAMBOOHR_API_KEY_REF: FAKE_KEY });
    } catch (e) {
      expect((e as Error).message).not.toContain(FAKE_KEY);
    }
  });

  it('a reference also works outside production and wins over a raw key', () => {
    const config = loadConfig({
      ...base,
      BAMBOOHR_API_KEY: 'raw-key-that-should-lose-0123456789',
      BAMBOOHR_API_KEY_REF: 'env:BAMBOO_SECRET',
      BAMBOOHR_SUBDOMAIN: 'bertsauto',
    });
    expect(bambooApiKey(config, { BAMBOO_SECRET: FAKE_KEY })).toBe(FAKE_KEY);
  });
});
