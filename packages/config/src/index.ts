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
import path from 'node:path';
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
  /**
   * What this DEPLOYMENT is for. Distinct from NODE_ENV, which says only how
   * Node and Next were built and run - a hosted test environment is still a
   * production BUILD. Every provider and policy guard keys off this value,
   * never off NODE_ENV (owner directive, 2026-09-21).
   *
   *   development - local work; recipients must be non-deliverable.
   *   test        - real configuration; recipients are calculated exactly as
   *                 in production but delivery is redirected to TEST_EMAIL,
   *                 so a real mailbox can never be reached.
   *   uat         - a hosted testing deployment on any host (container,
   *                 cloud, temporary web host). Non-production providers are
   *                 permitted; production-CAPABLE providers are also
   *                 permitted, but never pointed at production RESOURCES.
   *   production  - real recipients, real delivery.
   *
   * Defaults from NODE_ENV so nothing has to be set to keep working, and so
   * that an absent value on a production build still means production.
   */
  APP_ENVIRONMENT: z.enum(['development', 'test', 'uat', 'production']).optional(),
  /**
   * Explicit acknowledgement that this is a deliberately-chosen hosted
   * testing deployment. Required for APP_ENVIRONMENT=uat, and for any
   * non-production environment running on a production Node build. A hosted
   * test environment is never inferred: it must be asked for twice.
   */
  UAT_HOSTED_ACK: boolString,
  /** The one mailbox every message is redirected to while testing. */
  TEST_EMAIL: z.string().optional(),
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
  /**
   * Address the bucket as a PATH (endpoint/bucket/key) rather than a virtual
   * host (bucket.endpoint/key). Self-hosted and S3-compatible providers
   * commonly require this; AWS S3 does not. Host-agnostic: it describes the
   * provider's addressing style, never a particular vendor.
   */
  S3_FORCE_PATH_STYLE: boolString,
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
  // LAN access for internal UAT (owner directive, 2026-09-02). Where the web
  // server LISTENS. 0.0.0.0 accepts connections from other workstations on
  // the same network; 127.0.0.1 keeps the app private to this machine. The
  // database is never affected by this - it stays loopback-only by its own
  // configuration (postgresql.conf listen_addresses), and every other
  // workstation reaches data only through this application.
  WEB_HOST: z.string().min(1).default('0.0.0.0'),
  WEB_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  // Directive 5.1 (section A): local read-only BambooHR directory credential.
  // The VALUE is never logged, surfaced or committed; status reporting uses
  // bambooDirectoryStatus() which returns a category only. Production refuses
  // this raw-key form entirely (reference-based configuration is required
  // there), so the existing fail-closed posture is unchanged.
  BAMBOOHR_API_KEY: z.string().optional(),
  /**
   * DEC-071: the reference form, as every other provider uses - `env:NAME`,
   * naming the host secret that holds the key. Accepted in every environment
   * and the ONLY form production accepts, so a deployment can connect the
   * live directory without a raw key in its configuration.
   */
  BAMBOOHR_API_KEY_REF: z.string().optional(),
  BAMBOOHR_SUBDOMAIN: z.string().optional(),
  /**
   * Private key BambooHR issued for the API-created employee webhook; used
   * only to verify webhook signatures (owner directive, 2026-09-15). Never
   * logged, rendered or returned. Absent = the webhook endpoint is closed.
   */
  BAMBOOHR_WEBHOOK_PRIVATE_KEY: z.string().optional(),
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
    /**
     * True when this is a production DEPLOYMENT (APP_ENVIRONMENT=production).
     * This is what every provider and policy guard means by "production".
     */
    isProduction: boolean;
    /**
     * True when the process was BUILT for production (NODE_ENV=production).
     * A hosted UAT deployment is normally both a production build and a
     * non-production environment. Diagnostics and startup logs only.
     */
    nodeEnvIsProduction: boolean;
    /** Resolved deployment environment. */
    appEnvironment: 'development' | 'test' | 'uat' | 'production';
    /**
     * True when WEB_HOST accepts connections from other machines. Read by
     * the sign-in page and the startup logs so that exposing the development
     * role switcher to a network is never silent.
     */
    lanExposed: boolean;
    /**
     * True when APP_BASE_URL points at this machine's loopback. Links the
     * platform puts in email (checklist, acknowledgement) are built from
     * APP_BASE_URL, and "localhost" in a link opened on ANOTHER workstation
     * points at that workstation, not at this server.
     */
    appBaseUrlIsLoopback: boolean;
  }
