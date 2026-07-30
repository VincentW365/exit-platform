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
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', ALLOW_DEV_LOGIN: 'true' })).toThrow(
      /not permitted when NODE_ENV=production/,
    );
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
