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
import type { getPrisma } from './client.ts';

type Db = ReturnType<typeof getPrisma>;

const DEV_RECIPIENTS = [
  {
    recipientClass: 'IT_OFFBOARDING',
    displayName: 'DEV IT offboarding mailbox',
    destination: 'capture://it-offboarding',
    purpose: null,
    organizationName: null,
    contactName: null,
  },
  {
    recipientClass: 'FINANCE_OFFBOARDING',
    displayName: 'DEV Finance offboarding mailbox',
    destination: 'capture://finance-offboarding',
    purpose: null,
    organizationName: null,
    contactName: null,
  },
  {
    recipientClass: 'HR_OFFBOARDING',
    displayName: 'DEV HR offboarding mailbox',
    destination: 'capture://hr-offboarding',
    purpose: null,
    organizationName: null,
    contactName: null,
  },
  {
    recipientClass: 'LINE_MANAGER',
    displayName: 'DEV line-manager mailbox',
    destination: 'capture://line-manager',
    purpose: null,
    organizationName: null,
    contactName: null,
  },
  {
    recipientClass: 'SAGICOR_GROUP_HEALTH',
    displayName: 'DEV Sagicor capture (synthetic)',
    destination: 'capture://sagicor-group-health',
    purpose: 'GROUP_HEALTH_REMOVAL',
    organizationName: 'Sagicor (synthetic)',
    contactName: 'Group Benefits Team',
  },
  {
    recipientClass: 'NCB_GROUP_LIFE',
    displayName: 'DEV NCB capture (synthetic)',
    destination: 'capture://ncb-group-life',
    purpose: 'GROUP_LIFE_REMOVAL',
    organizationName: 'NCB Insurance (synthetic)',
    contactName: 'Group Life Team',
  },
  {
    recipientClass: 'EMPLOYEE_PERSONAL',
    displayName: 'DEV employee capture (synthetic)',
    destination: 'capture://employee-personal',
    purpose: null,
    organizationName: null,
    contactName: null,
  },
  // Directive 6.3 N: independently configurable provider purposes.
  {
    recipientClass: 'PAYROLL_BANK',
    displayName: 'DEV payroll/bank capture (synthetic)',
    destination: 'capture://payroll-bank',
    purpose: 'PAYROLL_OR_BANK_NOTIFICATION',
    organizationName: 'NCB Bank (synthetic)',
    contactName: 'Payroll Services Team',
  },
  {
    recipientClass: 'OTHER_APPROVED_EXTERNAL',
    displayName: 'DEV other approved provider capture (synthetic)',
    destination: 'capture://other-approved-external',
    purpose: 'OTHER_APPROVED_PROVIDER',
    organizationName: 'Other approved provider (synthetic)',
    contactName: 'Provider Contact Team',
  },
] as const;

export async function seedStage4(db: Db): Promise<void> {
  const hrManager = await db.user.findUniqueOrThrow({
    where: { identitySubject: 'dev|hr-manager' },
  });
  for (const r of DEV_RECIPIENTS) {
    const existing = await db.recipientConfig.findFirst({
      where: { recipientClass: r.recipientClass, environment: 'development' },
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
        environment: 'development',
        allowedTypes: [...NOTIFICATION_TYPES],
        isExternal: (EXTERNAL_RECIPIENT_CLASSES as readonly string[]).includes(r.recipientClass),
        purpose: r.purpose,
        organizationName: r.organizationName,
        contactName: r.contactName,
        approvalStatus: 'APPROVED',
        approvedById: hrManager.id,
        approvedAt: new Date(),
        verifiedAt: new Date(),
        changeReason: 'Synthetic development seed (Stage 4) - capture destinations only.',
        createdById: hrManager.id,
        ownerId: hrManager.id,
      },
    });
  }
}
