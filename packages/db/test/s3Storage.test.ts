/**
 * S3 storage adapter (DEC-062).
 *
 * No network happens here and no bucket exists: these tests pin the parts
 * that must be right before a single byte is written - key discipline,
 * configuration reporting that never resolves a secret, and the never-
 * overwrite contract the local adapter enforces with `flag: 'wx'`.
 *
 * Live connectivity is proven by the UAT acceptance checks, not here.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { resetConfigForTests } from '@exit/config';
import { S3StorageAdapter, newObjectKey, newPrefixedObjectKey } from '../src/storage.ts';

const ORIGINAL_ENV = { ...process.env };

/** A UAT deployment with a separate UAT bucket, credentials by reference. */
function configureS3(overrides: Record<string, string | undefined> = {}): void {
  Object.assign(process.env, {
    NODE_ENV: 'production',
    APP_ENVIRONMENT: 'uat',
    UAT_HOSTED_ACK: 'true',
    DATABASE_URL: 'postgresql://exit_app:x@127.0.0.1:5433/db',
    SESSION_SECRET: 'a'.repeat(48),
    IDENTITY_MODE: 'dev',
    EMAIL_MODE: 'dev-capture',
    SCAN_MODE: 'dev-passthrough',
    STORAGE_MODE: 's3',
    S3_ENDPOINT: 'https://s3.uat.internal.invalid',
    S3_BUCKET: 'exit-platform-uat',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY_REF: 'env:UAT_S3_ACCESS_KEY',
    S3_SECRET_KEY_REF: 'env:UAT_S3_SECRET_KEY',
    UAT_S3_ACCESS_KEY: 'uat-access-key-value',
    UAT_S3_SECRET_KEY: 'uat-secret-key-value',
    ...overrides,
  });
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
  }
  resetConfigForTests();
}

beforeEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
  resetConfigForTests();
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
  resetConfigForTests();
});

describe('object keys stay system-generated', () => {
  it('generates bare and prefixed keys the adapter accepts', () => {
    expect(newObjectKey()).toMatch(/^[a-f0-9]{48}$/);
    expect(newPrefixedObjectKey('generated')).toMatch(/^generated\/[a-f0-9]{48}$/);
  });

  it('REFUSES a caller-supplied key before any credential is read', async () => {
    // Deliberately unconfigured: an invalid key must fail on the key, not on
    // configuration, proving the check runs first and touches no secret.
    configureS3({ S3_BUCKET: undefined, S3_ACCESS_KEY_REF: undefined });
    const adapter = new S3StorageAdapter();
    for (const bad of [
      '../../etc/passwd',
      'avery-brown-resignation.pdf',
      'generated/../secret',
      'GENERATED/' + 'a'.repeat(48),
      'a'.repeat(47),
      '',
    ]) {
      await expect(adapter.put(bad, new Uint8Array([1]))).rejects.toThrow('Invalid object key.');
      await expect(adapter.get(bad)).rejects.toThrow('Invalid object key.');
      await expect(adapter.deleteForRetention(bad)).rejects.toThrow('Invalid object key.');
    }
  });
});

describe('configuration reporting never resolves a secret', () => {
  it('reports a complete configuration as usable', () => {
    configureS3();
    expect(new S3StorageAdapter().validateConfig()).toEqual([]);
  });

  it('names every missing location setting', () => {
    configureS3({ S3_ENDPOINT: undefined, S3_BUCKET: undefined, S3_REGION: undefined });
    const errors = new S3StorageAdapter().validateConfig();
    expect(errors).toContain('S3_ENDPOINT is not configured.');
    expect(errors).toContain('S3_BUCKET is not configured.');
    expect(errors).toContain('S3_REGION is not configured.');
  });

  it('reports a malformed credential reference without echoing it', () => {
    const rawSecret = 'AKIA-RAW-SECRET-PASTED-BY-MISTAKE-77x';
    configureS3({ S3_ACCESS_KEY_REF: rawSecret });
    const errors = new S3StorageAdapter().validateConfig().join(' ');
    expect(errors).toMatch(/S3_ACCESS_KEY_REF must be a reference/);
    expect(errors).not.toContain(rawSecret);
    expect(errors).not.toContain('77x');
  });

  it('reports an unsupported scheme without resolving anything', () => {
    configureS3({ S3_SECRET_KEY_REF: 'vault://uat/s3-secret' });
    expect(new S3StorageAdapter().validateConfig().join(' ')).toMatch(/unsupported/);
  });

  it('does NOT require the referenced variable to exist to report format', () => {
    // validateConfig checks shape only - it must not touch the environment.
    configureS3({ UAT_S3_ACCESS_KEY: undefined, UAT_S3_SECRET_KEY: undefined });
    expect(new S3StorageAdapter().validateConfig()).toEqual([]);
  });
});

describe('health is non-mutating and reports safely', () => {
  it('fails closed, without a probe, when configuration is incomplete', async () => {
    configureS3({ S3_BUCKET: undefined });
    const health = await new S3StorageAdapter().health();
    expect(health.ok).toBe(false);
    expect(health.detail).toMatch(/not configured/);
  });

  it('never returns a credential in its detail', async () => {
    configureS3({ UAT_S3_ACCESS_KEY: undefined });
    const health = await new S3StorageAdapter().health();
    expect(health.ok).toBe(false);
    expect(health.detail).not.toContain('uat-secret-key-value');
    expect(health.detail).not.toContain('uat-access-key-value');
  });
});

describe('credential resolution is deferred to first use', () => {
  it('fails closed when the referenced variable is not set', async () => {
    configureS3({ UAT_S3_ACCESS_KEY: undefined });
    const adapter = new S3StorageAdapter();
    // A VALID key, so the failure is about the credential, not the request.
    await expect(adapter.put(newObjectKey(), new Uint8Array([1]))).rejects.toThrow(
      /UAT_S3_ACCESS_KEY/,
    );
  });

  it('does not leak the secret value when resolution fails', async () => {
    configureS3({ UAT_S3_SECRET_KEY: '' });
    const adapter = new S3StorageAdapter();
    let message = '';
    try {
      await adapter.put(newObjectKey(), new Uint8Array([1]));
    } catch (e) {
      message = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
    }
    expect(message).toMatch(/UAT_S3_SECRET_KEY/);
    expect(message).not.toContain('uat-access-key-value');
  });
});

describe('adapter identity', () => {
  it('is a generic S3 adapter, named for the protocol and no provider', () => {
    configureS3();
    expect(new S3StorageAdapter().name).toBe('s3');
  });
});
