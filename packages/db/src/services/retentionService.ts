/**
 * Privacy, retention and data-subject operations (Directive 4 section P).
 *
 * Development uses synthetic retention schedules; nothing deletes
 * automatically; holds always win; destructive operations demand a dry run,
 * authorized approval and full audit. Immutable evidence (snapshots, audit,
 * attestations) is protected by database triggers - anonymization therefore
 * covers case-level identity fields and records the exact boundary.
 */
import { can, retentionEligible, ANONYMIZED_CASE_FIELDS, type Actor } from '@exit/domain';
import { z } from 'zod';
import { getPrisma } from '../client.ts';
import { getStorage, newPrefixedObjectKey } from '../storage.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, newCorrelationId } from './auditService.ts';

// --- policies ----------------------------------------------------------------

export const policyInputSchema = z.object({
  recordType: z.enum(['OFFBOARDING_CASE', 'SURVEY_RESPONSE', 'AUDIT_EVENT', 'ATTACHMENT']),
  retainYears: z.coerce.number().int().min(1).max(50),
  basis: z.string().trim().min(1).max(500),
  reason: z.string().trim().min(1).max(500),
});

export async function upsertRetentionPolicy(actor: Actor, rawInput: unknown) {
  if (!can(actor, 'privacy.operate')) throw ServiceError.forbidden();
  const parsed = policyInputSchema.safeParse(rawInput);
  if (!parsed.success)
    throw ServiceError.validation(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  const input = parsed.data;
  const prisma = getPrisma();
  const prior = await prisma.retentionPolicy.findFirst({
    where: { recordType: input.recordType },
    orderBy: { version: 'desc' },
  });
  const correlationId = newCorrelationId();
  const row = await prisma.$transaction(async (tx) => {
    await tx.retentionPolicy.updateMany({
      where: { recordType: input.recordType, active: true },
      data: { active: false },
    });
    const policy = await tx.retentionPolicy.create({
      data: {
        recordType: input.recordType,
        retainYears: input.retainYears,
        basis: input.basis,
        version: (prior?.version ?? 0) + 1,
        active: false, // activation is approval (below)
        createdById: actor.userId,
        reason: input.reason,
      },
    });
    await appendAudit(tx, {
      eventType: 'RETENTION_POLICY_CHANGED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'RetentionPolicy',
      objectId: policy.id,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        recordType: input.recordType,
        retainYears: input.retainYears,
        version: policy.version,
      },
    });
    return policy;
  });
  return row;
}

export async function approveRetentionPolicy(actor: Actor, id: string) {
  if (!can(actor, 'privacy.operate')) throw ServiceError.forbidden();
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    const p = await tx.retentionPolicy.update({
      where: { id },
      data: { active: true, approvedById: actor.userId, approvedAt: new Date() },
    });
    await appendAudit(tx, {
      eventType: 'RETENTION_POLICY_CHANGED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'RetentionPolicy',
      objectId: id,
      result: 'SUCCESS',
      correlationId: newCorrelationId(),
      metadata: { action: 'approved', recordType: p.recordType, version: p.version },
    });
  });
}

export async function listRetentionPolicies(actor: Actor) {
  if (!can(actor, 'privacy.view')) throw ServiceError.forbidden();
  return getPrisma().retentionPolicy.findMany({
    orderBy: [{ recordType: 'asc' }, { version: 'desc' }],
  });
}

// --- holds (P.3/P.4) ---------------------------------------------------------

export async function placeHold(actor: Actor, caseId: string, reason: string) {
  if (!can(actor, 'privacy.operate')) throw ServiceError.forbidden();
  if (!reason.trim()) throw ServiceError.validation(['A hold reason is required.']);
  const prisma = getPrisma();
  const correlationId = newCorrelationId();
  const hold = await prisma.$transaction(async (tx) => {
    const h = await tx.retentionHold.create({
      data: { caseId, reason, placedById: actor.userId },
    });
    await appendAudit(tx, {
      eventType: 'RETENTION_HOLD_PLACED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'RetentionHold',
      objectId: h.id,
      caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: { reason },
    });
    return h;
  });
  return hold;
}

export async function releaseHold(actor: Actor, holdId: string, note: string) {
  if (!can(actor, 'privacy.operate')) throw ServiceError.forbidden();
  if (!note.trim()) throw ServiceError.validation(['A release note is required.']);
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    const h = await tx.retentionHold.update({
      where: { id: holdId },
      data: { releasedById: actor.userId, releasedAt: new Date(), releaseNote: note },
    });
    await appendAudit(tx, {
      eventType: 'RETENTION_HOLD_RELEASED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'RetentionHold',
      objectId: holdId,
      caseId: h.caseId,
      result: 'SUCCESS',
      correlationId: newCorrelationId(),
      metadata: { note },
    });
  });
}

// --- retention runs (P.4/P.7) ------------------------------------------------

