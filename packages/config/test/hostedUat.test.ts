/**
 * Hosted UAT environment invariants (owner directive, 2026-09-21).
 *
 * The platform separates two ideas that used to be one:
 *   NODE_ENV        - how the process was BUILT.
 *   APP_ENVIRONMENT - what the deployment is FOR.
 *
 * A hosted test environment is normally a production BUILD running as a
 * non-production ENVIRONMENT. These tests pin the safety properties that make
 * that separation acceptable, and - just as importantly - prove that nothing
 * about production changed.
 *
 * Nothing here is host-specific. `uat` means the same thing in a container,
 * on a cloud provider, on a temporary web host or on a laptop.
 */
import { describe, expect, it } from 'vitest';
import { loadConfig, ConfigError } from '../src/index.ts';

const BASE = {
  DATABASE_URL: 'postgresql://exit_app:x@127.0.0.1:5433/db',
  SESSION_SECRET: 'a'.repeat(48),
};

/** The hosted UAT deployment this directive describes. */
const UAT = {
  ...BASE,
  NODE_ENV: 'production', // hosted platforms build for production
  APP_ENVIRONMENT: 'uat',
  UAT_HOSTED_ACK: 'true',
  IDENTITY_MODE: 'dev',
  ALLOW_DEV_LOGIN: 'true',
  EMAIL_MODE: 'dev-capture',
  SCAN_MODE: 'dev-passthrough',
  STORAGE_MODE: 'local',
} as const;

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

describe('production is unchanged by the hosted-UAT separation', () => {
  it('treats an absent APP_ENVIRONMENT on a production build as production', () => {
    const c = loadConfig({ ...PROD_OK });
    expect(c.appEnvironment).toBe('production');
    expect(c.isProduction).toBe(true);
    expect(c.nodeEnvIsProduction).toBe(true);
    expect(c.devLoginEnabled).toBe(false);
  });

  it('still refuses every development provider in production', () => {
    expect(() => loadConfig({ ...PROD_OK, EMAIL_MODE: 'dev-capture' })).toThrow(/dev-capture/);
    expect(() => loadConfig({ ...PROD_OK, STORAGE_MODE: 'local' })).toThrow(/local/);
    expect(() => loadConfig({ ...PROD_OK, IDENTITY_MODE: 'dev' })).toThrow(/IDENTITY_MODE=dev/);
    expect(() => loadConfig({ ...PROD_OK, SCAN_MODE: 'disabled' })).toThrow(/disabled/);
    expect(() => loadConfig({ ...PROD_OK, BAMBOOHR_API_KEY: 'raw-key' })).toThrow(/BAMBOOHR/);
  });

  it('can never enable dev login, whatever else is set', () => {
    expect(() => loadConfig({ ...PROD_OK, ALLOW_DEV_LOGIN: 'true' })).toThrow(ConfigError);
    expect(() =>
      loadConfig({ ...PROD_OK, ALLOW_DEV_LOGIN: 'true', UAT_HOSTED_ACK: 'true' }),
    ).toThrow(ConfigError);
  });

  it('throws on a broken production configuration rather than degrading to UAT', () => {
    // The decisive property: an incomplete production environment must FAIL,
    // never quietly resolve to a weaker environment that would start.
    const broken = { ...PROD_OK, GRAPH_SENDER_MAILBOX: undefined };
    expect(() => loadConfig(broken)).toThrow(ConfigError);
    expect(() => loadConfig({ ...broken, UAT_HOSTED_ACK: 'true' })).toThrow(ConfigError);
  });
});

