/**
 * Case attachments: quarantine-first uploads with allow-list validation
 * (REQ-SEC-019/020/021/022, REQ-CASE-018).
 */
import { createHash } from 'node:crypto';
import { getConfig } from '@exit/config';
import {
  canActOnCase,
  isServable,
  uploadValidationErrors,
  type Actor,
  type AttachmentPurpose,
} from '@exit/domain';
import { canDiscoverCase, canViewCase, type CaseAccessContext } from '@exit/domain';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { getStorage, newObjectKey } from '../storage.ts';
import { appendAudit, auditDenied, newCorrelationId } from './auditService.ts';

async function loadAccess(caseId: string) {
  const c = await getPrisma().offboardingCase.findUnique({
    where: { id: caseId },
    select: {
      id: true,
      caseNumber: true,
      status: true,
      ownerId: true,
      classification: true,
      participants: { where: { removedAt: null }, select: { userId: true } },
    },
  });
  if (!c) throw ServiceError.notFound();
  const ctx: CaseAccessContext = {
    ownerId: c.ownerId,
    classification: c.classification,
    participantUserIds: c.participants.map((p) => p.userId),
  };
  return { c, ctx };
}

function assertView(actor: Actor, ctx: CaseAccessContext): void {
  if (canViewCase(actor, ctx)) return;
  if (canDiscoverCase(actor, ctx)) throw ServiceError.forbidden();
  throw ServiceError.notFound();
}

export async function uploadAttachment(
  actor: Actor,
  caseId: string,
  file: { fileName: string; declaredMime: string; bytes: Uint8Array },
  purpose: AttachmentPurpose,
) {
  const { c, ctx } = await loadAccess(caseId);
  assertView(actor, ctx);
  if (!canActOnCase(actor, 'attachment.upload', ctx)) {
    await auditDenied(actor, 'ACCESS_DENIED', 'Attachment', 'upload', caseId);
    throw ServiceError.forbidden();
  }
  if (c.status === 'VOIDED' || c.status === 'CANCELLED')
    throw ServiceError.conflict('Closed cases do not accept new attachments.');

  const config = getConfig();
  const errors = uploadValidationErrors(
    {
      fileName: file.fileName,
      declaredMime: file.declaredMime,
      sizeBytes: file.bytes.byteLength,
      head: file.bytes.slice(0, 8),
    },
    config.MAX_UPLOAD_MB,
  );
  if (errors.length) throw ServiceError.validation(errors);

  const objectKey = newObjectKey();
  const checksum = createHash('sha256').update(file.bytes).digest('hex');

  // Quarantine-first: files are PENDING unless the explicitly-labelled
  // non-production passthrough is configured. No real scan is claimed.
  const scanStatus = config.SCAN_MODE === 'dev-passthrough' ? 'CLEAN' : 'PENDING';
  const scanNote =
    config.SCAN_MODE === 'dev-passthrough'
      ? 'dev-passthrough: no real malware scan performed (non-production only)'
      : 'quarantined: no scanner configured in this environment';

  await getStorage().put(objectKey, file.bytes);

  const correlationId = newCorrelationId();
  const created = await getPrisma().$transaction(async (tx) => {
    const a = await tx.attachment.create({
      data: {
        caseId,
        purpose,
        fileName: file.fileName,
        objectKey,
        mimeType: file.declaredMime,
        sizeBytes: file.bytes.byteLength,
        checksum,
        scanStatus,
        scanNote,
        uploadedById: actor.userId,
      },
    });
    await appendAudit(tx, {
      eventType: 'FILE_UPLOADED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'Attachment',
      objectId: a.id,
      caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        caseNumber: c.caseNumber,
        purpose,
        mimeType: file.declaredMime,
        sizeBytes: file.bytes.byteLength,
        scanStatus,
      },
    });
    return a;
  });

  return { attachmentId: created.id, scanStatus };
}

export async function listAttachments(actor: Actor, caseId: string) {
  const { ctx } = await loadAccess(caseId);
  assertView(actor, ctx);
  return getPrisma().attachment.findMany({
    where: { caseId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      purpose: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      scanStatus: true,
      scanNote: true,
      createdAt: true,
      uploadedById: true,
    },
  });
}

export async function downloadAttachment(actor: Actor, attachmentId: string) {
  const prisma = getPrisma();
  const a = await prisma.attachment.findUnique({ where: { id: attachmentId } });
  if (!a) throw ServiceError.notFound();
  const { c, ctx } = await loadAccess(a.caseId);
  assertView(actor, ctx);
  if (!canActOnCase(actor, 'attachment.download', ctx)) {
    await auditDenied(actor, 'ACCESS_DENIED', 'Attachment', attachmentId, a.caseId);
    throw ServiceError.forbidden();
  }
  if (!isServable(a.scanStatus)) {
    throw ServiceError.conflict(
      'This file is quarantined and cannot be downloaded (scan status: ' + a.scanStatus + ').',
    );
  }

  const bytes = await getStorage().get(a.objectKey);
  const checksum = createHash('sha256').update(bytes).digest('hex');
  if (checksum !== a.checksum)
    throw ServiceError.conflict('Stored file failed its integrity check; download blocked.');

  await appendAudit(prisma, {
    eventType: 'FILE_DOWNLOADED',
    actorType: 'USER',
    actorId: actor.userId,
    effectiveRoles: actor.roles,
    objectType: 'Attachment',
    objectId: a.id,
    caseId: a.caseId,
    result: 'SUCCESS',
    correlationId: newCorrelationId(),
    metadata: { caseNumber: c.caseNumber, mimeType: a.mimeType, sizeBytes: a.sizeBytes },
  });

  return { fileName: a.fileName, mimeType: a.mimeType, bytes };
}
