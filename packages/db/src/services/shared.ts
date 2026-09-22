/** Shared Stage 2 service helpers: case access loading and feature gating. */
import {
  automationPermitted,
  canDiscoverCase,
  canViewCase,
  caseAccessLevel,
  type Actor,
  type CaseAccessContext,
  type CaseAccessLevel,
} from '@exit/domain';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';

export interface LoadedCase {
  c: NonNullable<Awaited<ReturnType<typeof loadCaseRaw>>>;
  ctx: CaseAccessContext;
  level: CaseAccessLevel;
}

async function loadCaseRaw(caseId: string) {
  return getPrisma().offboardingCase.findUnique({
    where: { id: caseId },
    include: {
      participants: { where: { removedAt: null } },
      snapshot: { select: { id: true, payload: true, retrievedAt: true } },
    },
  });
}

/** Load case + access context; NOT_FOUND for undiscoverable actors. */
export async function loadCaseAccess(actor: Actor, caseId: string): Promise<LoadedCase> {
  const c = await loadCaseRaw(caseId);
  if (!c) throw ServiceError.notFound();
  const ctx: CaseAccessContext = {
    ownerId: c.ownerId,
    assignedOfficerId: c.assignedOfficerId,
    classification: c.classification,
    participantUserIds: c.participants.map((p) => p.userId),
  };
  const level = caseAccessLevel(actor, ctx);
  if (level === 'NONE') throw ServiceError.notFound();
  return { c, ctx, level };
}

export function assertFullView(actor: Actor, ctx: CaseAccessContext): void {
  if (canViewCase(actor, ctx)) return;
  if (canDiscoverCase(actor, ctx)) throw ServiceError.forbidden();
  throw ServiceError.notFound();
}

/**
 * Feature gate (fixed defaults 25/26 + DEC-007): TRAINING/TEST records may
 * always exercise features; OPERATIONAL records require the flag enabled AND
 * a non-BASELINE cohort (automationPermitted).
 */
export async function assertFeatureAllowed(
  caseLike: { recordPurpose: string; measurementCohort: string | null },
  flagKey: string,
): Promise<void> {
  if (caseLike.recordPurpose !== 'OPERATIONAL') return;
  const flag = await getPrisma().featureFlag.findUnique({ where: { key: flagKey } });
  const permitted = automationPermitted(
    {
      recordPurpose: caseLike.recordPurpose as 'OPERATIONAL',
      measurementCohort: caseLike.measurementCohort as 'BASELINE' | 'PILOT' | 'POST_ROLLOUT' | null,
    },
    flag?.enabled ?? false,
  );
  if (!permitted) {
    throw ServiceError.validation([
      `This feature is disabled for operational records (flag "${flagKey}" is off or the case is in the BASELINE cohort). ` +
        'Use a TRAINING or TEST record for development, or await pilot activation.',
    ]);
  }
}