describe('hosted UAT must be selected deliberately', () => {
  it('starts when both the environment and the acknowledgement are given', () => {
    const c = loadConfig({ ...UAT });
    expect(c.appEnvironment).toBe('uat');
    expect(c.isProduction).toBe(false);
    // Still a production BUILD - the two ideas stay visible and separate.
    expect(c.nodeEnvIsProduction).toBe(true);
    expect(c.devLoginEnabled).toBe(true);
  });

  it('refuses APP_ENVIRONMENT=uat without the acknowledgement', () => {
    expect(() => loadConfig({ ...UAT, UAT_HOSTED_ACK: undefined })).toThrow(/UAT_HOSTED_ACK/);
    expect(() => loadConfig({ ...UAT, UAT_HOSTED_ACK: 'false' })).toThrow(/UAT_HOSTED_ACK/);
  });

  it('refuses any non-production environment on a production build without acknowledgement', () => {
    // Replaces the former blanket refusal: still no silent non-production
    // behaviour on a production build, but now it can be asked for.
    expect(() =>
      loadConfig({ ...BASE, NODE_ENV: 'production', APP_ENVIRONMENT: 'development' }),
    ).toThrow(/UAT_HOSTED_ACK/);
    expect(() =>
      loadConfig({
        ...BASE,
        NODE_ENV: 'production',
        APP_ENVIRONMENT: 'test',
        TEST_EMAIL: 'uat@company.invalid',
      }),
    ).toThrow(/UAT_HOSTED_ACK/);
  });

  it('is never reached by inference - only an explicit value selects it', () => {
    // No NODE_ENV produces 'uat' on its own.
    expect(loadConfig({ ...BASE, NODE_ENV: 'development' }).appEnvironment).toBe('development');
    expect(loadConfig({ ...BASE, NODE_ENV: 'test' }).appEnvironment).toBe('development');
    // A production build resolves to production - and a bare one does not even
    // get that far, because the fail-closed provider matrix throws first.
    expect(loadConfig({ ...PROD_OK }).appEnvironment).toBe('production');
    expect(() => loadConfig({ ...BASE, NODE_ENV: 'production' })).toThrow(ConfigError);
    // The acknowledgement alone does not select it either.
    expect(loadConfig({ ...BASE, UAT_HOSTED_ACK: 'true' }).appEnvironment).toBe('development');
  });

  it('keeps dev login opt-in inside UAT', () => {
    expect(loadConfig({ ...UAT, ALLOW_DEV_LOGIN: 'false' }).devLoginEnabled).toBe(false);
    expect(loadConfig({ ...UAT, ALLOW_DEV_LOGIN: undefined }).devLoginEnabled).toBe(false);
  });
});

describe('UAT permits production-capable providers, but not production resources', () => {
  // The prohibition is on pointing UAT at PRODUCTION resources - a rule about
  // which bucket, tenant and database a deployment is given, not about which
  // adapter implementations exist. Configuration cannot tell a UAT bucket from
  // a production one, so this must not be expressed as a code constraint.
  it('allows a separate UAT S3 bucket', () => {
    const c = loadConfig({
      ...UAT,
      STORAGE_MODE: 's3',
      S3_ENDPOINT: 'https://s3.uat.internal.invalid',
      S3_BUCKET: 'exit-platform-uat',
      S3_REGION: 'us-east-1',
      S3_ACCESS_KEY_REF: 'vault://uat-s3-access',
      S3_SECRET_KEY_REF: 'vault://uat-s3-secret',
    });
    expect(c.STORAGE_MODE).toBe('s3');
    expect(c.isProduction).toBe(false);
  });

  it('allows a separate UAT OIDC application', () => {
    const c = loadConfig({
      ...UAT,
      IDENTITY_MODE: 'oidc',
      ALLOW_DEV_LOGIN: 'false',
      OIDC_ISSUER: 'https://login-uat.company.invalid',
      OIDC_CLIENT_ID: 'app-client-uat',
      OIDC_CLIENT_SECRET_REF: 'vault://uat-oidc-secret',
    });
    expect(c.IDENTITY_MODE).toBe('oidc');
    expect(c.devLoginEnabled).toBe(false);
  });

  it('allows a controlled test email provider', () => {
    expect(loadConfig({ ...UAT, EMAIL_MODE: 'dev-capture' }).EMAIL_MODE).toBe('dev-capture');
    expect(loadConfig({ ...UAT, EMAIL_MODE: 'disabled' }).EMAIL_MODE).toBe('disabled');
  });
});
