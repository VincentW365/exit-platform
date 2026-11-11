/**
 * DEC-075: the request-body limit the web build accepts is sized from the same
 * MAX_UPLOAD_MB the upload rule reads, plus a fixed margin, so every file the
 * platform accepts also reaches it. Owner report, 2026-11-11: a 1.3 MB banner
 * came back as "Something Went Wrong" because the build kept Next's 1 MB.
 */
import { describe, expect, it } from 'vitest';
import {
  loadConfig,
  MAX_UPLOAD_MB_CEILING,
  MAX_UPLOAD_MB_DEFAULT,
  maxUploadMbFromEnv,
  UPLOAD_BODY_MARGIN_MB,
  uploadBodyLimitMb,
} from '../src/index.ts';

const BASE = {
  DATABASE_URL: 'postgresql://user:pw@localhost:5432/db',
  SESSION_SECRET: 'x'.repeat(40),
};

describe('upload limits (DEC-075)', () => {
  it('reads MAX_UPLOAD_MB as the configuration does, default included', () => {
    expect(maxUploadMbFromEnv(undefined)).toBe(MAX_UPLOAD_MB_DEFAULT);
    expect(maxUploadMbFromEnv('25')).toBe(25);
    expect(maxUploadMbFromEnv(String(MAX_UPLOAD_MB_CEILING))).toBe(MAX_UPLOAD_MB_CEILING);
    expect(() => maxUploadMbFromEnv('0')).toThrow();
    expect(() => maxUploadMbFromEnv('101')).toThrow();
    expect(() => maxUploadMbFromEnv('ten')).toThrow();
    expect(loadConfig({ ...BASE, MAX_UPLOAD_MB: '25' }).MAX_UPLOAD_MB).toBe(25);
    expect(loadConfig(BASE).MAX_UPLOAD_MB).toBe(MAX_UPLOAD_MB_DEFAULT);
  });

  it('the body limit always clears the largest file the platform accepts', () => {
    expect(uploadBodyLimitMb(MAX_UPLOAD_MB_DEFAULT)).toBe(
      MAX_UPLOAD_MB_DEFAULT + UPLOAD_BODY_MARGIN_MB,
    );
    // The 2 MB email banner (EMAIL_BANNER_MAX_BYTES) fits even at the smallest setting.
    expect(uploadBodyLimitMb(1)).toBeGreaterThan(2);
    for (const mb of [1, 10, 50, MAX_UPLOAD_MB_CEILING]) {
      expect(uploadBodyLimitMb(mb)).toBeGreaterThan(mb);
    }
  });
});
