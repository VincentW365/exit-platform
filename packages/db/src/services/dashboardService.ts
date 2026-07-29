/**
 * HR dashboard queries (REQ-REPORT-001/004/005). Every count applies the same
 * record-level visibility as detail views so restricted cases never leak
 * through numbers (REQ-SEC-008).
 */
import { daysUntil, type Actor } from '@exit/domain';
import { can } from '@exit/domain';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';

function hrVisibilityWhere(actor: Actor) {
  return {
    OR: [
      { classification: 'CONFIDENTIAL' as const },
      { participants: { some: { userId: actor.userId, removedAt: null } } },
      { ownerId: actor.userId },
    ],
  };
}

export async function hrDashboard(actor: Actor) {
  if (!can(actor, 'baseline.viewDashboard')) throw ServiceError.forbidden();
  const prisma = getPrisma();
  const visibility = hrVisibilityWhere(actor);

  const [byStatus, upcoming, baselineOpen, trainingCount] = await Promise.all([
    prisma.offboardingCase.groupBy({
      by: ['status'],
      where: { AND: [visibility, { recordPurpose: 'OPERATIONAL' }] },
      _count: { _all: true },
    }),
    prisma.offboardingCase.findMany({
      where: {
        AND: [
          visibility,
          {
            recordPurpose: 'OPERATIONAL',
            status: { in: ['PENDING_HR_REVIEW', 'APPROVED', 'ACTIVE'] },
            effectiveSeparationAt: {
              gte: new Date(),
              lte: new Date(Date.now() + 30 * 24 * 60 * 60_000),
            },
          },
        ],
      },
      orderBy: { effectiveSeparationAt: 'asc' },
      take: 20,
      select: {
        id: true,
        caseNumber: true,
        employeeDisplayName: true,
        classification: true,
        departureType: true,
        status: true,
        effectiveSeparationAt: true,
      },
    }),
    prisma.offboardingCase.count({
      where: {
        AND: [
          visibility,
          {
            recordPurpose: 'OPERATIONAL',
            measurementCohort: 'BASELINE',
            status: { notIn: ['VOIDED', 'CANCELLED', 'COMPLETED'] },
          },
        ],
      },
    }),
    prisma.offboardingCase.count({ where: { recordPurpose: { in: ['TRAINING', 'TEST'] } } }),
  ]);

  const now = new Date();
  return {
    countsByStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
    upcomingDepartures: upcoming.map((c) => ({
      ...c,
      daysUntil: c.effectiveSeparationAt ? daysUntil(c.effectiveSeparationAt, now) : null,
    })),
    baselineOpenCount: baselineOpen,
    nonOperationalCount: trainingCount,
  };
}
