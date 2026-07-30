/**
 * Environment configuration with runtime schema validation.
 *
 * Fail-closed rules (CLAUDE.md "Authentication safeguard", REQ-SEC-003,
 * REQ-INT-018, IC-S1-005/IC-S1-006):
 *  - development login requires BOTH a non-production environment AND
 *    ALLOW_DEV_LOGIN=true; the process refuses to start when it is enabled
 *    in production;
 *  - the dev-passthrough scan mode is refused in production;
 *  - only the sink email adapter is accepted in Stage 1;
 *  - missing required secrets fail startup instead of falling back silently.
 */
import { z } from 'zod';

const boolString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SESSION_SECRET: z
    .string()
    .min(32, 'SESSION_SECRET must be at least 32 characters; see .env.example'),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(240).default(30),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(24).default(12),
  ALLOW_DEV_LOGIN: boolString,
  STORAGE_DIR: z.string().min(1).default('./storage'),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(100).default(10),
  SCAN_MODE: z.enum(['disabled', 'dev-passthrough', 'external']).default('disabled'),
  SCANNER_URL: z.string().optional(),
  APP_TIMEZONE: z.literal('America/Jamaica').default('America/Jamaica'),
  // Stage 4 (Directive 4 sections B/C): provider-neutral email boundary.
  // 'sink' (legacy no-op) and 'dev-capture' are development-only; 'graph' is
  // the production boundary; 'disabled' runs without email entirely.
  EMAIL_MODE: z.enum(['disabled', 'sink', 'dev-capture', 'graph']).default('dev-capture'),
  GRAPH_TENANT_ID: z.string().optional(),
  GRAPH_CLIENT_ID: z.string().optional(),
  /// A REFERENCE to the credential location (vault path / secret name) -
  /// never the secret itself (fixed defaults 9/10).
  GRAPH_CLIENT_SECRET_REF: z.string().optional(),
  GRAPH_SENDER_MAILBOX: z.string().optional(),
  GRAPH_ALLOWED_DOMAINS: z.string().optional(),
  // Stage 4 (section G): object-storage boundary.
  STORAGE_MODE: z.enum(['local', 's3']).default('local'),
  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY_REF: z.string().optional(),
  S3_SECRET_KEY_REF: z.string().optional(),
  // Stage 4 (section E): identity boundary.
  IDENTITY_MODE: z.enum(['dev', 'oidc']).default('dev'),
  OIDC_ISSUER: z.string().optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET_REF: z.string().optional(),
  IDENTITY_JIT_PROVISIONING: boolString,
  // Stage 4 operations.
  TRUSTED_PROXY: z.string().optional(),
  PG_BIN: z.string().default('C:\\Program Files\\PostgreSQL\\17\\bin'),
  BACKUP_DIR: z.string().default('./backups'),
  /// Optional dedicated data-encryption key (>=32 chars); when absent the key
  /// is derived from SESSION_SECRET (documented development fallback).
  DATA_KEY: z.string().min(32).optional(),
  APP_BASE_URL: z.string().min(1).default('http://localhost:3000'),
  // Directive 5.1 (section A): local read-only BambooHR directory credential.
  // The VALUE is never logged, surfaced or committed; status reporting uses
  // bambooDirectoryStatus() which returns a category only. Production refuses
  // this raw-key form entirely (reference-based configuration is required
  // there), so the existing fail-closed posture is unchanged.
  BAMBOOHR_API_KEY: z.string().optional(),
  BAMBOOHR_SUBDOMAIN: z.string().optional(),
  // Directive 5.1 (section H.13/H.14): controlled branding configuration. The
  // logo can be replaced by pointing this at a new asset without touching
  // document templates; when the file is unreadable, rendering falls back to
  // the company name instead of failing.
  BRAND_LOGO_PATH: z.string().min(1).default('apps/web/public/brand/berts-auto-parts.png'),
});

export type AppConfig = Readonly<
  z.infer<typeof envSchema> & {
    /** True only when BOTH safeguards hold (never in production). */
    devLoginEnabled: boolean;
    isProduction: boolean;
  }
