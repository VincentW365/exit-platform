/**
 * Controlled recipient directory (Directive 4 section D).
 *
 * HR selects business recipient classes; technical destination values and
 * external recipient approval are HR_MANAGER work (DEC-063).
 * Destinations are encrypted at rest and only ever displayed masked outside
 * the authorized edit surface. No real address is ever seeded.
 */
import {
  can,
  destinationErrors,
  maskDestination,
  recipientUsableErrors,
  EXTERNAL_RECIPIENT_CLASSES,
  PROVIDER_PURPOSES,
  RECIPIENT_CLASSES,
  NOTIFICATION_TYPES,
  type Actor,
  type RecipientClassName,
} from '@exit/domain';
import { z } from 'zod';
import { getConfig } from '@exit/config';
import { getPrisma } from '../client.ts';
import { encryptValue, tryDecryptValue } from '../secretBox.ts';
import { DEV_RECIPIENTS, SEED_CHANGE_REASON, SEED_ENVIRONMENT } from '../syntheticRecipients.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, newCorrelationId } from './auditService.ts';

const environment = () => (getConfig().isProduction ? 'production' : 'development');

export const recipientInputSchema = z.object({
  recipientClass: z.enum(RECIPIENT_CLASSES),
  displayName: z.string().trim().min(1).max(200),
  destination: z.string().trim().min(1).max(320),
  allowedTypes: z.array(z.enum(NOTIFICATION_TYPES)).min(1),
  changeReason: z.string().trim().min(1).max(500),
  effectiveFrom: z
    .union([z.null(), z.literal('').transform(() => null), z.coerce.date()])
    .optional(),
  // Directive 6.3 N/P: provider purpose + human identity fields.
  purpose: z.enum(PROVIDER_PURPOSES).nullable().optional(),
  organizationName: z.string().trim().max(200).nullable().optional(),
  contactName: z.string().trim().max(200).nullable().optional(),
});

/**
 * The seed entry a row was written from, when it certainly was: the seed's
 * change reason and environment, and a mask equal to the seed's. A
 * hand-entered address never matches.
 */
export function seededRecipientFor(row: {
  recipientClass: string;
  environment: string;
  changeReason: string | null;
  destinationMask: string;
}): { destination: string } | null {
  if (row.environment !== SEED_ENVIRONMENT || row.changeReason !== SEED_CHANGE_REASON) return null;
  const entry = DEV_RECIPIENTS.find((r) => r.recipientClass === row.recipientClass);
  if (!entry || maskDestination(entry.destination) !== row.destinationMask) return null;
  return { destination: entry.destination };
}

/**
 * Seeded addresses this site's data key cannot read are re-encrypted from the
 * seed's own table (DEC-073): synthetic capture destinations only, so no
 * re-approval is needed - the value is the one that was approved. Returns how
 * many were repaired and how many unreadable, hand-entered rows remain.
 */
export async function repairSeededRecipientRows(
  db: ReturnType<typeof getPrisma>,
  who: { actorId: string | null; roles: readonly string[] },
): Promise<{ repaired: number; remaining: number }> {
  const rows = await db.recipientConfig.findMany();
  let repaired = 0;
  let remaining = 0;
  for (const row of rows) {
    if (tryDecryptValue(row.destinationCiphertext) !== null) continue;
    const seed = seededRecipientFor(row);
    if (!seed) {
      remaining += 1;
      continue;
    }
    await db.recipientConfig.update({
      where: { id: row.id },
      data: {
        destinationCiphertext: encryptValue(seed.destination),
        destinationMask: maskDestination(seed.destination),
      },
    });
    await appendAudit(db, {
      eventType: 'RECIPIENT_CHANGED',
      actorType: who.actorId ? 'USER' : 'SYSTEM',
      actorId: who.actorId ?? undefined,
      effectiveRoles: who.roles,
      objectType: 'RecipientConfig',
      objectId: row.id,
      result: 'SUCCESS',
      correlationId: newCorrelationId(),
      // Mask only - never the destination itself.
      metadata: {
        action: 'repaired-seeded',
        recipientClass: row.recipientClass,
        destinationMask: row.destinationMask,
      },
    });
    repaired += 1;
  }
  return { repaired, remaining };
}