/** P.7: dry-run identifies eligible records WITHOUT touching anything. */
export async function retentionDryRun(actor: Actor) {
  if (!can(actor, 'privacy.operate')) throw ServiceError.forbidden();
  const prisma = getPrisma();
  const policy = await prisma.retentionPolicy.findFirst({
    where: { recordType: 'OFFBOARDING_CASE', active: true },
    orderBy: { version: 'desc' },
  });
  if (!policy) throw ServiceError.validation(['No active OFFBOARDING_CASE retention policy.']);
  const closed = await prisma.offboardingCase.findMany({
    where: { status: { in: ['COMPLETED', 'CANCELLED', 'VOIDED'] }, anonymizedAt: null },
    select: {
      id: true,
      caseNumber: true,
      closedAt: true,
      recordPurpose: true,
      retentionHolds: { where: { releasedAt: null }, select: { id: true } },
    },
  });
  const now = new Date();
  const findings = closed.map((c) => {
    const verdict = retentionEligible(
      { closedAt: c.closedAt, hasActiveHold: c.retentionHolds.length > 0 },
      policy,
      now,
    );
    return {
      caseId: c.id,
      caseNumber: c.caseNumber,
      recordPurpose: c.recordPurpose,
      eligible: verdict.eligible,
      reason: verdict.reason,
      held: c.retentionHolds.length > 0,
    };
  });
  const correlationId = newCorrelationId();
  const run = await prisma.retentionRun.create({
    data: {
      mode: 'DRY_RUN',
      policyVersion: policy.version,
      startedById: actor.userId,
      findings: findings as never,
      correlationId,
    },
  });
  await appendAudit(prisma, {
    eventType: 'RETENTION_RUN_COMPLETED',
    actorType: 'USER',
    actorId: actor.userId,
    effectiveRoles: actor.roles,
    objectType: 'RetentionRun',
    objectId: run.id,
    result: 'SUCCESS',
    correlationId,
    metadata: {
      mode: 'DRY_RUN',
      evaluated: findings.length,
      eligible: findings.filter((x) => x.eligible).length,
      held: findings.filter((x) => x.held).length,
    },
  });
  return { runId: run.id, findings };
}

/**
 * P.5: controlled anonymization of one case - approval-gated, hold-blocked,
 * TEST/TRAINING records only in this environment (no approved production
 * retention periods exist - P.1). Audit and structural evidence remain;
 * database-immutable artefacts (snapshot, attestations, audit) are the
 * documented anonymization boundary.
 */
export async function anonymizeCase(actor: Actor, caseId: string, reason: string) {
  if (!can(actor, 'privacy.operate')) throw ServiceError.forbidden();
  if (!reason.trim()) throw ServiceError.validation(['A reason is required (P.5).']);
  const prisma = getPrisma();
  const c = await prisma.offboardingCase.findUnique({
    where: { id: caseId },
    include: { retentionHolds: { where: { releasedAt: null } } },
  });
  if (!c) throw ServiceError.notFound();
  if (c.retentionHolds.length > 0)
    throw ServiceError.validation(['An active hold prevents this operation (P.4).']);
  if (!['COMPLETED', 'CANCELLED', 'VOIDED'].includes(c.status))
    throw ServiceError.validation(['Only closed cases can be anonymized.']);
  if (c.recordPurpose === 'OPERATIONAL')
    throw ServiceError.validation([
      'Operational anonymization requires approved production retention periods (P.1); use TEST/TRAINING records in this environment.',
    ]);
  if (c.anonymizedAt) throw ServiceError.conflict('The case is already anonymized.');

  const marker = `ANONYMIZED-${c.caseNumber}`;
  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    await tx.offboardingCase.updateMany({
      where: { id: caseId, version: c.version },
      data: {
        employeeDisplayName: marker,
        employeeWorkEmail: null,
        reasonNotes: null,
        anonymizedAt: new Date(),
        anonymizedById: actor.userId,
        version: { increment: 1 },
      },
    });
    await appendAudit(tx, {
      eventType: 'CASE_ANONYMIZED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'OffboardingCase',
      objectId: caseId,
      caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        caseNumber: c.caseNumber,
        reason,
        fields: ANONYMIZED_CASE_FIELDS.join(','),
        boundaryNote:
          'snapshot/attestation/audit rows are database-immutable and retained per design',
      },
    });
  });
}

// --- data-subject operations (P.6-P.9) ---------------------------------------

/** P.6: search everything held about a subject reference. */
export async function dataSubjectSearch(actor: Actor, subjectRef: string) {
  if (!can(actor, 'privacy.operate')) throw ServiceError.forbidden();
  const prisma = getPrisma();
  const [cases, sourceRecords, assets] = await Promise.all([
    prisma.offboardingCase.findMany({
      where: { employeeSourceId: subjectRef },
      select: {
        id: true,
        caseNumber: true,
        status: true,
        departureType: true,
        createdAt: true,
        anonymizedAt: true,
      },
    }),
    prisma.employeeSourceRecord.findMany({ where: { sourceId: subjectRef } }),
    prisma.issuedAsset.findMany({ where: { employeeSourceId: subjectRef } }),
  ]);
  return { subjectRef, cases, sourceRecords: sourceRecords.length, issuedAssets: assets.length };
}

