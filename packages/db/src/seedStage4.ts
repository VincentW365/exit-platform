/**
 * Stage 4 synthetic seeds (Directive 4 section D): development recipient
 * configurations using CAPTURE destinations only - no real address is ever
 * seeded (D.6). Seeded entries are approved+verified so TEST/TRAINING flows
 * can exercise the outbox against the development mailbox immediately.
 */
import { maskDestination, NOTIFICATION_TYPES } from '@exit/domain';
import { encryptValue } from './secretBox.ts';
import type { getPrisma } from './client.ts';

type Db = ReturnType<typeof getPrisma>;

const DEV_RECIPIENTS = [
  {
    recipientClass: 'IT_OFFBOARDING',
    displayName: 'DEV IT offboarding mailbox',
    destination: 'capture://it-offboarding',
  },
  {
    recipientClass: 'FINANCE_OFFBOARDING',
    displayName: 'DEV Finance offboarding mailbox',
    destination: 'capture://finance-offboarding',
  },
  {
    recipientClass: 'HR_OFFBOARDING',
    displayName: 'DEV HR offboarding mailbox',
    destination: 'capture://hr-offboarding',
  },
  {
    recipientClass: 'LINE_MANAGER',
    displayName: 'DEV line-manager mailbox',
    destination: 'capture://line-manager',
  },
  {
    recipientClass: 'SAGICOR_GROUP_HEALTH',
    displayName: 'DEV Sagicor capture (synthetic)',
    destination: 'capture://sagicor-group-health',
  },
  {
    recipientClass: 'NCB_GROUP_LIFE',
    displayName: 'DEV NCB capture (synthetic)',
    destination: 'capture://ncb-group-life',
  },
  {
    recipientClass: 'EMPLOYEE_PERSONAL',
    displayName: 'DEV employee capture (synthetic)',
    destination: 'capture://employee-personal',
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
    if (existing) continue;
    await db.recipientConfig.create({
      data: {
        recipientClass: r.recipientClass,
        displayName: r.displayName,
        destinationCiphertext: encryptValue(r.destination),
        destinationMask: maskDestination(r.destination),
        environment: 'development',
        allowedTypes: [...NOTIFICATION_TYPES],
        isExternal: ['SAGICOR_GROUP_HEALTH', 'NCB_GROUP_LIFE', 'EMPLOYEE_PERSONAL'].includes(
          r.recipientClass,
        ),
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
