/**
 * The BambooHR directory credential, entered in the application (DEC-072,
 * owner request 2026-10-27).
 *
 * The owner has no access to the hosting platform, so the HR Manager can save
 * the company subdomain and the read-only API key on the System page. The key
 * is encrypted at rest with the application's data key (the same AES-256-GCM
 * boundary that protects recipient addresses), is never displayed, logged or
 * audited, and can be replaced or removed. A credential set on the host
 * (BAMBOOHR_API_KEY_REF, or BAMBOOHR_API_KEY outside production) always wins,
 * so moving it to the host later needs no change here.
 */
import { bambooApiKey, bambooDirectoryStatus, getConfig } from '@exit/config';
import { can, type Actor } from '@exit/domain';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { decryptValue, encryptValue } from '../secretBox.ts';
import { appendAudit, newCorrelationId } from './auditService.ts';

/** Kept out of the System Configuration listing (see listSystemConfig). */
export const STORED_BAMBOO_CREDENTIAL_KEY = 'bamboohr.storedCredential';

interface StoredCredential {
  subdomain: string;
  keyCiphertext: string;
  savedAt: string;
}

export type BambooCredentialStatus = 'configured' | 'not configured' | 'invalid configuration';

export interface BambooCredential {
  key: string;
  subdomain: string;
  source: 'host' | 'app';
}

/**
 * The company subdomain however it was typed: `acme`, `acme.bamboohr.com`,
 * `https://acme.bamboohr.com/...` or the API gateway URL.
 */
export function normaliseBambooSubdomain(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const gateway = /gateway\.php\/([a-z0-9][a-z0-9-]*)/i.exec(v);
  if (gateway) return gateway[1]!.toLowerCase();
  const host = v.replace(/^https?:\/\//i, '').split(/[/?#]/)[0]!;
  const sub = host.toLowerCase().endsWith('.bamboohr.com') ? host.split('.')[0]! : host;
  return /^[a-z0-9][a-z0-9-]*$/i.test(sub) ? sub.toLowerCase() : null;
}

async function readStored(): Promise<StoredCredential | null> {
  const row = await getPrisma().systemConfig.findUnique({
    where: { key: STORED_BAMBOO_CREDENTIAL_KEY },
  });
  const v = row?.value as Partial<StoredCredential> | null | undefined;
  if (!v || typeof v.subdomain !== 'string' || typeof v.keyCiphertext !== 'string') return null;
  return { subdomain: v.subdomain, keyCiphertext: v.keyCiphertext, savedAt: String(v.savedAt) };
}

/** The credential the live adapter should use: the host's first, then the saved one. */
export async function resolveBambooCredential(): Promise<BambooCredential | null> {
  const config = getConfig();
  if (bambooDirectoryStatus(config) === 'configured') {
    return {
      key: bambooApiKey(config),
      subdomain: config.BAMBOOHR_SUBDOMAIN!.trim(),
      source: 'host',
    };
  }
  const stored = await readStored();
  if (!stored) return null;
  try {
    const key = decryptValue(stored.keyCiphertext).trim();
    return key.length >= 20 ? { key, subdomain: stored.subdomain, source: 'app' } : null;
  } catch {
    // The data key changed since it was saved: treat as not usable.
    return null;
  }
}

/** Configured / not configured / invalid - never the value. */
export async function bambooCredentialStatus(): Promise<{
  status: BambooCredentialStatus;
  source: 'host' | 'app' | null;
  savedAt: string | null;
}> {
  const hostStatus = bambooDirectoryStatus();
  if (hostStatus === 'configured') return { status: 'configured', source: 'host', savedAt: null };
  const stored = await readStored();
  if (!stored) return { status: hostStatus, source: null, savedAt: null };
  const usable = (await resolveBambooCredential()) !== null;
  return {
    status: usable ? 'configured' : 'invalid configuration',
    source: 'app',
    savedAt: stored.savedAt,
  };
}

export function bambooCredentialErrors(input: { subdomain: string; apiKey: string }): string[] {
  const errors: string[] = [];
  if (!normaliseBambooSubdomain(input.subdomain)) {
    errors.push(
      'Enter the company name from your BambooHR web address - for acme.bamboohr.com, type acme.',
    );
  }
  const key = input.apiKey.trim();
  if (key.length < 20 || /\s/.test(key)) {
    errors.push('The API key looks incomplete. Paste the whole key from BambooHR, with no spaces.');
  }
  return errors;
}

export async function saveBambooCredential(
  actor: Actor,
  input: { subdomain: string; apiKey: string },
): Promise<void> {
  if (!can(actor, 'admin.system')) throw ServiceError.forbidden();
  const errors = bambooCredentialErrors(input);
  if (errors.length) throw ServiceError.validation(errors);
  const subdomain = normaliseBambooSubdomain(input.subdomain)!;
  const value: StoredCredential = {
    subdomain,
    keyCiphertext: encryptValue(input.apiKey.trim()),
    savedAt: new Date().toISOString(),
  };
  const reason = 'BambooHR connection saved on the System page (DEC-072).';
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    await tx.systemConfig.upsert({
      where: { key: STORED_BAMBOO_CREDENTIAL_KEY },
      create: {
        key: STORED_BAMBOO_CREDENTIAL_KEY,
        value: value as never,
        reason,
        updatedById: actor.userId,
      },
      update: { value: value as never, reason, updatedById: actor.userId },
    });
    await appendAudit(tx, {
      eventType: 'CONFIG_SYSTEM_CHANGED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'BambooHRCredential',
      objectId: STORED_BAMBOO_CREDENTIAL_KEY,
      result: 'SUCCESS',
      correlationId: newCorrelationId(),
      // Never the key: the action, the subdomain (not a secret) and the reason.
      metadata: { action: 'SAVED', subdomain, reason },
    });
  });
}

export async function removeBambooCredential(actor: Actor): Promise<void> {
  if (!can(actor, 'admin.system')) throw ServiceError.forbidden();
  const prisma = getPrisma();
  // The runtime role holds no DELETE on system_config, so removal overwrites
  // the saved key with a marker that resolves to "no credential".
  const reason = 'BambooHR connection removed on the System page (DEC-072).';
  const value = { removed: true, removedAt: new Date().toISOString() };
  await prisma.$transaction(async (tx) => {
    await tx.systemConfig.upsert({
      where: { key: STORED_BAMBOO_CREDENTIAL_KEY },
      create: { key: STORED_BAMBOO_CREDENTIAL_KEY, value, reason, updatedById: actor.userId },
      update: { value, reason, updatedById: actor.userId },
    });
    await appendAudit(tx, {
      eventType: 'CONFIG_SYSTEM_CHANGED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'BambooHRCredential',
      objectId: STORED_BAMBOO_CREDENTIAL_KEY,
      result: 'SUCCESS',
      correlationId: newCorrelationId(),
      metadata: { action: 'REMOVED', reason },
    });
  });
}