>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Validate an environment map. Throws ConfigError on any unsafe configuration. */
export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new ConfigError(`Invalid environment configuration: ${issues}`);
  }
  const c = parsed.data;
  const isProduction = c.NODE_ENV === 'production';

  // CLAUDE.md authentication safeguard: refuse to start, do not merely disable.
  if (isProduction && c.ALLOW_DEV_LOGIN) {
    throw new ConfigError(
      'FATAL: ALLOW_DEV_LOGIN=true is not permitted when NODE_ENV=production. ' +
        'The development role switcher is a non-production feature (REQ-SEC-003).',
    );
  }
  if (isProduction && c.SCAN_MODE === 'dev-passthrough') {
    throw new ConfigError(
      'FATAL: SCAN_MODE=dev-passthrough is not permitted in production. ' +
        'Production requires a real malware-scanning boundary (REQ-SEC-020).',
    );
  }

  // Stage 4 production fail-closed matrix (Directive 4 U.5 / fixed default 11):
  // every development-only provider is refused; every enabled production
  // provider must be completely configured.
  if (isProduction) {
    if (c.SCAN_MODE === 'disabled') {
      throw new ConfigError(
        'FATAL: SCAN_MODE=disabled is not permitted in production; configure SCAN_MODE=external with SCANNER_URL.',
      );
    }
    if (c.SCAN_MODE === 'external' && !c.SCANNER_URL) {
      throw new ConfigError('FATAL: SCAN_MODE=external requires SCANNER_URL.');
    }
    if (c.EMAIL_MODE === 'sink' || c.EMAIL_MODE === 'dev-capture') {
      throw new ConfigError(
        `FATAL: EMAIL_MODE=${c.EMAIL_MODE} is a development capture provider and is not permitted in production. ` +
          'Use EMAIL_MODE=graph (fully configured) or EMAIL_MODE=disabled.',
      );
    }
    if (c.EMAIL_MODE === 'graph') {
      const missing = [
        ['GRAPH_TENANT_ID', c.GRAPH_TENANT_ID],
        ['GRAPH_CLIENT_ID', c.GRAPH_CLIENT_ID],
        ['GRAPH_CLIENT_SECRET_REF', c.GRAPH_CLIENT_SECRET_REF],
        ['GRAPH_SENDER_MAILBOX', c.GRAPH_SENDER_MAILBOX],
      ]
        .filter(([, v]) => !v)
        .map(([k]) => k);
      if (missing.length) {
        throw new ConfigError(
          `FATAL: EMAIL_MODE=graph requires complete configuration; missing: ${missing.join(', ')}.`,
        );
      }
    }
    if (c.STORAGE_MODE === 'local') {
      throw new ConfigError(
        'FATAL: STORAGE_MODE=local (filesystem) is not permitted in production; configure STORAGE_MODE=s3.',
      );
    }
    if (c.STORAGE_MODE === 's3') {
      const missing = [
        ['S3_ENDPOINT', c.S3_ENDPOINT],
        ['S3_BUCKET', c.S3_BUCKET],
        ['S3_REGION', c.S3_REGION],
        ['S3_ACCESS_KEY_REF', c.S3_ACCESS_KEY_REF],
        ['S3_SECRET_KEY_REF', c.S3_SECRET_KEY_REF],
      ]
        .filter(([, v]) => !v)
        .map(([k]) => k);
      if (missing.length) {
        throw new ConfigError(
          `FATAL: STORAGE_MODE=s3 requires complete configuration; missing: ${missing.join(', ')}.`,
        );
      }
    }
    if (c.IDENTITY_MODE === 'dev') {
      throw new ConfigError(
        'FATAL: IDENTITY_MODE=dev is not permitted in production; configure IDENTITY_MODE=oidc.',
      );
    }
    if (c.IDENTITY_MODE === 'oidc') {
      const missing = [
        ['OIDC_ISSUER', c.OIDC_ISSUER],
        ['OIDC_CLIENT_ID', c.OIDC_CLIENT_ID],
        ['OIDC_CLIENT_SECRET_REF', c.OIDC_CLIENT_SECRET_REF],
      ]
        .filter(([, v]) => !v)
        .map(([k]) => k);
      if (missing.length) {
        throw new ConfigError(
          `FATAL: IDENTITY_MODE=oidc requires complete configuration; missing: ${missing.join(', ')}.`,
        );
      }
    }
    if (c.BAMBOOHR_API_KEY) {
      // Raw secret values are never accepted in production environment files
      // (fixed default 9/10): production BambooHR access requires the
      // reference-based configuration pattern like every other provider.
      throw new ConfigError(
        'FATAL: BAMBOOHR_API_KEY (a raw secret) is not permitted in production; ' +
          'use a credential reference via the secret manager instead.',
      );
    }
  }

  return Object.freeze({
    ...c,
    isProduction,
    devLoginEnabled: !isProduction && c.ALLOW_DEV_LOGIN,
  });
}

/**
 * Load the repository-root .env into process.env using Node's native
 * loader (no override of variables that are already set). Missing files are
 * ignored: real environments inject configuration directly (REQ-SEC-013).
 */
export function loadRootEnvFile(startDir: string): void {
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    const candidate = `${dir}/.env`;
    try {
      process.loadEnvFile(candidate);
      // Also load the gitignored .env.local beside it (local-only secrets
      // such as the BambooHR directory credential). Existing variables are
      // never overridden; a missing file is normal.
      try {
        process.loadEnvFile(`${dir}/.env.local`);
      } catch {
        // no .env.local - fine
      }
      return;
    } catch {
      // keep walking up
    }
    const parent = dir.replace(/[\\/][^\\/]+$/, '');
    if (parent === dir) return;
    dir = parent;
  }
}

/**
 * Directive 5.1 A.8: report the BambooHR directory configuration state as a
 * CATEGORY only - the credential value is never included in any message.
 */
export type BambooDirectoryStatus = 'configured' | 'not configured' | 'invalid configuration';

export function bambooDirectoryStatus(config: AppConfig = getConfig()): BambooDirectoryStatus {
  const key = config.BAMBOOHR_API_KEY?.trim() ?? '';
  const subdomain = config.BAMBOOHR_SUBDOMAIN?.trim() ?? '';
  if (!key && !subdomain) return 'not configured';
  if (!key || !subdomain) return 'invalid configuration';
  if (key.length < 20 || !/^[a-z0-9][a-z0-9-]*$/i.test(subdomain)) return 'invalid configuration';
  return 'configured';
}

let cached: AppConfig | undefined;

/** Process-wide config, validated once. */
export function getConfig(): AppConfig {
  cached ??= loadConfig();
  return cached;
}

/** Test hook: clear the cached config. */
export function resetConfigForTests(): void {
  cached = undefined;
}
