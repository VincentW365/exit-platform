import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/index.ts';

const base = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://exitplatform:x@localhost:5432/exitplatform_dev',
  SESSION_SECRET: 'a-test-only-secret-that-is-long-enough-0123456789',
};

describe('environment schema validation', () => {
  it('accepts a minimal safe development environment with safe defaults', () => {
    const c = loadConfig(base);
    expect(c.NODE_ENV).toBe('development');
    expect(c.ALLOW_DEV_LOGIN).toBe(false); // default off: opt-in only
    expect(c.devLoginEnabled).toBe(false);
    expect(c.SCAN_MODE).toBe('disabled'); // quarantine by default
    // Stage 4 (Directive 4 section C): the development default is the capture
    // provider; live modes stay configuration-gated.
    expect(c.EMAIL_MODE).toBe('dev-capture');
    expect(c.APP_TIMEZONE).toBe('America/Jamaica');
    expect(c.SESSION_IDLE_MINUTES).toBe(30);
  });

  it('requires DATABASE_URL and SESSION_SECRET (fail safely when missing, REQ-INT-018)', () => {
    expect(() => loadConfig({ ...base, DATABASE_URL: undefined })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, SESSION_SECRET: undefined })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, SESSION_SECRET: 'short' })).toThrow(/32 characters/);
  });

  it('enables dev login only with BOTH safeguards (REQ-SEC-003)', () => {
    expect(loadConfig({ ...base, ALLOW_DEV_LOGIN: 'true' }).devLoginEnabled).toBe(true);
    expect(loadConfig({ ...base, ALLOW_DEV_LOGIN: 'false' }).devLoginEnabled).toBe(false);
    expect(loadConfig({ ...base, NODE_ENV: 'test', ALLOW_DEV_LOGIN: 'true' }).devLoginEnabled).toBe(
      true,
    );
  });

  it('REFUSES TO START when dev login is enabled in production (CLAUDE.md safeguard)', () => {
    // NODE_ENV=production with no APP_ENVIRONMENT is still a production
    // DEPLOYMENT, so the switcher is refused exactly as before. The message
    // now names APP_ENVIRONMENT, because that is what the guard tests.
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', ALLOW_DEV_LOGIN: 'true' })).toThrow(
      /not permitted when APP_ENVIRONMENT=production/,
    );
    // Naming production explicitly is refused the same way, and neither the
    // hosted-UAT acknowledgement nor anything else can unlock it.
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        APP_ENVIRONMENT: 'production',
        ALLOW_DEV_LOGIN: 'true',
        UAT_HOSTED_ACK: 'true',
      }),
    ).toThrow(ConfigError);
  });

  it('production starts only with complete provider configuration (Stage 4 fail-closed)', () => {
    // A bare production environment now fails closed on every development
    // provider (Directive 4 U.5); the full passing matrix is covered in
    // failClosed.test.ts.
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', ALLOW_DEV_LOGIN: 'false' })).toThrow(
      ConfigError,
    );
  });

  it('refuses dev-passthrough scanning in production (REQ-SEC-020)', () => {
    expect(() =>
      loadConfig({ ...base, NODE_ENV: 'production', SCAN_MODE: 'dev-passthrough' }),
    ).toThrow(/dev-passthrough/);
    expect(
      loadConfig({ ...base, NODE_ENV: 'development', SCAN_MODE: 'dev-passthrough' }).SCAN_MODE,
    ).toBe('dev-passthrough');
  });

  it('email modes are the approved enum only (Stage 4 supersedes REQ-NOTIFY-013 sink-only)', () => {
    expect(() => loadConfig({ ...base, EMAIL_MODE: 'smtp' })).toThrow(ConfigError);
    expect(loadConfig({ ...base, EMAIL_MODE: 'graph' }).EMAIL_MODE).toBe('graph'); // dev: boundary allowed, unconfigured -> fails closed at send
    expect(loadConfig({ ...base, EMAIL_MODE: 'sink' }).EMAIL_MODE).toBe('sink');
    expect(loadConfig({ ...base, EMAIL_MODE: 'disabled' }).EMAIL_MODE).toBe('disabled');
  });

  it('rejects a non-Jamaica application timezone (DEC-027 / IC-S1-007)', () => {
    expect(() => loadConfig({ ...base, APP_TIMEZONE: 'UTC' })).toThrow(ConfigError);
  });

  it('bounds upload size configuration (REQ-NFR-018)', () => {
    expect(loadConfig({ ...base, MAX_UPLOAD_MB: '25' }).MAX_UPLOAD_MB).toBe(25);
    expect(() => loadConfig({ ...base, MAX_UPLOAD_MB: '0' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, MAX_UPLOAD_MB: '9999' })).toThrow(ConfigError);
  });
});

describe('LAN access for internal UAT (owner directive, 2026-09-02)', () => {
  it('listens on every interface by default and says so', () => {
    const c = loadConfig(base);
    expect(c.WEB_HOST).toBe('0.0.0.0');
    expect(c.WEB_PORT).toBe(3000);
    expect(c.lanExposed).toBe(true);
  });

  it('can be kept private to this machine by configuration alone', () => {
    for (const host of ['127.0.0.1', 'localhost', '::1', '[::1]']) {
      expect(loadConfig({ ...base, WEB_HOST: host }).lanExposed).toBe(false);
    }
  });

  it('takes the port from configuration so a restart never needs a code change', () => {
    expect(loadConfig({ ...base, WEB_PORT: '3010' }).WEB_PORT).toBe(3010);
    expect(() => loadConfig({ ...base, WEB_PORT: '0' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, WEB_PORT: '70000' })).toThrow(ConfigError);
  });

  it('knows when emailed links would dead-end on another workstation', () => {
    // The default base URL is loopback: fine on the host, wrong on the LAN.
    expect(loadConfig(base).appBaseUrlIsLoopback).toBe(true);
    expect(
      loadConfig({ ...base, APP_BASE_URL: 'http://192.168.1.20:3000' }).appBaseUrlIsLoopback,
    ).toBe(false);
    expect(
      loadConfig({ ...base, APP_BASE_URL: 'http://127.0.0.1:3000/' }).appBaseUrlIsLoopback,
    ).toBe(true);
  });

  it('never weakens the production safeguards to get there', () => {
    // Exposure is a listener setting; the role switcher is still refused in
    // production regardless of host.
    expect(() =>
      loadConfig({ ...base, NODE_ENV: 'production', WEB_HOST: '0.0.0.0', ALLOW_DEV_LOGIN: 'true' }),
    ).toThrow(ConfigError);
  });
});

describe('UAT redirect mailbox (APP_ENVIRONMENT=test)', () => {
  it('accepts an ordinary mailbox address, whatever letters it contains', () => {
    // Found by the offboarding regression suite (2026-09-09): the format
    // check had lost its backslashes, so any address containing the letter
    // "s" - uat@example.test, say - was refused and the UAT posture could
    // not start at all.
    for (const address of [
      'uat-test-mailbox@example.test',
      'hr.systems@bertsautoparts.test',
      'a@b.co',
    ]) {
      const c = loadConfig({ ...base, APP_ENVIRONMENT: 'test', TEST_EMAIL: address });
      expect(c.appEnvironment).toBe('test');
      expect(c.TEST_EMAIL).toBe(address);
    }
  });

  it('still refuses a value that is not an address', () => {
    for (const bad of ['', 'not-an-address', 'missing@tld', '@example.test', 'a b@example.test']) {
      expect(() => loadConfig({ ...base, APP_ENVIRONMENT: 'test', TEST_EMAIL: bad })).toThrow(
        ConfigError,
      );
    }
  });
});
