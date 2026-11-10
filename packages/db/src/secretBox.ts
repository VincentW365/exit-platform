/**
 * Application-boundary encryption for protected values at rest
 * (Directive 4 B.13): AES-256-GCM with a key from DATA_KEY, or - documented
 * development fallback - derived from SESSION_SECRET via HKDF. This protects
 * recipient destinations in the database; it is NOT a substitute for a
 * production KMS, which remains a deployment decision.
 *
 * A value saved under one key cannot be read under another. Readers get
 * UnreadableSecretError (or null from tryDecryptValue) and say so in plain
 * words: the site's data key changed since the value was saved, or the
 * database was seeded under a different one (owner report, 2026-11-10: Review
 * and approve crashed on the first saved address it tried to read). The
 * fingerprint lets two environments compare keys without revealing either.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { getConfig } from '@exit/config';

function material(): string {
  const config = getConfig();
  return config.DATA_KEY ?? config.SESSION_SECRET;
}

function key(): Buffer {
  return Buffer.from(hkdfSync('sha256', material(), 'exit-platform', 'data-at-rest', 32));
}

/** A stored value this process cannot read. Never carries the value or the key. */
export class UnreadableSecretError extends Error {
  readonly reason: 'key' | 'format';
  constructor(reason: 'key' | 'format') {
    super(
      reason === 'format'
        ? 'The stored value is not in a form this application can read.'
        : "The stored value cannot be read with this site's data key: SESSION_SECRET or DATA_KEY changed since it was saved, or the database was seeded under a different one.",
    );
    this.name = 'UnreadableSecretError';
    this.reason = reason;
  }
}

export function encryptValue(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${enc.toString('base64url')}`;
}

export function decryptValue(ciphertext: string): string {
  const [v, ivB64, tagB64, dataB64] = ciphertext.split(':');
  if (v !== 'v1' || !ivB64 || !tagB64 || !dataB64) throw new UnreadableSecretError('format');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new UnreadableSecretError('key');
  }
}

/** The value, or null when this site's data key cannot read it. */
export function tryDecryptValue(ciphertext: string): string | null {
  try {
    return decryptValue(ciphertext);
  } catch (e) {
    if (e instanceof UnreadableSecretError) return null;
    throw e;
  }
}

/** Eight hex characters that change with the data key and reveal nothing of it. */
export function dataKeyFingerprint(): string {
  return Buffer.from(
    hkdfSync('sha256', material(), 'exit-platform', 'data-key-fingerprint', 4),
  ).toString('hex');
}
