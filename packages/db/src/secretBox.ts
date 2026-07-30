/**
 * Application-boundary encryption for protected values at rest
 * (Directive 4 B.13): AES-256-GCM with a key from DATA_KEY, or - documented
 * development fallback - derived from SESSION_SECRET via HKDF. This protects
 * recipient destinations in the database; it is NOT a substitute for a
 * production KMS, which remains a deployment decision.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { getConfig } from '@exit/config';

function key(): Buffer {
  const config = getConfig();
  const material = config.DATA_KEY ?? config.SESSION_SECRET;
  return Buffer.from(hkdfSync('sha256', material, 'exit-platform', 'data-at-rest', 32));
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
  if (v !== 'v1' || !ivB64 || !tagB64 || !dataB64) throw new Error('Invalid ciphertext format.');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
