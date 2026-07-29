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
  SCAN_MODE: z.enum(['disabled', 'dev-passthrough']).default('disabled'),
  APP_TIMEZONE: z.literal('America/Jamaica').default('America/Jamaica'),
  // Stage 1: sink only (REQ-NOTIFY-013). Widening this enum is a later-stage,
  // decision-gated change (DEC-020).
  EMAIL_MODE: z.literal('sink').default('sink'),
  APP_BASE_URL: z.string().min(1).default('http://localhost:3000'),
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
      return;
    } catch {
      // keep walking up
    }
    const parent = dir.replace(/[\\/][^\\/]+$/, '');
    if (parent === dir) return;
    dir = parent;
  }
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
