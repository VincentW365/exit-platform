/**
 * Object-storage adapter boundary (REQ-INT-001). Stage 1 ships only the local
 * development adapter: private directory, system-generated random object keys
 * (REQ-SEC-021), no user-controlled paths, nothing served from a public root
 * (REQ-DOC-012).
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getConfig } from '@exit/config';

export interface StorageAdapter {
  readonly name: string;
  put(objectKey: string, bytes: Uint8Array): Promise<void>;
  get(objectKey: string): Promise<Buffer>;
}

const KEY_PATTERN = /^[a-f0-9]{48}$/;

export function newObjectKey(): string {
  return randomBytes(24).toString('hex');
}

export class LocalStorageAdapter implements StorageAdapter {
  readonly name = 'local-dev';
  private readonly root: string;

  constructor(rootDir?: string) {
    this.root = path.resolve(rootDir ?? getConfig().STORAGE_DIR);
  }

  private resolveKey(objectKey: string): string {
    // Keys are always system-generated; anything else is rejected outright.
    if (!KEY_PATTERN.test(objectKey)) throw new Error('Invalid object key.');
    return path.join(this.root, objectKey.slice(0, 2), objectKey);
  }

  async put(objectKey: string, bytes: Uint8Array): Promise<void> {
    const target = this.resolveKey(objectKey);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: 'wx' }); // never overwrite
  }

  async get(objectKey: string): Promise<Buffer> {
    return readFile(this.resolveKey(objectKey));
  }
}

let adapter: StorageAdapter | undefined;

export function getStorage(): StorageAdapter {
  adapter ??= new LocalStorageAdapter();
  return adapter;
}

/** Test hook. */
export function setStorageForTests(a: StorageAdapter | undefined): void {
  adapter = a;
}
