/**
 * Object-storage adapter boundary (REQ-INT-001). Stage 1 ships only the local
 * development adapter: private directory, system-generated random object keys
 * (REQ-SEC-021), no user-controlled paths, nothing served from a public root
 * (REQ-DOC-012).
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getConfig, resolveFromRoot } from '@exit/config';

export interface StorageAdapter {
  readonly name: string;
  put(objectKey: string, bytes: Uint8Array): Promise<void>;
  get(objectKey: string): Promise<Buffer>;
  /** Deletion runs ONLY through the approved retention process (Directive 4 G). */
  deleteForRetention?(objectKey: string): Promise<void>;
  health?(): Promise<{ ok: boolean; detail: string }>;
  validateConfig?(): string[];
}

// Legacy bare keys plus Stage 4 prefixed keys (quarantine/clean/rejected/
// generated) - always system-generated randomness, never employee names.
const KEY_PATTERN = /^(?:(?:quarantine|clean|rejected|generated)\/)?[a-f0-9]{48}$/;

export function newObjectKey(): string {
  return randomBytes(24).toString('hex');
}

/** Stage 4 (section G): path-prefixed key for a specific storage class. */
export function newPrefixedObjectKey(
  prefix: 'quarantine' | 'clean' | 'rejected' | 'generated',
): string {
  return `${prefix}/${newObjectKey()}`;
}

export class LocalStorageAdapter implements StorageAdapter {
  readonly name = 'local-dev';
  private readonly root: string;

  constructor(rootDir?: string) {
    // Anchored at the repository root, not the process cwd: the web app and
    // the worker run from different directories and must share one store.
    this.root = rootDir ? path.resolve(rootDir) : resolveFromRoot(getConfig().STORAGE_DIR);
  }

  private resolveKey(objectKey: string): string {
    // Keys are always system-generated; anything else is rejected outright.
    if (!KEY_PATTERN.test(objectKey)) throw new Error('Invalid object key.');
    const flat = objectKey.replace('/', '_');
    return path.join(this.root, flat.slice(0, 2), flat);
  }

  async put(objectKey: string, bytes: Uint8Array): Promise<void> {
    const target = this.resolveKey(objectKey);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: 'wx' }); // never overwrite
  }

  async get(objectKey: string): Promise<Buffer> {
    return readFile(this.resolveKey(objectKey));
  }

  async deleteForRetention(objectKey: string): Promise<void> {
    const { unlink } = await import('node:fs/promises');
    await unlink(this.resolveKey(objectKey)).catch(() => undefined);
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    try {
      await mkdir(this.root, { recursive: true });
      return {
        ok: true,
        detail: `local private directory (${getConfig().isProduction ? 'FORBIDDEN in production' : 'development'})`,
      };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message.slice(0, 100) : 'unavailable' };
    }
  }

  validateConfig(): string[] {
    return getConfig().isProduction
      ? ['Local filesystem storage is not permitted in production (G).']
      : [];
  }
}

/**
 * S3-compatible object-storage BOUNDARY (Directive 4 section G): private by
 * default, encryption in transit and at rest, signed short-lived access only
 * after server authorization. No credentials exist in this repository, so
 * every operation fails closed until the deployment provides configuration -
 * no network activity occurs here.
 */
export class S3StorageAdapter implements StorageAdapter {
  readonly name = 's3-boundary';

  validateConfig(): string[] {
    const c = getConfig();
    const missing = [
      ['S3_ENDPOINT', c.S3_ENDPOINT],
      ['S3_BUCKET', c.S3_BUCKET],
      ['S3_REGION', c.S3_REGION],
      ['S3_ACCESS_KEY_REF', c.S3_ACCESS_KEY_REF],
      ['S3_SECRET_KEY_REF', c.S3_SECRET_KEY_REF],
    ]
      .filter(([, v]) => !v)
      .map(([k]) => `${k} is not configured.`);
    return missing;
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    const errors = this.validateConfig();
    return errors.length
      ? { ok: false, detail: `not configured: ${errors.length} item(s) missing` }
      : { ok: true, detail: 'configuration present (live connectivity untested - no credentials)' };
  }

  private refuse(): never {
    throw new Error(
      'S3 storage is a configuration-gated boundary; credentials are not provisioned (fail closed).',
    );
  }

  async put(): Promise<void> {
    this.refuse();
  }
  async get(): Promise<Buffer> {
    this.refuse();
  }
  async deleteForRetention(): Promise<void> {
    this.refuse();
  }
}

let adapter: StorageAdapter | undefined;

export function getStorage(): StorageAdapter {
  if (!adapter) {
    adapter =
      getConfig().STORAGE_MODE === 's3' ? new S3StorageAdapter() : new LocalStorageAdapter();
  }
  return adapter;
}

/** Test hook. */
export function setStorageForTests(a: StorageAdapter | undefined): void {
  adapter = a;
}
