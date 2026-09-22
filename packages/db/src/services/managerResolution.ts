/**
 * Shared directory manager resolution (Directive 6.1 F, de-duplicated in
 * Directive 6.2; directory-only under the two-role model, DEC-063). Given an
 * employee's directory identity, derive the reporting manager (name + source
 * id) from directory data. Reporting managers are not application logins,
 * so no account lookup takes place: `managerUserId` is always null, and the
 * manager is reached as a notification recipient or token-link holder.
 */
import { SYNTHETIC_EMPLOYEES } from '@exit/domain';
import { getPrisma } from '../client.ts';

export interface ResolvedManager {
  managerName: string | null;
  managerSourceId: string | null;
  /** Always null: reporting managers hold no application account (DEC-063). */
  managerUserId: null;
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

  return {
    managerName,
    managerSourceId,
    managerUserId: null,
    lastSyncedAt: sourceRow?.lastSyncedAt ?? null,
  };
}