/** The System page's Repair button: the HR Manager re-encrypts seeded addresses. */
export async function repairSeededRecipients(
  actor: Actor,
): Promise<{ repaired: number; remaining: number }> {
  if (!can(actor, 'recipients.editTechnical') && !can(actor, 'recipients.editBusiness'))
    throw ServiceError.forbidden();
  return repairSeededRecipientRows(getPrisma(), { actorId: actor.userId, roles: actor.roles });
}

/** Plain words for an address this site's data key cannot read (DEC-073). */
export function unreadableAddressMessage(what: string): string {
  return (
    `The saved address for ${what} cannot be read with this site's data key: SESSION_SECRET or ` +
    'DATA_KEY changed since it was saved, or the database was seeded under a different one. ' +
    'Restore the original value on the host, or enter the address again under Administration > Recipients.'
  );
}

export async function listRecipients(actor: Actor) {
  if (!can(actor, 'recipients.viewBusiness')) throw ServiceError.forbidden();
  const rows = await getPrisma().recipientConfig.findMany({
    orderBy: [{ recipientClass: 'asc' }, { createdAt: 'desc' }],
  });
  // Masked ONLY - raw destinations never leave the service (I.7 analogue).
  // Whether this site's data key can read each row is told; the value is not.
  return rows.map(({ destinationCiphertext, ...r }) => ({
    ...r,
    readable: tryDecryptValue(destinationCiphertext) !== null,
  }));
}

export async function upsertRecipient(actor: Actor, rawInput: unknown, existingId?: string) {
  const parsed = recipientInputSchema.safeParse(rawInput);
  if (!parsed.success)
    throw ServiceError.validation(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  const input = parsed.data;
  const isExternal = EXTERNAL_RECIPIENT_CLASSES.includes(input.recipientClass);

  // D.1/D.2: destination (technical value) requires technical authority;
  // business-only fields may be maintained by HR.
  if (!can(actor, 'recipients.editTechnical') && !can(actor, 'recipients.editBusiness'))
    throw ServiceError.forbidden();

  const destErrors = destinationErrors(input.destination, environment());
  if (destErrors.length) throw ServiceError.validation(destErrors);

  const prisma = getPrisma();
  const correlationId = newCorrelationId();
  const data = {
    recipientClass: input.recipientClass,
    displayName: input.displayName,
    destinationCiphertext: encryptValue(input.destination),
    destinationMask: maskDestination(input.destination),
    allowedTypes: input.allowedTypes,
    isExternal,
    environment: environment(),
    effectiveFrom: input.effectiveFrom ?? null,
    changeReason: input.changeReason,
    purpose: input.purpose ?? null,
    organizationName: input.organizationName ?? null,
    contactName: input.contactName ?? null,
    // Any change resets approval and verification (D.3/D.7).
    approvalStatus: 'PENDING_APPROVAL' as const,
    approvedById: null,
    approvedAt: null,
    verifiedAt: null,
  };
  const record = await prisma.$transaction(async (tx) => {
    const row = existingId
      ? await tx.recipientConfig.update({ where: { id: existingId }, data })
      : await tx.recipientConfig.create({
          data: { ...data, createdById: actor.userId, ownerId: actor.userId },
        });
    await appendAudit(tx, {
      eventType: 'RECIPIENT_CHANGED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'RecipientConfig',
      objectId: row.id,
      result: 'SUCCESS',
      correlationId,
      // Mask only - never the destination itself (D / B.14).
      metadata: {
        recipientClass: input.recipientClass,
        destinationMask: data.destinationMask,
        isExternal,
        changeReason: input.changeReason,
      },
    });
    return row;
  });
  return { id: record.id, destinationMask: record.destinationMask };
}

/** D.3: external recipients require HR_MANAGER approval; internal ones are
 *  approved by the HR Manager as well (DEC-063). */
export async function approveRecipient(actor: Actor, id: string) {
  const prisma = getPrisma();
  const r = await prisma.recipientConfig.findUnique({ where: { id } });
  if (!r) throw ServiceError.notFound();
  if (r.isExternal) {
    if (!can(actor, 'recipients.approveExternal')) throw ServiceError.forbidden();
  } else if (!can(actor, 'recipients.editBusiness') && !can(actor, 'recipients.editTechnical')) {
    throw ServiceError.forbidden();
  }
  if (r.approvalStatus !== 'PENDING_APPROVAL')
    throw ServiceError.conflict(`Cannot approve from ${r.approvalStatus}.`);
  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    await tx.recipientConfig.update({
      where: { id },
      data: { approvalStatus: 'APPROVED', approvedById: actor.userId, approvedAt: new Date() },
    });
    await appendAudit(tx, {
      eventType: 'RECIPIENT_APPROVED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'RecipientConfig',
      objectId: id,
      result: 'SUCCESS',
      correlationId,
      metadata: { recipientClass: r.recipientClass, isExternal: r.isExternal },
    });
  });
}

