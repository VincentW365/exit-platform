/**
 * Shared directory→application manager resolution (Directive 6.1 F,
 * de-duplicated in Directive 6.2). Given an employee's directory identity,
 * derive the reporting manager (name + source id) and resolve it to an
 * ACTIVE application account holding LINE_MANAGER - by work email first,
 * then by a globally unique exact display name. Ambiguity resolves to null:
 * HR reviews and overrides rather than the system guessing.
 */
import { SYNTHETIC_EMPLOYEES } from '@exit/domain';
import { getPrisma } from '../client.ts';

export interface ResolvedManager {
  managerName: string | null;
  managerSourceId: string | null;
  managerUserId: string | null;
  lastSyncedAt: Date | null;
}

export async function resolveDirectoryManager(
  sourceSystem: string,
  sourceId: string,
): Promise<ResolvedManager> {
  const prisma = getPrisma();
  const sourceRow = await prisma.employeeSourceRecord.findUnique({
    where: { sourceSystem_sourceId: { sourceSystem, sourceId } },
    select: { managerName: true, managerSourceId: true, lastSyncedAt: true },
  });
  const fixture =
    sourceSystem === 'SYNTHETIC' ? SYNTHETIC_EMPLOYEES.find((s) => s.sourceId === sourceId) : null;
  const managerName = sourceRow?.managerName ?? fixture?.managerName ?? null;
  const managerSourceId = sourceRow?.managerSourceId ?? fixture?.managerSourceId ?? null;
  let managerUserId: string | null = null;

  if (managerName || managerSourceId) {
    const managerRecord = managerSourceId
      ? await prisma.employeeSourceRecord.findUnique({
          where: { sourceSystem_sourceId: { sourceSystem, sourceId: managerSourceId } },
          select: { workEmail: true, displayName: true },
        })
      : null;
    const managerFixture =
      sourceSystem === 'SYNTHETIC' && managerSourceId
        ? SYNTHETIC_EMPLOYEES.find((s) => s.sourceId === managerSourceId)
        : null;
    const managerEmail = managerRecord?.workEmail ?? managerFixture?.workEmail ?? null;
    // Resolution requires an ACTIVE application account holding LINE_MANAGER
    // (assignment-scoped manager authority); otherwise the plan shows the
    // directory manager with no account and HR overrides or maps an account.
    const candidates = await prisma.user.findMany({
      where: {
        isActive: true,
        roleAssignments: { some: { role: 'LINE_MANAGER', revokedAt: null } },
        OR: [
          ...(managerEmail ? [{ workEmail: managerEmail }] : []),
          ...(managerName ? [{ displayName: managerName }] : []),
        ],
      },
      select: { id: true, workEmail: true, displayName: true },
      take: 3,
    });
    const emailMatch = managerEmail
      ? candidates.find((u) => u.workEmail.toLowerCase() === managerEmail.toLowerCase())
      : undefined;
    const nameMatches = managerName ? candidates.filter((u) => u.displayName === managerName) : [];
    managerUserId = emailMatch?.id ?? (nameMatches.length === 1 ? nameMatches[0]!.id : null);
  }

  return {
    managerName,
    managerSourceId,
    managerUserId,
    lastSyncedAt: sourceRow?.lastSyncedAt ?? null,
  };
}
