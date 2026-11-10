/**
 * Stage 4 synthetic seeds (Directive 4 section D; extended by Directive 6.3
 * N/P): development recipient configurations using CAPTURE destinations only -
 * no real address is ever seeded (D.6). Seeded entries are approved+verified
 * so TEST/TRAINING flows can exercise the outbox against the development
 * mailbox immediately. Directive 6.3 adds the provider purpose + human
 * identity fields and the independently configurable payroll/bank and
 * other-approved-provider rows (all synthetic organisations).
 */
import { maskDestination, EXTERNAL_RECIPIENT_CLASSES, NOTIFICATION_TYPES } from '@exit/domain';
import { encryptValue } from './secretBox.ts';
import { repairSeededRecipientRows } from './services/recipientService.ts';
import { DEV_RECIPIENTS, SEED_CHANGE_REASON, SEED_ENVIRONMENT } from './syntheticRecipients.ts';
import type { getPrisma } from './client.ts';

type Db = ReturnType<typeof getPrisma>;

/**
 * Write the shipped routes into the routing table on first seed. Storing them
 * makes the configuration visible and editable from day one; the values are
 * identical to what the code used to hard-code, so nothing about who receives
 * what changes.
 */
async function seedRoutes(db: Db): Promise<void> {
  const { DEFAULT_ROUTES } = await import('./services/routingService.ts');
  for (const [notificationType, route] of Object.entries(DEFAULT_ROUTES)) {
    const existing = await db.notificationRouting.findUnique({
      where: { notificationType: notificationType as never },
    });
    if (existing) continue;
    await db.notificationRouting.create({
      data: {
        notificationType: notificationType as never,
        toDestination: route.to,
        ccDestinations: route.cc ?? [],
        bccDestinations: [],
        note: route.note ?? null,
      },
    });
  }
}

export async function seedStage4(db: Db): Promise<void> {
  const hrManager = await db.user.findUniqueOrThrow({
    where: { identitySubject: 'dev|hr-manager' },
  });
  for (const r of DEV_RECIPIENTS) {
    const existing = await db.recipientConfig.findFirst({
      where: { recipientClass: r.recipientClass, environment: SEED_ENVIRONMENT },
    });
    if (existing) {
      // Directive 6.3 N/P: backfill the purpose/identity metadata and the
      // extended allowed types on rows from earlier seeds. The destination
      // itself never changes here (that path requires re-approval, D.3/D.7).
      await db.recipientConfig.update({
        where: { id: existing.id },
        data: {
          purpose: r.purpose,
          organizationName: r.organizationName,
          contactName: r.contactName,
          allowedTypes: [...NOTIFICATION_TYPES],
        },
      });
      continue;
    }
    await db.recipientConfig.create({
      data: {
        recipientClass: r.recipientClass,
        displayName: r.displayName,
        destinationCiphertext: encryptValue(r.destination),
        destinationMask: maskDestination(r.destination),
        environment: SEED_ENVIRONMENT,
        allowedTypes: [...NOTIFICATION_TYPES],
        isExternal: (EXTERNAL_RECIPIENT_CLASSES as readonly string[]).includes(r.recipientClass),
        purpose: r.purpose,
        organizationName: r.organizationName,
        contactName: r.contactName,
        approvalStatus: 'APPROVED',
        approvedById: hrManager.id,
        approvedAt: new Date(),
        verifiedAt: new Date(),
        changeReason: SEED_CHANGE_REASON,
        createdById: hrManager.id,
        ownerId: hrManager.id,
      },
    });
  }
  // DEC-073: a seeded address this machine's data key cannot read (the
  // secret changed since the last seed) is re-encrypted from the table above.
  const repair = await repairSeededRecipientRows(db, {
    actorId: hrManager.id,
    roles: ['HR_MANAGER'],
  });
  if (repair.repaired) {
    // eslint-disable-next-line no-console -- seed progress, like the line below it
    console.log(`Re-encrypted ${repair.repaired} seeded recipient address(es) with this data key.`);
  }
  await seedRoutes(db);
}