/** Verification (safe test-connection): dev captures a probe; never a real
 *  message unless explicitly authorized (I.9). */
export async function verifyRecipient(actor: Actor, id: string) {
  if (!can(actor, 'recipients.editBusiness') && !can(actor, 'recipients.editTechnical'))
    throw ServiceError.forbidden();
  const prisma = getPrisma();
  const r = await prisma.recipientConfig.findUnique({ where: { id } });
  if (!r) throw ServiceError.notFound();
  if (r.approvalStatus !== 'APPROVED')
    throw ServiceError.validation(['Approve the recipient before verifying it.']);
  if (getConfig().isProduction)
    throw ServiceError.validation([
      'Production verification requires the approved live verification procedure (not available in this increment).',
    ]);
  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    await tx.recipientConfig.update({ where: { id }, data: { verifiedAt: new Date() } });
    await appendAudit(tx, {
      eventType: 'RECIPIENT_VERIFIED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'RecipientConfig',
      objectId: id,
      result: 'SUCCESS',
      correlationId,
      metadata: { recipientClass: r.recipientClass, mode: 'development-capture-probe' },
    });
  });
}

export async function suspendRecipient(actor: Actor, id: string, reason: string) {
  if (!can(actor, 'recipients.editBusiness') && !can(actor, 'recipients.editTechnical'))
    throw ServiceError.forbidden();
  if (!reason.trim()) throw ServiceError.validation(['A reason is required.']);
  const prisma = getPrisma();
  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    await tx.recipientConfig.update({
      where: { id },
      data: { approvalStatus: 'SUSPENDED', active: false, changeReason: reason },
    });
    await appendAudit(tx, {
      eventType: 'RECIPIENT_CHANGED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'RecipientConfig',
      objectId: id,
      result: 'SUCCESS',
      correlationId,
      metadata: { action: 'suspended', reason },
    });
  });
}

/**
 * Resolve a usable recipient for a notification type/class. Returns the
 * DECRYPTED destination for the outbox worker only - callers must never log
 * or persist it.
 */
export async function resolveUsableRecipient(
  recipientClass: RecipientClassName,
  notificationType: string,
): Promise<{ id: string; destination: string; destinationMask: string } | { errors: string[] }> {
  const prisma = getPrisma();
  const env = environment();
  const row = await prisma.recipientConfig.findFirst({
    where: { recipientClass, environment: env, active: true },
    orderBy: { updatedAt: 'desc' },
  });
  if (!row) return { errors: [`No ${recipientClass} recipient is configured for ${env}.`] };
  const errors = recipientUsableErrors(row, notificationType, env, new Date());
  if (errors.length) return { errors };
  const destination = tryDecryptValue(row.destinationCiphertext);
  if (destination === null) return { errors: [unreadableAddressMessage(recipientClass)] };
  return { id: row.id, destination, destinationMask: row.destinationMask };
}

/** Development mailbox (section C): captured messages, non-production only. */
export async function listDevMailbox(actor: Actor) {
  if (!can(actor, 'mailbox.dev')) throw ServiceError.forbidden();
  if (getConfig().isProduction)
    throw ServiceError.forbidden('The development mailbox does not exist in production.');
  return getPrisma().notificationCapture.findMany({
    orderBy: { capturedAt: 'desc' },
    take: 100,
    include: {
      record: {
        select: {
          notificationType: true,
          recipientClass: true,
          case: { select: { caseNumber: true, recordPurpose: true } },
        },
      },
    },
  });
}
