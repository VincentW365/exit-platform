/**
 * Object-storage adapter boundary (REQ-INT-001). Stage 1 ships only the local
 * development adapter: private directory, system-generated random object keys
 * (REQ-SEC-021), no user-controlled paths, nothing served from a public root
 * (REQ-DOC-012).
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getConfig, resolveFromRoot, resolveSecretRef, secretRefFormatError } from '@exit/config';

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
// generated) and the DEC-067 branding class (email banner images) - always
// system-generated randomness, never employee names.
const KEY_PATTERN = /^(?:(?:quarantine|clean|rejected|generated|branding)\/)?[a-f0-9]{48}$/;

export function newObjectKey(): string {
  return randomBytes(24).toString('hex');
}

/** Stage 4 (section G): path-prefixed key for a specific storage class. */
export function newPrefixedObjectKey(
  prefix: 'quarantine' | 'clean' | 'rejected' | 'generated' | 'branding',
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
 * S3-compatible object storage (Directive 4 section G): private bucket,
 * encryption in transit, system-generated keys, server authorization before
 * any read. Generic S3 - the endpoint, region and addressing style are all
 * configuration, so this works against AWS S3 or any S3-compatible provider
 * and depends on no particular host.
 *
 * Credentials arrive as REFERENCES (`env:NAME`) and are resolved only at the
 * moment a client is built. They are never logged, never returned and never
 * placed in an error (DEC-062).
 */
export class S3StorageAdapter implements StorageAdapter {
  readonly name = 's3';
  private client?: S3Client;
  private bucketName?: string;

  /** Reports configuration problems WITHOUT resolving any secret value. */
  validateConfig(): string[] {
    const c = getConfig();
    const errors = [
      ['S3_ENDPOINT', c.S3_ENDPOINT],
      ['S3_BUCKET', c.S3_BUCKET],
      ['S3_REGION', c.S3_REGION],
    ]
      .filter(([, v]) => !v)
      .map(([k]) => `${k} is not configured.`);
    for (const [label, ref] of [
      ['S3_ACCESS_KEY_REF', c.S3_ACCESS_KEY_REF],
      ['S3_SECRET_KEY_REF', c.S3_SECRET_KEY_REF],
    ] as const) {
      const problem = secretRefFormatError(ref, label);
      if (problem) errors.push(problem);
    }
    return errors;
  }

  /**
   * Build the client on first use. Resolution failures surface as
   * ConfigError, which carries the variable NAME and never its value.
   */
  private connection(): { client: S3Client; bucket: string } {
    if (!this.client || !this.bucketName) {
      const c = getConfig();
      const errors = this.validateConfig();
      if (errors.length) {
        throw new Error(`S3 storage is not completely configured: ${errors.join(' ')}`);
      }
      this.client = new S3Client({
        region: c.S3_REGION!,
        endpoint: c.S3_ENDPOINT!,
        // Provider addressing style, not a vendor assumption (see config).
        forcePathStyle: c.S3_FORCE_PATH_STYLE,
        credentials: {
          accessKeyId: resolveSecretRef(c.S3_ACCESS_KEY_REF, 'S3_ACCESS_KEY_REF'),
          secretAccessKey: resolveSecretRef(c.S3_SECRET_KEY_REF, 'S3_SECRET_KEY_REF'),
        },
      });
      this.bucketName = c.S3_BUCKET!;
    }
    return { client: this.client, bucket: this.bucketName };
  }

  /** Keys are system-generated; anything else is refused, as locally. */
  private assertKey(objectKey: string): string {
    if (!KEY_PATTERN.test(objectKey)) throw new Error('Invalid object key.');
    return objectKey;
  }

  /**
   * Never overwrite. `IfNoneMatch: '*'` is the S3 equivalent of the local
   * adapter's `flag: 'wx'`: the write succeeds only if no object exists at
   * that key. A provider that does not honour conditional creation surfaces
   * its refusal here rather than silently replacing a stored document.
   */
  async put(objectKey: string, bytes: Uint8Array): Promise<void> {
    // Key first: an invalid request is refused before any credential is read.
    const key = this.assertKey(objectKey);
    const { client, bucket } = this.connection();
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: bytes,
          ContentType: 'application/octet-stream',
          IfNoneMatch: '*',
        }),
      );
    } catch (e) {
      if (isPreconditionFailed(e)) {
        throw new Error('Object already exists; stored documents are never overwritten.');
      }
      throw e;
    }
  }

  async get(objectKey: string): Promise<Buffer> {
    const key = this.assertKey(objectKey);
    const { client, bucket } = this.connection();
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!result.Body) throw new Error('Object has no readable body.');
    return Buffer.from(await result.Body.transformToByteArray());
  }

  /**
   * Deletion runs ONLY through the approved retention process. Absence is
   * success - disposal is idempotent - but a genuine failure propagates, so
   * retention evidence never claims a disposal that did not happen. (The
   * local adapter swallows all errors; that is acceptable for a development
   * directory and not for durable evidence.)
   */
  async deleteForRetention(objectKey: string): Promise<void> {
    const key = this.assertKey(objectKey);
    const { client, bucket } = this.connection();
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } catch (e) {
      if (isNotFound(e)) return;
      throw e;
    }
  }

  /** Non-mutating readiness probe: the bucket exists and is reachable. */
  async health(): Promise<{ ok: boolean; detail: string }> {
    const errors = this.validateConfig();
    if (errors.length) {
      return { ok: false, detail: `not configured: ${errors.length} item(s) missing` };
    }
    try {
      const { client, bucket } = this.connection();
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
      return { ok: true, detail: 'bucket reachable' };
    } catch (e) {
      // Shape and status only - never a credential, never a bucket policy.
      return { ok: false, detail: storageErrorDetail(e) };
    }
  }
}

/** True when the provider refused a conditional create (object exists). */
function isPreconditionFailed(e: unknown): boolean {
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
  return err?.name === 'PreconditionFailed' || err?.$metadata?.httpStatusCode === 412;
}

/** True when the object or key does not exist. */
function isNotFound(e: unknown): boolean {
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    err?.name === 'NoSuchKey' || err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404
  );
}

/** A safe, value-free description of a storage failure for health output. */
function storageErrorDetail(e: unknown): string {
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
  const status = err?.$metadata?.httpStatusCode;
  const name = typeof err?.name === 'string' ? err.name : 'StorageError';
  return status ? `${name} (http ${status})` : name;
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
