/**
 * Asset recovery and disposition (Directive 3 section L).
 *
 * Hard boundary (fixed defaults 17-19 / L.5-L.7): NOTHING here touches pay.
 * There are no amount fields, no deduction fields and no payroll hooks; an
 * unresolved asset produces a review exception only.
 */
import {
  assetDispositionError,
  assetMetrics,
  canActOnCase,
  hasRole,
  ASSET_TYPES,
  FINAL_DISPOSITIONS,
  OPEN_ASSET_STATUSES,
  type Actor,
} from '@exit/domain';
import { z } from 'zod';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, newCorrelationId } from './auditService.ts';
import { loadCaseAccess } from './shared.ts';
import { autoResolveException, openException } from './exceptionService.ts';

export async function listCaseAssets(actor: Actor, caseId: string) {
  const { c, ctx } = await loadCaseAccess(actor, caseId);
  if (!canActOnCase(actor, 'asset.view', ctx)) throw ServiceError.forbidden();
  const items = await getPrisma().assetRecoveryItem.findMany({
    where: { caseId },
    orderBy: [{ createdAt: 'asc' }],
    include: { issuedAsset: { select: { issuedAt: true, issuingDepartment: true } } },
  });
  // L.10 / R.5: serial numbers and identifiers only for authorized users
  // (HR case workers on the case).
  const showIdentifiers = canActOnCase(actor, 'asset.manage', ctx);
  const now = Date.now();
  return {
    caseNumber: c.caseNumber,
    caseStatus: c.status,
    // Lets the page show what the directory says this employee holds, even
    // before activation turns those records into recovery items.
    employeeSourceId: c.employeeSourceId,
    items: items.map((i) => ({
      id: i.id,
      assetType: i.assetType,
      label: i.label,
      identifier: showIdentifiers ? i.identifier : i.identifier ? '(restricted)' : null,
      serialNumber: showIdentifiers ? i.serialNumber : i.serialNumber ? '(restricted)' : null,
      responsibleDepartment: i.responsibleDepartment,
      expectedReturnAt: i.expectedReturnAt,
      overdue:
        i.expectedReturnAt !== null &&
        i.expectedReturnAt.getTime() < now &&
        OPEN_ASSET_STATUSES.includes(i.status),
      requiredForClearance: i.requiredForClearance,
      status: i.status,
      receivedAt: i.receivedAt,
      condition: i.condition,
      remarks: i.remarks,
      dispositionReason: i.dispositionReason,
      dispositionAt: i.dispositionAt,
      manuallyAdded: i.manuallyAdded,
      issuedAt: i.issuedAsset?.issuedAt ?? null,
      evidenceAttachmentId: i.evidenceAttachmentId,
      rowVersion: i.rowVersion,
    })),
    metrics: assetMetrics(items),
    canManage: canActOnCase(actor, 'asset.manage', ctx),
    canWaiveWriteOff: canActOnCase(actor, 'asset.waiveWriteOff', ctx),
  };
}

export const addAssetSchema = z.object({
  assetType: z.enum(ASSET_TYPES),
  label: z.string().trim().min(1).max(200),
  identifier: z.string().trim().max(100).optional(),
  serialNumber: z.string().trim().max(100).optional(),
  responsibleDepartment: z.enum(['HR', 'IT', 'FINANCE', 'LINE_MANAGER']).default('HR'),
  expectedReturnAt: z
    .union([z.null(), z.literal('').transform(() => null), z.coerce.date()])
    .optional(),
  requiredForClearance: z.boolean().default(true),
});