>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Resolve a credential REFERENCE to its value (DEC-062).
 *
 * The `*_REF` configuration fields hold a reference to where a secret lives,
 * never the secret itself - production refuses raw credential values, and this
 * keeps that discipline while making the reference usable.
 *
 * Only `env:NAME` is implemented. Every other scheme fails closed, so a
 * reference the deployment cannot honour stops the operation instead of
 * silently falling back to an anonymous or default credential.
 *
 * Nothing about the resolved VALUE ever reaches an error message, and neither
 * does the reference string: a raw secret mistakenly pasted into a `*_REF`
 * field must not leak through the error it causes. The referenced variable
 * NAME is named, because it is not a secret and it is what an operator needs.
 *
 * Deliberately generic: GRAPH_CLIENT_SECRET_REF and OIDC_CLIENT_SECRET_REF can
 * adopt this unchanged when those boundaries are implemented. Wiring them is
 * NOT part of the storage work.
 */
export function resolveSecretRef(
  reference: string | undefined,
  label: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const ref = (reference ?? '').trim();
  if (!ref) {
    throw new ConfigError(`${label} is not configured.`);
  }
  // A scheme is a leading token before the first colon. Anything else - most
  // importantly a raw credential pasted into the field - has no scheme and is
  // refused without being echoed.
  const match = /^([a-z][a-z0-9+.-]*):(.*)$/.exec(ref);
  if (!match) {
    throw new ConfigError(
      `${label} must be a reference such as env:VARIABLE_NAME. ` +
        'A raw credential value is not accepted in a reference field.',
    );
  }
  const scheme = match[1] ?? '';
  if (scheme !== 'env') {
    throw new ConfigError(
      `${label} uses an unsupported reference scheme. Only env:VARIABLE_NAME is implemented.`,
    );
  }
  const variableName = (match[2] ?? '').trim();
  if (!variableName) {
    throw new ConfigError(`${label} must name an environment variable, as env:VARIABLE_NAME.`);
  }
  const value = env[variableName];
  if (value === undefined || value.trim() === '') {
    throw new ConfigError(
      `${label} points at environment variable ${variableName}, which is not set or is empty.`,
    );
  }
  return value;
}

/**
 * Whether a reference is well-formed, WITHOUT resolving it. Used by
 * validateConfig() reporting, which must never touch a secret value.
 */
export function secretRefFormatError(reference: string | undefined, label: string): string | null {
  const ref = (reference ?? '').trim();
  if (!ref) return `${label} is not configured.`;
  const match = /^([a-z][a-z0-9+.-]*):(.*)$/.exec(ref);
  if (!match) return `${label} must be a reference such as env:VARIABLE_NAME.`;
  if (match[1] !== 'env') return `${label} uses an unsupported reference scheme (only env: works).`;
  if (!(match[2] ?? '').trim()) return `${label} must name an environment variable.`;
  return null;
}

/** Loopback in any of its spellings: nothing outside this machine can reach it. */
export function isLoopbackHost(host: string): boolean {
  const h = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127(\.\d{1,3}){3}$/.test(h);
}