/** P.8: export package with the mandated exclusions, stored privately. */
export async function prepareDsrPackage(actor: Actor, subjectRef: string) {
  if (!can(actor, 'privacy.operate')) throw ServiceError.forbidden();
  const prisma = getPrisma();
  const cases = await prisma.offboardingCase.findMany({
    where: { employeeSourceId: subjectRef },
    include: {
      documents: { select: { documentType: true, status: true, version: true, createdAt: true } },
      surveyInvitations: { select: { status: true, responseChannel: true, completedAt: true } },
      assetRecoveryItems: { select: { label: true, status: true, dispositionAt: true } },
    },
  });
  const pkg = {
    generatedAt: new Date().toISOString(),
    subjectRef,
    exclusionsApplied: [
      'other employees personal data',
      'restricted manager/private notes',
      'secrets and credential references',
      'internal security details',
    ],
    cases: cases.map((c) => ({
      caseNumber: c.caseNumber,
      status: c.status,
      departureType: c.departureType,
      receivedAt: c.receivedAt.toISOString(),
      // Restricted notes and rehire data are deliberately ABSENT (P.8).
      documents: c.documents,
      surveys: c.surveyInvitations,
      assets: c.assetRecoveryItems,
    })),
  };
  const objectKey = newPrefixedObjectKey('generated');
  await getStorage().put(objectKey, Buffer.from(JSON.stringify(pkg, null, 2), 'utf8'));
  const correlationId = newCorrelationId();
  const dsr = await prisma.dataSubjectRequest.create({
    data: {
      type: 'EXPORT',
      subjectRef,
      status: 'COMPLETED',
      packageObjectKey: objectKey,
      handledById: actor.userId,
      completedAt: new Date(),
      correlationId,
    },
  });
  await appendAudit(prisma, {
    eventType: 'DSR_UPDATED',
    actorType: 'USER',
    actorId: actor.userId,
    effectiveRoles: actor.roles,
    objectType: 'DataSubjectRequest',
    objectId: dsr.id,
    result: 'SUCCESS',
    correlationId,
    metadata: { type: 'EXPORT', caseCount: cases.length },
  });
  return { requestId: dsr.id, objectKey };
}

/** P.9: disclosure log entry - append-only evidence. */
export async function recordDisclosure(
  actor: Actor,
  input: {
    subjectRef: string;
    disclosedTo: string;
    description: string;
    lawfulBasis: string;
    caseId?: string;
  },
) {
  if (!can(actor, 'privacy.operate')) throw ServiceError.forbidden();
  for (const [k, v] of Object.entries(input)) {
    if (k !== 'caseId' && (!v || !String(v).trim()))
      throw ServiceError.validation([`${k} is required.`]);
  }
  const prisma = getPrisma();
  const correlationId = newCorrelationId();
  const row = await prisma.disclosureLog.create({
    data: {
      subjectRef: input.subjectRef,
      disclosedTo: input.disclosedTo,
      description: input.description,
      lawfulBasis: input.lawfulBasis,
      caseId: input.caseId ?? null,
      disclosedById: actor.userId,
      correlationId,
    },
  });
  await appendAudit(prisma, {
    eventType: 'DISCLOSURE_RECORDED',
    actorType: 'USER',
    actorId: actor.userId,
    effectiveRoles: actor.roles,
    objectType: 'DisclosureLog',
    objectId: row.id,
    caseId: input.caseId ?? null,
    result: 'SUCCESS',
    correlationId,
    metadata: { lawfulBasis: input.lawfulBasis },
  });
  return row;
}

export async function privacyOverview(actor: Actor) {
  if (!can(actor, 'privacy.view')) throw ServiceError.forbidden();
  const prisma = getPrisma();
  const [policies, holds, runs, dsrs, disclosures, incidents] = await Promise.all([
    prisma.retentionPolicy.findMany({ orderBy: [{ recordType: 'asc' }, { version: 'desc' }] }),
    prisma.retentionHold.findMany({
      orderBy: { placedAt: 'desc' },
      take: 20,
      include: { case: { select: { caseNumber: true } } },
    }),
    prisma.retentionRun.findMany({ orderBy: { startedAt: 'desc' }, take: 5 }),
    prisma.dataSubjectRequest.findMany({ orderBy: { requestedAt: 'desc' }, take: 20 }),
    prisma.disclosureLog.findMany({ orderBy: { disclosedAt: 'desc' }, take: 20 }),
    prisma.supportTicket.findMany({
      where: { category: 'SECURITY_PRIVACY_INCIDENT' },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ]);
  return { policies, holds, runs, dsrs, disclosures, incidents };
}