/** L: manually add a recovery item beyond the issued-asset list. */
export async function addAssetRecoveryItem(actor: Actor, caseId: string, rawInput: unknown) {
  const parsed = addAssetSchema.safeParse(rawInput);
  if (!parsed.success)
    throw ServiceError.validation(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  const input = parsed.data;
  const { c, ctx } = await loadCaseAccess(actor, caseId);
  if (!canActOnCase(actor, 'asset.manage', ctx)) throw ServiceError.forbidden();
  if (['COMPLETED', 'CANCELLED', 'VOIDED'].includes(c.status))
    throw ServiceError.conflict('Assets cannot be added to a closed case.');

  const correlationId = newCorrelationId();
  return getPrisma().$transaction(async (tx) => {
    const item = await tx.assetRecoveryItem.create({
      data: {
        caseId,
        manuallyAdded: true,
        assetType: input.assetType,
        label: input.label,
        identifier: input.identifier || null,
        serialNumber: input.serialNumber || null,
        responsibleDepartment: input.responsibleDepartment,
        expectedReturnAt: input.expectedReturnAt ?? c.confirmedLastDay ?? c.effectiveSeparationAt,
        requiredForClearance: input.requiredForClearance,
      },
    });
    await appendAudit(tx, {
      eventType: 'ASSET_ITEM_ADDED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'AssetRecoveryItem',
      objectId: item.id,
      caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: { assetType: input.assetType, requiredForClearance: input.requiredForClearance },
    });
    return item;
  });
}

export const dispositionSchema = z.object({
  status: z.enum([
    'REQUESTED',
    'PARTIALLY_RETURNED',
    'RETURNED',
    'NOT_ISSUED',
    'LOST',
    'DAMAGED',
    'WAIVED',
    'WRITTEN_OFF',
    'UNRESOLVED',
  ]),
  condition: z.string().trim().max(300).optional(),
  remarks: z.string().trim().max(1000).optional(),
  reason: z.string().trim().max(1000).optional(),
  evidenceAttachmentId: z.uuid().optional(),
});

/**
 * L.4: record an operational state change or final disposition. LOST/DAMAGED/
 * WAIVED/WRITTEN_OFF/UNRESOLVED require a reason; WAIVED/WRITTEN_OFF require
 * HR_MANAGER. No payroll effect of any kind (L.5/L.6).
 */
export async function setAssetDisposition(actor: Actor, itemId: string, rawInput: unknown) {
  const parsed = dispositionSchema.safeParse(rawInput);
  if (!parsed.success)
    throw ServiceError.validation(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  const input = parsed.data;

  const prisma = getPrisma();
  const item = await prisma.assetRecoveryItem.findUnique({ where: { id: itemId } });
  if (!item) throw ServiceError.notFound();
  const { ctx } = await loadCaseAccess(actor, item.caseId);
  if (!canActOnCase(actor, 'asset.manage', ctx)) throw ServiceError.forbidden();
  if (FINAL_DISPOSITIONS.includes(item.status) && item.status !== 'UNRESOLVED')
    throw ServiceError.conflict(
      'This item already has a final disposition; corrections require a new audited change.',
    );

  const dispositionErr = assetDispositionError(
    input.status,
    input.reason,
    hasRole(actor, 'HR_MANAGER') && canActOnCase(actor, 'asset.waiveWriteOff', ctx),
  );
  if (dispositionErr) throw ServiceError.validation([dispositionErr]);

  const isFinal = FINAL_DISPOSITIONS.includes(input.status);
  const isReturn = input.status === 'RETURNED' || input.status === 'PARTIALLY_RETURNED';
  const now = new Date();
  const correlationId = newCorrelationId();

  await prisma.$transaction(async (tx) => {
    const updated = await tx.assetRecoveryItem.updateMany({
      where: { id: itemId, rowVersion: item.rowVersion },
      data: {
        status: input.status,
        condition: input.condition ?? item.condition,
        remarks: input.remarks ?? item.remarks,
        evidenceAttachmentId: input.evidenceAttachmentId ?? item.evidenceAttachmentId,
        ...(isReturn ? { receivedById: actor.userId, receivedAt: now } : {}),
        ...(isFinal
          ? {
              dispositionReason: input.reason ?? null,
              dispositionById: actor.userId,
              dispositionAt: now,
            }
          : {}),
        rowVersion: { increment: 1 },
      },
    });
    if (updated.count === 0) throw ServiceError.conflict('The item changed; reload and retry.');
    await appendAudit(tx, {
      eventType: isFinal ? 'ASSET_DISPOSITION_RECORDED' : 'ASSET_STATUS_UPDATED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'AssetRecoveryItem',
      objectId: itemId,
      caseId: item.caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        assetType: item.assetType,
        oldStatus: item.status,
        newStatus: input.status,
        reason: input.reason ?? null,
      },
    });
  });

  // L.7 / fixed default 19: unresolved/lost surfaces a REVIEW exception for
  // HR/Finance - explicitly with no financial recommendation of any kind.
  if (input.status === 'UNRESOLVED' || input.status === 'LOST') {
    await openException(item.caseId, {
      exceptionType: 'ASSET_UNRESOLVED',
      severity: 'WARNING',
      title: `Asset ${input.status.toLowerCase()}: ${item.label}`,
      detail:
        'Authorized HR/Finance review required. This exception carries no payroll instruction and no deduction recommendation.',
      refType: 'AssetRecoveryItem',
      refId: itemId,
      ownerDepartment: 'HR',
    });
  } else if (isFinal) {
    await autoResolveException(item.caseId, 'ASSET_UNRESOLVED', itemId, 'Disposition documented.');
    await autoResolveException(item.caseId, 'ASSET_OVERDUE', itemId, 'Disposition documented.');
  }
}

/** Issued-asset register lookups (synthetic development data). */
export async function listIssuedAssetsForEmployee(actor: Actor, employeeSourceId: string) {
  if (!hasRole(actor, 'HR_MANAGER', 'HR_OFFICER')) throw ServiceError.forbidden();
  return getPrisma().issuedAsset.findMany({
    where: { employeeSourceId, active: true },
    orderBy: { catalogueLabel: 'asc' },
  });
}
