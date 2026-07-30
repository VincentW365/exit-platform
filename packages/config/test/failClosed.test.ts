import { describe, expect, it } from 'vitest';
import { loadConfig, ConfigError } from '../src/index.ts';

const BASE = {
  DATABASE_URL: 'postgresql://exit_app:x@127.0.0.1:5433/db',
  SESSION_SECRET: 'a'.repeat(48),
};

/** A completely configured production environment (references only). */
const PROD_OK = {
  ...BASE,
  NODE_ENV: 'production',
  SCAN_MODE: 'external',
  SCANNER_URL: 'https://scanner.internal.invalid',
  EMAIL_MODE: 'graph',
  GRAPH_TENANT_ID: 'tenant-ref',
  GRAPH_CLIENT_ID: 'client-ref',
  GRAPH_CLIENT_SECRET_REF: 'vault://graph-secret',
  GRAPH_SENDER_MAILBOX: 'offboarding@company.invalid',
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
} as const;

describe('production fail-closed matrix (Directive 4 U.5 / fixed default 11)', () => {
  it('accepts a completely configured production environment', () => {
    const c = loadConfig({ ...PROD_OK });
    expect(c.isProduction).toBe(true);
    expect(c.devLoginEnabled).toBe(false);
  });

  it('rejects the development role switcher in production', () => {
    expect(() => loadConfig({ ...PROD_OK, ALLOW_DEV_LOGIN: 'true' })).toThrow(ConfigError);
  });

  it('rejects every development scanner mode in production', () => {
    expect(() => loadConfig({ ...PROD_OK, SCAN_MODE: 'dev-passthrough' })).toThrow(/passthrough/);
    expect(() => loadConfig({ ...PROD_OK, SCAN_MODE: 'disabled' })).toThrow(/disabled/);
    expect(() => loadConfig({ ...PROD_OK, SCANNER_URL: undefined })).toThrow(/SCANNER_URL/);
  });

  it('rejects development email capture in production (X.7/X.27)', () => {
    expect(() => loadConfig({ ...PROD_OK, EMAIL_MODE: 'dev-capture' })).toThrow(/dev-capture/);
    expect(() => loadConfig({ ...PROD_OK, EMAIL_MODE: 'sink' })).toThrow(/sink/);
  });

  it('rejects incomplete Graph configuration; accepts disabled email', () => {
    expect(() => loadConfig({ ...PROD_OK, GRAPH_CLIENT_SECRET_REF: undefined })).toThrow(
      /GRAPH_CLIENT_SECRET_REF/,
    );
    expect(() =>
      loadConfig({
        ...PROD_OK,
        EMAIL_MODE: 'disabled',
        GRAPH_TENANT_ID: undefined,
        GRAPH_CLIENT_ID: undefined,
        GRAPH_CLIENT_SECRET_REF: undefined,
        GRAPH_SENDER_MAILBOX: undefined,
      }),
    ).not.toThrow();
  });

  it('rejects local filesystem storage and incomplete S3 in production', () => {
    expect(() => loadConfig({ ...PROD_OK, STORAGE_MODE: 'local' })).toThrow(/local/);
    expect(() => loadConfig({ ...PROD_OK, S3_BUCKET: undefined })).toThrow(/S3_BUCKET/);
  });

  it('rejects development identity and incomplete OIDC in production', () => {
    expect(() => loadConfig({ ...PROD_OK, IDENTITY_MODE: 'dev' })).toThrow(/IDENTITY_MODE=dev/);
    expect(() => loadConfig({ ...PROD_OK, OIDC_ISSUER: undefined })).toThrow(/OIDC_ISSUER/);
  });

  it('rejects a weak or missing session secret everywhere', () => {
    expect(() => loadConfig({ ...PROD_OK, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
    expect(() => loadConfig({ ...BASE, SESSION_SECRET: undefined as never })).toThrow(
      /SESSION_SECRET/,
    );
  });

  it('rejects a missing database URL', () => {
    expect(() => loadConfig({ ...PROD_OK, DATABASE_URL: undefined as never })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('development defaults stay permissive and capture-based', () => {
    const c = loadConfig({ ...BASE });
    expect(c.isProduction).toBe(false);
    expect(c.EMAIL_MODE).toBe('dev-capture');
    expect(c.STORAGE_MODE).toBe('local');
    expect(c.IDENTITY_MODE).toBe('dev');
  });
});