/** The host part of a URL, or the raw value when it is not a URL at all. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
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
  // How the process was BUILT. Used for diagnostics only - never to decide
  // which providers or safeguards apply.
  const nodeEnvIsProduction = c.NODE_ENV === 'production';
  // What this deployment is FOR. The only source is an explicit
  // APP_ENVIRONMENT, or the NODE_ENV-derived default. There is deliberately
  // no other path to this value: a production configuration that fails
  // validation throws below, it never degrades into a weaker environment.
  const appEnvironment = c.APP_ENVIRONMENT ?? (nodeEnvIsProduction ? 'production' : 'development');
  // Every provider and policy guard in this file, and every isProduction
  // reader elsewhere, means "is this a production DEPLOYMENT". With
  // APP_ENVIRONMENT absent this is identical to the previous NODE_ENV test,
  // so existing development and production deployments are unchanged.
  const isProduction = appEnvironment === 'production';

  // A test/UAT deployment exists to exercise real routing without reaching a
  // real mailbox. Without somewhere to redirect to, that promise cannot be
  // kept, so the application refuses to start rather than deliver.
  if (appEnvironment === 'test') {
    const testEmail = (c.TEST_EMAIL ?? '').trim();
    if (!testEmail) {
      throw new ConfigError(
        'FATAL: APP_ENVIRONMENT=test requires TEST_EMAIL - the single mailbox every message is redirected to.',
      );
    }
    // One mailbox, plausibly shaped: no whitespace, one "@", a dotted host.
    // (The earlier form of this check had lost its backslashes and refused
    // any address containing the letter "s" - found 2026-09-09.)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail)) {
      throw new ConfigError('FATAL: TEST_EMAIL must be a valid email address.');
    }
  }
  // A hosted testing deployment is never inferred - it is asked for twice.
  // APP_ENVIRONMENT=uat names the intent; UAT_HOSTED_ACK confirms it, so a
  // single stray or mistyped variable cannot turn production into UAT.
  if (appEnvironment === 'uat' && !c.UAT_HOSTED_ACK) {
    throw new ConfigError(
      'FATAL: APP_ENVIRONMENT=uat requires UAT_HOSTED_ACK=true. A hosted testing ' +
        'environment must be selected deliberately, never inherited or inferred.',
    );
  }
  // A production BUILD running as anything other than production is legitimate
  // (a hosted test environment is still built for production), but it must be
  // deliberate. This replaces the former blanket refusal, which could not tell
  // "hosted UAT" apart from "production accidentally redirected".
  if (nodeEnvIsProduction && appEnvironment !== 'production' && !c.UAT_HOSTED_ACK) {
    throw new ConfigError(
      `FATAL: NODE_ENV=production with APP_ENVIRONMENT=${appEnvironment} requires ` +
        'UAT_HOSTED_ACK=true. Production delivers to real recipients; a non-production ' +
        'environment on a production build must be acknowledged explicitly.',
    );
  }

  // CLAUDE.md authentication safeguard: refuse to start, do not merely disable.
  // Keyed on the deployment environment, not the build mode - a production
  // deployment can never enable the switcher, whatever NODE_ENV says.
  if (isProduction && c.ALLOW_DEV_LOGIN) {
    throw new ConfigError(
      'FATAL: ALLOW_DEV_LOGIN=true is not permitted when APP_ENVIRONMENT=production. ' +
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
          'set BAMBOOHR_API_KEY_REF=env:<SECRET_VARIABLE> instead.',
      );
    }
    if (c.BAMBOOHR_API_KEY_REF) {
      const refError = secretRefFormatError(c.BAMBOOHR_API_KEY_REF, 'BAMBOOHR_API_KEY_REF');
      if (refError) throw new ConfigError(`FATAL: ${refError}`);
    }
  }

  return Object.freeze({
    ...c,
    isProduction,
    nodeEnvIsProduction,
    appEnvironment,
    devLoginEnabled: !isProduction && c.ALLOW_DEV_LOGIN,
    lanExposed: !isLoopbackHost(c.WEB_HOST),
    appBaseUrlIsLoopback: isLoopbackHost(hostOf(c.APP_BASE_URL)),
  });
}

/**
 * Load the repository-root .env into process.env using Node's native
 * loader (no override of variables that are already set). Missing files are
 * ignored: real environments inject configuration directly (REQ-SEC-013).
 */
/**
 * Where the repository's .env was found. Relative paths in configuration
 * (STORAGE_DIR above all) must mean the same directory for every process:
 * the web app runs from apps/web and the worker from apps/worker, so
 * resolving against cwd would give them separate object stores and the
 * worker could not read a PDF the web app rendered.
 */
let repositoryRoot: string | null = null;

/** The repository root, once loadRootEnvFile has located it. */
export function getRepositoryRoot(): string | null {
  return repositoryRoot;
}

/** Resolve a possibly relative path against the repository root. */
export function resolveFromRoot(p: string): string {
  if (!repositoryRoot) return path.resolve(p);
  return path.isAbsolute(p) ? p : path.resolve(repositoryRoot, p);
}

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
      repositoryRoot = dir;
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

/**
 * The BambooHR API key, from `BAMBOOHR_API_KEY_REF` when set (any
 * environment), otherwise from the raw `BAMBOOHR_API_KEY` outside production.
 * Returns '' when neither applies; throws ConfigError (never naming the
 * value) when a reference cannot be resolved.
 */
export function bambooApiKey(
  config: AppConfig = getConfig(),
  env: Record<string, string | undefined> = process.env,
): string {
  if (config.BAMBOOHR_API_KEY_REF?.trim()) {
    return resolveSecretRef(config.BAMBOOHR_API_KEY_REF, 'BAMBOOHR_API_KEY_REF', env).trim();
  }
  return config.isProduction ? '' : (config.BAMBOOHR_API_KEY?.trim() ?? '');
}

export function bambooDirectoryStatus(
  config: AppConfig = getConfig(),
  env: Record<string, string | undefined> = process.env,
): BambooDirectoryStatus {
  let key: string;
  try {
    key = bambooApiKey(config, env);
  } catch {
    return 'invalid configuration';
  }
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
